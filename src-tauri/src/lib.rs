use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::PathBuf;
use std::io::{BufRead, BufReader};
use std::time::{SystemTime, UNIX_EPOCH, Instant};
use std::process::Stdio;
use tauri::{State, Emitter, Manager};
use regex::Regex;
use parking_lot::Mutex;

mod ace;
mod claude;
mod permissions;
#[cfg(target_os = "macos")]
mod window_capture;

use claude::{ClaudeSession, ClaudeState, ClaudeModel, ClaudeSessionConfig, SavedSession};
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

// =============================================================================
// Device Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,                    // UDID for xcodebuild (works for both simulator and physical)
    pub core_device_id: Option<String>, // CoreDevice UUID (only for physical, used by devicectl)
    pub name: String,
    pub model: String,
    pub os_version: String,
    pub device_type: DeviceType,
    pub state: DeviceState,
    pub is_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Simulator,
    Physical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceState {
    Booted,
    Shutdown,
    Connected,
    Disconnected,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceListResult {
    pub devices: Vec<DeviceInfo>,
    pub simulator_count: i32,
    pub physical_count: i32,
}

/// App state for selected device
pub struct AppState {
    pub selected_device_id: Option<String>,
    pub selected_device: Option<DeviceInfo>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            selected_device_id: None,
            selected_device: None,
        }
    }
}

// =============================================================================
// Device Commands
// =============================================================================

#[tauri::command]
async fn list_devices() -> Result<DeviceListResult, String> {
    // Run nocur-swift device list
    let output = Command::new("swift")
        .args(["run", "nocur-swift", "device", "list"])
        .current_dir(format!("{}/nocur-swift", env!("CARGO_MANIFEST_DIR").replace("/src-tauri", "")))
        .output()
        .map_err(|e| format!("Failed to run nocur-swift: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("nocur-swift device list failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // Parse the JSON output
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse device list: {}", e))?;

    // Extract the data field
    let data = json.get("data")
        .ok_or("Missing data field in response")?;
    
    let result: DeviceListResult = serde_json::from_value(data.clone())
        .map_err(|e| format!("Failed to parse device list data: {}", e))?;

    Ok(result)
}

#[tauri::command]
async fn get_selected_device(
    state: State<'_, Mutex<AppState>>,
) -> Result<Option<DeviceInfo>, String> {
    let app_state = state.lock();
    Ok(app_state.selected_device.clone())
}

#[tauri::command]
async fn set_selected_device(
    device: DeviceInfo,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let mut app_state = state.lock();
    app_state.selected_device_id = Some(device.id.clone());
    app_state.selected_device = Some(device);
    Ok(())
}

#[tauri::command]
async fn clear_selected_device(
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let mut app_state = state.lock();
    app_state.selected_device_id = None;
    app_state.selected_device = None;
    Ok(())
}

// =============================================================================
// Build Commands
// =============================================================================

#[tauri::command]
async fn build_project(
    project_path: Option<String>,
    scheme: Option<String>,
    device: Option<DeviceInfo>,
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

    // Determine destination based on device
    let (destination, is_physical_device) = match &device {
        Some(d) => {
            let dest = match d.device_type {
                DeviceType::Physical => format!("platform=iOS,id={}", d.id),
                DeviceType::Simulator => format!("platform=iOS Simulator,id={}", d.id),
            };
            emit_build_event(&app_handle, "output", &format!("Device: {} ({})", d.name, if d.device_type == DeviceType::Physical { "physical" } else { "simulator" }));
            (dest, d.device_type == DeviceType::Physical)
        }
        None => {
            emit_build_event(&app_handle, "output", "Device: iPhone 16 Pro (simulator, default)");
            ("platform=iOS Simulator,name=iPhone 16 Pro".to_string(), false)
        }
    };

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
        "-destination", &destination,
        "-derivedDataPath", &format!("{}/DerivedData", project_dir),
    ]);

    // Add -allowProvisioningUpdates for physical devices (automatic code signing)
    if is_physical_device {
        cmd.arg("-allowProvisioningUpdates");
    }

    cmd.arg("build");

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

        // Find the built app - check both iphoneos (physical) and iphonesimulator paths
        let sdk_suffix = if is_physical_device { "iphoneos" } else { "iphonesimulator" };
        let derived_data = format!("{}/DerivedData/Build/Products/Debug-{}", project_dir, sdk_suffix);
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
    device: Option<DeviceInfo>,
    app_handle: tauri::AppHandle,
) -> Result<BuildResult, String> {
    // First, build the project
    let build_result = build_project(project_path.clone(), scheme, device.clone(), app_handle.clone()).await?;

    if !build_result.success {
        return Ok(build_result);
    }

    // Get app path and bundle ID from build result
    let app_path = build_result.app_path.clone()
        .ok_or("Build succeeded but app path not found")?;
    let bundle_id = build_result.bundle_id.clone()
        .ok_or("Build succeeded but bundle ID not found")?;

    // Determine if this is a physical device or simulator
    let is_physical_device = device.as_ref()
        .map(|d| d.device_type == DeviceType::Physical)
        .unwrap_or(false);
    
    // For xcodebuild and simctl, use the regular id
    let device_id = device.as_ref().map(|d| d.id.clone());
    // For devicectl, use core_device_id (falls back to id if not available)
    let core_device_id = device.as_ref().map(|d| d.core_device_id.clone().unwrap_or_else(|| d.id.clone()));

    if is_physical_device {
        // Physical device: use devicectl for install and launch
        // devicectl requires the CoreDevice UUID, not the xcodebuild UDID
        let devicectl_id = core_device_id.ok_or("Device ID required for physical device")?;
        
        emit_build_event(&app_handle, "output", &format!("Installing app to physical device {}...", device.as_ref().map(|d| d.name.as_str()).unwrap_or("unknown")));

        // Install using devicectl
        let install_output = Command::new("xcrun")
            .args(["devicectl", "device", "install", "app", "--device", &devicectl_id, &app_path])
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

        emit_build_event(&app_handle, "output", "Launching app on physical device...");

        // Launch using devicectl
        let launch_output = Command::new("xcrun")
            .args(["devicectl", "device", "process", "launch", "--device", &devicectl_id, &bundle_id])
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

        emit_build_event(&app_handle, "completed", &format!("App launched on device: {}", bundle_id));
        
        // Emit app-launched event so frontend can start log streaming
        // Use devicectl_id for log streaming since it uses devicectl
        let _ = app_handle.emit("app-launched", serde_json::json!({
            "bundleId": bundle_id.clone(),
            "deviceId": devicectl_id,
            "deviceType": "physical",
            "deviceName": device.as_ref().map(|d| d.name.clone()).unwrap_or_default()
        }));
    } else {
        // Simulator: use simctl for install and launch
        let sim_target = device_id.as_deref().unwrap_or("booted");

        // Check if the target simulator is booted
        emit_build_event(&app_handle, "output", "Checking simulator status...");

        let list_output = Command::new("xcrun")
            .args(["simctl", "list", "devices", "booted", "-j"])
            .output()
            .map_err(|e| format!("Failed to list simulators: {}", e))?;

        let list_stdout = String::from_utf8_lossy(&list_output.stdout);
        
        // Check if our specific simulator is booted, or any simulator if using "booted"
        let needs_boot = if sim_target == "booted" {
            !list_stdout.contains("\"state\" : \"Booted\"")
        } else {
            // Check if the specific device ID is in the booted list
            !list_stdout.contains(&format!("\"udid\" : \"{}\"", sim_target))
        };

        if needs_boot {
            let boot_target = if sim_target == "booted" {
                "iPhone 16 Pro"
            } else {
                sim_target
            };
            
            emit_build_event(&app_handle, "output", &format!("Booting simulator {}...", boot_target));

            let boot_output = Command::new("xcrun")
                .args(["simctl", "boot", boot_target])
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
            .args(["simctl", "install", sim_target, &app_path])
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
            .args(["simctl", "launch", sim_target, &bundle_id])
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
        
        // Emit app-launched event so frontend can start log streaming
        let _ = app_handle.emit("app-launched", serde_json::json!({
            "bundleId": bundle_id.clone(),
            "deviceId": device_id,
            "deviceType": "simulator",
            "deviceName": device.as_ref().map(|d| d.name.clone()).unwrap_or("Simulator".to_string())
        }));
    }

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

/// Terminate an app running on a simulator
#[tauri::command]
async fn terminate_app_on_simulator(bundle_id: String) -> Result<(), String> {
    let output = Command::new("xcrun")
        .args(["simctl", "terminate", "booted", &bundle_id])
        .output()
        .map_err(|e| format!("Failed to terminate app: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Don't fail if app wasn't running
        if !stderr.contains("not found") {
            return Err(format!("Failed to terminate app: {}", stderr));
        }
    }

    Ok(())
}

/// Terminate an app running on a physical device
#[tauri::command]
async fn terminate_app_on_device(device_id: String, bundle_id: String) -> Result<(), String> {
    // Get the app name from bundle ID (last component, e.g., "NocurTestApp" from "com.nocur.NocurTestApp")
    let app_name = bundle_id.split('.').last().unwrap_or(&bundle_id);
    
    // List processes and find our app
    let list_output = Command::new("xcrun")
        .args(["devicectl", "device", "info", "processes", "--device", &device_id])
        .output()
        .map_err(|e| format!("Failed to list processes: {}", e))?;

    let stdout = String::from_utf8_lossy(&list_output.stdout);
    let stderr = String::from_utf8_lossy(&list_output.stderr);
    let combined = format!("{}{}", stdout, stderr);
    
    // Parse the text output to find PID
    // Format: "58681   /private/var/containers/Bundle/Application/.../NocurTestApp.app/NocurTestApp"
    for line in combined.lines() {
        if line.contains(&format!("{}.app/{}", app_name, app_name)) || line.contains(&format!("/{}.app", app_name)) {
            // Extract PID from the beginning of the line
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(pid_str) = parts.first() {
                if let Ok(pid) = pid_str.parse::<i64>() {
                    log::info!("Found app {} with PID {}, terminating...", app_name, pid);
                    
                    // Terminate by PID
                    let term_output = Command::new("xcrun")
                        .args(["devicectl", "device", "process", "terminate", "--device", &device_id, "--pid", &pid.to_string()])
                        .output();
                    
                    if let Ok(output) = term_output {
                        let term_stderr = String::from_utf8_lossy(&output.stderr);
                        log::info!("Terminate result: {}", term_stderr);
                    }
                    
                    return Ok(());
                }
            }
        }
    }

    log::warn!("Could not find running process for {}", bundle_id);
    // If we couldn't find/terminate by PID, that's okay - the app might have already stopped
    Ok(())
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
    model: Option<String>,
    resume_session_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<String, String> {
    let mut claude_state = state.lock();

    // Save current session to history before dropping
    if claude_state.session.is_some() {
        claude_state.save_current_session(None);
    }

    // Drop existing session
    claude_state.session = None;

    // Parse model string to enum
    let model_enum = model.and_then(|m| match m.to_lowercase().as_str() {
        "sonnet" => Some(ClaudeModel::Sonnet),
        "opus" => Some(ClaudeModel::Opus),
        "haiku" => Some(ClaudeModel::Haiku),
        _ => None,
    });

    // Create session config
    let config = ClaudeSessionConfig {
        model: model_enum,
        resume_session_id,
        skip_permissions: skip_permissions.unwrap_or(false),
    };

    // Start new Claude session with config
    let session = ClaudeSession::new_with_config(&working_dir, app_handle, config)?;
    let session_id = session.get_session_id().to_string();
    claude_state.session = Some(session);

    Ok(session_id)
}

#[tauri::command]
async fn send_claude_message(
    message: String,
    app_handle: tauri::AppHandle,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let claude_state = state.lock();

    if let Some(ref session) = claude_state.session {
        // Emit user message event so the UI can display it
        let _ = app_handle.emit("user-message", serde_json::json!({
            "content": message
        }));

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

/// Get list of available Claude models
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[tauri::command]
async fn get_available_models() -> Result<Vec<ModelInfo>, String> {
    Ok(vec![
        ModelInfo {
            id: "sonnet".to_string(),
            name: "Claude Sonnet 4.5".to_string(),
            description: "Fast and capable, great for most coding tasks".to_string(),
        },
        ModelInfo {
            id: "opus".to_string(),
            name: "Claude Opus 4.5".to_string(),
            description: "Most powerful, best for complex reasoning".to_string(),
        },
        ModelInfo {
            id: "haiku".to_string(),
            name: "Claude Haiku 4.5".to_string(),
            description: "Fastest and most economical".to_string(),
        },
    ])
}

/// Get recent sessions for resume functionality
#[tauri::command]
async fn get_recent_sessions(
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<Vec<SavedSession>, String> {
    let claude_state = state.lock();
    Ok(claude_state.get_recent_sessions())
}

/// Get current session ID
#[tauri::command]
async fn get_current_session_id(
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<Option<String>, String> {
    let claude_state = state.lock();
    Ok(claude_state.get_current_session_id())
}

/// Save current session to history (call before ending important sessions)
#[tauri::command]
async fn save_session_to_history(
    last_message: Option<String>,
    state: State<'_, Mutex<ClaudeState>>,
) -> Result<(), String> {
    let mut claude_state = state.lock();
    claude_state.save_current_session(last_message);
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

// ============ Git Diff/Status Commands ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub status: String, // "M" modified, "A" added, "D" deleted, "?" untracked
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffStats {
    pub total_additions: u32,
    pub total_deletions: u32,
    pub files: Vec<GitChangedFile>,
}

#[tauri::command]
async fn get_git_diff_stats(path: Option<String>) -> Result<GitDiffStats, String> {
    let working_dir = path.unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });

    // Get list of changed files with status
    let status_output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| format!("Failed to get git status: {}", e))?;

    let status_str = String::from_utf8_lossy(&status_output.stdout);

    // Get diff stats (numstat)
    let diff_output = Command::new("git")
        .args(["diff", "--numstat", "HEAD"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| format!("Failed to get git diff: {}", e))?;

    let diff_str = String::from_utf8_lossy(&diff_output.stdout);

    // Parse numstat for additions/deletions per file
    let mut file_stats: std::collections::HashMap<String, (u32, u32)> = std::collections::HashMap::new();
    for line in diff_str.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let additions = parts[0].parse().unwrap_or(0);
            let deletions = parts[1].parse().unwrap_or(0);
            let file_path = parts[2].to_string();
            file_stats.insert(file_path, (additions, deletions));
        }
    }

    // Parse status and build file list
    let mut files = Vec::new();
    let mut total_additions = 0u32;
    let mut total_deletions = 0u32;

    for line in status_str.lines() {
        if line.len() < 3 {
            continue;
        }
        let status = line[..2].trim().to_string();
        let file_path = line[3..].to_string();

        let (additions, deletions) = file_stats.get(&file_path).copied().unwrap_or((0, 0));
        total_additions += additions;
        total_deletions += deletions;

        files.push(GitChangedFile {
            path: file_path,
            status,
            additions,
            deletions,
        });
    }

    Ok(GitDiffStats {
        total_additions,
        total_deletions,
        files,
    })
}

#[tauri::command]
async fn get_file_diff(path: String, file_path: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["diff", "HEAD", "--", &file_path])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to get diff: {}", e))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ============ Open In Commands ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedProject {
    pub project_type: String, // "xcode", "swift-package", "cargo", "node", "python"
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,      // "xcode", "vscode", "cursor", "terminal", "finder"
    pub name: String,
    pub path: String,
    pub icon: Option<String>, // SF Symbol name or emoji
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInInfo {
    pub projects: Vec<DetectedProject>,
    pub apps: Vec<InstalledApp>,
}

/// Detect projects in a directory and installed apps
#[tauri::command]
async fn get_open_in_options(path: String) -> Result<OpenInInfo, String> {
    let mut projects = Vec::new();
    let mut apps = Vec::new();

    // Detect projects in the directory
    if let Ok(entries) = fs::read_dir(&path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let entry_path = entry.path();
            let name = entry_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // Xcode project
            if name.ends_with(".xcodeproj") {
                projects.push(DetectedProject {
                    project_type: "xcode".to_string(),
                    name: name.trim_end_matches(".xcodeproj").to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                });
            }
            // Xcode workspace
            else if name.ends_with(".xcworkspace") {
                projects.push(DetectedProject {
                    project_type: "xcode".to_string(),
                    name: name.trim_end_matches(".xcworkspace").to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                });
            }
            // Swift Package
            else if name == "Package.swift" {
                projects.push(DetectedProject {
                    project_type: "swift-package".to_string(),
                    name: PathBuf::from(&path).file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Package")
                        .to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                });
            }
            // Cargo (Rust)
            else if name == "Cargo.toml" {
                projects.push(DetectedProject {
                    project_type: "cargo".to_string(),
                    name: PathBuf::from(&path).file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Cargo")
                        .to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                });
            }
            // Node.js
            else if name == "package.json" {
                projects.push(DetectedProject {
                    project_type: "node".to_string(),
                    name: PathBuf::from(&path).file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Node")
                        .to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                });
            }
        }
    }

    // Check for installed apps
    let app_checks = vec![
        ("xcode", "Xcode", "/Applications/Xcode.app"),
        ("xcode-beta", "Xcode Beta", "/Applications/Xcode-beta.app"),
        ("vscode", "VS Code", "/Applications/Visual Studio Code.app"),
        ("cursor", "Cursor", "/Applications/Cursor.app"),
        ("zed", "Zed", "/Applications/Zed.app"),
        ("sublime", "Sublime Text", "/Applications/Sublime Text.app"),
        ("fleet", "Fleet", "/Applications/Fleet.app"),
        ("nova", "Nova", "/Applications/Nova.app"),
        ("terminal", "Terminal", "/System/Applications/Utilities/Terminal.app"),
        ("iterm", "iTerm", "/Applications/iTerm.app"),
        ("warp", "Warp", "/Applications/Warp.app"),
        ("ghostty", "Ghostty", "/Applications/Ghostty.app"),
        ("alacritty", "Alacritty", "/Applications/Alacritty.app"),
        ("kitty", "kitty", "/Applications/kitty.app"),
    ];

    for (id, name, app_path) in app_checks {
        if PathBuf::from(app_path).exists() {
            apps.push(InstalledApp {
                id: id.to_string(),
                name: name.to_string(),
                path: app_path.to_string(),
                icon: None,
            });
        }
    }

    // Finder is always available
    apps.push(InstalledApp {
        id: "finder".to_string(),
        name: "Finder".to_string(),
        path: "/System/Library/CoreServices/Finder.app".to_string(),
        icon: None,
    });

    Ok(OpenInInfo { projects, apps })
}

/// Open a path in a specific application
#[tauri::command]
async fn open_in_app(app_id: String, path: String, project_path: Option<String>) -> Result<(), String> {
    let target_path = project_path.unwrap_or(path.clone());

    match app_id.as_str() {
        "finder" => {
            Command::new("open")
                .arg(&target_path)
                .spawn()
                .map_err(|e| format!("Failed to open Finder: {}", e))?;
        }
        "terminal" => {
            Command::new("open")
                .args(["-a", "Terminal", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open Terminal: {}", e))?;
        }
        "iterm" => {
            Command::new("open")
                .args(["-a", "iTerm", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open iTerm: {}", e))?;
        }
        "warp" => {
            Command::new("open")
                .args(["-a", "Warp", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open Warp: {}", e))?;
        }
        "ghostty" => {
            Command::new("open")
                .args(["-a", "Ghostty", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open Ghostty: {}", e))?;
        }
        "alacritty" => {
            Command::new("open")
                .args(["-a", "Alacritty", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open Alacritty: {}", e))?;
        }
        "kitty" => {
            Command::new("open")
                .args(["-a", "kitty", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open kitty: {}", e))?;
        }
        "xcode" | "xcode-beta" => {
            let app_name = if app_id == "xcode-beta" { "Xcode-beta" } else { "Xcode" };
            Command::new("open")
                .args(["-a", app_name, &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open Xcode: {}", e))?;
        }
        "vscode" => {
            // Try 'code' command first, fall back to open -a
            let code_result = Command::new("code")
                .arg(&target_path)
                .spawn();

            if code_result.is_err() {
                Command::new("open")
                    .args(["-a", "Visual Studio Code", &target_path])
                    .spawn()
                    .map_err(|e| format!("Failed to open VS Code: {}", e))?;
            }
        }
        "cursor" => {
            // Try 'cursor' command first, fall back to open -a
            let cursor_result = Command::new("cursor")
                .arg(&target_path)
                .spawn();

            if cursor_result.is_err() {
                Command::new("open")
                    .args(["-a", "Cursor", &target_path])
                    .spawn()
                    .map_err(|e| format!("Failed to open Cursor: {}", e))?;
            }
        }
        "zed" => {
            let zed_result = Command::new("zed")
                .arg(&target_path)
                .spawn();

            if zed_result.is_err() {
                Command::new("open")
                    .args(["-a", "Zed", &target_path])
                    .spawn()
                    .map_err(|e| format!("Failed to open Zed: {}", e))?;
            }
        }
        "sublime" => {
            let subl_result = Command::new("subl")
                .arg(&target_path)
                .spawn();

            if subl_result.is_err() {
                Command::new("open")
                    .args(["-a", "Sublime Text", &target_path])
                    .spawn()
                    .map_err(|e| format!("Failed to open Sublime Text: {}", e))?;
            }
        }
        "fleet" => {
            Command::new("open")
                .args(["-a", "Fleet", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open Fleet: {}", e))?;
        }
        "nova" => {
            Command::new("open")
                .args(["-a", "Nova", &target_path])
                .spawn()
                .map_err(|e| format!("Failed to open Nova: {}", e))?;
        }
        _ => {
            return Err(format!("Unknown app: {}", app_id));
        }
    }

    Ok(())
}

/// Copy path to clipboard
#[tauri::command]
async fn copy_to_clipboard(text: String) -> Result<(), String> {
    Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            if let Some(stdin) = child.stdin.as_mut() {
                use std::io::Write;
                stdin.write_all(text.as_bytes())?;
            }
            child.wait()
        })
        .map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

    Ok(())
}

// ============ Git Worktree Commands ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
    pub session_id: Option<String>,
}

#[tauri::command]
async fn list_worktrees(path: Option<String>) -> Result<Vec<GitWorktree>, String> {
    let working_dir = path.unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });

    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&working_dir)
        .output()
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree list failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current_worktree: Option<GitWorktree> = None;

    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            // Save previous worktree if exists
            if let Some(wt) = current_worktree.take() {
                worktrees.push(wt);
            }
            // Start new worktree
            let path = line.strip_prefix("worktree ").unwrap_or("").to_string();
            current_worktree = Some(GitWorktree {
                path,
                branch: String::new(),
                is_main: false,
                session_id: None,
            });
        } else if line.starts_with("branch ") {
            if let Some(ref mut wt) = current_worktree {
                let branch = line.strip_prefix("branch refs/heads/").unwrap_or(
                    line.strip_prefix("branch ").unwrap_or("")
                );
                wt.branch = branch.to_string();
                // Check if this is a session worktree (branch name contains "session-")
                if branch.starts_with("session-") {
                    wt.session_id = Some(branch.strip_prefix("session-").unwrap_or(branch).to_string());
                }
            }
        } else if line == "bare" {
            // Skip bare worktrees
            current_worktree = None;
        }
    }

    // Don't forget the last worktree
    if let Some(wt) = current_worktree {
        worktrees.push(wt);
    }

    // Mark the main worktree (first one)
    if let Some(first) = worktrees.first_mut() {
        first.is_main = true;
    }

    Ok(worktrees)
}

#[tauri::command]
async fn create_session_worktree(
    path: String,
    session_id: String,
) -> Result<GitWorktree, String> {
    // Create branch name from session ID
    let branch_name = format!("session-{}", session_id.chars().take(8).collect::<String>());
    let worktree_path = format!("{}/../{}-worktree", path, branch_name);

    // First create the branch from current HEAD
    let branch_output = Command::new("git")
        .args(["branch", &branch_name])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to create branch: {}", e))?;

    if !branch_output.status.success() {
        let stderr = String::from_utf8_lossy(&branch_output.stderr);
        // Branch might already exist, which is fine
        if !stderr.contains("already exists") {
            return Err(format!("Failed to create branch: {}", stderr));
        }
    }

    // Create the worktree
    let output = Command::new("git")
        .args(["worktree", "add", &worktree_path, &branch_name])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to create worktree: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to create worktree: {}", stderr));
    }

    // Resolve the full path
    let full_path = std::fs::canonicalize(&worktree_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(worktree_path);

    Ok(GitWorktree {
        path: full_path,
        branch: branch_name,
        is_main: false,
        session_id: Some(session_id),
    })
}

#[tauri::command]
async fn remove_worktree(worktree_path: String, force: Option<bool>) -> Result<(), String> {
    let mut args = vec!["worktree", "remove"];
    if force.unwrap_or(false) {
        args.push("--force");
    }
    args.push(&worktree_path);

    let output = Command::new("git")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to remove worktree: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to remove worktree: {}", stderr));
    }

    Ok(())
}

// ============ Claude Code Session History ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeSession {
    pub id: String,
    pub project_path: String,
    pub project_hash: String,
    pub created_at: u64,
    pub last_message: Option<String>,
    pub message_count: u32,
}

/// Get project hash like Claude Code does (SHA256 of path)
fn get_project_hash(path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Message from a session file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsed {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: String,
    pub message_type: String, // "user" or "assistant"
    pub content: String,
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools_used: Option<Vec<ToolUsed>>,
}

/// Load messages from a Claude Code session file
#[tauri::command]
async fn load_session_messages(project_path: String, session_id: String) -> Result<Vec<SessionMessage>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set")?;
    let claude_projects_dir = PathBuf::from(&home).join(".claude").join("projects");

    // Build list of paths to check (current + parents up to home)
    let mut paths_to_check = Vec::new();
    let mut current = PathBuf::from(&project_path);
    let home_path = PathBuf::from(&home);

    while current.starts_with(&home_path) && current != home_path {
        paths_to_check.push(current.clone());
        if !current.pop() {
            break;
        }
    }

    // Find the session file
    let mut session_file = None;
    for path in paths_to_check {
        let path_str = path.to_string_lossy().to_string();
        let project_dir_name = path_str.replace("/", "-");
        let project_dir = claude_projects_dir.join(&project_dir_name);
        let file_path = project_dir.join(format!("{}.jsonl", session_id));

        if file_path.exists() {
            session_file = Some(file_path);
            break;
        }
    }

    let Some(file_path) = session_file else {
        return Ok(vec![]);
    };

    // Read and parse the JSONL file
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let mut messages = Vec::new();
    let mut msg_counter = 0u64;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            let msg_type = json.get("type").and_then(|t| t.as_str()).unwrap_or("");

            if msg_type == "user" || msg_type == "assistant" {
                // Extract content and tools from the message
                let (content, tools_used) = if let Some(msg) = json.get("message") {
                    if let Some(content) = msg.get("content") {
                        // Content can be a string or array of blocks
                        if let Some(s) = content.as_str() {
                            (s.to_string(), None)
                        } else if let Some(arr) = content.as_array() {
                            // Extract text and tool_use from content blocks
                            let mut texts = Vec::new();
                            let mut tools = Vec::new();

                            for block in arr {
                                let block_type = block.get("type").and_then(|t| t.as_str());
                                match block_type {
                                    Some("text") => {
                                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                            texts.push(text.to_string());
                                        }
                                    }
                                    Some("tool_use") => {
                                        if let Some(name) = block.get("name").and_then(|n| n.as_str()) {
                                            let input = block.get("input")
                                                .map(|i| serde_json::to_string(i).unwrap_or_default());
                                            tools.push(ToolUsed {
                                                name: name.to_string(),
                                                input,
                                            });
                                        }
                                    }
                                    _ => {}
                                }
                            }

                            let content = texts.join("\n");
                            let tools_used = if tools.is_empty() { None } else { Some(tools) };
                            (content, tools_used)
                        } else {
                            continue;
                        }
                    } else {
                        continue;
                    }
                } else {
                    continue;
                };

                // Skip empty content (unless there are tools)
                if content.trim().is_empty() && tools_used.is_none() {
                    continue;
                }

                msg_counter += 1;
                messages.push(SessionMessage {
                    id: format!("hist-{}", msg_counter),
                    message_type: msg_type.to_string(),
                    content,
                    timestamp: msg_counter, // Use counter as pseudo-timestamp for ordering
                    tools_used,
                });
            }
        }
    }

    Ok(messages)
}

/// List Claude Code sessions for a project
#[tauri::command]
async fn list_claude_code_sessions(project_path: String) -> Result<Vec<ClaudeCodeSession>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set")?;
    let claude_projects_dir = PathBuf::from(&home).join(".claude").join("projects");

    if !claude_projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut sessions = Vec::new();

    // Claude Code stores sessions directly in ~/.claude/projects/<project-path-encoded>/
    // The directory name is the project path with / replaced by -
    // e.g. /Users/foo/project becomes -Users-foo-project

    // Build list of paths to check: current path + all parent paths up to home
    let mut paths_to_check = Vec::new();
    let mut current = PathBuf::from(&project_path);
    let home_path = PathBuf::from(&home);

    // Add current path and walk up to home directory
    while current.starts_with(&home_path) && current != home_path {
        paths_to_check.push(current.clone());
        if !current.pop() {
            break;
        }
    }

    // Find the first path that has a matching sessions directory
    let mut target_dir = None;
    for path in paths_to_check {
        let path_str = path.to_string_lossy().to_string();
        let project_dir_name = path_str.replace("/", "-");
        let project_dir = claude_projects_dir.join(&project_dir_name);

        if project_dir.exists() {
            // Check if it has any .jsonl files
            if let Ok(entries) = fs::read_dir(&project_dir) {
                let has_sessions = entries
                    .filter_map(|e| e.ok())
                    .any(|e| e.path().extension().map_or(false, |ext| ext == "jsonl"));
                if has_sessions {
                    target_dir = Some(project_dir);
                    break;
                }
            }
        }
    }

    let Some(project_dir) = target_dir else {
        return Ok(vec![]);
    };

    // Get the project hash from directory name
    let project_hash = project_dir.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    // Read .jsonl files directly from the project directory (not a sessions subdirectory)
    if let Ok(session_entries) = fs::read_dir(&project_dir) {
        for session_entry in session_entries.filter_map(|e| e.ok()) {
            let session_path = session_entry.path();
            if !session_path.extension().map_or(false, |ext| ext == "jsonl") {
                continue;
            }

            // Get session ID from filename (without .jsonl)
            let session_id = session_path.file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // Get file metadata for timestamp
            let metadata = fs::metadata(&session_path).ok();
            let created_at = metadata.as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            // Read first few lines to get last message and count
            let (last_message, message_count) = if let Ok(content) = fs::read_to_string(&session_path) {
                let lines: Vec<&str> = content.lines().collect();
                let count = lines.len() as u32;

                // Find last assistant message
                let last_msg = lines.iter().rev().find_map(|line| {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                        if json.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                            return json.get("message")
                                .and_then(|m| m.get("content"))
                                .and_then(|c| {
                                    // Content can be a string or array
                                    if let Some(s) = c.as_str() {
                                        return Some(s.chars().take(100).collect::<String>());
                                    }
                                    if let Some(arr) = c.as_array() {
                                        // Find first text block
                                        for item in arr {
                                            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                                    return Some(text.chars().take(100).collect::<String>());
                                                }
                                            }
                                        }
                                    }
                                    None
                                });
                        }
                    }
                    None
                });
                (last_msg, count)
            } else {
                (None, 0)
            };

            sessions.push(ClaudeCodeSession {
                id: session_id,
                project_path: project_path.clone(),
                project_hash: project_hash.clone(),
                created_at,
                last_message,
                message_count,
            });
        }
    }

    // Sort by created_at descending (most recent first)
    sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    // Limit to most recent 20 sessions
    sessions.truncate(20);

    Ok(sessions)
}

// ============ User Preferences ============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    pub model: Option<String>,
    pub skills: Vec<String>,
    pub skip_permissions: bool,
    #[serde(default)]
    pub session_names: std::collections::HashMap<String, String>,
    /// Maps project path to active session ID
    #[serde(default)]
    pub active_sessions: std::collections::HashMap<String, String>,
}

fn get_preferences_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".nocur").join("preferences.json")
}

#[tauri::command]
async fn get_user_preferences() -> Result<UserPreferences, String> {
    let prefs_path = get_preferences_path();

    if prefs_path.exists() {
        let content = fs::read_to_string(&prefs_path)
            .map_err(|e| format!("Failed to read preferences: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse preferences: {}", e))
    } else {
        Ok(UserPreferences::default())
    }
}

#[tauri::command]
async fn save_user_preferences(preferences: UserPreferences) -> Result<(), String> {
    let prefs_path = get_preferences_path();

    // Create .nocur directory if needed
    if let Some(parent) = prefs_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create preferences directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&preferences)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;

    fs::write(&prefs_path, content)
        .map_err(|e| format!("Failed to write preferences: {}", e))?;

    Ok(())
}

// City names for stable session naming
const CITY_NAMES: &[&str] = &[
    "tokyo", "paris", "london", "berlin", "sydney", "cairo", "mumbai", "seoul",
    "rome", "vienna", "prague", "lisbon", "dublin", "oslo", "stockholm", "helsinki",
    "amsterdam", "brussels", "zurich", "milan", "barcelona", "madrid", "athens",
    "istanbul", "dubai", "singapore", "bangkok", "hanoi", "manila", "jakarta",
    "nairobi", "lagos", "casablanca", "capetown", "montreal", "vancouver", "seattle",
    "denver", "austin", "miami", "boston", "chicago", "portland", "phoenix",
    "havana", "lima", "bogota", "santiago", "buenosaires", "rio", "saopaulo",
    "reykjavik", "tallinn", "riga", "vilnius", "warsaw", "budapest", "bucharest",
    "sofia", "belgrade", "zagreb", "ljubljana", "bratislava", "kyiv", "minsk"
];

/// Get or create a stable city name for a session ID
#[tauri::command]
async fn get_session_name(session_id: String) -> Result<String, String> {
    let prefs_path = get_preferences_path();

    // Load existing preferences
    let mut prefs: UserPreferences = if prefs_path.exists() {
        let content = fs::read_to_string(&prefs_path)
            .map_err(|e| format!("Failed to read preferences: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        UserPreferences::default()
    };

    // Check if we already have a name for this session
    if let Some(name) = prefs.session_names.get(&session_id) {
        return Ok(name.clone());
    }

    // Generate a new name - pick one not already used
    let used_names: std::collections::HashSet<&String> = prefs.session_names.values().collect();
    let available_name = CITY_NAMES
        .iter()
        .find(|&&name| !used_names.contains(&name.to_string()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            // If all names used, generate one with a suffix
            let base_name = CITY_NAMES[prefs.session_names.len() % CITY_NAMES.len()];
            format!("{}-{}", base_name, prefs.session_names.len() / CITY_NAMES.len() + 1)
        });

    // Save the new mapping
    prefs.session_names.insert(session_id, available_name.clone());

    // Write back to file
    if let Some(parent) = prefs_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(&prefs)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;
    fs::write(&prefs_path, content)
        .map_err(|e| format!("Failed to write preferences: {}", e))?;

    Ok(available_name)
}

/// Get all session name mappings
#[tauri::command]
async fn get_session_names() -> Result<std::collections::HashMap<String, String>, String> {
    let prefs_path = get_preferences_path();

    if prefs_path.exists() {
        let content = fs::read_to_string(&prefs_path)
            .map_err(|e| format!("Failed to read preferences: {}", e))?;
        let prefs: UserPreferences = serde_json::from_str(&content).unwrap_or_default();
        Ok(prefs.session_names)
    } else {
        Ok(std::collections::HashMap::new())
    }
}

/// Get the active session ID for a project
#[tauri::command]
async fn get_active_session(project_path: String) -> Result<Option<String>, String> {
    let prefs_path = get_preferences_path();

    if prefs_path.exists() {
        let content = fs::read_to_string(&prefs_path)
            .map_err(|e| format!("Failed to read preferences: {}", e))?;
        let prefs: UserPreferences = serde_json::from_str(&content).unwrap_or_default();
        Ok(prefs.active_sessions.get(&project_path).cloned())
    } else {
        Ok(None)
    }
}

/// Set the active session ID for a project
#[tauri::command]
async fn set_active_session(project_path: String, session_id: String) -> Result<(), String> {
    let prefs_path = get_preferences_path();

    // Ensure directory exists
    if let Some(parent) = prefs_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create prefs directory: {}", e))?;
    }

    // Load existing preferences or create default
    let mut prefs: UserPreferences = if prefs_path.exists() {
        let content = fs::read_to_string(&prefs_path)
            .map_err(|e| format!("Failed to read preferences: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        UserPreferences::default()
    };

    // Set active session for this project
    prefs.active_sessions.insert(project_path, session_id);

    // Save preferences
    let content = serde_json::to_string_pretty(&prefs)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;
    fs::write(&prefs_path, content)
        .map_err(|e| format!("Failed to save preferences: {}", e))?;

    Ok(())
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
async fn simulator_swipe(
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    duration_ms: Option<u64>,
    state: State<'_, Arc<WindowCaptureState>>,
) -> Result<(), String> {
    let bounds = state.get_bounds().ok_or("No simulator window bounds")?;
    let duration = duration_ms.unwrap_or(300);
    window_capture::send_mouse_drag(start_x, start_y, end_x, end_y, duration, &bounds)
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn simulator_home() -> Result<(), String> {
    // Use simctl to press home button
    let output = Command::new("xcrun")
        .args(["simctl", "io", "booted", "sendkey", "home"])
        .output()
        .map_err(|e| format!("Failed to press home: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Home button failed: {}", stderr));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn focus_simulator() -> Result<(), String> {
    // Use AppleScript to bring Simulator to front
    let output = Command::new("osascript")
        .args(["-e", "tell application \"Simulator\" to activate"])
        .output()
        .map_err(|e| format!("Failed to focus simulator: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Focus simulator failed: {}", stderr));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn find_simulator_window() -> Result<window_capture::SimulatorWindowInfo, String> {
    window_capture::find_simulator_window()
}

// ============ Simulator Log Streaming ============

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

/// State for simulator log streaming
pub struct SimulatorLogState {
    is_streaming: AtomicBool,
    logs: RwLock<Vec<SimulatorLogEntry>>,
    child_pid: RwLock<Option<u32>>,
}

impl SimulatorLogState {
    pub fn new() -> Self {
        Self {
            is_streaming: AtomicBool::new(false),
            logs: RwLock::new(Vec::new()),
            child_pid: RwLock::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorLogEntry {
    pub timestamp: u64,
    pub level: String,      // "debug", "info", "warning", "error", "fault"
    pub process: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStreamEvent {
    pub entries: Vec<SimulatorLogEntry>,
}

/// Start streaming simulator logs
#[cfg(target_os = "macos")]
#[tauri::command]
async fn start_simulator_logs(
    bundle_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<SimulatorLogState>>,
) -> Result<(), String> {
    if state.is_streaming.load(Ordering::SeqCst) {
        return Ok(()); // Already streaming
    }

    state.is_streaming.store(true, Ordering::SeqCst);

    // Clear existing logs
    {
        let mut logs = state.logs.write().unwrap();
        logs.clear();
    }

    let state_clone = state.inner().clone();
    let app_handle_clone = app_handle.clone();

    // Spawn log streaming in background
    std::thread::spawn(move || {
        // Build the log stream command
        let mut cmd = Command::new("xcrun");
        cmd.args(["simctl", "spawn", "booted", "log", "stream", "--style", "compact"]);

        // Filter by bundle ID if provided
        if let Some(ref bid) = bundle_id {
            cmd.args(["--predicate", &format!("subsystem == '{}' OR process == '{}'", bid, bid)]);
        }

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to start log stream: {}", e);
                state_clone.is_streaming.store(false, Ordering::SeqCst);
                return;
            }
        };

        // Store child PID for later killing
        let pid = child.id();
        *state_clone.child_pid.write().unwrap() = Some(pid);

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            if !state_clone.is_streaming.load(Ordering::SeqCst) {
                break;
            }

            if let Ok(line) = line {
                // Parse log line (format: "2024-01-01 12:00:00.000000 process[pid] <level> message")
                let entry = parse_log_line(&line);

                // Store in state
                {
                    let mut logs = state_clone.logs.write().unwrap();
                    logs.push(entry.clone());
                    // Keep only last 1000 entries
                    if logs.len() > 1000 {
                        logs.remove(0);
                    }
                }

                // Emit event to frontend
                let _ = app_handle_clone.emit("simulator-log", LogStreamEvent {
                    entries: vec![entry],
                });
            }
        }

        // Cleanup
        let _ = child.kill();
        state_clone.is_streaming.store(false, Ordering::SeqCst);
        *state_clone.child_pid.write().unwrap() = None;
    });

    Ok(())
}

fn parse_log_line(line: &str) -> SimulatorLogEntry {
    // Simple parser for log lines
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // Try to extract level from <level> markers
    let level = if line.contains("<Error>") || line.contains("error") {
        "error"
    } else if line.contains("<Warning>") || line.contains("warning") {
        "warning"
    } else if line.contains("<Debug>") || line.contains("debug") {
        "debug"
    } else if line.contains("<Fault>") || line.contains("fault") {
        "fault"
    } else {
        "info"
    }.to_string();

    // Try to extract process name
    let process = line.split_whitespace()
        .nth(2)
        .and_then(|s| s.split('[').next())
        .unwrap_or("unknown")
        .to_string();

    SimulatorLogEntry {
        timestamp,
        level,
        process,
        message: line.to_string(),
    }
}

/// Stop streaming simulator logs
#[cfg(target_os = "macos")]
#[tauri::command]
async fn stop_simulator_logs(
    state: State<'_, Arc<SimulatorLogState>>,
) -> Result<(), String> {
    state.is_streaming.store(false, Ordering::SeqCst);

    // Kill the child process if running
    if let Some(pid) = *state.child_pid.read().unwrap() {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }

    Ok(())
}

/// Get all captured logs so far
#[cfg(target_os = "macos")]
#[tauri::command]
async fn get_simulator_logs(
    state: State<'_, Arc<SimulatorLogState>>,
) -> Result<Vec<SimulatorLogEntry>, String> {
    let logs = state.logs.read().unwrap();
    Ok(logs.clone())
}

/// Clear captured logs
#[cfg(target_os = "macos")]
#[tauri::command]
async fn clear_simulator_logs(
    state: State<'_, Arc<SimulatorLogState>>,
) -> Result<(), String> {
    let mut logs = state.logs.write().unwrap();
    logs.clear();
    Ok(())
}

// ============ Physical Device Log Streaming ============

/// State for physical device log streaming
pub struct PhysicalDeviceLogState {
    is_streaming: AtomicBool,
    child_pid: RwLock<Option<u32>>,
}

impl PhysicalDeviceLogState {
    pub fn new() -> Self {
        Self {
            is_streaming: AtomicBool::new(false),
            child_pid: RwLock::new(None),
        }
    }
}

/// Start streaming logs from a physical device app
/// This uses `xcrun devicectl device process launch --console` to stream stdout/stderr
#[cfg(target_os = "macos")]
#[tauri::command]
async fn start_physical_device_logs(
    device_id: String,
    bundle_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<PhysicalDeviceLogState>>,
) -> Result<(), String> {
    if state.is_streaming.load(Ordering::SeqCst) {
        return Ok(()); // Already streaming
    }

    state.is_streaming.store(true, Ordering::SeqCst);

    let state_clone = state.inner().clone();
    let app_handle_clone = app_handle.clone();

    // Spawn log streaming in background
    std::thread::spawn(move || {
        // Use devicectl to launch with console attached
        // This streams the app's stdout/stderr
        let mut cmd = Command::new("xcrun");
        cmd.args([
            "devicectl", "device", "process", "launch",
            "--device", &device_id,
            "--console",
            "--terminate-existing",
            &bundle_id
        ]);

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to start physical device log stream: {}", e);
                let _ = app_handle_clone.emit("device-log-error", serde_json::json!({
                    "error": format!("Failed to start log stream: {}", e)
                }));
                state_clone.is_streaming.store(false, Ordering::SeqCst);
                return;
            }
        };

        // Store child PID for later killing
        let pid = child.id();
        *state_clone.child_pid.write().unwrap() = Some(pid);

        // Emit that we started streaming
        let _ = app_handle_clone.emit("device-log-started", serde_json::json!({
            "deviceId": device_id,
            "bundleId": bundle_id
        }));

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take();

        // Read stdout in a thread
        let app_handle_stdout = app_handle_clone.clone();
        let state_stdout = state_clone.clone();
        let stdout_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                if !state_stdout.is_streaming.load(Ordering::SeqCst) {
                    break;
                }

                if let Ok(line) = line {
                    // Skip devicectl status messages
                    if line.starts_with("Launched application") || 
                       line.starts_with("Process ") ||
                       line.trim().is_empty() {
                        continue;
                    }

                    let timestamp = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;

                    // Determine log level from content
                    let level = if line.contains("error") || line.contains("Error") || line.contains("ERROR") {
                        "error"
                    } else if line.contains("warning") || line.contains("Warning") || line.contains("WARN") {
                        "warning"
                    } else if line.contains("debug") || line.contains("Debug") || line.contains("DEBUG") {
                        "debug"
                    } else {
                        "info"
                    }.to_string();

                    let entry = SimulatorLogEntry {
                        timestamp,
                        level,
                        process: "app".to_string(),
                        message: line,
                    };

                    // Emit log entry - reuse the same event type as simulator
                    let _ = app_handle_stdout.emit("simulator-log", LogStreamEvent {
                        entries: vec![entry],
                    });
                }
            }
        });

        // Also read stderr if available
        if let Some(stderr) = stderr {
            let app_handle_stderr = app_handle_clone.clone();
            let state_stderr = state_clone.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);

                for line in reader.lines() {
                    if !state_stderr.is_streaming.load(Ordering::SeqCst) {
                        break;
                    }

                    if let Ok(line) = line {
                        if line.trim().is_empty() {
                            continue;
                        }

                        let timestamp = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;

                        let entry = SimulatorLogEntry {
                            timestamp,
                            level: "error".to_string(),
                            process: "app".to_string(),
                            message: line,
                        };

                        let _ = app_handle_stderr.emit("simulator-log", LogStreamEvent {
                            entries: vec![entry],
                        });
                    }
                }
            });
        }

        // Wait for stdout thread to finish
        let _ = stdout_thread.join();

        // Wait for process to exit
        let exit_status = child.wait();
        
        // Emit that streaming stopped
        let _ = app_handle_clone.emit("device-log-stopped", serde_json::json!({
            "exitStatus": exit_status.map(|s| s.code()).ok().flatten()
        }));

        state_clone.is_streaming.store(false, Ordering::SeqCst);
        *state_clone.child_pid.write().unwrap() = None;
    });

    Ok(())
}

/// Stop streaming physical device logs
#[cfg(target_os = "macos")]
#[tauri::command]
async fn stop_physical_device_logs(
    state: State<'_, Arc<PhysicalDeviceLogState>>,
) -> Result<(), String> {
    state.is_streaming.store(false, Ordering::SeqCst);

    // Kill the child process if running
    if let Some(pid) = *state.child_pid.read().unwrap() {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }

    Ok(())
}

// ============ Crash Reports ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub path: String,
    pub process_name: String,
    pub timestamp: u64,
    pub exception_type: Option<String>,
    pub crash_reason: Option<String>,
    pub stack_trace: Option<String>,
}

/// Get recent crash reports from the simulator
#[cfg(target_os = "macos")]
#[tauri::command]
async fn get_crash_reports(
    bundle_id: Option<String>,
    since_timestamp: Option<u64>,
) -> Result<Vec<CrashReport>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set")?;

    // Simulator crash logs are in ~/Library/Logs/DiagnosticReports/
    let crash_dir = PathBuf::from(&home)
        .join("Library")
        .join("Logs")
        .join("DiagnosticReports");

    if !crash_dir.exists() {
        return Ok(vec![]);
    }

    let mut reports = Vec::new();
    let since = since_timestamp.unwrap_or(0);

    if let Ok(entries) = fs::read_dir(&crash_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();

            // Only process .crash and .ips files
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "crash" && ext != "ips" {
                continue;
            }

            // Check modification time
            let metadata = match fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            let modified = metadata.modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            if modified < since {
                continue;
            }

            // Read and parse the crash report
            if let Ok(content) = fs::read_to_string(&path) {
                let file_name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                // Filter by bundle ID if provided
                if let Some(ref bid) = bundle_id {
                    if !content.contains(bid) && !file_name.contains(bid) {
                        continue;
                    }
                }

                // Extract process name from filename (usually ProcessName-date.crash)
                let process_name = file_name
                    .split('-')
                    .next()
                    .unwrap_or("unknown")
                    .to_string();

                // Parse crash details
                let exception_type = content.lines()
                    .find(|l| l.starts_with("Exception Type:"))
                    .map(|l| l.replace("Exception Type:", "").trim().to_string());

                let crash_reason = content.lines()
                    .find(|l| l.starts_with("Termination Reason:") || l.starts_with("Exception Reason:"))
                    .map(|l| l.split(':').skip(1).collect::<Vec<_>>().join(":").trim().to_string());

                // Extract stack trace (Thread 0 Crashed section)
                let stack_trace = extract_stack_trace(&content);

                reports.push(CrashReport {
                    path: path.to_string_lossy().to_string(),
                    process_name,
                    timestamp: modified,
                    exception_type,
                    crash_reason,
                    stack_trace,
                });
            }
        }
    }

    // Sort by timestamp descending
    reports.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    // Limit to most recent 10
    reports.truncate(10);

    Ok(reports)
}

fn extract_stack_trace(content: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_crashed_thread = false;
    let mut stack_lines = Vec::new();

    for line in lines {
        if line.contains("Thread 0 Crashed") || line.contains("Crashed Thread:") {
            in_crashed_thread = true;
            continue;
        }
        if in_crashed_thread {
            if line.is_empty() || line.starts_with("Thread ") && !line.contains("Crashed") {
                break;
            }
            stack_lines.push(line);
        }
    }

    if stack_lines.is_empty() {
        None
    } else {
        Some(stack_lines.join("\n"))
    }
}

/// List project files for @ file reference autocomplete
/// Uses the `ignore` crate to respect .gitignore
#[tauri::command]
async fn list_project_files(
    project_path: String,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    use ignore::WalkBuilder;

    let limit = limit.unwrap_or(50);
    let query = query.unwrap_or_default().to_lowercase();

    let mut files: Vec<String> = Vec::new();

    let walker = WalkBuilder::new(&project_path)
        .hidden(false)  // Don't skip hidden files
        .git_ignore(true)  // Respect .gitignore
        .git_global(true)  // Respect global .gitignore
        .git_exclude(true)  // Respect .git/info/exclude
        .max_depth(Some(10))  // Limit depth
        .build();

    for entry in walker {
        if files.len() >= limit * 2 {  // Collect more to filter better
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Skip directories
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(true) {
            continue;
        }

        let path = entry.path();

        // Get relative path from project root
        let relative_path = path.strip_prefix(&project_path)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        // Skip if path starts with .git/
        if relative_path.starts_with(".git/") || relative_path.starts_with(".git\\") {
            continue;
        }

        files.push(relative_path);
    }

    // Sort and filter by query
    if !query.is_empty() {
        // Score each file by how well it matches the query
        let mut scored: Vec<(String, i32)> = files
            .into_iter()
            .filter_map(|f| {
                let lower = f.to_lowercase();
                let filename = f.split('/').last().unwrap_or(&f).to_lowercase();

                // Calculate match score
                let score = if filename == query {
                    100  // Exact filename match
                } else if filename.starts_with(&query) {
                    80  // Filename starts with query
                } else if filename.contains(&query) {
                    60  // Filename contains query
                } else if lower.contains(&query) {
                    40  // Path contains query
                } else {
                    return None;  // No match
                };

                Some((f, score))
            })
            .collect();

        // Sort by score (descending), then alphabetically
        scored.sort_by(|a, b| {
            b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0))
        });

        files = scored.into_iter().map(|(f, _)| f).take(limit).collect();
    } else {
        // No query - sort by recency (we don't have mtime, so just alphabetically)
        files.sort();
        files.truncate(limit);
    }

    Ok(files)
}

/// Write debug snapshot to file for agentic access
#[tauri::command]
async fn write_debug_snapshot(snapshot: String) -> Result<(), String> {
    let debug_path = std::path::Path::new("/tmp/nocur-debug.json");
    fs::write(debug_path, &snapshot)
        .map_err(|e| format!("Failed to write debug snapshot: {}", e))?;
    Ok(())
}

/// Read debug snapshot from file
#[tauri::command]
async fn read_debug_snapshot() -> Result<String, String> {
    let debug_path = std::path::Path::new("/tmp/nocur-debug.json");
    if debug_path.exists() {
        fs::read_to_string(debug_path)
            .map_err(|e| format!("Failed to read debug snapshot: {}", e))
    } else {
        Ok("{}".to_string())
    }
}

/// Save base64 screenshots to temp files and return their paths
#[tauri::command]
async fn save_screenshots_to_temp(
    images: Vec<String>,  // base64 JPEG images
    prefix: Option<String>,
) -> Result<Vec<String>, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let temp_dir = std::env::temp_dir().join("nocur_recordings");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let prefix = prefix.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "recording".to_string())
    });

    let mut paths = Vec::new();

    for (i, base64_data) in images.iter().enumerate() {
        // Strip data URL prefix if present
        let data = if base64_data.starts_with("data:") {
            base64_data.split(',').nth(1).unwrap_or(base64_data)
        } else {
            base64_data
        };

        let bytes = STANDARD.decode(data)
            .map_err(|e| format!("Failed to decode base64: {}", e))?;

        let filename = format!("{}_{:03}.jpg", prefix, i);
        let path = temp_dir.join(&filename);

        fs::write(&path, bytes)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        paths.push(path.to_string_lossy().to_string());
    }

    Ok(paths)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[tauri::command]
async fn run_terminal_command(command: String, working_dir: String) -> Result<TerminalResult, String> {
    let output = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    Ok(TerminalResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

#[tauri::command]
fn get_shell_env() -> std::collections::HashMap<String, String> {
    std::env::vars().collect()
}

// ============================================================================
// ACE (Agentic Context Engineering) Commands
// ============================================================================

#[tauri::command]
fn ace_get_config() -> ace::ACEConfig {
    ace::load_ace_config()
}

#[tauri::command]
fn ace_save_config(config: ace::ACEConfig) -> Result<(), String> {
    ace::save_ace_config(&config)
}

#[tauri::command]
fn ace_get_playbook(project_path: String) -> Result<Option<ace::Playbook>, String> {
    ace::load_playbook(&project_path)
}

#[tauri::command]
fn ace_get_or_create_playbook(project_path: String) -> Result<ace::Playbook, String> {
    ace::get_or_create_playbook(&project_path)
}

#[tauri::command]
fn ace_save_playbook(playbook: ace::Playbook) -> Result<(), String> {
    ace::save_playbook(&playbook)
}

#[tauri::command]
fn ace_add_bullet(
    project_path: String,
    section: ace::BulletSection,
    content: String,
) -> Result<ace::Bullet, String> {
    ace::add_bullet(&project_path, section, content)
}

#[tauri::command]
fn ace_update_bullet(
    project_path: String,
    bullet_id: String,
    content: String,
) -> Result<ace::Bullet, String> {
    ace::update_bullet(&project_path, &bullet_id, content)
}

#[tauri::command]
fn ace_delete_bullet(project_path: String, bullet_id: String) -> Result<(), String> {
    ace::delete_bullet(&project_path, &bullet_id)
}

#[tauri::command]
fn ace_update_bullet_tags(
    project_path: String,
    tags: Vec<ace::BulletTagEntry>,
) -> Result<(), String> {
    ace::update_bullet_tags(&project_path, tags)
}

#[tauri::command]
fn ace_set_enabled(project_path: String, enabled: bool) -> Result<(), String> {
    ace::set_ace_enabled(&project_path, enabled)
}

#[tauri::command]
fn ace_get_reflections(project_path: String) -> Result<Vec<ace::StoredReflection>, String> {
    ace::load_reflections(&project_path)
}

#[tauri::command]
fn ace_save_reflection(
    project_path: String,
    reflection: ace::StoredReflection,
) -> Result<(), String> {
    ace::save_reflection(&project_path, reflection)
}

#[tauri::command]
fn ace_list_playbooks() -> Result<Vec<String>, String> {
    ace::list_playbooks()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    let window_capture_state = Arc::new(WindowCaptureState::new());
    #[cfg(target_os = "macos")]
    let log_state = Arc::new(SimulatorLogState::new());
    #[cfg(target_os = "macos")]
    let physical_device_log_state = Arc::new(PhysicalDeviceLogState::new());

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_os::init())
        .manage(Mutex::new(ClaudeState::new()))
        .manage(Mutex::new(PermissionState::new()))
        .manage(Mutex::new(AppState::default()));

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .manage(window_capture_state)
            .manage(log_state)
            .manage(physical_device_log_state);
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
            terminate_app_on_simulator,
            terminate_app_on_device,
            list_devices,
            get_selected_device,
            set_selected_device,
            clear_selected_device,
            take_screenshot,
            get_view_hierarchy,
            load_image_from_path,
            start_claude_session,
            send_claude_message,
            stop_claude_session,
            cancel_claude_request,
            get_claude_session_info,
            set_claude_session_info,
            get_available_models,
            get_recent_sessions,
            get_current_session_id,
            save_session_to_history,
            set_skip_permissions,
            respond_to_permission,
            add_permission_rule,
            list_skills,
            read_skill,
            create_skill,
            open_skills_folder,
            get_git_info,
            get_git_diff_stats,
            get_file_diff,
            get_open_in_options,
            open_in_app,
            copy_to_clipboard,
            list_worktrees,
            create_session_worktree,
            remove_worktree,
            // Claude Code sessions
            list_claude_code_sessions,
            load_session_messages,
            // User preferences
            get_user_preferences,
            save_user_preferences,
            get_session_name,
            get_session_names,
            get_active_session,
            set_active_session,
            // Terminal
            run_terminal_command,
            get_shell_env,
            // ACE (Agentic Context Engineering)
            ace_get_config,
            ace_save_config,
            ace_get_playbook,
            ace_get_or_create_playbook,
            ace_save_playbook,
            ace_add_bullet,
            ace_update_bullet,
            ace_delete_bullet,
            ace_update_bullet_tags,
            ace_set_enabled,
            ace_get_reflections,
            ace_save_reflection,
            ace_list_playbooks,
            // Window capture (macOS only)
            #[cfg(target_os = "macos")]
            start_simulator_stream,
            #[cfg(target_os = "macos")]
            stop_simulator_stream,
            #[cfg(target_os = "macos")]
            simulator_click,
            #[cfg(target_os = "macos")]
            simulator_swipe,
            #[cfg(target_os = "macos")]
            simulator_home,
            #[cfg(target_os = "macos")]
            focus_simulator,
            #[cfg(target_os = "macos")]
            find_simulator_window,
            // Log streaming (macOS only)
            #[cfg(target_os = "macos")]
            start_simulator_logs,
            #[cfg(target_os = "macos")]
            stop_simulator_logs,
            #[cfg(target_os = "macos")]
            get_simulator_logs,
            #[cfg(target_os = "macos")]
            clear_simulator_logs,
            #[cfg(target_os = "macos")]
            start_physical_device_logs,
            #[cfg(target_os = "macos")]
            stop_physical_device_logs,
            #[cfg(target_os = "macos")]
            get_crash_reports,
            // Screenshot saving
            save_screenshots_to_temp,
            // Debug utilities
            write_debug_snapshot,
            read_debug_snapshot,
            // File autocomplete
            list_project_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
