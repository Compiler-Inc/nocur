use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::PathBuf;
use std::io::{BufRead, BufReader};
use std::time::{SystemTime, UNIX_EPOCH, Instant};
use std::process::Stdio;
use tauri::{State, Emitter, Manager};
use regex::Regex;
use parking_lot::Mutex;

mod claude;
mod permissions;
#[cfg(target_os = "macos")]
mod window_capture;

use claude::{ClaudeSession, ClaudeState};
use permissions::{PermissionState, PermissionResponse};
#[cfg(target_os = "macos")]
use window_capture::WindowCaptureState;
use std::sync::Arc;

// Path to nocur-swift CLI
fn nocur_swift_path() -> PathBuf {
    // Use the release build for better performance
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .unwrap()
        .join("nocur-swift/.build/release/nocur-swift")
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
    pub warnings: u32,
    pub build_time: Option<f64>,
    pub app_path: Option<String>,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildError {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub message: String,
}

/// Events emitted during build process
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildEvent {
    pub event_type: String, // "started" | "output" | "error" | "completed"
    pub message: String,
    pub timestamp: u64,
}

fn emit_build_event(app_handle: &tauri::AppHandle, event_type: &str, message: &str) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let _ = app_handle.emit("build-event", BuildEvent {
        event_type: event_type.to_string(),
        message: message.to_string(),
        timestamp,
    });
}

fn parse_build_errors(output: &str) -> (Vec<BuildError>, u32) {
    let mut errors = Vec::new();
    let mut warnings = 0u32;

    // Regex for Xcode build errors: /path/to/file.swift:42:10: error: message
    let error_regex = Regex::new(r"(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)").ok();

    for line in output.lines() {
        if line.contains(": warning:") {
            warnings += 1;
        }
        if line.contains(": error:") {
            if let Some(ref re) = error_regex {
                if let Some(caps) = re.captures(line) {
                    errors.push(BuildError {
                        file: Some(caps.get(1).map_or("", |m| m.as_str()).to_string()),
                        line: caps.get(2).and_then(|m| m.as_str().parse().ok()),
                        column: caps.get(3).and_then(|m| m.as_str().parse().ok()),
                        message: caps.get(5).map_or("", |m| m.as_str()).to_string(),
                    });
                }
            }
        }
    }

    (errors, warnings)
}

#[tauri::command]
async fn build_project(
    project_path: Option<String>,
    scheme: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<BuildResult, String> {
    let start_time = Instant::now();

    // Emit build started event
    emit_build_event(&app_handle, "started", &format!("Building {} ...", scheme.as_deref().unwrap_or("project")));

    // Determine project path
    let project_dir = project_path.clone().unwrap_or_else(|| {
        "<REPO_ROOT>/sample-app".to_string()
    });

    // Find .xcodeproj
    let project_file = std::fs::read_dir(&project_dir)
        .map_err(|e| format!("Cannot read directory: {}", e))?
        .filter_map(|e| e.ok())
        .find(|e| {
            e.path().extension().map_or(false, |ext| ext == "xcodeproj" || ext == "xcworkspace")
        })
        .map(|e| e.path())
        .ok_or_else(|| "No Xcode project found".to_string())?;

    let is_workspace = project_file.extension().map_or(false, |ext| ext == "xcworkspace");

    // Determine scheme (use provided or default to project name)
    let build_scheme = scheme.unwrap_or_else(|| {
        project_file.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("NocurTestApp")
            .to_string()
    });

    emit_build_event(&app_handle, "output", &format!("Project: {}", project_file.display()));
    emit_build_event(&app_handle, "output", &format!("Scheme: {}", build_scheme));

    // Build xcodebuild command
    let mut cmd = Command::new("xcodebuild");

    if is_workspace {
        cmd.arg("-workspace").arg(&project_file);
    } else {
        cmd.arg("-project").arg(&project_file);
    }

    cmd.args([
        "-scheme", &build_scheme,
        "-configuration", "Debug",
        "-destination", "platform=iOS Simulator,name=iPhone 16 Pro",
        "-derivedDataPath", &format!("{}/DerivedData", project_dir),
        "build"
    ]);

    cmd.current_dir(&project_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    emit_build_event(&app_handle, "output", "Starting xcodebuild...");

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to start xcodebuild: {}", e))?;

    // Stream stdout
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let app_stdout = app_handle.clone();
    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut output = String::new();

        for line in reader.lines() {
            if let Ok(line) = line {
                output.push_str(&line);
                output.push('\n');

                // Parse and emit meaningful lines
                let trimmed = line.trim();
                if trimmed.starts_with("Compiling") || trimmed.starts_with("Compile") {
                    // Extract filename from compile line
                    if let Some(file) = trimmed.split_whitespace().last() {
                        emit_build_event(&app_stdout, "output", &format!("Compiling {}", file));
                    }
                } else if trimmed.starts_with("Linking") || trimmed.starts_with("Link") {
                    emit_build_event(&app_stdout, "output", "Linking...");
                } else if trimmed.contains(": error:") {
                    emit_build_event(&app_stdout, "error", trimmed);
                } else if trimmed.contains(": warning:") {
                    emit_build_event(&app_stdout, "warning", trimmed);
                } else if trimmed.starts_with("Build") || trimmed.contains("BUILD") {
                    emit_build_event(&app_stdout, "output", trimmed);
                } else if trimmed.starts_with("CodeSign") || trimmed.starts_with("Signing") {
                    emit_build_event(&app_stdout, "output", "Signing...");
                } else if trimmed.starts_with("CompileSwiftSources") {
                    emit_build_event(&app_stdout, "output", "Compiling Swift sources...");
                } else if trimmed.starts_with("ProcessInfoPlistFile") {
                    emit_build_event(&app_stdout, "output", "Processing Info.plist...");
                } else if trimmed.starts_with("PhaseScript") {
                    emit_build_event(&app_stdout, "output", "Running build phase scripts...");
                }
            }
        }
        output
    });

    let app_stderr = app_handle.clone();
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let mut output = String::new();

        for line in reader.lines() {
            if let Ok(line) = line {
                output.push_str(&line);
                output.push('\n');

                // Emit errors and warnings
                let trimmed = line.trim();
                if !trimmed.is_empty() && (trimmed.contains("error") || trimmed.contains("warning")) {
                    emit_build_event(&app_stderr, "error", trimmed);
                }
            }
        }
        output
    });

    // Wait for process
    let status = child.wait()
        .map_err(|e| format!("Failed to wait for xcodebuild: {}", e))?;

    let stdout_output = stdout_handle.join().unwrap_or_default();
    let stderr_output = stderr_handle.join().unwrap_or_default();

    let build_time = start_time.elapsed().as_secs_f64();
    let all_output = format!("{}\n{}", stdout_output, stderr_output);
    let (errors, warnings) = parse_build_errors(&all_output);

    let success = status.success();

    if success {
        emit_build_event(&app_handle, "completed", &format!("Build succeeded in {:.1}s", build_time));

        // Find the built app
        let derived_data = format!("{}/DerivedData/Build/Products/Debug-iphonesimulator", project_dir);
        let app_path = std::fs::read_dir(&derived_data)
            .ok()
            .and_then(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .find(|e| e.path().extension().map_or(false, |ext| ext == "app"))
                    .map(|e| e.path().to_string_lossy().to_string())
            });

        // Get bundle ID from Info.plist
        let bundle_id = app_path.as_ref().and_then(|path| {
            let plist_path = format!("{}/Info.plist", path);
            std::fs::read(&plist_path).ok().and_then(|data| {
                plist::from_bytes::<plist::Dictionary>(&data).ok()
            }).and_then(|dict| {
                dict.get("CFBundleIdentifier").and_then(|v| v.as_string()).map(String::from)
            })
        });

        Ok(BuildResult {
            success: true,
            output: all_output,
            errors: vec![],
            warnings,
            build_time: Some(build_time),
            app_path,
            bundle_id,
        })
    } else {
        emit_build_event(&app_handle, "completed", &format!("Build failed with {} error(s)", errors.len()));

        Ok(BuildResult {
            success: false,
            output: all_output,
            errors,
            warnings,
            build_time: Some(build_time),
            app_path: None,
            bundle_id: None,
        })
    }
}

#[tauri::command]
async fn run_project(
    project_path: Option<String>,
    scheme: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<BuildResult, String> {
    // First, build the project
    let build_result = build_project(project_path.clone(), scheme, app_handle.clone()).await?;

    if !build_result.success {
        return Ok(build_result);
    }

    // Get app path and bundle ID from build result
    let app_path = build_result.app_path.clone()
        .ok_or("Build succeeded but app path not found")?;
    let bundle_id = build_result.bundle_id.clone()
        .ok_or("Build succeeded but bundle ID not found")?;

    // Check if any simulator is booted
    emit_build_event(&app_handle, "output", "Checking simulator status...");

    let list_output = Command::new("xcrun")
        .args(["simctl", "list", "devices", "booted", "-j"])
        .output()
        .map_err(|e| format!("Failed to list simulators: {}", e))?;

    let list_stdout = String::from_utf8_lossy(&list_output.stdout);
    let has_booted_device = list_stdout.contains("\"state\" : \"Booted\"");

    if !has_booted_device {
        emit_build_event(&app_handle, "output", "No simulator booted, starting iPhone 16 Pro...");

        // Boot the iPhone 16 Pro simulator
        let boot_output = Command::new("xcrun")
            .args(["simctl", "boot", "iPhone 16 Pro"])
            .output()
            .map_err(|e| format!("Failed to boot simulator: {}", e))?;

        if !boot_output.status.success() {
            // Try with a different simulator name as fallback
            let boot_fallback = Command::new("xcrun")
                .args(["simctl", "boot", "iPhone 15 Pro"])
                .output()
                .map_err(|e| format!("Failed to boot fallback simulator: {}", e))?;

            if !boot_fallback.status.success() {
                let stderr = String::from_utf8_lossy(&boot_fallback.stderr);
                emit_build_event(&app_handle, "error", &format!("Failed to boot simulator: {}", stderr));
            }
        }

        // Open the Simulator app
        let _ = Command::new("open")
            .args(["-a", "Simulator"])
            .output();

        // Wait a moment for simulator to boot
        emit_build_event(&app_handle, "output", "Waiting for simulator to boot...");
        std::thread::sleep(std::time::Duration::from_secs(3));
    }

    emit_build_event(&app_handle, "output", "Installing app to simulator...");

    // Install to simulator using simctl
    let install_output = Command::new("xcrun")
        .args(["simctl", "install", "booted", &app_path])
        .output()
        .map_err(|e| format!("Failed to install app: {}", e))?;

    if !install_output.status.success() {
        let stderr = String::from_utf8_lossy(&install_output.stderr);
        emit_build_event(&app_handle, "error", &format!("Install failed: {}", stderr));
        return Ok(BuildResult {
            success: false,
            output: format!("Install failed: {}", stderr),
            errors: vec![BuildError {
                file: None,
                line: None,
                column: None,
                message: stderr.to_string(),
            }],
            warnings: build_result.warnings,
            build_time: build_result.build_time,
            app_path: Some(app_path),
            bundle_id: Some(bundle_id),
        });
    }

    emit_build_event(&app_handle, "output", "Launching app...");

    // Launch the app
    let launch_output = Command::new("xcrun")
        .args(["simctl", "launch", "booted", &bundle_id])
        .output()
        .map_err(|e| format!("Failed to launch app: {}", e))?;

    if !launch_output.status.success() {
        let stderr = String::from_utf8_lossy(&launch_output.stderr);
        emit_build_event(&app_handle, "error", &format!("Launch failed: {}", stderr));
        return Ok(BuildResult {
            success: false,
            output: format!("Launch failed: {}", stderr),
            errors: vec![BuildError {
                file: None,
                line: None,
                column: None,
                message: stderr.to_string(),
            }],
            warnings: build_result.warnings,
            build_time: build_result.build_time,
            app_path: Some(app_path),
            bundle_id: Some(bundle_id),
        });
    }

    emit_build_event(&app_handle, "completed", &format!("App launched: {}", bundle_id));

    Ok(BuildResult {
        success: true,
        output: format!("Build, install, and launch succeeded for {}", bundle_id),
        errors: vec![],
        warnings: build_result.warnings,
        build_time: build_result.build_time,
        app_path: Some(app_path),
        bundle_id: Some(bundle_id),
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

/// Load an image from a file path and return as base64 data URL
#[tauri::command]
async fn load_image_from_path(path: String) -> Result<String, String> {
    let image_data = fs::read(&path)
        .map_err(|e| format!("Failed to read image at {}: {}", path, e))?;

    // Detect format from extension
    let format = if path.ends_with(".png") {
        "png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "jpeg"
    } else {
        "png" // default
    };

    let base64_data = BASE64.encode(&image_data);
    Ok(format!("data:image/{};base64,{}", format, base64_data))
}

// Claude subprocess commands - uses JSON streaming mode
#[tauri::command]
async fn start_claude_session(
    working_dir: String,
    skip_permissions: Option<bool>,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let mut claude_state = state.lock();

    // Drop existing session if any
    claude_state.session = None;

    // Start new Claude session
    let session = ClaudeSession::new(&working_dir, app_handle, skip_permissions.unwrap_or(false))?;
    claude_state.session = Some(session);

    Ok(())
}

#[tauri::command]
async fn send_claude_message(
    message: String,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let claude_state = state.lock();

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
    let mut claude_state = state.lock();
    claude_state.session = None;
    claude_state.clear_session_info();
    Ok(())
}

#[tauri::command]
async fn cancel_claude_request(
    working_dir: String,
    skip_permissions: Option<bool>,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let mut claude_state = state.lock();

    // Stop current session
    if let Some(ref session) = claude_state.session {
        session.stop();
    }
    claude_state.session = None;

    // Preserve session info (skills/model) since we're just canceling, not fully stopping
    let skills = claude_state.skills.clone();
    let model = claude_state.model.clone();

    // Start a new session
    let session = ClaudeSession::new(&working_dir, app_handle, skip_permissions.unwrap_or(false))?;
    claude_state.session = Some(session);

    // Restore session info
    claude_state.skills = skills;
    claude_state.model = model;

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionInfo {
    pub active: bool,
    pub skills: Vec<String>,
    pub model: Option<String>,
}

#[tauri::command]
async fn get_claude_session_info(
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<ClaudeSessionInfo, String> {
    let claude_state = state.lock();
    Ok(ClaudeSessionInfo {
        active: claude_state.session.is_some(),
        skills: claude_state.skills.clone(),
        model: claude_state.model.clone(),
    })
}

#[tauri::command]
async fn set_claude_session_info(
    skills: Vec<String>,
    model: Option<String>,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let mut claude_state = state.lock();
    claude_state.set_session_info(skills, model);
    Ok(())
}

// ============ Permission Commands ============

#[tauri::command]
async fn set_skip_permissions(
    enabled: bool,
    state: State<'_, Mutex<PermissionState>>,
) -> Result<(), String> {
    let permission_state = state.lock();
    permission_state.server.set_auto_approve(enabled);
    Ok(())
}

#[tauri::command]
async fn respond_to_permission(
    request_id: String,
    approved: bool,
    reason: Option<String>,
    state: State<'_, Mutex<PermissionState>>,
) -> Result<(), String> {
    let permission_state = state.lock();

    let response = PermissionResponse {
        decision: if approved { "approve".to_string() } else { "block".to_string() },
        reason,
    };

    permission_state.server.respond(&request_id, response);
    Ok(())
}

/// Add a permission rule to .claude/settings.local.json
#[tauri::command]
async fn add_permission_rule(
    tool_name: String,
    tool_input: serde_json::Value,
    working_dir: String,
) -> Result<(), String> {
    let settings_path = PathBuf::from(&working_dir)
        .join(".claude")
        .join("settings.local.json");

    // Read existing settings or create new
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure permissions.allow array exists
    if settings.get("permissions").is_none() {
        settings["permissions"] = serde_json::json!({});
    }
    if settings["permissions"].get("allow").is_none() {
        settings["permissions"]["allow"] = serde_json::json!([]);
    }

    // Generate the permission pattern based on tool type
    let pattern = match tool_name.as_str() {
        "Edit" | "Write" => {
            // For file operations, allow the specific file path
            if let Some(path) = tool_input.get("file_path").and_then(|v| v.as_str()) {
                format!("{}({})", tool_name, path)
            } else {
                format!("{}(*)", tool_name)
            }
        }
        "Bash" => {
            // For bash, extract command prefix and allow with wildcard
            if let Some(cmd) = tool_input.get("command").and_then(|v| v.as_str()) {
                // Get first word/command as prefix
                let prefix = cmd.split_whitespace().next().unwrap_or(cmd);
                format!("Bash({}:*)", prefix)
            } else {
                "Bash(*)".to_string()
            }
        }
        _ => format!("{}(*)", tool_name),
    };

    // Add to allow array if not already present
    let allow_array = settings["permissions"]["allow"].as_array_mut()
        .ok_or("permissions.allow is not an array")?;

    let pattern_value = serde_json::Value::String(pattern.clone());
    if !allow_array.contains(&pattern_value) {
        allow_array.push(pattern_value);
        log::info!("Added permission rule: {}", pattern);
    }

    // Write back to file
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}

// ============ Skills Commands ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub path: String,
    pub content: String,
    pub location: String, // "user" or "project"
}

#[tauri::command]
async fn list_skills(project_path: Option<String>) -> Result<Vec<SkillInfo>, String> {
    let mut skills = Vec::new();

    // User-level skills: ~/.claude/skills/<skill-name>/SKILL.md
    let home = std::env::var("HOME").unwrap_or_default();
    let user_skills_dir = PathBuf::from(&home).join(".claude").join("skills");

    if user_skills_dir.exists() {
        if let Ok(entries) = fs::read_dir(&user_skills_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let skill_dir = entry.path();
                // Skills are directories containing SKILL.md
                if skill_dir.is_dir() {
                    let skill_file = skill_dir.join("SKILL.md");
                    if skill_file.exists() {
                        if let Ok(content) = fs::read_to_string(&skill_file) {
                            let name = skill_dir.file_name()
                                .and_then(|s| s.to_str())
                                .unwrap_or("unknown")
                                .to_string();
                            skills.push(SkillInfo {
                                name,
                                path: skill_file.to_string_lossy().to_string(),
                                content,
                                location: "user".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Project-level skills: .claude/skills/<skill-name>/SKILL.md
    if let Some(ref proj_path) = project_path {
        let project_skills_dir = PathBuf::from(proj_path).join(".claude").join("skills");

        if project_skills_dir.exists() {
            if let Ok(entries) = fs::read_dir(&project_skills_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let skill_dir = entry.path();
                    // Skills are directories containing SKILL.md
                    if skill_dir.is_dir() {
                        let skill_file = skill_dir.join("SKILL.md");
                        if skill_file.exists() {
                            if let Ok(content) = fs::read_to_string(&skill_file) {
                                let name = skill_dir.file_name()
                                    .and_then(|s| s.to_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                skills.push(SkillInfo {
                                    name,
                                    path: skill_file.to_string_lossy().to_string(),
                                    content,
                                    location: "project".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(skills)
}

#[tauri::command]
async fn read_skill(skill_path: String) -> Result<String, String> {
    fs::read_to_string(&skill_path)
        .map_err(|e| format!("Failed to read skill: {}", e))
}

#[tauri::command]
async fn create_skill(
    name: String,
    content: String,
    location: String,
    project_path: Option<String>,
) -> Result<String, String> {
    let base_skills_dir = if location == "project" {
        let proj = project_path.ok_or("Project path required for project skills")?;
        PathBuf::from(proj).join(".claude").join("skills")
    } else {
        let home = std::env::var("HOME").map_err(|_| "HOME not set")?;
        PathBuf::from(home).join(".claude").join("skills")
    };

    // Skills are stored as: skills/<skill-name>/SKILL.md
    let skill_dir = base_skills_dir.join(&name);
    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    let file_path = skill_dir.join("SKILL.md");
    fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write skill: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_skills_folder(location: String, project_path: Option<String>) -> Result<(), String> {
    let skills_dir = if location == "project" {
        let proj = project_path.ok_or("Project path required for project skills")?;
        PathBuf::from(proj).join(".claude").join("skills")
    } else {
        let home = std::env::var("HOME").map_err(|_| "HOME not set")?;
        PathBuf::from(home).join(".claude").join("skills")
    };

    // Create directory if it doesn't exist
    fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("Failed to create skills directory: {}", e))?;

    Command::new("open")
        .arg(&skills_dir)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;

    Ok(())
}

// ============ Git Info Commands ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub branch: String,
    pub is_dirty: bool,
    pub has_untracked: bool,
    pub ahead: u32,
    pub behind: u32,
    pub short_status: String,
    pub working_dir: String,
}

#[tauri::command]
async fn get_git_info(path: Option<String>) -> Result<GitInfo, String> {
    let working_dir = path.unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });

    // Get current branch
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| format!("Failed to get branch: {}", e))?;

    let branch = if branch_output.status.success() {
        String::from_utf8_lossy(&branch_output.stdout).trim().to_string()
    } else {
        "unknown".to_string()
    };

    // Get status (porcelain for easy parsing)
    let status_output = Command::new("git")
        .args(["status", "--porcelain", "-b"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let status_str = String::from_utf8_lossy(&status_output.stdout).to_string();
    let lines: Vec<&str> = status_str.lines().collect();

    // Parse ahead/behind from first line (## branch...origin/branch [ahead 1, behind 2])
    let (ahead, behind) = if let Some(first_line) = lines.first() {
        let ahead_re = Regex::new(r"ahead (\d+)").ok();
        let behind_re = Regex::new(r"behind (\d+)").ok();

        let ahead = ahead_re.and_then(|re| re.captures(first_line))
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);

        let behind = behind_re.and_then(|re| re.captures(first_line))
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);

        (ahead, behind)
    } else {
        (0, 0)
    };

    // Count modified and untracked files (skip first line which is branch info)
    let file_lines: Vec<&str> = lines.iter().skip(1).copied().collect();
    let is_dirty = file_lines.iter().any(|l| l.starts_with(" M") || l.starts_with("M ") || l.starts_with("MM") || l.starts_with("A ") || l.starts_with("D ") || l.starts_with("R "));
    let has_untracked = file_lines.iter().any(|l| l.starts_with("??"));

    // Build short status string
    let mut short_status = String::new();
    if is_dirty {
        short_status.push('*');
    }
    if has_untracked {
        short_status.push('+');
    }
    if ahead > 0 {
        short_status.push_str(&format!("↑{}", ahead));
    }
    if behind > 0 {
        short_status.push_str(&format!("↓{}", behind));
    }
    if short_status.is_empty() {
        short_status = "✓".to_string();
    }

    Ok(GitInfo {
        branch,
        is_dirty,
        has_untracked,
        ahead,
        behind,
        short_status,
        working_dir,
    })
}

// ============ Window Capture Commands (macOS only) ============

#[cfg(target_os = "macos")]
#[tauri::command]
async fn start_simulator_stream(
    fps: Option<u32>,
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<WindowCaptureState>>,
) -> Result<(), String> {
    // First, ensure Simulator.app is open
    let _ = std::process::Command::new("open")
        .arg("-a")
        .arg("Simulator")
        .spawn();

    // Wait a moment for Simulator to open
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let fps = fps.unwrap_or(30);
    window_capture::start_streaming(app_handle, state.inner().clone(), fps).await
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn stop_simulator_stream(
    state: State<'_, Arc<WindowCaptureState>>,
) -> Result<(), String> {
    window_capture::stop_streaming(&state);
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn simulator_click(
    x: f64,
    y: f64,
    state: State<'_, Arc<WindowCaptureState>>,
) -> Result<(), String> {
    let bounds = state.get_bounds().ok_or("No simulator window bounds")?;
    window_capture::send_mouse_click(x, y, &bounds)
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn find_simulator_window() -> Result<window_capture::SimulatorWindowInfo, String> {
    window_capture::find_simulator_window()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    let window_capture_state = Arc::new(WindowCaptureState::new());

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(ClaudeState::new()))
        .manage(Mutex::new(PermissionState::new()));

    #[cfg(target_os = "macos")]
    {
        builder = builder.manage(window_capture_state);
    }

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }

            // Start permission server
            let permission_state = app.state::<Mutex<PermissionState>>();
            permission_state.lock().server.start(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_claude_code_status,
            open_claude_login,
            build_project,
            run_project,
            take_screenshot,
            get_view_hierarchy,
            load_image_from_path,
            start_claude_session,
            send_claude_message,
            stop_claude_session,
            cancel_claude_request,
            get_claude_session_info,
            set_claude_session_info,
            set_skip_permissions,
            respond_to_permission,
            add_permission_rule,
            list_skills,
            read_skill,
            create_skill,
            open_skills_folder,
            get_git_info,
            // Window capture (macOS only)
            #[cfg(target_os = "macos")]
            start_simulator_stream,
            #[cfg(target_os = "macos")]
            stop_simulator_stream,
            #[cfg(target_os = "macos")]
            simulator_click,
            #[cfg(target_os = "macos")]
            find_simulator_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
