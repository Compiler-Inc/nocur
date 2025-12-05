use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// Events emitted to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEvent {
    pub event_type: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub tool_id: Option<String>,
    pub is_error: bool,
    pub raw_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    // Token usage fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_tokens: Option<u64>,
    // SDK-specific fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_turns: Option<u32>,
}

impl Default for ClaudeEvent {
    fn default() -> Self {
        Self {
            event_type: String::new(),
            content: String::new(),
            tool_name: None,
            tool_input: None,
            tool_id: None,
            is_error: false,
            raw_json: None,
            skills: None,
            model: None,
            session_id: None,
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            cache_creation_tokens: None,
            cost: None,
            duration: None,
            num_turns: None,
        }
    }
}

/// Commands sent to the claude-service
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ServiceCommand {
    Start {
        #[serde(rename = "workingDir")]
        working_dir: String,
        model: Option<String>,
        #[serde(rename = "resumeSessionId")]
        resume_session_id: Option<String>,
        #[serde(rename = "skipPermissions")]
        skip_permissions: bool,
    },
    Message {
        content: String,
    },
    Interrupt,
    ChangeModel {
        model: String,
    },
    Stop,
}

/// Available Claude models
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ClaudeModel {
    #[serde(rename = "sonnet")]
    Sonnet,
    #[serde(rename = "opus")]
    Opus,
    #[serde(rename = "haiku")]
    Haiku,
}

impl ClaudeModel {
    pub fn as_str(&self) -> &str {
        match self {
            ClaudeModel::Sonnet => "sonnet",
            ClaudeModel::Opus => "opus",
            ClaudeModel::Haiku => "haiku",
        }
    }

    pub fn display_name(&self) -> &str {
        match self {
            ClaudeModel::Sonnet => "Claude Sonnet",
            ClaudeModel::Opus => "Claude Opus",
            ClaudeModel::Haiku => "Claude Haiku",
        }
    }
}

impl Default for ClaudeModel {
    fn default() -> Self {
        ClaudeModel::Sonnet
    }
}

/// Session configuration for starting Claude
#[derive(Debug, Clone, Default)]
pub struct ClaudeSessionConfig {
    pub model: Option<ClaudeModel>,
    pub resume_session_id: Option<String>,
    pub skip_permissions: bool,
}

pub struct ClaudeSession {
    child: Arc<Mutex<Option<Child>>>,
    stdin_writer: Arc<Mutex<Option<std::process::ChildStdin>>>,
    session_id: String,
    #[allow(dead_code)]
    working_dir: String,
    #[allow(dead_code)]
    skip_permissions: bool,
    model: Option<ClaudeModel>,
}

impl ClaudeSession {
    pub fn new(working_dir: &str, app_handle: AppHandle, skip_permissions: bool) -> Result<Self, String> {
        Self::new_with_config(working_dir, app_handle, ClaudeSessionConfig {
            skip_permissions,
            ..Default::default()
        })
    }

    pub fn new_with_config(working_dir: &str, app_handle: AppHandle, config: ClaudeSessionConfig) -> Result<Self, String> {
        // Generate session ID (actual session ID comes from the service)
        let session_id = config.resume_session_id.clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        log::info!("Starting Claude SDK service with working_dir: {}", working_dir);
        log::info!("Session ID: {}", session_id);
        if let Some(ref model) = config.model {
            log::info!("Model: {}", model.as_str());
        }

        // Path to the Node.js service
        let service_path = format!("{}/claude-service/dist/index.js", working_dir);

        // Spawn the Node.js service
        let mut child = Command::new("node")
            .arg(&service_path)
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn claude-service: {}. Is Node.js installed?", e))?;

        log::info!("Claude SDK service spawned successfully");

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
                        log::debug!("Service stdout: {}", &line[..std::cmp::min(200, line.len())]);

                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                            if let Some(event) = parse_service_event(&json, &line) {
                                log::info!("Emitting event: type={}, content_len={}",
                                    event.event_type, event.content.len());
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
            log::info!("Claude service stdout reader finished");
        });

        // Spawn stderr reader thread
        let app_stderr = app_handle.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);

            for line in reader.lines() {
                match line {
                    Ok(line) if !line.trim().is_empty() => {
                        log::warn!("Service stderr: {}", line);
                        // Only emit real errors
                        let lower = line.to_lowercase();
                        if lower.contains("error") || lower.contains("failed") || lower.contains("exception") {
                            let _ = app_stderr.emit("claude-event", ClaudeEvent {
                                event_type: "error".to_string(),
                                content: line,
                                is_error: true,
                                ..Default::default()
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
            log::info!("Claude service stderr reader finished");
        });

        let session = Self {
            child: child_arc,
            stdin_writer: stdin_arc.clone(),
            session_id: session_id.clone(),
            working_dir: working_dir.to_string(),
            skip_permissions: config.skip_permissions,
            model: config.model.clone(),
        };

        // Send start command to initialize the service
        let start_cmd = ServiceCommand::Start {
            working_dir: working_dir.to_string(),
            model: config.model.map(|m| m.as_str().to_string()),
            resume_session_id: config.resume_session_id,
            skip_permissions: config.skip_permissions,
        };

        let json_line = serde_json::to_string(&start_cmd)
            .map_err(|e| format!("Failed to serialize start command: {}", e))?;

        {
            let mut stdin_guard = stdin_arc.lock()
                .map_err(|e| format!("Failed to lock stdin: {}", e))?;

            if let Some(ref mut stdin) = *stdin_guard {
                writeln!(stdin, "{}", json_line)
                    .map_err(|e| format!("Failed to write start command: {}", e))?;
                stdin.flush()
                    .map_err(|e| format!("Failed to flush stdin: {}", e))?;
                log::info!("Start command sent to service");
            }
        }

        Ok(session)
    }

    /// Get the session ID for this Claude session
    pub fn get_session_id(&self) -> &str {
        &self.session_id
    }

    /// Get the model being used
    pub fn get_model(&self) -> Option<&ClaudeModel> {
        self.model.as_ref()
    }

    pub fn send_message(&self, message: &str, app_handle: AppHandle) -> Result<(), String> {
        log::info!("Sending message to Claude: {}", &message[..std::cmp::min(100, message.len())]);

        let cmd = ServiceCommand::Message {
            content: message.to_string(),
        };

        let json_line = serde_json::to_string(&cmd)
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

            // Emit a "sent" event
            let _ = app_handle.emit("claude-event", ClaudeEvent {
                event_type: "message_sent".to_string(),
                ..Default::default()
            });

            Ok(())
        } else {
            Err("Stdin not available - session may have ended".to_string())
        }
    }

    pub fn change_model(&self, model: &ClaudeModel) -> Result<(), String> {
        let cmd = ServiceCommand::ChangeModel {
            model: model.as_str().to_string(),
        };

        let json_line = serde_json::to_string(&cmd)
            .map_err(|e| format!("Failed to serialize change model command: {}", e))?;

        let mut stdin_guard = self.stdin_writer.lock()
            .map_err(|e| format!("Failed to lock stdin: {}", e))?;

        if let Some(ref mut stdin) = *stdin_guard {
            writeln!(stdin, "{}", json_line)
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin.flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            log::info!("Change model command sent");
            Ok(())
        } else {
            Err("Stdin not available".to_string())
        }
    }

    pub fn interrupt(&self) -> Result<(), String> {
        let cmd = ServiceCommand::Interrupt;

        let json_line = serde_json::to_string(&cmd)
            .map_err(|e| format!("Failed to serialize interrupt command: {}", e))?;

        let mut stdin_guard = self.stdin_writer.lock()
            .map_err(|e| format!("Failed to lock stdin: {}", e))?;

        if let Some(ref mut stdin) = *stdin_guard {
            writeln!(stdin, "{}", json_line)
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin.flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            log::info!("Interrupt command sent");
            Ok(())
        } else {
            Err("Stdin not available".to_string())
        }
    }

    pub fn stop(&self) {
        log::info!("Stopping Claude SDK service");

        // Try to send stop command gracefully
        if let Ok(mut guard) = self.stdin_writer.lock() {
            if let Some(ref mut stdin) = *guard {
                if let Ok(cmd) = serde_json::to_string(&ServiceCommand::Stop) {
                    let _ = writeln!(stdin, "{}", cmd);
                    let _ = stdin.flush();
                }
            }
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

/// Parse events from the claude-service
fn parse_service_event(json: &serde_json::Value, raw_line: &str) -> Option<ClaudeEvent> {
    let event_type = json.get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown")
        .to_string();

    log::debug!("Parsing service event type: {}", event_type);

    match event_type.as_str() {
        "service_ready" => {
            Some(ClaudeEvent {
                event_type: "service_ready".to_string(),
                content: "Claude SDK service is ready".to_string(),
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "ready" => {
            let model = json.get("model")
                .and_then(|m| m.as_str())
                .map(String::from);
            Some(ClaudeEvent {
                event_type: "ready".to_string(),
                content: String::new(),
                model,
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "system_init" => {
            let session_id = json.get("sessionId")
                .and_then(|s| s.as_str())
                .map(String::from);
            let model = json.get("model")
                .and_then(|m| m.as_str())
                .map(String::from);
            Some(ClaudeEvent {
                event_type: "system_init".to_string(),
                content: String::new(),
                session_id,
                model,
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "assistant" => {
            let content = json.get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            if content.is_empty() {
                return None;
            }

            Some(ClaudeEvent {
                event_type: "assistant".to_string(),
                content,
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "tool_use" => {
            let tool_name = json.get("toolName")
                .and_then(|n| n.as_str())
                .map(String::from);
            let tool_input = json.get("toolInput")
                .and_then(|i| i.as_str())
                .map(String::from);
            let tool_id = json.get("toolId")
                .and_then(|i| i.as_str())
                .map(String::from);

            Some(ClaudeEvent {
                event_type: "tool_use".to_string(),
                content: String::new(),
                tool_name,
                tool_input,
                tool_id,
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "tool_result" => {
            let result = json.get("result")
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .to_string();
            let tool_id = json.get("toolId")
                .and_then(|i| i.as_str())
                .map(String::from);

            Some(ClaudeEvent {
                event_type: "tool_result".to_string(),
                content: result,
                tool_id,
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "result" => {
            let content = json.get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            // Extract usage info
            let usage = json.get("usage");
            let input_tokens = usage
                .and_then(|u| u.get("inputTokens"))
                .and_then(|v| v.as_u64());
            let output_tokens = usage
                .and_then(|u| u.get("outputTokens"))
                .and_then(|v| v.as_u64());
            let cache_read_tokens = usage
                .and_then(|u| u.get("cacheReadTokens"))
                .and_then(|v| v.as_u64());
            let cache_creation_tokens = usage
                .and_then(|u| u.get("cacheCreationTokens"))
                .and_then(|v| v.as_u64());

            let cost = json.get("cost").and_then(|c| c.as_f64());
            let duration = json.get("duration").and_then(|d| d.as_f64());
            let num_turns = json.get("numTurns").and_then(|n| n.as_u64()).map(|n| n as u32);

            Some(ClaudeEvent {
                event_type: "result".to_string(),
                content,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
                cost,
                duration,
                num_turns,
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "error" => {
            let message = json.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error")
                .to_string();

            Some(ClaudeEvent {
                event_type: "error".to_string(),
                content: message,
                is_error: true,
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "interrupted" => {
            Some(ClaudeEvent {
                event_type: "interrupted".to_string(),
                content: "Query interrupted".to_string(),
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "model_changed" => {
            let model = json.get("model")
                .and_then(|m| m.as_str())
                .map(String::from);
            Some(ClaudeEvent {
                event_type: "model_changed".to_string(),
                content: String::new(),
                model,
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        "stopped" => {
            Some(ClaudeEvent {
                event_type: "stopped".to_string(),
                content: "Service stopped".to_string(),
                raw_json: Some(raw_line.to_string()),
                ..Default::default()
            })
        }
        _ => {
            log::debug!("Unhandled service event type: {}", event_type);
            None
        }
    }
}

/// Represents a saved session that can be resumed
#[derive(Debug, Clone, Serialize)]
pub struct SavedSession {
    pub session_id: String,
    pub model: Option<String>,
    pub created_at: u64, // Unix timestamp
    pub last_message_preview: Option<String>,
}

pub struct ClaudeState {
    pub session: Option<ClaudeSession>,
    pub skills: Vec<String>,
    pub model: Option<String>,
    /// History of session IDs for resume functionality
    pub session_history: Vec<SavedSession>,
}

impl ClaudeState {
    pub fn new() -> Self {
        Self {
            session: None,
            skills: Vec::new(),
            model: None,
            session_history: Vec::new(),
        }
    }

    pub fn set_session_info(&mut self, skills: Vec<String>, model: Option<String>) {
        self.skills = skills;
        self.model = model;
    }

    pub fn clear_session_info(&mut self) {
        self.skills.clear();
        self.model = None;
    }

    /// Save the current session to history before stopping it
    pub fn save_current_session(&mut self, last_message: Option<String>) {
        if let Some(ref session) = self.session {
            let session_id = session.get_session_id().to_string();
            let model = session.get_model().map(|m| m.as_str().to_string());

            // Check if already in history
            if !self.session_history.iter().any(|s| s.session_id == session_id) {
                let saved = SavedSession {
                    session_id,
                    model,
                    created_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    last_message_preview: last_message.map(|m| {
                        if m.len() > 100 {
                            format!("{}...", &m[..100])
                        } else {
                            m
                        }
                    }),
                };

                // Keep only last 10 sessions
                if self.session_history.len() >= 10 {
                    self.session_history.remove(0);
                }
                self.session_history.push(saved);
            }
        }
    }

    /// Get recent sessions for resume UI
    pub fn get_recent_sessions(&self) -> Vec<SavedSession> {
        self.session_history.iter().rev().cloned().collect()
    }

    /// Get current session ID if active
    pub fn get_current_session_id(&self) -> Option<String> {
        self.session.as_ref().map(|s| s.get_session_id().to_string())
    }
}
