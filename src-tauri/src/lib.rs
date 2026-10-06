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

#[tauri::command]
fn read_file(path: String) -> Result<FileData, String> {
    let p = Path::new(&path);
    let size = fs::metadata(p).map_err(|e| e.to_string())?.len();
    let mtime = mtime_ms(p)?;
    let path = p.to_string_lossy().into_owned();

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

fn file_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter().skip(1).filter(|a| Path::new(a).is_file()).collect()
}

#[tauri::command]
fn initial_files() -> Vec<String> {
    file_args(std::env::args())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = app.emit("open-files", file_args(args));
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, file_mtime, initial_files])
        .run(tauri::generate_context!())
        .expect("error while running Codepad");
}
