mod shell;
mod update;

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252};
use serde::Serialize;
use std::{fs, path::Path, time::UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
struct FileData {
    path: String,
    mtime: u64,
    content: Option<String>,
    /// Shown in place of the content when the file can't be displayed.
    note: Option<String>,
    /// How the bytes were decoded (an encoding_rs name such as "UTF-8", "UTF-16LE", "windows-1252").
    encoding: String,
    /// The file started with a byte-order mark (stripped from `content`; written back on save).
    bom: bool,
    /// Most line breaks are CRLF (the editor works in LF; this is how to write them back).
    crlf: bool,
    /// Some bytes weren't valid in `encoding`, so `content` has replacement characters and must not be saved over the file.
    lossy: bool,
}

impl FileData {
    fn note(path: String, mtime: u64, note: String) -> Self {
        FileData { path, mtime, content: None, note: Some(note), encoding: "UTF-8".into(), bom: false, crlf: false, lossy: false }
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

fn lookup_encoding(label: &str) -> Result<&'static Encoding, String> {
    Encoding::for_label(label.as_bytes()).ok_or_else(|| format!("Unknown encoding: {label}"))
}

/// Reads a file as text. Without `encoding` the encoding is detected: a byte-order mark wins, then valid
/// UTF-8, and anything else is taken to be Windows-1252 (which decodes any byte). With `encoding` that
/// encoding is used as given ("Reopen with Encoding").
#[tauri::command]
fn read_file(path: String, encoding: Option<String>) -> Result<FileData, String> {
    let p = Path::new(&path);
    let size = fs::metadata(p).map_err(|e| e.to_string())?.len();
    let mtime = mtime_ms(p)?;
    let path = canon(p);

    if size > MAX_BYTES {
        return Ok(FileData::note(path, mtime, format!("File is too large to display ({} MB).", size / 1024 / 1024)));
    }

    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    let forced = encoding.as_deref().map(lookup_encoding).transpose()?;
    let sniffed = Encoding::for_bom(&bytes);
    if forced.is_none() && sniffed.is_none() && bytes.iter().take(8192).any(|&b| b == 0) {
        return Ok(FileData::note(path, mtime, "Binary file — not shown.".into()));
    }

    let (enc, bom_len, lossy_ok) = match (forced, sniffed) {
        (Some(e), Some((s, n))) if s == e => (e, n, true),
        (Some(e), _) => (e, 0, true),
        (None, Some((s, n))) => (s, n, true),
        (None, None) => (UTF_8, 0, false),
    };
    let body = &bytes[bom_len..];
    let (content, enc, lossy) = if lossy_ok {
        let (c, had_errors) = enc.decode_without_bom_handling(body);
        (c.into_owned(), enc, had_errors)
    } else {
        match UTF_8.decode_without_bom_handling_and_without_replacement(body) {
            Some(c) => (c.into_owned(), UTF_8, false),
            None => (WINDOWS_1252.decode_without_bom_handling(body).0.into_owned(), WINDOWS_1252, false),
        }
    };
    let crlf_n = content.matches("\r\n").count();
    let lf_n = content.matches('\n').count() - crlf_n;
    Ok(FileData { path, mtime, content: Some(content), note: None, encoding: enc.name().into(), bom: bom_len > 0, crlf: crlf_n > lf_n, lossy })
}

/// UTF-16 has no encoder in encoding_rs (the web platform never writes it), so do it by hand.
fn encode_text(content: &str, enc: &'static Encoding, bom: bool) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(content.len() + 3);
    if enc == UTF_16LE || enc == UTF_16BE {
        let le = enc == UTF_16LE;
        let unit = |u: u16| if le { u.to_le_bytes() } else { u.to_be_bytes() };
        if bom {
            out.extend_from_slice(&unit(0xFEFF));
        }
        for u in content.encode_utf16() {
            out.extend_from_slice(&unit(u));
        }
        return Ok(out);
    }
    if bom && enc == UTF_8 {
        out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    let (bytes, _, had_errors) = enc.encode(content);
    if had_errors {
        // Name the first character that doesn't fit, so the message is actionable.
        let bad = content.chars().find(|c| enc.encode(c.encode_utf8(&mut [0; 4])).2).unwrap_or('?');
        return Err(format!("UNMAPPABLE:{bad}"));
    }
    out.extend_from_slice(&bytes);
    Ok(out)
}

/// Saves `content` over `path` (recreating it if it was deleted). When `expected_mtime` is given and the
/// file on disk has a different modification time, nothing is written and the error is `CONFLICT`, so
/// the UI can ask before overwriting someone else's change. A character that `encoding` can't represent
/// gives `UNMAPPABLE:<char>` and nothing is written. Returns the new mtime.
#[tauri::command]
fn write_file(path: String, content: String, encoding: String, bom: bool, expected_mtime: Option<u64>) -> Result<u64, String> {
    let p = Path::new(&path);
    if let (Some(want), Ok(now)) = (expected_mtime, mtime_ms(p)) {
        if now != want {
            return Err("CONFLICT".into());
        }
    }
    let bytes = encode_text(&content, lookup_encoding(&encoding)?, bom)?;
    fs::write(p, bytes).map_err(|e| e.to_string())?;
    mtime_ms(p)
}

/// The "Save As" dialog. `None` = cancelled. If `CODEPAD_SAVE_AS` is set it names the answer
/// instead (so automated UI tests don't need a human at the file dialog).
#[tauri::command]
async fn save_dialog(app: tauri::AppHandle, name: String, dir: Option<String>) -> Option<String> {
    if let Ok(forced) = std::env::var("CODEPAD_SAVE_AS") {
        return Some(forced);
    }
    let mut dlg = app.dialog().file().set_file_name(name);
    if let Some(d) = dir.filter(|d| Path::new(d).is_dir()) {
        dlg = dlg.set_directory(d);
    }
    let picked = dlg.blocking_save_file()?;
    picked.into_path().ok().map(|p| canon_new(&p))
}

/// Like `canon`, for a file that may not exist yet: resolve the folder, keep the new name.
fn canon_new(p: &Path) -> String {
    match (p.parent(), p.file_name()) {
        (Some(dir), Some(name)) if !p.exists() => Path::new(&canon(dir)).join(name).to_string_lossy().into_owned(),
        _ => canon(p),
    }
}

/// An image file as a `data:` URL, for the Markdown preview (the webview can't load local files itself).
#[tauri::command]
fn read_image_data(path: String) -> Result<String, String> {
    use base64::Engine;
    const MAX_IMAGE: u64 = 15 * 1024 * 1024;
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return Err("not an image".into()),
    };
    if fs::metadata(p).map_err(|e| e.to_string())?.len() > MAX_IMAGE {
        return Err("image too large".into());
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Opens a web or mail link from the Markdown preview in the default app. Nothing else is allowed through.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err("unsupported link".into());
    }
    #[cfg(windows)]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
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
        path: canon(&p), // same spelling an opened tab gets, so settings.json is recognised even behind a link
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
    if shell::handle_cli() {
        return;
    }
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
            std::thread::spawn(shell::heal);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, save_dialog, read_image_data, open_external, shell::context_menu_enabled, shell::set_context_menu, file_mtime, initial_files,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_roundtrips_with_bom() {
        let bytes = encode_text("héllo\r\n€", UTF_16LE, true).unwrap();
        assert_eq!(&bytes[..2], &[0xFF, 0xFE]);
        let (enc, n) = Encoding::for_bom(&bytes).unwrap();
        assert_eq!(enc, UTF_16LE);
        assert_eq!(enc.decode_without_bom_handling(&bytes[n..]).0, "héllo\r\n€");
        let be = encode_text("a", UTF_16BE, true).unwrap();
        assert_eq!(be, vec![0xFE, 0xFF, 0x00, b'a']);
    }

    #[test]
    fn unmappable_character_is_named() {
        assert_eq!(encode_text("price: €5", WINDOWS_1252, false).unwrap(), b"price: \x805");
        let err = encode_text("snow ☃", WINDOWS_1252, false).unwrap_err();
        assert_eq!(err, "UNMAPPABLE:☃");
    }

    #[test]
    fn utf8_bom_is_optional() {
        assert_eq!(encode_text("a", UTF_8, true).unwrap(), vec![0xEF, 0xBB, 0xBF, b'a']);
        assert_eq!(encode_text("a", UTF_8, false).unwrap(), vec![b'a']);
    }
}
