//! A way for the end-to-end tests to drive the page on macOS. Only compiled with `--features e2e`; the
//! builds that are released don't have it.
//!
//! On Windows the tests talk to WebView2 over its DevTools port. WKWebView has no such port, so with this
//! feature the app listens on `127.0.0.1:$CODEPAD_E2E_PORT` (and does nothing at all when that variable is
//! not set) and answers:
//!
//! - `POST /eval`: the body is a JavaScript expression (a promise is awaited). The reply is
//!   `{"ok":true,"value":...}` (plus `"undef":true` when the value was `undefined`) or `{"ok":false,"error":"..."}`.
//! - `POST /resize?w=800&h=600`: resizes the window (logical pixels).
//! - `POST /terminate` (macOS): what the Dock's "Quit" does.
//! - `GET /ping`.
//!
//! The page reports an `/eval` result back with `POST /result/<id>`.

use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{channel, Sender},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, LogicalSize, Manager};

type Waiting = Arc<Mutex<HashMap<u64, Sender<String>>>>;

pub fn start(app: AppHandle) {
    let Ok(port) = std::env::var("CODEPAD_E2E_PORT") else { return };
    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).expect("e2e port is taken");
    let waiting: Waiting = Arc::default();
    let next = Arc::new(AtomicU64::new(1));
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (app, waiting, next, port) = (app.clone(), waiting.clone(), next.clone(), port.clone());
            std::thread::spawn(move || {
                let _ = handle(stream, &app, &waiting, &next, &port);
            });
        }
    });
}

fn handle(mut stream: TcpStream, app: &AppHandle, waiting: &Waiting, next: &AtomicU64, port: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let request_line = head.lines().next().unwrap_or_default().to_string();
    let length = head
        .lines()
        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
        .unwrap_or(0);
    while buf.len() < head_end + length {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let body = String::from_utf8_lossy(&buf[head_end..]).into_owned();
    let mut parts = request_line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let (path, query) = target.split_once('?').unwrap_or((target, ""));

    let reply = |stream: &mut TcpStream, status: &str, text: &str| {
        let _ = write!(
            stream,
            "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
            text.len()
        );
    };

    match (method, path) {
        ("OPTIONS", _) => reply(&mut stream, "204 No Content", ""),
        ("GET", "/ping") => reply(&mut stream, "200 OK", "\"pong\""),
        ("POST", "/resize") => {
            let num = |k: &str| query.split('&').find_map(|p| p.strip_prefix(&format!("{k}="))).and_then(|v| v.parse::<f64>().ok());
            match (num("w"), num("h"), app.get_webview_window("main")) {
                (Some(w), Some(h), Some(win)) => {
                    let _ = win.set_size(LogicalSize::new(w, h));
                    reply(&mut stream, "200 OK", "true");
                }
                _ => reply(&mut stream, "400 Bad Request", "false"),
            }
        }
        #[cfg(target_os = "macos")]
        ("POST", "/terminate") => {
            let _ = app.run_on_main_thread(crate::quit_guard::terminate);
            reply(&mut stream, "200 OK", "true");
        }
        ("POST", p) if p.starts_with("/result/") => {
            if let Some(tx) = p["/result/".len()..].parse::<u64>().ok().and_then(|id| waiting.lock().unwrap().remove(&id)) {
                let _ = tx.send(body);
            }
            reply(&mut stream, "200 OK", "true");
        }
        ("POST", "/eval") => {
            let id = next.fetch_add(1, Ordering::SeqCst);
            let (tx, rx) = channel();
            waiting.lock().unwrap().insert(id, tx);
            let script = format!(
                "(async()=>{{let r;try{{const v=await (0,eval)({expr});r={{ok:true,value:v===undefined?null:v,undef:v===undefined}}}}catch(e){{r={{ok:false,error:String((e&&e.stack)||e)}}}}\
                 let text;try{{text=JSON.stringify(r)}}catch(e){{text=JSON.stringify({{ok:false,error:'not serialisable: '+e}})}}\
                 await fetch('http://127.0.0.1:{port}/result/{id}',{{method:'POST',mode:'no-cors',body:text}})}})()",
                expr = serde_json::to_string(&body).unwrap(),
            );
            match app.get_webview_window("main").map(|w| w.eval(script)) {
                Some(Ok(())) => match rx.recv_timeout(Duration::from_secs(30)) {
                    Ok(text) => reply(&mut stream, "200 OK", &text),
                    Err(_) => reply(&mut stream, "504 Gateway Timeout", "{\"ok\":false,\"error\":\"the page never answered\"}"),
                },
                _ => reply(&mut stream, "503 Service Unavailable", "{\"ok\":false,\"error\":\"no window\"}"),
            }
            waiting.lock().unwrap().remove(&id);
        }
        _ => reply(&mut stream, "404 Not Found", "null"),
    }
    Ok(())
}
