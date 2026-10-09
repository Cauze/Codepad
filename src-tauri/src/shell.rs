//! Two optional bits of shell integration, both per-user and both switched on and off from the command palette:
//!
//! 1. "Open with Codepad" in Explorer's right-click menu, for text and code files only.
//!
//! One key per extension under `HKCU\Software\Classes\SystemFileAssociations\.ext\shell\Codepad`.
//! That adds a menu entry without touching which program owns the file type. Everything is
//! per-user (no admin rights) and `unregister` removes it all again.
//!
//! 2. `codepad` on the PATH, so `codepad notes.txt` works in any terminal (see the `path` section below).

use std::{fs, path::{Path, PathBuf}};
use winreg::{enums::*, RegKey};

const EXTENSIONS: &[&str] = &[
    // text and data
    "txt", "text", "log", "md", "markdown", "rst", "tex", "csv", "tsv", "json", "jsonc", "json5", "jsonld", "toml", "yaml", "yml",
    "ini", "cfg", "conf", "env", "properties", "xml", "xsd", "xsl", "diff", "patch", "lock", "gitignore", "gitattributes", "editorconfig",
    // web
    "html", "htm", "css", "scss", "sass", "less", "svg", "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "vue", "svelte", "astro", "graphql", "gql",
    // languages
    "py", "pyw", "rs", "go", "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "cs", "java", "kt", "kts", "scala", "groovy", "gradle",
    "swift", "dart", "lua", "rb", "php", "pl", "pm", "r", "jl", "hs", "ml", "mli", "fs", "clj", "cljs", "edn", "el", "lisp", "scm", "erl",
    "ex", "exs", "elm", "zig", "nim", "vb", "vbs", "sv", "vhd", "vhdl", "tcl", "tf", "hcl", "nix", "wat", "proto", "sql", "cmake",
    // shells and scripts
    "sh", "bash", "zsh", "ksh", "bat", "cmd", "ps1", "psm1", "psd1",
];

const CLASSES: &str = r"Software\Classes\SystemFileAssociations";

fn exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| e.to_string())
}

fn command(exe: &PathBuf) -> String {
    format!("\"{}\" \"%1\"", exe.display())
}

pub fn register() -> Result<(), String> {
    let exe = exe()?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let cmd = command(&exe);
    let icon = format!("\"{}\",0", exe.display());
    for ext in EXTENSIONS {
        let (key, _) = hkcu.create_subkey(format!(r"{CLASSES}\.{ext}\shell\Codepad")).map_err(|e| e.to_string())?;
        key.set_value("", &"Open with Codepad").map_err(|e| e.to_string())?;
        key.set_value("Icon", &icon).map_err(|e| e.to_string())?;
        let (c, _) = key.create_subkey("command").map_err(|e| e.to_string())?;
        c.set_value("", &cmd).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Removes every Codepad entry, including the all-files one that 0.4.0 and 0.4.1 added.
pub fn unregister() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(r"Software\Classes\*\shell\Codepad");
    let Ok(classes) = hkcu.open_subkey_with_flags(CLASSES, KEY_READ | KEY_WRITE) else { return Ok(()) };
    let names: Vec<String> = classes.enum_keys().flatten().collect();
    for name in names {
        let shell = format!(r"{name}\shell");
        if classes.delete_subkey_all(format!(r"{shell}\Codepad")).is_ok() {
            // tidy up the folders we created, if nothing else lives in them
            let _ = classes.delete_subkey(&shell);
            let _ = classes.delete_subkey(&name);
        }
    }
    Ok(())
}

pub fn is_registered() -> bool {
    RegKey::predef(HKEY_CURRENT_USER).open_subkey(format!(r"{CLASSES}\.txt\shell\Codepad\command")).is_ok()
}

/// If the menu is on but points at an exe that has moved or gone (e.g. a portable copy was moved), point it here.
pub fn heal() {
    heal_path();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey(format!(r"{CLASSES}\.txt\shell\Codepad\command")) else { return };
    let Ok(current) = key.get_value::<String, _>("") else { return };
    let Ok(me) = exe() else { return };
    if current == command(&me) {
        return;
    }
    let target = current.trim_start_matches('"').split('"').next().unwrap_or("");
    if !std::path::Path::new(target).exists() {
        let _ = register();
    }
}

// ---------- codepad on the PATH ----------
//
// A `bin` folder next to the app data holds two tiny launchers (`codepad.cmd` for cmd and PowerShell,
// `codepad` for Git Bash) that start whichever exe turned it on. That folder is added to the user's PATH.
// Pointing at a launcher rather than at the exe's own folder works for the portable build too.

fn bin_dir() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA isn't set")?;
    Ok(PathBuf::from(base).join("Codepad").join("bin"))
}

fn cmd_launcher(exe: &Path) -> String {
    // `start` so a batch file doesn't wait for the (GUI) app to exit
    format!("@echo off\r\nstart \"\" \"{}\" %*\r\n", exe.display())
}

fn sh_launcher(exe: &Path) -> String {
    format!("#!/bin/sh\n\"{}\" \"$@\" >/dev/null 2>&1 &\n", exe.display().to_string().replace('\\', "/"))
}

fn same_dir(a: &str, b: &Path) -> bool {
    a.trim().trim_end_matches('\\').eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches('\\'))
}

/// Tell running programs (Explorer, so new terminals) that the environment changed.
fn broadcast_env_change() {
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageTimeoutW(hwnd: isize, msg: u32, wparam: usize, lparam: *const u16, flags: u32, timeout: u32, result: *mut usize) -> isize;
    }
    let env: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut out = 0usize;
    // HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG
    unsafe { SendMessageTimeoutW(0xffff, 0x001A, 0, env.as_ptr(), 0x0002, 2000, &mut out) };
}

fn edit_path(f: impl FnOnce(Vec<String>) -> Vec<String>) -> Result<(), String> {
    let env = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE).map_err(|e| e.to_string())?;
    let current: String = env.get_value("Path").unwrap_or_default();
    let parts: Vec<String> = current.split(';').filter(|p| !p.is_empty()).map(String::from).collect();
    let new = f(parts.clone());
    if new != parts {
        // keep it expandable (%USERPROFILE% and friends) like Windows' own entries
        let value = winreg::RegValue { vtype: REG_EXPAND_SZ, bytes: to_wide(&new.join(";")) };
        env.set_raw_value("Path", &value).map_err(|e| e.to_string())?;
        broadcast_env_change();
    }
    Ok(())
}

fn to_wide(s: &str) -> std::borrow::Cow<'static, [u8]> {
    let mut v: Vec<u8> = s.encode_utf16().chain(std::iter::once(0)).flat_map(|u| u.to_le_bytes()).collect();
    v.shrink_to_fit();
    v.into()
}

pub fn register_path() -> Result<(), String> {
    let exe = exe()?;
    let dir = bin_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("codepad.cmd"), cmd_launcher(&exe)).map_err(|e| e.to_string())?;
    fs::write(dir.join("codepad"), sh_launcher(&exe)).map_err(|e| e.to_string())?;
    edit_path(|mut parts| {
        if !parts.iter().any(|p| same_dir(p, &dir)) {
            parts.push(dir.to_string_lossy().into_owned());
        }
        parts
    })
}

pub fn unregister_path() -> Result<(), String> {
    let dir = bin_dir()?;
    edit_path(|parts| parts.into_iter().filter(|p| !same_dir(p, &dir)).collect())?;
    let _ = fs::remove_file(dir.join("codepad.cmd"));
    let _ = fs::remove_file(dir.join("codepad"));
    let _ = fs::remove_dir(&dir); // only if empty
    Ok(())
}

pub fn is_path_registered() -> bool {
    let Ok(dir) = bin_dir() else { return false };
    let on_path = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .and_then(|k| k.get_value::<String, _>("Path"))
        .map(|p| p.split(';').any(|x| same_dir(x, &dir)))
        .unwrap_or(false);
    on_path && dir.join("codepad.cmd").is_file()
}

/// Like `heal`: if the launchers point at an exe that is gone, point them at this one.
fn heal_path() {
    if !is_path_registered() {
        return;
    }
    let (Ok(dir), Ok(me)) = (bin_dir(), exe()) else { return };
    let Ok(current) = fs::read_to_string(dir.join("codepad.cmd")) else { return };
    if current == cmd_launcher(&me) {
        return;
    }
    let target = current.split('"').nth(3).unwrap_or("");
    if !Path::new(target).exists() {
        let _ = register_path();
    }
}

/// Handles `--register-context-menu`, `--unregister-context-menu`, `--register-path` and `--unregister-path` (used by the installer). True if one was given.
pub fn handle_cli() -> bool {
    match std::env::args().nth(1).as_deref() {
        Some("--register-context-menu") => { let _ = register(); true }
        Some("--unregister-context-menu") => { let _ = unregister(); true }
        Some("--register-path") => { let _ = register_path(); true }
        Some("--unregister-path") => { let _ = unregister_path(); true }
        _ => false,
    }
}

#[tauri::command]
pub fn context_menu_enabled() -> bool {
    is_registered()
}

#[tauri::command]
pub fn set_context_menu(enabled: bool) -> Result<bool, String> {
    if enabled { register()? } else { unregister()? }
    Ok(is_registered())
}

#[tauri::command]
pub fn path_enabled() -> bool {
    is_path_registered()
}

#[tauri::command]
pub fn set_path(enabled: bool) -> Result<bool, String> {
    if enabled { register_path()? } else { unregister_path()? }
    Ok(is_path_registered())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn extensions_are_plain_lowercase_and_unique() {
        let mut seen = HashSet::new();
        for ext in EXTENSIONS {
            assert!(!ext.is_empty() && !ext.starts_with('.'), "{ext:?} should be written without the dot");
            assert_eq!(*ext, ext.to_ascii_lowercase(), "{ext:?} should be lowercase");
            assert!(seen.insert(*ext), "{ext:?} is listed twice");
        }
    }

    #[test]
    fn menu_covers_text_and_code_but_not_binaries() {
        for ext in ["txt", "md", "json", "rs", "ts", "py", "html", "css", "sh", "ps1"] {
            assert!(EXTENSIONS.contains(&ext), "{ext} should get the menu entry");
        }
        for ext in ["png", "jpg", "mp4", "exe", "dll", "zip", "pdf", "docx"] {
            assert!(!EXTENSIONS.contains(&ext), "{ext} should not get the menu entry");
        }
    }

    #[test]
    fn menu_command_quotes_exe_and_file() {
        assert_eq!(command(&PathBuf::from(r"C:\Program Files\Codepad\codepad.exe")), r#""C:\Program Files\Codepad\codepad.exe" "%1""#);
    }

    #[test]
    fn same_dir_ignores_case_whitespace_and_trailing_slash() {
        let dir = Path::new(r"C:\Users\Me\AppData\Local\Codepad\bin");
        assert!(same_dir(r"C:\Users\Me\AppData\Local\Codepad\bin", dir));
        assert!(same_dir(r"c:\users\me\appdata\local\codepad\BIN\", dir));
        assert!(same_dir(r"  C:\Users\Me\AppData\Local\Codepad\bin ", dir));
        assert!(!same_dir(r"C:\Users\Me\AppData\Local\Codepad", dir));
        assert!(!same_dir(r"C:\Users\Me\AppData\Local\Codepad\bin2", dir));
    }

    #[test]
    fn cmd_launcher_starts_the_exe_without_waiting_and_passes_arguments_on() {
        let text = cmd_launcher(Path::new(r"C:\Apps\Codepad\codepad.exe"));
        assert_eq!(text, "@echo off\r\nstart \"\" \"C:\\Apps\\Codepad\\codepad.exe\" %*\r\n");
    }

    #[test]
    fn heal_can_read_the_exe_back_out_of_the_cmd_launcher() {
        // heal_path() takes the 4th quote-separated piece; this keeps it in step with cmd_launcher()
        for exe in [r"C:\Apps\Codepad\codepad.exe", r"C:\Program Files\Codepad\codepad.exe"] {
            assert_eq!(cmd_launcher(Path::new(exe)).split('"').nth(3), Some(exe));
        }
    }

    #[test]
    fn sh_launcher_uses_forward_slashes_and_detaches() {
        let text = sh_launcher(Path::new(r"C:\Apps\Codepad\codepad.exe"));
        assert_eq!(text, "#!/bin/sh\n\"C:/Apps/Codepad/codepad.exe\" \"$@\" >/dev/null 2>&1 &\n");
        assert!(!text.contains('\r'), "a CR in a shell script breaks the shebang line");
    }

    #[test]
    fn registry_strings_are_utf16_with_a_terminator() {
        assert_eq!(&*to_wide("a;é"), &[b'a', 0, b';', 0, 0xe9, 0, 0, 0]);
        assert_eq!(&*to_wide(""), &[0, 0]);
    }
}
