use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

mod claude;
use claude::{ClaudeSession, ClaudeState};

// Path to nocur-swift CLI
fn nocur_swift_path() -> PathBuf {
    // In development, use the debug build
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .unwrap()
        .join("nocur-swift/.build/debug/nocur-swift")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub logged_in: bool,
    pub has_active_plan: bool,
    pub error: Option<String>,
}

#[tauri::command]
async fn check_claude_code_status() -> Result<ClaudeCodeStatus, String> {
    // Check if claude is installed
    let which_result = Command::new("which")
        .arg("claude")
        .output()
        .map_err(|e| e.to_string())?;

    if !which_result.status.success() {
        return Ok(ClaudeCodeStatus {
            installed: false,
            path: None,
            logged_in: false,
            has_active_plan: false,
            error: None,
        });
    }

    let claude_path = String::from_utf8_lossy(&which_result.stdout)
        .trim()
        .to_string();

    // Test if claude works (logged in with active plan)
    let test_result = Command::new("claude")
        .args(["-p", "hi", "--output-format", "json"])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&test_result.stdout).to_string();
    let stderr = String::from_utf8_lossy(&test_result.stderr).to_string();

    // Parse the JSON response
    if test_result.status.success() {
        // Try to parse the response
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
            if json.get("type").and_then(|t| t.as_str()) == Some("result") {
                return Ok(ClaudeCodeStatus {
                    installed: true,
                    path: Some(claude_path),
                    logged_in: true,
                    has_active_plan: true,
                    error: None,
                });
            }
        }
    }

    // Check for specific error conditions
    let combined_output = format!("{}{}", stdout, stderr).to_lowercase();

    if combined_output.contains("not logged in") || combined_output.contains("login") || combined_output.contains("authenticate") {
        return Ok(ClaudeCodeStatus {
            installed: true,
            path: Some(claude_path),
            logged_in: false,
            has_active_plan: false,
            error: Some("Not logged in".to_string()),
        });
    }

    if combined_output.contains("subscription") || combined_output.contains("plan") || combined_output.contains("billing") {
        return Ok(ClaudeCodeStatus {
            installed: true,
            path: Some(claude_path),
            logged_in: true,
            has_active_plan: false,
            error: Some("No active plan".to_string()),
        });
    }

    // Unknown error state
    Ok(ClaudeCodeStatus {
        installed: true,
        path: Some(claude_path),
        logged_in: false,
        has_active_plan: false,
        error: Some(format!("Unknown error: {}", stderr.chars().take(200).collect::<String>())),
    })
}

#[tauri::command]
async fn open_claude_login() -> Result<(), String> {
    // Open Claude Code in terminal for login
    Command::new("open")
        .args(["-a", "Terminal"])
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub success: bool,
    pub output: String,
    pub errors: Vec<BuildError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildError {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub message: String,
}

#[tauri::command]
async fn build_project(project_path: Option<String>, scheme: Option<String>) -> Result<BuildResult, String> {
    let mut args = vec!["app", "build"];

    if let Some(ref path) = project_path {
        args.push("--project");
        args.push(path);
    }
    if let Some(ref s) = scheme {
        args.push("--scheme");
        args.push(s);
    }

    let output = Command::new(nocur_swift_path())
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run nocur-swift: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // Try to parse JSON output
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
        if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
            return Ok(BuildResult {
                success: true,
                output: stdout,
                errors: vec![],
            });
        } else if let Some(data) = json.get("data") {
            // Check for build failure with errors
            if data.get("buildFailed").and_then(|v| v.as_bool()) == Some(true) {
                let errors = data.get("errors")
                    .and_then(|e| e.as_array())
                    .map(|arr| {
                        arr.iter().filter_map(|e| {
                            Some(BuildError {
                                file: e.get("file").and_then(|v| v.as_str()).map(String::from),
                                line: e.get("line").and_then(|v| v.as_u64()).map(|v| v as u32),
                                column: e.get("column").and_then(|v| v.as_u64()).map(|v| v as u32),
                                message: e.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string(),
                            })
                        }).collect()
                    })
                    .unwrap_or_default();

                return Ok(BuildResult {
                    success: false,
                    output: stdout,
                    errors,
                });
            }
        }
    }

    // Fallback
    Ok(BuildResult {
        success: output.status.success(),
        output: stdout,
        errors: vec![],
    })
}

#[tauri::command]
async fn run_project(project_path: Option<String>, scheme: Option<String>) -> Result<BuildResult, String> {
    let mut args = vec!["app", "run"];

    if let Some(ref path) = project_path {
        args.push("--project");
        args.push(path);
    }
    if let Some(ref s) = scheme {
        args.push("--scheme");
        args.push(s);
    }

    let output = Command::new(nocur_swift_path())
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run nocur-swift: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    Ok(BuildResult {
        success: output.status.success(),
        output: stdout,
        errors: vec![],
    })
}

use std::fs;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

#[tauri::command]
async fn take_screenshot() -> Result<String, String> {
    let output = Command::new(nocur_swift_path())
        .args(["sim", "screenshot"])
        .output()
        .map_err(|e| format!("Failed to run nocur-swift: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // Parse JSON to get the path
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
        if let Some(data) = json.get("data") {
            if let Some(path) = data.get("path").and_then(|v| v.as_str()) {
                // Read the file and return as base64 data URL
                let image_data = fs::read(path)
                    .map_err(|e| format!("Failed to read screenshot: {}", e))?;
                let base64_data = BASE64.encode(&image_data);
                return Ok(format!("data:image/png;base64,{}", base64_data));
            }
        }
    }

    Err(format!("Failed to parse screenshot response: {}", stdout))
}

#[tauri::command]
async fn get_view_hierarchy() -> Result<String, String> {
    let output = Command::new(nocur_swift_path())
        .args(["ui", "hierarchy"])
        .output()
        .map_err(|e| format!("Failed to run nocur-swift: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

// Claude subprocess commands - uses JSON streaming mode
#[tauri::command]
async fn start_claude_session(
    working_dir: String,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let mut claude_state = state.lock().map_err(|e| e.to_string())?;

    // Drop existing session if any
    claude_state.session = None;

    // Start new Claude session
    let session = ClaudeSession::new(&working_dir, app_handle)?;
    claude_state.session = Some(session);

    Ok(())
}

#[tauri::command]
async fn send_claude_message(
    message: String,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let claude_state = state.lock().map_err(|e| e.to_string())?;

    if let Some(ref session) = claude_state.session {
        session.send_message(&message, app_handle)?;
        Ok(())
    } else {
        Err("No Claude session active. Start a session first.".to_string())
    }
}

#[tauri::command]
async fn stop_claude_session(
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let mut claude_state = state.lock().map_err(|e| e.to_string())?;
    claude_state.session = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(ClaudeState::new()))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_claude_code_status,
            open_claude_login,
            build_project,
            run_project,
            take_screenshot,
            get_view_hierarchy,
            start_claude_session,
            send_claude_message,
            stop_claude_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
