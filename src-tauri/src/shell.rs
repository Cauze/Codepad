//! "Open with Codepad" in Explorer's right-click menu, for text and code files only.
//!
//! One key per extension under `HKCU\Software\Classes\SystemFileAssociations\.ext\shell\Codepad`.
//! That adds a menu entry without touching which program owns the file type. Everything is
//! per-user (no admin rights) and `unregister` removes it all again.

use std::path::PathBuf;
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

/// Handles `--register-context-menu` / `--unregister-context-menu` (used by the installer). True if one was given.
pub fn handle_cli() -> bool {
    match std::env::args().nth(1).as_deref() {
        Some("--register-context-menu") => { let _ = register(); true }
        Some("--unregister-context-menu") => { let _ = unregister(); true }
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
