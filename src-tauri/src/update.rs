//! In-app updates, straight from GitHub Releases: no server, no extra metadata file.
//!
//! `check_update` asks the releases API for the latest release and remembers it in managed state.
//! `install_update` then downloads *that remembered asset* (the frontend never supplies a URL),
//! checks its SHA-256 against the digest GitHub publishes, and swaps it in:
//!   - installed build: runs the NSIS setup (`/P` passive, `/R` relaunch) and exits;
//!   - portable build: renames the running exe aside, drops the new one in its place, relaunches;
//!   - macOS: unpacks the `.app.tar.gz` next to the running app, swaps the two bundles and relaunches.

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

    #[cfg(target_os = "macos")]
    let (suffix, what) = (".app.tar.gz", "macOS");
    #[cfg(not(target_os = "macos"))]
    let (suffix, what) = if portable { ("-portable.exe", "portable") } else { ("-setup.exe", "installer") };
    let asset = rel["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["name"].as_str().is_some_and(|n| n.ends_with(suffix))))
        .ok_or_else(|| format!("Version {} is out, but it has no {what} download yet.", tag.trim_start_matches('v')))?;

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

#[cfg(all(not(windows), not(target_os = "macos")))]
fn relaunch_later(exe: &Path) -> Result<(), String> {
    std::process::Command::new("sh")
        .arg("-c")
        .arg("sleep 2; exec \"$0\"")
        .arg(exe)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
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

/// Runs a system tool, turning a failure into a message.
#[cfg(target_os = "macos")]
fn run_tool(what: &str, cmd: &mut std::process::Command) -> Result<String, String> {
    let out = cmd.output().map_err(|e| format!("Couldn't {what} ({e})."))?;
    if !out.status.success() {
        return Err(format!("Couldn't {what}: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Starts the app bundle again once this process has had time to exit (LaunchServices would otherwise just refocus us).
#[cfg(target_os = "macos")]
fn relaunch_later(bundle: &Path) -> Result<(), String> {
    let mut cmd = std::process::Command::new("/bin/sh");
    // `sh -c SCRIPT sh ARGS...`: the script sees ARGS as "$@"
    cmd.arg("-c").arg("sleep 2; exec /usr/bin/open \"$@\"").arg("sh");
    // The end-to-end tests keep the app on their throw-away HOME, and its test bridge, across the restart.
    #[cfg(feature = "e2e")]
    for key in ["HOME", "CODEPAD_E2E_PORT"] {
        if let Some(value) = std::env::var_os(key) {
            cmd.arg("--env").arg(format!("{key}={}", value.to_string_lossy()));
        }
    }
    cmd.arg(bundle).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Where the new app is unpacked: beside the running one, so the swap below is a rename on one volume.
#[cfg(target_os = "macos")]
fn staging_dir(bundle: &Path) -> PathBuf {
    bundle.with_file_name(".Codepad-update")
}

/// Unpacks the download, checks that it is a whole, intact Codepad of the version GitHub said it is, and
/// returns the path of the new `.app`.
#[cfg(target_os = "macos")]
fn unpack(archive: &Path, staging: &Path, want_version: &str) -> Result<PathBuf, String> {
    use std::process::Command;
    run_tool("unpack the update", Command::new("/usr/bin/tar").arg("-xzf").arg(archive).arg("-C").arg(staging))?;
    let fresh = fs::read_dir(staging)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|x| x == "app") && p.is_dir())
        .ok_or("The download doesn't contain an app.")?;
    run_tool("verify the new app", Command::new("/usr/bin/codesign").args(["--verify", "--deep", "--strict"]).arg(&fresh))?;
    let version = run_tool(
        "read the new app's version",
        Command::new("/usr/libexec/PlistBuddy").args(["-c", "Print :CFBundleShortVersionString"]).arg(fresh.join("Contents/Info.plist")),
    )?;
    if version != want_version {
        return Err(format!("The download is version {version}, not {want_version}."));
    }
    // We fetched it ourselves, so it has no quarantine flag; make sure nothing else added one.
    let _ = Command::new("/usr/bin/xattr").args(["-dr", "com.apple.quarantine"]).arg(&fresh).output();
    Ok(fresh)
}

#[cfg(target_os = "macos")]
fn install(app: &AppHandle, info: &UpdateInfo) -> Result<(), String> {
    if !download_allowed(&info.asset_url) {
        return Err("Refusing to download from an unexpected address.".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let manual = "Download the new version from the release page instead.";
    let bundle = crate::shell::bundle_of(&exe).ok_or_else(|| format!("Codepad isn't running from an app bundle, so it can't replace itself. {manual}"))?;
    let staging = staging_dir(&bundle);
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir(&staging).map_err(|e| format!("Can't write to {} ({e}). {manual}", bundle.parent().unwrap_or(&bundle).display()))?;

    let swapped = (|| {
        let archive = staging.join("update.tar.gz");
        download(app, info, &archive)?;
        let fresh = unpack(&archive, &staging, &info.version)?;
        let old = sibling(&bundle, ".old");
        let _ = fs::remove_dir_all(&old);
        fs::rename(&bundle, &old).map_err(|e| format!("Couldn't replace the running app ({e}). {manual}"))?;
        if let Err(e) = fs::rename(&fresh, &bundle) {
            let _ = fs::rename(&old, &bundle); // put the old one back
            return Err(format!("Couldn't put the new app in place ({e})."));
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&staging);
    swapped?;

    if let Err(e) = relaunch_later(&bundle) {
        return Err(format!("Updated, but couldn't restart automatically ({e}). Start Codepad again."));
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
        #[cfg(target_os = "macos")]
        if let Some(bundle) = crate::shell::bundle_of(&exe) {
            let _ = fs::remove_dir_all(sibling(&bundle, ".old"));
            let _ = fs::remove_dir_all(staging_dir(&bundle));
        }
    }
    let _ = fs::remove_dir_all(std::env::temp_dir().join("codepad-update"));
}
