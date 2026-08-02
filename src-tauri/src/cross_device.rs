use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::Sender,
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rand::RngCore;
use serde::Serialize;

const MAX_TEXT_BYTES: usize = 100_000;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Clone)]
enum SharedItem {
    Text {
        text: String,
        preview: String,
        sent_at: i64,
        revision: u64,
    },
    Image {
        png: Vec<u8>,
        preview: String,
        sent_at: i64,
        revision: u64,
    },
}

#[derive(Default)]
struct Inner {
    address: Option<String>,
    port: Option<u16>,
    token: Option<String>,
    last_seen_at: Option<i64>,
    latest: Option<SharedItem>,
    revision: u64,
}

pub struct CrossDevice {
    inner: Arc<Mutex<Inner>>,
    generation: Arc<AtomicU64>,
    phone_text: Sender<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub url: Option<String>,
    pub pair_code: Option<String>,
    pub connected: bool,
    pub last_seen_at: Option<i64>,
    pub last_sent_at: Option<i64>,
    pub last_sent_preview: Option<String>,
}

#[derive(Serialize)]
pub struct SendResult {
    pub ok: bool,
    pub reason: Option<&'static str>,
}

impl CrossDevice {
    pub fn new(phone_text: Sender<String>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            generation: Arc::new(AtomicU64::new(0)),
            phone_text,
        }
    }
    pub fn start(&self) -> Result<Status, String> {
        if self
            .inner
            .lock()
            .map_err(|_| "cross-device lock poisoned")?
            .port
            .is_some()
        {
            return Ok(self.status());
        }
        let address =
            lan_address().ok_or_else(|| "没有检测到可用的局域网 IPv4 地址".to_string())?;
        let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let mut random = [0u8; 24];
        rand::rng().fill_bytes(&mut random);
        let token = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "cross-device lock poisoned")?;
            inner.address = Some(address);
            inner.port = Some(port);
            inner.token = Some(token);
        }
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let current = self.generation.clone();
        let inner = self.inner.clone();
        let phone = self.phone_text.clone();
        thread::spawn(move || {
            while current.load(Ordering::Acquire) == generation {
                match listener.accept() {
                    Ok((stream, _)) => handle(stream, &inner, &phone),
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(40))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(self.status())
    }
    pub fn stop(&self) -> Status {
        self.generation.fetch_add(1, Ordering::AcqRel);
        *self.inner.lock().expect("cross-device lock poisoned") = Inner::default();
        self.status()
    }
    pub fn status(&self) -> Status {
        let inner = self.inner.lock().expect("cross-device lock poisoned");
        let running = inner.port.is_some() && inner.token.is_some();
        let url = match (&inner.address, inner.port, &inner.token) {
            (Some(a), Some(p), Some(t)) => Some(format!("http://{a}:{p}/pair/{t}")),
            _ => None,
        };
        let pair_code = inner
            .token
            .as_ref()
            .map(|t| t[t.len() - 6..].to_uppercase());
        let (last_sent_at, last_sent_preview) = match &inner.latest {
            Some(SharedItem::Text {
                sent_at, preview, ..
            })
            | Some(SharedItem::Image {
                sent_at, preview, ..
            }) => (Some(*sent_at), Some(preview.clone())),
            None => (None, None),
        };
        Status {
            running,
            url,
            pair_code,
            connected: running && inner.last_seen_at.is_some_and(|v| now_ms() - v < 5000),
            last_seen_at: inner.last_seen_at,
            last_sent_at,
            last_sent_preview,
        }
    }
    pub fn publish_text(&self, text: String) -> SendResult {
        if self.status().running == false {
            return fail("not-running");
        }
        if text.len() > MAX_TEXT_BYTES {
            return fail("too-large");
        }
        if crate::classify::is_sensitive_sync_text(&text) {
            return fail("sensitive");
        }
        let mut inner = self.inner.lock().unwrap();
        inner.revision += 1;
        inner.latest = Some(SharedItem::Text {
            preview: preview(&text),
            text,
            sent_at: now_ms(),
            revision: inner.revision,
        });
        SendResult {
            ok: true,
            reason: None,
        }
    }
    pub fn publish_image(&self, png: Vec<u8>, preview: String) -> SendResult {
        if !self.status().running {
            return fail("not-running");
        }
        if png.is_empty() || png.len() > MAX_IMAGE_BYTES {
            return fail("too-large");
        }
        let mut inner = self.inner.lock().unwrap();
        inner.revision += 1;
        inner.latest = Some(SharedItem::Image {
            png,
            preview,
            sent_at: now_ms(),
            revision: inner.revision,
        });
        SendResult {
            ok: true,
            reason: None,
        }
    }
}

fn handle(mut stream: TcpStream, inner: &Arc<Mutex<Inner>>, phone: &Sender<String>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut data = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                data.extend_from_slice(&chunk[..n]);
                if request_complete(&data) {
                    break;
                }
                if data.len() > MAX_TEXT_BYTES + 8192 {
                    return;
                }
            }
            Err(_) => return,
        }
    }
    let request = String::from_utf8_lossy(&data);
    let first = request.lines().next().unwrap_or_default();
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");
    let clean = path.split('?').next().unwrap_or(path);
    let token = clean.rsplit('/').next().unwrap_or("");
    let expected = inner.lock().ok().and_then(|v| v.token.clone());
    if expected.as_deref() != Some(token) {
        respond(
            &mut stream,
            404,
            "text/plain; charset=utf-8",
            b"Pairing expired",
        );
        return;
    }
    if method == "GET" && clean.starts_with("/pair/") {
        respond(
            &mut stream,
            200,
            "text/html; charset=utf-8",
            mobile_page().as_bytes(),
        );
        return;
    }
    if method == "GET" && clean.starts_with("/api/state/") {
        let mut state = inner.lock().unwrap();
        state.last_seen_at = Some(now_ms());
        let latest = match &state.latest {
            Some(SharedItem::Text {
                text,
                preview,
                sent_at,
                revision,
            }) => {
                serde_json::json!({"revision":revision,"kind":"text","text":text,"preview":preview,"sentAt":sent_at})
            }
            Some(SharedItem::Image {
                preview,
                sent_at,
                revision,
                ..
            }) => {
                serde_json::json!({"revision":revision,"kind":"image","text":null,"preview":preview,"sentAt":sent_at,"imageUrl":format!("/api/image/{token}?revision={revision}")})
            }
            None => serde_json::Value::Null,
        };
        let body = serde_json::to_vec(&serde_json::json!({"ok":true,"latest":latest})).unwrap();
        respond(&mut stream, 200, "application/json", &body);
        return;
    }
    if method == "GET" && clean.starts_with("/api/image/") {
        let image = inner.lock().ok().and_then(|v| match &v.latest {
            Some(SharedItem::Image { png, .. }) => Some(png.clone()),
            _ => None,
        });
        if let Some(png) = image {
            respond(&mut stream, 200, "image/png", &png)
        } else {
            respond(&mut stream, 404, "text/plain", b"Not found")
        };
        return;
    }
    if method == "POST" && clean.starts_with("/api/send/") {
        let body = request.split_once("\r\n\r\n").map(|v| v.1).unwrap_or("");
        let text = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v.get("text").and_then(|v| v.as_str()).map(str::to_string))
            .unwrap_or_default();
        if text.trim().is_empty() || crate::classify::is_sensitive_sync_text(&text) {
            respond(&mut stream, 403, "application/json", b"{\"ok\":false}");
            return;
        }
        let _ = phone.send(text.clone());
        let mut state = inner.lock().unwrap();
        state.last_seen_at = Some(now_ms());
        state.revision += 1;
        state.latest = Some(SharedItem::Text {
            text: text.clone(),
            preview: preview(&text),
            sent_at: now_ms(),
            revision: state.revision,
        });
        respond(&mut stream, 200, "application/json", b"{\"ok\":true}");
        return;
    }
    respond(&mut stream, 404, "text/plain", b"Not found")
}

fn request_complete(data: &[u8]) -> bool {
    let Some(pos) = data.windows(4).position(|v| v == b"\r\n\r\n") else {
        return false;
    };
    let header = String::from_utf8_lossy(&data[..pos]);
    let length = header
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .and_then(|v| v.trim().parse::<usize>().ok())
        })
        .unwrap_or(0);
    data.len() >= pos + 4 + length
}
fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) {
    let reason = if status == 200 { "OK" } else { "Not Found" };
    let header=format!("HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",body.len());
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}
fn lan_address() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn preview(text: &str) -> String {
    crate::classify::make_preview(text, 160)
}
fn fail(reason: &'static str) -> SendResult {
    SendResult {
        ok: false,
        reason: Some(reason),
    }
}
fn mobile_page() -> String {
    r#"<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Witch Clipboard</title><style>body{font:16px system-ui;max-width:680px;margin:40px auto;padding:20px;background:#18131f;color:#eee}section{background:#2a2234;padding:20px;border-radius:18px;margin:16px 0}textarea{box-sizing:border-box;width:100%;min-height:140px;padding:12px}button{padding:12px 20px;background:#8b5cf6;color:white;border:0;border-radius:10px}img{max-width:100%}</style><h1>Witch Clipboard</h1><section><h3>来自电脑</h3><div id=received>等待内容…</div></section><section><h3>发送到电脑</h3><textarea id=out></textarea><p><button onclick=send()>发送</button></p></section><script>const token=location.pathname.split('/').pop();let revision=0;async function poll(){try{const s=await(await fetch('/api/state/'+token,{cache:'no-store'})).json();if(s.latest&&s.latest.revision!==revision){revision=s.latest.revision;received.innerHTML=s.latest.kind==='image'?'<img src="'+s.latest.imageUrl+'">':'<pre></pre>';if(s.latest.kind==='text')received.querySelector('pre').textContent=s.latest.text}}catch{}setTimeout(poll,1000)}async function send(){await fetch('/api/send/'+token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:out.value})});out.value=''}poll()</script>"#.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_pairing_server_sends_and_receives_text() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let service = CrossDevice::new(sender);
        let status = service.start().unwrap();
        let url = status.url.unwrap();
        let tail = url.split_once("/pair/").unwrap();
        let port = tail.0.rsplit(':').next().unwrap();
        let token = tail.1;
        let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
        let body = r#"{"text":"from phone"}"#;
        write!(
            stream,
            "POST /api/send/{token} HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.contains("200 OK"));
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(1)).unwrap(),
            "from phone"
        );
        assert!(service.publish_text("from desktop".into()).ok);
        assert!(!service.stop().running);
    }
}
