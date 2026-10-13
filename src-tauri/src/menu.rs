//! The macOS menu bar.
//!
//! Every item with a shortcut here is a command of the app itself: choosing it (or pressing its
//! shortcut, which the menu swallows before the page sees it) sends the item's id to the page as a
//! `menu` event, and `src/lib/menu.ts` runs the matching command. Only the standard window and
//! text items (hide, minimize, copy, paste...) are handled by the system.
//!
//! There is deliberately no Undo / Redo item and no Close Window: CodeMirror keeps its own history, and
//! Cmd+W closes a tab, not the window.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Wry,
};

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, text: &str, accelerator: Option<&str>| MenuItem::with_id(app, id, text, true, accelerator);
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu = Submenu::with_items(
        app,
        "Codepad",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Codepad"), None)?,
            &sep()?,
            &item("settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &item("quit", "Quit Codepad", Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("new", "New File", Some("CmdOrCtrl+N"))?,
            &item("open", "Open…", Some("CmdOrCtrl+O"))?,
            &sep()?,
            &item("save", "Save", Some("CmdOrCtrl+S"))?,
            &item("save_as", "Save As…", Some("CmdOrCtrl+Shift+S"))?,
            &item("save_all", "Save All", Some("CmdOrCtrl+Alt+S"))?,
            &sep()?,
            &item("close", "Close File", Some("CmdOrCtrl+W"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("palette", "Command Palette…", Some("CmdOrCtrl+Shift+P"))?,
            &sep()?,
            &item("zoom_in", "Zoom In", Some("CmdOrCtrl+="))?,
            &item("zoom_out", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &item("zoom_reset", "Actual Size", Some("CmdOrCtrl+0"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window = Submenu::with_items(app, "Window", true, &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?])?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
}
