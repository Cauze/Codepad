mod update;

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
    /// The file started with a UTF-8 byte-order mark (stripped from `content`; written back on save).
    bom: bool,
    /// Most line breaks are CRLF (the editor works in LF; this is how to write them back).
    crlf: bool,
    /// Not valid UTF-8, so `content` has replacement characters and must not be saved over the file.
    lossy: bool,
}

impl FileData {
    fn note(path: String, mtime: u64, note: String) -> Self {
        FileData { path, mtime, content: None, note: Some(note), bom: false, crlf: false, lossy: false }
    }
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
        return Ok(FileData::note(path, mtime, format!("File is too large to display ({} MB).", size / 1024 / 1024)));
    }

    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return Ok(FileData::note(path, mtime, "Binary file — not shown.".into()));
    }
    let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let body = if bom { &bytes[3..] } else { &bytes[..] };
    let (content, lossy) = match std::str::from_utf8(body) {
        Ok(s) => (s.to_owned(), false),
        Err(_) => (String::from_utf8_lossy(body).into_owned(), true),
    };
    let crlf_n = content.matches("\r\n").count();
    let lf_n = content.matches('\n').count() - crlf_n;
    Ok(FileData { path, mtime, content: Some(content), note: None, bom, crlf: crlf_n > lf_n, lossy })
}

/// Saves `content` over `path` (recreating it if it was deleted). When `expected_mtime` is given and the
/// file on disk has a different modification time, nothing is written and the error is `CONFLICT`, so
/// the UI can ask before overwriting someone else's change. Returns the new mtime.
#[tauri::command]
fn write_file(path: String, content: String, bom: bool, expected_mtime: Option<u64>) -> Result<u64, String> {
    let p = Path::new(&path);
    if let (Some(want), Ok(now)) = (expected_mtime, mtime_ms(p)) {
        if now != want {
            return Err("CONFLICT".into());
        }
    }
    let mut bytes = Vec::with_capacity(content.len() + 3);
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(content.as_bytes());
    fs::write(p, bytes).map_err(|e| e.to_string())?;
    mtime_ms(p)
}

#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    mtime_ms(Path::new(&path))
}

/// Only these files may be read/written through the config commands.
const CONFIG_FILES: [&str; 3] = ["settings.json", "state.json", "settings.invalid.json"];

#[derive(Serialize)]
struct ConfigFile {
    path: String,
    /// `None` when the file doesn't exist yet.
    content: Option<String>,
    mtime: u64,
}

fn config_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    if !CONFIG_FILES.contains(&name) {
        return Err(format!("unknown config file: {name}"));
    }
    let dir = app.path().config_dir().map_err(|e| e.to_string())?.join("Codepad");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
fn read_config(app: tauri::AppHandle, name: String) -> Result<ConfigFile, String> {
    let p = config_path(&app, &name)?;
    Ok(ConfigFile {
        content: fs::read_to_string(&p).ok(),
        mtime: mtime_ms(&p).unwrap_or(0),
        path: p.to_string_lossy().into_owned(),
    })
}

/// Writes via a temp file + rename so a crash can't leave a half-written config.
#[tauri::command]
fn write_config(app: tauri::AppHandle, name: String, content: String) -> Result<u64, String> {
    let p = config_path(&app, &name)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    mtime_ms(&p)
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("file not found".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg("-R").arg(p).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(p.parent().unwrap_or(p))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
        .manage(update::UpdateState::default())
        .setup(|_| {
            std::thread::spawn(update::cleanup);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, file_mtime, initial_files,
            canonical_path,
            read_config,
            write_config,
            reveal_in_explorer,
            update::check_update,
            update::install_update,
            update::open_release_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codepad");
}
