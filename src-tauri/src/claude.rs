use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEvent {
    pub event_type: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub is_error: bool,
    pub raw_json: Option<String>,
}

/// Input message format for Claude CLI stream-json mode
#[derive(Debug, Serialize)]
struct InputMessage {
    #[serde(rename = "type")]
    msg_type: String,
    message: UserMessage,
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_tool_use_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct UserMessage {
    role: String,
    content: String,
}

pub struct ClaudeSession {
    child: Arc<Mutex<Option<Child>>>,
    stdin_writer: Arc<Mutex<Option<std::process::ChildStdin>>>,
    session_id: String,
    #[allow(dead_code)]
    working_dir: String,
}

impl ClaudeSession {
    pub fn new(working_dir: &str, app_handle: AppHandle) -> Result<Self, String> {
        let session_id = Uuid::new_v4().to_string();

        // Enhanced PATH for finding claude binary
        let path = std::env::var("PATH").unwrap_or_default();
        let home = std::env::var("HOME").unwrap_or_default();
        let enhanced_path = format!(
            "{}:{}/.local/bin:{}/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin",
            path, home, home
        );

        log::info!("Starting Claude session with working_dir: {}", working_dir);
        log::info!("Session ID: {}", session_id);

        // Spawn Claude in SDK streaming mode
        // This keeps the process alive for multi-turn conversation
        let mut child = Command::new("claude")
            .args([
                "--input-format", "stream-json",
                "--output-format", "stream-json",
                "--verbose",
            ])
            .current_dir(working_dir)
            .env("PATH", &enhanced_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {}. Is Claude Code installed?", e))?;

        log::info!("Claude process spawned successfully");

        // Take ownership of stdin for writing messages
        let stdin = child.stdin.take()
            .ok_or("Failed to open stdin")?;

        // Take stdout for reading responses
        let stdout = child.stdout.take()
            .ok_or("Failed to open stdout")?;

        // Take stderr for error handling
        let stderr = child.stderr.take()
            .ok_or("Failed to open stderr")?;

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let stdin_arc = Arc::new(Mutex::new(Some(stdin)));

        // Spawn stdout reader thread
        let app_stdout = app_handle.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                match line {
                    Ok(line) if !line.trim().is_empty() => {
                        log::debug!("Claude stdout: {}", &line[..std::cmp::min(200, line.len())]);

                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                            if let Some(event) = parse_claude_event(&json, &line) {
                                log::info!("Emitting event: type={}, content_len={}, tool={:?}",
                                    event.event_type, event.content.len(), event.tool_name);
                                let _ = app_stdout.emit("claude-event", event);
                            }
                        } else {
                            log::warn!("Failed to parse JSON: {}", &line[..std::cmp::min(100, line.len())]);
                        }
                    }
                    Ok(_) => {} // Empty line, skip
                    Err(e) => {
                        log::error!("Error reading stdout: {}", e);
                        break;
                    }
                }
            }
            log::info!("Claude stdout reader finished");
        });

        // Spawn stderr reader thread
        let app_stderr = app_handle;
        thread::spawn(move || {
            let reader = BufReader::new(stderr);

            for line in reader.lines() {
                match line {
                    Ok(line) if !line.trim().is_empty() => {
                        log::warn!("Claude stderr: {}", line);
                        // Only emit real errors, not info/debug messages
                        let lower = line.to_lowercase();
                        if lower.contains("error") || lower.contains("failed") || lower.contains("exception") {
                            let _ = app_stderr.emit("claude-event", ClaudeEvent {
                                event_type: "error".to_string(),
                                content: line,
                                tool_name: None,
                                tool_input: None,
                                is_error: true,
                                raw_json: None,
                            });
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        log::error!("Error reading stderr: {}", e);
                        break;
                    }
                }
            }
            log::info!("Claude stderr reader finished");
        });

        Ok(Self {
            child: child_arc,
            stdin_writer: stdin_arc,
            session_id,
            working_dir: working_dir.to_string(),
        })
    }

    pub fn send_message(&self, message: &str, app_handle: AppHandle) -> Result<(), String> {
        log::info!("Sending message to Claude: {}", &message[..std::cmp::min(100, message.len())]);

        // Build the input message in SDK format
        let input = InputMessage {
            msg_type: "user".to_string(),
            message: UserMessage {
                role: "user".to_string(),
                content: message.to_string(),
            },
            session_id: self.session_id.clone(),
            parent_tool_use_id: None,
        };

        let json_line = serde_json::to_string(&input)
            .map_err(|e| format!("Failed to serialize message: {}", e))?;

        log::debug!("Sending JSON: {}", json_line);

        // Write to stdin
        let mut stdin_guard = self.stdin_writer.lock()
            .map_err(|e| format!("Failed to lock stdin: {}", e))?;

        if let Some(ref mut stdin) = *stdin_guard {
            writeln!(stdin, "{}", json_line)
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin.flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            log::info!("Message sent successfully");

            // Emit a "sent" event so frontend knows message was delivered
            let _ = app_handle.emit("claude-event", ClaudeEvent {
                event_type: "message_sent".to_string(),
                content: String::new(),
                tool_name: None,
                tool_input: None,
                is_error: false,
                raw_json: None,
            });

            Ok(())
        } else {
            Err("Stdin not available - session may have ended".to_string())
        }
    }

    pub fn stop(&self) {
        log::info!("Stopping Claude session");

        // Close stdin to signal EOF
        if let Ok(mut guard) = self.stdin_writer.lock() {
            *guard = None;
        }

        // Kill the child process
        if let Ok(mut guard) = self.child.lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
    }
}

impl Drop for ClaudeSession {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Parse a Claude CLI JSON event into our ClaudeEvent structure
fn parse_claude_event(json: &serde_json::Value, raw_line: &str) -> Option<ClaudeEvent> {
    let event_type = json.get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown")
        .to_string();

    log::debug!("Parsing event type: {}", event_type);

    match event_type.as_str() {
        "assistant" => {
            // Extract text content from message.content array
            let content = json.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            let item_type = item.get("type").and_then(|t| t.as_str());
                            match item_type {
                                Some("text") => item.get("text").and_then(|t| t.as_str()),
                                Some("thinking") => item.get("thinking").and_then(|t| t.as_str()),
                                _ => None,
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();

            // Check for tool use
            let tool_info = json.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter().find_map(|item| {
                        if item.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            Some((
                                item.get("name").and_then(|n| n.as_str()).map(String::from),
                                item.get("input").map(|i| serde_json::to_string_pretty(i).unwrap_or_default()),
                            ))
                        } else {
                            None
                        }
                    })
                });

            let (tool_name, tool_input) = tool_info.unwrap_or((None, None));

            // Skip if no content and no tool
            if content.is_empty() && tool_name.is_none() {
                return None;
            }

            Some(ClaudeEvent {
                event_type: "assistant".to_string(),
                content,
                tool_name,
                tool_input,
                is_error: false,
                raw_json: Some(raw_line.to_string()),
            })
        }
        "result" => {
            let content = json.get("result")
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .to_string();

            Some(ClaudeEvent {
                event_type: "result".to_string(),
                content,
                tool_name: None,
                tool_input: None,
                is_error: false,
                raw_json: Some(raw_line.to_string()),
            })
        }
        "system" => {
            // System init message - could extract session info if needed
            log::info!("Claude system event: {:?}", json);
            None
        }
        "error" => {
            let content = json.get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error")
                .to_string();

            Some(ClaudeEvent {
                event_type: "error".to_string(),
                content,
                tool_name: None,
                tool_input: None,
                is_error: true,
                raw_json: Some(raw_line.to_string()),
            })
        }
        _ => {
            log::debug!("Unknown event type: {}", event_type);
            None
        }
    }
}

pub struct ClaudeState {
    pub session: Option<ClaudeSession>,
}

impl ClaudeState {
    pub fn new() -> Self {
        Self { session: None }
    }
}
