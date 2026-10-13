//! Quit from the Dock, or the system quitting apps at log out, without losing unsaved edits.
//!
//! Those ask the app to terminate through AppKit (`[NSApp terminate:]`). The window library behind Tauri
//! has no hook for that, so the app would just vanish with its edits. AppKit first asks the app delegate
//! `applicationShouldTerminate:`, if it has such a method, so this adds one to the delegate class:
//! while the window is open it closes the window instead (which asks "save your changes?", and quits
//! once the window is gone) and tells AppKit not to terminate yet. Without a window it lets AppKit go ahead.
//!
//! If the delegate class can't be found (the window library renamed it) nothing is added, and quitting
//! from the Dock behaves as it would without this. Cmd+Q is a menu item of ours and doesn't depend on any of this.

use std::{
    ffi::{c_char, c_void},
    sync::OnceLock,
};
use tauri::{AppHandle, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();

extern "C" {
    fn objc_getClass(name: *const c_char) -> *mut c_void;
    fn sel_registerName(name: *const c_char) -> *mut c_void;
    fn class_addMethod(class: *mut c_void, name: *mut c_void, imp: *const c_void, types: *const c_char) -> bool;
}

const NS_TERMINATE_CANCEL: usize = 0;
const NS_TERMINATE_NOW: usize = 1;

extern "C" fn should_terminate(_this: *mut c_void, _cmd: *mut c_void, _sender: *mut c_void) -> usize {
    match APP.get().and_then(|app| app.get_webview_window("main")) {
        Some(window) => {
            let _ = window.close();
            NS_TERMINATE_CANCEL
        }
        None => NS_TERMINATE_NOW,
    }
}

pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    // SAFETY: plain Objective-C runtime calls; the class and selector names are NUL-terminated literals, and
    // `should_terminate` has the signature `NSUInteger (id, SEL, id)` that the type string "Q@:@" describes.
    unsafe {
        let class = objc_getClass(c"TaoAppDelegateParent".as_ptr());
        if class.is_null() {
            return;
        }
        class_addMethod(class, sel_registerName(c"applicationShouldTerminate:".as_ptr()), should_terminate as *const c_void, c"Q@:@".as_ptr());
    }
}

/// What the Dock's "Quit" does, for the end-to-end tests.
#[cfg(feature = "e2e")]
pub fn terminate() {
    extern "C" {
        fn objc_msgSend();
    }
    // SAFETY: `+[NSApplication sharedApplication]` and `-[NSApplication terminate:]` called with matching signatures.
    unsafe {
        let send0: extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void = std::mem::transmute(objc_msgSend as *const c_void);
        let send1: extern "C" fn(*mut c_void, *mut c_void, *mut c_void) = std::mem::transmute(objc_msgSend as *const c_void);
        let app = send0(objc_getClass(c"NSApplication".as_ptr()), sel_registerName(c"sharedApplication".as_ptr()));
        send1(app, sel_registerName(c"terminate:".as_ptr()), std::ptr::null_mut());
    }
}
