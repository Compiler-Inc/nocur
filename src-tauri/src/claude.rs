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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    // Token usage fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_tokens: Option<u64>,
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
    #[allow(dead_code)]
    skip_permissions: bool,
}

impl ClaudeSession {
    pub fn new(working_dir: &str, app_handle: AppHandle, skip_permissions: bool) -> Result<Self, String> {
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

        // System prompt to inform Claude about nocur-swift iOS tools
        // Use full path to avoid recompilation via `swift run`
        let nocur_swift_bin = format!("{}/nocur-swift/.build/release/nocur-swift", working_dir);
        let nocur_system_prompt = format!(r#"You have access to nocur-swift, a CLI tool for iOS simulator control and app verification. Use it to see what the iOS app looks like and interact with it.

IMPORTANT:
- Always use the pre-built binary at: {bin}
- DO NOT use "swift run nocur-swift" as it recompiles every time (slow!)
- Always verify your iOS work visually with screenshots after making changes.

Available commands:
- {bin} sim screenshot - Take screenshot of iOS simulator (returns JSON with path)
- {bin} sim list - List available simulators
- {bin} sim boot <name> - Boot a simulator
- {bin} ui hierarchy - Get view hierarchy as structured JSON
- {bin} ui tap <x> <y> - Tap at screen coordinates
- {bin} ui type <text> - Type text into focused field
- {bin} app build --path <project-path> - Build the Xcode project
- {bin} app launch <bundle-id> - Launch app in simulator
- {bin} app kill <bundle-id> - Kill running app

After making UI changes, ALWAYS take a screenshot to verify the result. If something looks wrong, use the view hierarchy to debug."#, bin = nocur_swift_bin);

        // Spawn Claude in SDK streaming mode
        // This keeps the process alive for multi-turn conversation
        // Permissions are handled via PreToolUse hook -> Nocur permission server (unless skip_permissions is true)
        let mut cmd = Command::new("claude");
        cmd.args([
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--append-system-prompt", &nocur_system_prompt,
        ]);

        if skip_permissions {
            cmd.arg("--dangerously-skip-permissions");
            log::info!("Starting Claude with --dangerously-skip-permissions");
        }

        let mut child = cmd
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
                                skills: None,
                                model: None,
                                input_tokens: None,
                                output_tokens: None,
                                cache_read_tokens: None,
                                cache_creation_tokens: None,
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
            skip_permissions,
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
                skills: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
                cache_read_tokens: None,
                cache_creation_tokens: None,
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

/// Extract token usage from a JSON value (looks in "usage" or "message.usage")
fn extract_token_usage(json: &serde_json::Value) -> (Option<u64>, Option<u64>, Option<u64>, Option<u64>) {
    // Try top-level usage first, then message.usage
    let usage = json.get("usage")
        .or_else(|| json.get("message").and_then(|m| m.get("usage")));

    let input_tokens = usage
        .and_then(|u| u.get("input_tokens"))
        .and_then(|v| v.as_u64());

    let output_tokens = usage
        .and_then(|u| u.get("output_tokens"))
        .and_then(|v| v.as_u64());

    let cache_read_tokens = usage
        .and_then(|u| u.get("cache_read_input_tokens"))
        .and_then(|v| v.as_u64());

    let cache_creation_tokens = usage
        .and_then(|u| u.get("cache_creation_input_tokens"))
        .and_then(|v| v.as_u64());

    (input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
}

/// Parse a Claude CLI JSON event into our ClaudeEvent structure
fn parse_claude_event(json: &serde_json::Value, raw_line: &str) -> Option<ClaudeEvent> {
    let event_type = json.get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown")
        .to_string();

    log::debug!("Parsing event type: {}", event_type);

    // Extract token usage if present (can appear in various event types)
    let (input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens) = extract_token_usage(json);

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
                skills: None,
                model: None,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
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
                skills: None,
                model: None,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens,
            })
        }
        "system" => {
            // System init message - extract skills and model info
            log::info!("Claude system event: {:?}", json);

            let skills = json.get("skills")
                .and_then(|s| s.as_array())
                .map(|arr| arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>());

            let model = json.get("model")
                .and_then(|m| m.as_str())
                .map(String::from);

            // Emit system init event with skills
            if skills.is_some() || model.is_some() {
                log::info!("Emitting system_init event: skills={:?}, model={:?}", skills, model);
                Some(ClaudeEvent {
                    event_type: "system_init".to_string(),
                    content: String::new(),
                    tool_name: None,
                    tool_input: None,
                    is_error: false,
                    raw_json: Some(raw_line.to_string()),
                    skills,
                    model,
                    input_tokens: None,
                    output_tokens: None,
                    cache_read_tokens: None,
                    cache_creation_tokens: None,
                })
            } else {
                None
            }
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
                skills: None,
                model: None,
                input_tokens: None,
                output_tokens: None,
                cache_read_tokens: None,
                cache_creation_tokens: None,
            })
        }
        // Handle message_delta events which contain token usage updates
        "message_delta" => {
            // Only emit if we have token usage to report
            if input_tokens.is_some() || output_tokens.is_some() {
                Some(ClaudeEvent {
                    event_type: "usage".to_string(),
                    content: String::new(),
                    tool_name: None,
                    tool_input: None,
                    is_error: false,
                    raw_json: Some(raw_line.to_string()),
                    skills: None,
                    model: None,
                    input_tokens,
                    output_tokens,
                    cache_read_tokens,
                    cache_creation_tokens,
                })
            } else {
                None
            }
        }
        "user" => {
            // User events contain tool results - extract the content
            let content = json.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter().find_map(|item| {
                        if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                            item.get("content").and_then(|c| {
                                // Content can be a string or more complex
                                if let Some(s) = c.as_str() {
                                    Some(s.to_string())
                                } else {
                                    Some(serde_json::to_string(c).unwrap_or_default())
                                }
                            })
                        } else {
                            None
                        }
                    })
                })
                .unwrap_or_default();

            // Only emit if there's actual content (screenshot results, etc.)
            if !content.is_empty() && content.contains("\"path\"") {
                Some(ClaudeEvent {
                    event_type: "tool_result".to_string(),
                    content,
                    tool_name: None,
                    tool_input: None,
                    is_error: false,
                    raw_json: Some(raw_line.to_string()),
                    skills: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                    cache_read_tokens: None,
                    cache_creation_tokens: None,
                })
            } else {
                None
            }
        }
        _ => {
            log::debug!("Unhandled event type: {}", event_type);
            None
        }
    }
}

pub struct ClaudeState {
    pub session: Option<ClaudeSession>,
    pub skills: Vec<String>,
    pub model: Option<String>,
}

impl ClaudeState {
    pub fn new() -> Self {
        Self {
            session: None,
            skills: Vec::new(),
            model: None,
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
}
