//! macOS shell integration: `codepad` on the PATH, so `codepad notes.txt` works in any terminal.
//!
//! There is no Explorer-style menu to add: Finder lists Codepad under "Open With" by itself, because the
//! app bundle declares the file types it can open (see `tauri.macos.conf.json`).
//!
//! The `codepad` command is a tiny shell script, written into the first of Homebrew's bin folders
//! that exists and is writable, or else `~/.local/bin`. It starts the app with `open -a`, so files
//! open in the running window just like a double click in Finder. Every launcher carries a marker line, and only
//! files with that marker are ever replaced or removed.

use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

const MARKER: &str = "# Installed by Codepad.";

fn exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| e.to_string())
}

/// `/Applications/Codepad.app` for `/Applications/Codepad.app/Contents/MacOS/codepad`; `None` for a bare binary.
pub fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let app = macos.parent()?.parent()?;
    (macos.file_name()? == "MacOS" && app.extension()? == "app").then(|| app.to_path_buf())
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn sh_unquote(s: &str) -> Option<String> {
    let inner = s.trim().strip_prefix('\'')?.strip_suffix('\'')?;
    Some(inner.replace(r"'\''", "'"))
}

fn launcher(exe: &Path) -> String {
    let start = match bundle_of(exe) {
        // `open -a` hands the files to the running app (or starts it) and returns at once
        Some(app) => format!("APP={}\nexec open -a \"$APP\" \"$@\"\n", sh_quote(&app.to_string_lossy())),
        // not in an app bundle (a development build): run the binary itself, detached from the terminal
        None => format!("EXE={}\nnohup \"$EXE\" \"$@\" >/dev/null 2>&1 &\n", sh_quote(&exe.to_string_lossy())),
    };
    format!("#!/bin/sh\n{MARKER} Remove it with \"Command Line: Remove codepad from PATH\" in Codepad's command palette.\n{start}")
}

/// What a launcher starts: the app bundle (or binary) named on its `APP=` / `EXE=` line.
fn launcher_target(text: &str) -> Option<PathBuf> {
    text.lines()
        .find_map(|l| l.strip_prefix("APP=").or_else(|| l.strip_prefix("EXE=")))
        .and_then(sh_unquote)
        .map(PathBuf::from)
}

/// Where the launcher may live, best first. The first two are on PATH for Homebrew users, `~/.local/bin` is the fallback.
fn candidate_dirs() -> Vec<PathBuf> {
    // The end-to-end tests point this somewhere harmless instead of at the real system folders.
    #[cfg(feature = "e2e")]
    if let Some(dirs) = std::env::var_os("CODEPAD_BIN_DIRS") {
        return std::env::split_paths(&dirs).collect();
    }
    let mut dirs = vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".local").join("bin"));
    }
    dirs
}

fn is_ours(file: &Path) -> bool {
    fs::read_to_string(file).is_ok_and(|t| t.contains(MARKER))
}

fn write_launcher(file: &Path, text: &str) -> std::io::Result<()> {
    fs::write(file, text)?;
    fs::set_permissions(file, fs::Permissions::from_mode(0o755))
}

/// Writes the launcher into the first usable folder of `dirs` and removes our launcher from the others.
/// A folder is skipped if it doesn't exist (except the last, which is created), isn't writable, or already
/// holds a `codepad` that isn't ours. Returns the folder used.
fn install_in(dirs: &[PathBuf], exe: &Path) -> Result<PathBuf, String> {
    let text = launcher(exe);
    let mut chosen = None;
    for (i, dir) in dirs.iter().enumerate() {
        let last = i + 1 == dirs.len();
        if !dir.is_dir() && !(last && fs::create_dir_all(dir).is_ok()) {
            continue;
        }
        let file = dir.join("codepad");
        if file.exists() && !is_ours(&file) {
            continue;
        }
        if write_launcher(&file, &text).is_ok() {
            chosen = Some(dir.clone());
            break;
        }
    }
    let dir = chosen.ok_or_else(|| {
        let tried: Vec<_> = dirs.iter().map(|d| d.display().to_string()).collect();
        format!("Couldn't write the codepad command to any of: {}", tried.join(", "))
    })?;
    for other in dirs.iter().filter(|d| **d != dir) {
        remove_ours(&other.join("codepad"));
    }
    Ok(dir)
}

fn remove_ours(file: &Path) {
    if is_ours(file) {
        let _ = fs::remove_file(file);
    }
}

fn installed_in(dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter().find(|d| is_ours(&d.join("codepad"))).cloned()
}

/// If the launcher points at an app that has moved or gone (dragged somewhere else, say), point it at this one.
fn heal_in(dirs: &[PathBuf], exe: &Path) {
    let Some(dir) = installed_in(dirs) else { return };
    let Ok(text) = fs::read_to_string(dir.join("codepad")) else { return };
    if text == launcher(exe) {
        return;
    }
    if !launcher_target(&text).is_some_and(|t| t.exists()) {
        let _ = write_launcher(&dir.join("codepad"), &launcher(exe));
    }
}

pub fn heal() {
    if let Ok(exe) = exe() {
        heal_in(&candidate_dirs(), &exe);
    }
}

pub fn handle_cli() -> bool {
    false
}

pub fn menu_enabled() -> Result<bool, String> {
    Err("There is no right-click menu entry to manage on this platform.".into())
}

pub fn set_menu(_enabled: bool) -> Result<bool, String> {
    menu_enabled()
}

pub fn path_enabled() -> bool {
    installed_in(&candidate_dirs()).is_some()
}

pub fn set_path(enabled: bool) -> Result<bool, String> {
    let dirs = candidate_dirs();
    if enabled {
        install_in(&dirs, &exe()?)?;
    } else {
        for dir in &dirs {
            remove_ours(&dir.join("codepad"));
        }
    }
    Ok(installed_in(&dirs).is_some())
}

pub fn path_dir() -> Option<PathBuf> {
    installed_in(&candidate_dirs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn scratch(name: &str) -> PathBuf {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("codepad-test-{name}-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const APP_EXE: &str = "/Applications/Codepad.app/Contents/MacOS/codepad";

    #[test]
    fn bundle_is_found_from_the_binary_inside_it() {
        assert_eq!(bundle_of(Path::new(APP_EXE)), Some(PathBuf::from("/Applications/Codepad.app")));
        assert_eq!(bundle_of(Path::new("/Users/me/My Apps/Codepad.app/Contents/MacOS/codepad")), Some(PathBuf::from("/Users/me/My Apps/Codepad.app")));
        assert_eq!(bundle_of(Path::new("/repo/src-tauri/target/release/codepad")), None);
        assert_eq!(bundle_of(Path::new("/Applications/Codepad.app/Contents/Resources/codepad")), None);
    }

    #[test]
    fn quoting_survives_spaces_and_quotes() {
        for s in ["/Applications/Codepad.app", "/Users/me/My Apps/Codepad.app", "/Users/o'brien/$HOME/`x`/\"y\".app"] {
            assert_eq!(sh_unquote(&sh_quote(s)).as_deref(), Some(s));
        }
    }

    #[test]
    fn launcher_names_its_target_and_carries_the_marker() {
        let text = launcher(Path::new(APP_EXE));
        assert!(text.starts_with("#!/bin/sh\n"));
        assert!(text.contains(MARKER));
        assert_eq!(launcher_target(&text), Some(PathBuf::from("/Applications/Codepad.app")));
        let bare = launcher(Path::new("/repo/target/release/codepad"));
        assert_eq!(launcher_target(&bare), Some(PathBuf::from("/repo/target/release/codepad")));
    }

    /// Runs the launcher for real, with a fake `open` that records its arguments.
    #[test]
    fn launcher_passes_files_to_open_untouched() {
        let dir = scratch("launcher");
        let fake = dir.join("fakebin");
        fs::create_dir_all(&fake).unwrap();
        let log = dir.join("args.txt");
        fs::write(fake.join("open"), format!("#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done > {}\n", sh_quote(&log.to_string_lossy()))).unwrap();
        fs::set_permissions(fake.join("open"), fs::Permissions::from_mode(0o755)).unwrap();

        let exe = dir.join("My Apps").join("Codepad.app").join("Contents").join("MacOS").join("codepad");
        let script = dir.join("codepad");
        write_launcher(&script, &launcher(&exe)).unwrap();
        let status = Command::new(&script).args(["a b.txt", "it's.rs"]).env("PATH", format!("{}:/usr/bin:/bin", fake.display())).status().unwrap();
        assert!(status.success());
        let got = fs::read_to_string(&log).unwrap();
        let app = dir.join("My Apps").join("Codepad.app");
        assert_eq!(got, format!("-a\n{}\na b.txt\nit's.rs\n", app.display()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_prefers_the_first_usable_folder_and_cleans_up_after_itself() {
        let root = scratch("install");
        let (a, b) = (root.join("a"), root.join("b").join("deep"));
        fs::create_dir_all(&a).unwrap();
        let exe = Path::new(APP_EXE);

        // a exists: used. b is created only when it is the last choice.
        let dirs = [root.join("missing"), a.clone(), b.clone()];
        assert_eq!(install_in(&dirs, exe).unwrap(), a);
        assert!(is_ours(&a.join("codepad")));
        assert!(!b.exists());
        assert_eq!(installed_in(&dirs), Some(a.clone()));
        assert_eq!(fs::metadata(a.join("codepad")).unwrap().permissions().mode() & 0o111, 0o111, "must be executable");

        // someone else's `codepad` in a is left alone; the launcher goes to b, and a's own copy is not duplicated
        fs::write(a.join("codepad"), "#!/bin/sh\necho not ours\n").unwrap();
        assert_eq!(install_in(&dirs, exe).unwrap(), b);
        assert_eq!(fs::read_to_string(a.join("codepad")).unwrap(), "#!/bin/sh\necho not ours\n");
        assert_eq!(installed_in(&dirs), Some(b.clone()));

        // once a is free again, installing moves the launcher back there and removes the one in b
        fs::remove_file(a.join("codepad")).unwrap();
        assert_eq!(install_in(&dirs, exe).unwrap(), a);
        assert!(!b.join("codepad").exists());

        // fails clearly when nothing is writable
        let file_not_dir = root.join("file");
        fs::write(&file_not_dir, "x").unwrap();
        assert!(install_in(&[file_not_dir.join("sub")], exe).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn heal_repoints_a_launcher_whose_app_is_gone() {
        let root = scratch("heal");
        let dirs = [root.clone()];
        let real = root.join("Codepad.app");
        fs::create_dir_all(real.join("Contents").join("MacOS")).unwrap();
        let new_exe = real.join("Contents").join("MacOS").join("codepad");

        install_in(&dirs, Path::new("/Gone/Codepad.app/Contents/MacOS/codepad")).unwrap();
        heal_in(&dirs, &new_exe);
        assert_eq!(launcher_target(&fs::read_to_string(root.join("codepad")).unwrap()), Some(real.clone()));

        // pointing at an app that still exists is left as it is, even if that is another copy
        install_in(&dirs, &new_exe).unwrap();
        heal_in(&dirs, Path::new("/Elsewhere/Codepad.app/Contents/MacOS/codepad"));
        assert_eq!(launcher_target(&fs::read_to_string(root.join("codepad")).unwrap()), Some(real));
        let _ = fs::remove_dir_all(&root);
    }
}
