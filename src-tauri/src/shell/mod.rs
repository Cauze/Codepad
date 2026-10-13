//! Shell integration: how Codepad shows up in the operating system around it.
//!
//! - Windows (`windows.rs`): "Open with Codepad" in Explorer's right-click menu and `codepad` on the PATH, both per-user.
//! - macOS (`unix.rs`): `codepad` on the PATH. "Open With" needs no setup there; the app bundle declares the file types it opens.

/// Extensions of the text and code files Codepad offers to open (without the dot). The Explorer menu on
/// Windows and the macOS file associations (`tauri.macos.conf.json`) are both built from this list.
#[cfg_attr(not(windows), allow(dead_code))] // on macOS only the tests read it
pub const EXTENSIONS: &[&str] = &[
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

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as imp;

#[cfg(not(windows))]
mod unix;
#[cfg(not(windows))]
use unix as imp;

pub use imp::{handle_cli, heal};
#[cfg(target_os = "macos")]
pub use unix::bundle_of;

/// Whether the Explorer right-click entry is installed. An error means this platform has no such thing.
#[tauri::command]
pub fn context_menu_enabled() -> Result<bool, String> {
    imp::menu_enabled()
}

#[tauri::command]
pub fn set_context_menu(enabled: bool) -> Result<bool, String> {
    imp::set_menu(enabled)
}

/// Whether the `codepad` command is installed.
#[tauri::command]
pub fn path_enabled() -> bool {
    imp::path_enabled()
}

#[tauri::command]
pub fn set_path(enabled: bool) -> Result<bool, String> {
    imp::set_path(enabled)
}

/// The folder holding the `codepad` command, so the UI can say where it went.
#[tauri::command]
pub fn path_dir() -> Option<String> {
    imp::path_dir().map(|d| d.to_string_lossy().into_owned())
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
            assert!(EXTENSIONS.contains(&ext), "{ext} should be listed");
        }
        for ext in ["png", "jpg", "mp4", "exe", "dll", "zip", "pdf", "docx"] {
            assert!(!EXTENSIONS.contains(&ext), "{ext} should not get the menu entry");
        }
    }

    /// The macOS bundle declares which files it opens in its own config; keep that in step with the list above.
    #[test]
    fn macos_file_associations_match_the_list() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../../tauri.macos.conf.json")).unwrap();
        let declared: Vec<&str> = conf["bundle"]["fileAssociations"][0]["ext"].as_array().unwrap().iter().map(|e| e.as_str().unwrap()).collect();
        assert_eq!(declared, EXTENSIONS, "tauri.macos.conf.json fileAssociations[0].ext differs from shell::EXTENSIONS");
    }
}
