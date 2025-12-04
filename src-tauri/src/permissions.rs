use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

const SOCKET_PATH: &str = "/tmp/nocur-permissions.sock";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub decision: String, // "approve" or "block"
    pub reason: Option<String>,
}

pub struct PermissionServer {
    pending_requests: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<PermissionResponse>>>>,
    running: Arc<Mutex<bool>>,
    auto_approve: Arc<Mutex<bool>>,
}

impl PermissionServer {
    pub fn new() -> Self {
        Self {
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
            auto_approve: Arc::new(Mutex::new(false)),
        }
    }

    pub fn set_auto_approve(&self, enabled: bool) {
        *self.auto_approve.lock() = enabled;
        log::info!("Auto-approve mode: {}", enabled);
    }

    pub fn is_auto_approve(&self) -> bool {
        *self.auto_approve.lock()
    }

    pub fn start(&self, app_handle: AppHandle) {
        // Check if already running
        {
            let mut running = self.running.lock();
            if *running {
                log::info!("Permission server already running");
                return;
            }
            *running = true;
        }

        // Remove existing socket file
        let _ = std::fs::remove_file(SOCKET_PATH);

        let pending = self.pending_requests.clone();
        let running = self.running.clone();
        let auto_approve = self.auto_approve.clone();

        thread::spawn(move || {
            let listener = match UnixListener::bind(SOCKET_PATH) {
                Ok(l) => l,
                Err(e) => {
                    log::error!("Failed to bind permission socket: {}", e);
                    *running.lock() = false;
                    return;
                }
            };

            log::info!("Permission server listening on {}", SOCKET_PATH);

            // Set socket to non-blocking for graceful shutdown
            listener.set_nonblocking(true).ok();

            while *running.lock() {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let pending_clone = pending.clone();
                        let app_clone = app_handle.clone();
                        let auto_approve_clone = auto_approve.clone();

                        thread::spawn(move || {
                            handle_connection(stream, pending_clone, app_clone, auto_approve_clone);
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // No connection available, sleep briefly
                        thread::sleep(Duration::from_millis(100));
                    }
                    Err(e) => {
                        log::error!("Failed to accept connection: {}", e);
                    }
                }
            }

            log::info!("Permission server stopped");
            let _ = std::fs::remove_file(SOCKET_PATH);
        });
    }

    pub fn stop(&self) {
        *self.running.lock() = false;
    }

    pub fn respond(&self, request_id: &str, response: PermissionResponse) {
        let mut pending = self.pending_requests.lock();
        if let Some(sender) = pending.remove(request_id) {
            let _ = sender.send(response);
        } else {
            log::warn!("No pending request with id: {}", request_id);
        }
    }
}

fn handle_connection(
    mut stream: UnixStream,
    pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<PermissionResponse>>>>,
    app_handle: AppHandle,
    auto_approve: Arc<Mutex<bool>>,
) {
    // Set timeout for read
    stream.set_read_timeout(Some(Duration::from_secs(60))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    // Read the request
    let mut reader = BufReader::new(stream.try_clone().expect("Failed to clone stream"));
    let mut line = String::new();

    if let Err(e) = reader.read_line(&mut line) {
        log::error!("Failed to read from socket: {}", e);
        return;
    }

    log::debug!("Received permission request: {}", line.trim());

    // Parse the tool request from hook
    // Format from hook: {"session_id": "...", "tool_name": "Edit", "tool_input": {...}}
    let tool_info: serde_json::Value = match serde_json::from_str(&line) {
        Ok(v) => v,
        Err(e) => {
            log::error!("Failed to parse tool request: {}", e);
            let response = r#"{"decision": "block", "reason": "Invalid request format"}"#;
            let _ = writeln!(stream, "{}", response);
            return;
        }
    };

    let tool_name = tool_info.get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    // Check auto-approve mode - respond immediately without waiting for frontend
    if *auto_approve.lock() {
        log::info!("Auto-approving permission request for: {}", tool_name);
        let response = r#"{"decision": "approve", "reason": "Auto-approved (skip permissions mode)"}"#;
        if let Err(e) = writeln!(stream, "{}", response) {
            log::error!("Failed to write auto-approve response: {}", e);
        }
        return;
    }

    // Generate unique request ID
    let request_id = uuid::Uuid::new_v4().to_string();

    // Create the permission request
    let request = PermissionRequest {
        id: request_id.clone(),
        tool_name: tool_name.to_string(),
        tool_input: tool_info.get("tool_input")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        session_id: tool_info.get("session_id")
            .and_then(|v| v.as_str())
            .map(String::from),
    };

    // Create a channel for the response
    let (tx, rx) = tokio::sync::oneshot::channel();

    // Store the sender
    {
        let mut pending_guard = pending.lock();
        pending_guard.insert(request_id.clone(), tx);
    }

    // Emit event to frontend
    log::info!("Emitting permission request: {} - {}", request.id, request.tool_name);
    if let Err(e) = app_handle.emit("permission-request", &request) {
        log::error!("Failed to emit permission request: {}", e);
    }

    // Wait for response (blocking with timeout)
    let response = match rx.blocking_recv() {
        Ok(r) => r,
        Err(_) => {
            log::warn!("Permission request timed out: {}", request_id);
            // Clean up
            pending.lock().remove(&request_id);
            PermissionResponse {
                decision: "block".to_string(),
                reason: Some("Request timed out".to_string()),
            }
        }
    };

    // Send response back to hook
    let response_json = serde_json::to_string(&response).unwrap_or_else(|_| {
        r#"{"decision": "block", "reason": "Failed to serialize response"}"#.to_string()
    });

    log::debug!("Sending permission response: {}", response_json);
    if let Err(e) = writeln!(stream, "{}", response_json) {
        log::error!("Failed to write response: {}", e);
    }
}

pub struct PermissionState {
    pub server: PermissionServer,
}

impl PermissionState {
    pub fn new() -> Self {
        Self {
            server: PermissionServer::new(),
        }
    }
}
