//! In-app updates, straight from GitHub Releases: no server, no extra metadata file.
//!
//! `check_update` asks the releases API for the latest release and remembers it in managed state.
//! `install_update` then downloads *that remembered asset* (the frontend never supplies a URL),
//! checks its SHA-256 against the digest GitHub publishes, and swaps it in:
//!   - installed build: runs the NSIS setup (`/P` passive, `/R` relaunch) and exits;
//!   - portable build: renames the running exe aside, drops the new one in its place, relaunches.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

const REPO: &str = "Cauze/Codepad";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    notes_url: String,
    asset_name: String,
    #[serde(skip)]
    asset_url: String,
    size: u64,
    #[serde(skip)]
    digest: Option<String>,
    /// true = the portable exe will be swapped in place; false = the installer will be run
    portable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    current: String,
    latest: Option<UpdateInfo>,
}

#[derive(Default)]
pub struct UpdateState(Mutex<Option<UpdateInfo>>);

/* ---------- where to look ---------- */

// Debug builds can be pointed at a local fake release (used by the tests); release builds can't.
#[cfg(debug_assertions)]
fn api_override() -> Option<String> {
    std::env::var("CODEPAD_UPDATE_API").ok()
}
#[cfg(not(debug_assertions))]
fn api_override() -> Option<String> {
    None
}

/// The running version; debug builds can pretend to be older to exercise the real update path.
fn current_version() -> String {
    #[cfg(debug_assertions)]
    if let Ok(v) = std::env::var("CODEPAD_FAKE_CURRENT") {
        return v;
    }
    VERSION.to_string()
}

fn api_url() -> String {
    api_override().unwrap_or_else(|| format!("https://api.github.com/repos/{REPO}/releases/latest"))
}

fn download_allowed(url: &str) -> bool {
    api_override().is_some() || url.starts_with(&format!("https://github.com/{REPO}/releases/download/"))
}

fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        .user_agent(format!("Codepad/{VERSION}"))
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_recv_response(Some(Duration::from_secs(20)))
        .build()
        .into()
}

/* ---------- versions ---------- */

/// "v1.2.3" -> (1, 2, 3). Anything else (pre-releases, odd tags) is not a version we'd update to.
fn parse_version(s: &str) -> Option<(u64, u64, u64)> {
    let mut it = s.trim().trim_start_matches('v').split('.');
    let v = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
    it.next().is_none().then_some(v)
}

/// The NSIS installer drops `uninstall.exe` next to the app; a portable exe has no such neighbour.
fn is_installed_build() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join("uninstall.exe").exists()))
        .unwrap_or(false)
}

/* ---------- check ---------- */

fn fetch_latest(portable: bool) -> Result<Option<UpdateInfo>, String> {
    let mut resp = match agent().get(&api_url()).header("Accept", "application/vnd.github+json").call() {
        Ok(r) => r,
        Err(ureq::Error::StatusCode(404)) => return Ok(None), // no releases yet
        Err(ureq::Error::StatusCode(403 | 429)) => return Err("GitHub is rate-limiting requests right now. Try again later.".into()),
        Err(ureq::Error::StatusCode(c)) => return Err(format!("GitHub answered with HTTP {c}.")),
        Err(e) => return Err(format!("Couldn't reach GitHub ({e}).")),
    };
    let rel: serde_json::Value = resp.body_mut().read_json().map_err(|e| format!("Unexpected answer from GitHub ({e})."))?;

    let tag = rel["tag_name"].as_str().unwrap_or_default();
    let Some(latest) = parse_version(tag) else { return Ok(None) };
    if rel["prerelease"].as_bool().unwrap_or(false) || rel["draft"].as_bool().unwrap_or(false) {
        return Ok(None);
    }
    let Some(current) = parse_version(&current_version()) else { return Ok(None) };
    if latest <= current {
        return Ok(None);
    }

    let suffix = if portable { "-portable.exe" } else { "-setup.exe" };
    let asset = rel["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"].as_str().is_some_and(|n| n.ends_with(suffix))))
        .ok_or_else(|| format!("Version {} is out, but it has no {} download yet.", tag.trim_start_matches('v'), if portable { "portable" } else { "installer" }))?;

    Ok(Some(UpdateInfo {
        version: tag.trim_start_matches('v').to_string(),
        notes_url: rel["html_url"].as_str().unwrap_or_default().to_string(),
        asset_name: asset["name"].as_str().unwrap_or_default().to_string(),
        asset_url: asset["browser_download_url"].as_str().unwrap_or_default().to_string(),
        size: asset["size"].as_u64().unwrap_or(0),
        digest: asset["digest"].as_str().map(str::to_string),
        portable,
    }))
}

#[tauri::command]
pub async fn check_update(state: State<'_, UpdateState>) -> Result<UpdateCheck, String> {
    let portable = !is_installed_build();
    let latest = tauri::async_runtime::spawn_blocking(move || fetch_latest(portable))
        .await
        .map_err(|e| e.to_string())??;
    *state.0.lock().unwrap() = latest.clone();
    Ok(UpdateCheck { current: current_version(), latest })
}

/* ---------- install ---------- */

/// Streams the asset to `dest`, hashing as it goes. On any failure `dest` is removed.
fn download(app: &AppHandle, info: &UpdateInfo, dest: &Path) -> Result<(), String> {
    let result = (|| {
        let want = info
            .digest
            .as_deref()
            .and_then(|d| d.strip_prefix("sha256:"))
            .ok_or("GitHub didn't publish a checksum for this download, so it can't be verified.")?
            .to_ascii_lowercase();

        let mut resp = agent().get(&info.asset_url).call().map_err(|e| format!("Download failed ({e})."))?;
        let total = info.size;
        let mut reader = resp.body_mut().as_reader().take(total.max(1) + 1); // one byte of slack to notice a too-long file
        let mut file = fs::File::create(dest).map_err(|e| format!("Can't write to {} ({e}).", dest.display()))?;

        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        let (mut done, mut last) = (0u64, Instant::now());
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("Download failed ({e})."))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            file.write_all(&buf[..n]).map_err(|e| format!("Can't write to {} ({e}).", dest.display()))?;
            done += n as u64;
            if last.elapsed() > Duration::from_millis(80) {
                last = Instant::now();
                let _ = app.emit("update-progress", serde_json::json!({ "done": done, "total": total }));
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        let _ = app.emit("update-progress", serde_json::json!({ "done": done, "total": total }));

        if done != total {
            return Err(format!("The download was incomplete or the wrong size ({done} of {total} bytes)."));
        }
        let got: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if got != want {
            return Err("The download didn't match GitHub's checksum, so it was discarded.".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(dest);
    }
    result
}

fn sibling(exe: &Path, ext: &str) -> PathBuf {
    let mut name = exe.file_name().unwrap_or_default().to_os_string();
    name.push(ext);
    exe.with_file_name(name)
}

#[cfg(windows)]
fn relaunch_later(exe: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let p = exe.to_string_lossy();
    if p.contains(['%', '"', '^', '&']) {
        return Err("This install location has characters that can't be restarted safely.".into());
    }
    // Wait ~2s so this process has exited (otherwise single-instance would hand the launch back to us).
    std::process::Command::new("cmd")
        .raw_arg(format!("/C ping -n 3 127.0.0.1 >nul & start \"\" \"{p}\""))
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn relaunch_later(exe: &Path) -> Result<(), String> {
    std::process::Command::new("sh")
        .arg("-c")
        .arg("sleep 2; exec \"$0\"")
        .arg(exe)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn install(app: &AppHandle, info: &UpdateInfo) -> Result<(), String> {
    if !download_allowed(&info.asset_url) {
        return Err("Refusing to download from an unexpected address.".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    if info.portable {
        // Everything happens beside the exe so the renames below stay on one volume.
        let new = sibling(&exe, ".new");
        let old = sibling(&exe, ".old");
        download(app, info, &new)?;
        let _ = fs::remove_file(&old);
        fs::rename(&exe, &old).map_err(|e| {
            let _ = fs::remove_file(&new);
            format!("Couldn't replace the running exe ({e}).")
        })?;
        if let Err(e) = fs::rename(&new, &exe) {
            let _ = fs::rename(&old, &exe); // put the old one back
            let _ = fs::remove_file(&new);
            return Err(format!("Couldn't put the new exe in place ({e})."));
        }
        if let Err(e) = relaunch_later(&exe) {
            return Err(format!("Updated, but couldn't restart automatically ({e}). Start Codepad again."));
        }
    } else {
        let dir = std::env::temp_dir().join("codepad-update");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let setup = dir.join(&info.asset_name);
        download(app, info, &setup)?;
        // /P = passive (progress only), /R = relaunch Codepad when done
        std::process::Command::new(&setup)
            .args(["/P", "/R"])
            .spawn()
            .map_err(|e| format!("Couldn't start the installer ({e})."))?;
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let info = state.0.lock().unwrap().clone().ok_or("No update has been found yet.")?;
    tauri::async_runtime::spawn_blocking(move || install(&app, &info))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens a release page in the browser. Only pages of this repo's releases are allowed.
#[tauri::command]
pub fn open_release_page(url: Option<String>) -> Result<(), String> {
    let base = format!("https://github.com/{REPO}/releases");
    let url = url.filter(|u| u == &base || u.starts_with(&format!("{base}/"))).unwrap_or(format!("{base}/latest"));
    #[cfg(windows)]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Clears what a previous update left behind (old exe, downloaded setup). Best effort.
pub fn cleanup() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = fs::remove_file(sibling(&exe, ".old"));
        let _ = fs::remove_file(sibling(&exe, ".new"));
    }
    let _ = fs::remove_dir_all(std::env::temp_dir().join("codepad-update"));
}
