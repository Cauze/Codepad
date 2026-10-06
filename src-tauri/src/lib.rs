use serde::Serialize;
use std::{fs, path::Path, time::UNIX_EPOCH};
use tauri::{Emitter, Manager};

const MAX_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
struct FileData {
    path: String,
    mtime: u64,
    content: Option<String>,
    /// Shown in place of the content when the file can't be displayed.
    note: Option<String>,
}

fn mtime_ms(p: &Path) -> Result<u64, String> {
    let m = fs::metadata(p).map_err(|e| e.to_string())?;
    let t = m.modified().map_err(|e| e.to_string())?;
    Ok(t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

/// Absolute, symlink-resolved path with Windows' `\\?\` prefix removed, so the
/// same file always yields the same string no matter how it was spelled.
fn canon(p: &Path) -> String {
    let c = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let s = c.to_string_lossy().into_owned();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s
    }
}

#[tauri::command]
fn canonical_path(path: String) -> String {
    canon(Path::new(&path))
}

#[tauri::command]
fn read_file(path: String) -> Result<FileData, String> {
    let p = Path::new(&path);
    let size = fs::metadata(p).map_err(|e| e.to_string())?.len();
    let mtime = mtime_ms(p)?;
    let path = canon(p);

    if size > MAX_BYTES {
        return Ok(FileData {
            path,
            mtime,
            content: None,
            note: Some(format!("File is too large to display ({} MB).", size / 1024 / 1024)),
        });
    }

    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return Ok(FileData { path, mtime, content: None, note: Some("Binary file — not shown.".into()) });
    }
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let content = String::from_utf8_lossy(bytes).into_owned();
    Ok(FileData { path, mtime, content: Some(content), note: None })
}

#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    mtime_ms(Path::new(&path))
}

/// File arguments (skipping argv[0]); relative paths resolve against `cwd`,
/// which for a second launch is that process's directory, not ours.
fn file_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&str>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .map(|a| match cwd {
            Some(c) if Path::new(&a).is_relative() => Path::new(c).join(a),
            _ => a.into(),
        })
        .filter(|p| p.is_file())
        .map(|p| canon(&p))
        .collect()
}

#[tauri::command]
fn initial_files() -> Vec<String> {
    file_args(std::env::args(), None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = app.emit("open-files", file_args(args, Some(&cwd)));
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, file_mtime, initial_files, canonical_path])
        .run(tauri::generate_context!())
        .expect("error while running Codepad");
}
