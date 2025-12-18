use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use chrono::Utc;

// =============================================================================
// Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub last_opened: i64,  // Unix timestamp
    pub project_type: ProjectType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectType {
    Tuist,
    Xcode,
    SwiftPackage,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjects {
    pub projects: Vec<ProjectInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub location: String,
    #[serde(default)]
    pub bundle_id_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectValidation {
    pub is_valid: bool,
    pub project_type: ProjectType,
    pub name: String,
    pub has_tuist: bool,
    pub has_xcodeproj: bool,
    pub has_package_swift: bool,
    pub error: Option<String>,
}

// =============================================================================
// Recent Projects Storage
// =============================================================================

const MAX_RECENT_PROJECTS: usize = 10;
const RECENT_PROJECTS_FILE: &str = "recent_projects.json";

fn get_app_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .map(|p| p.join("com.nocur.app"))
        .ok_or_else(|| "Could not determine app data directory".to_string())
}

pub fn load_recent_projects() -> Vec<ProjectInfo> {
    let data_dir = match get_app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Vec::new(),
    };
    
    let file_path = data_dir.join(RECENT_PROJECTS_FILE);
    
    if !file_path.exists() {
        return Vec::new();
    }
    
    match fs::read_to_string(&file_path) {
        Ok(content) => {
            match serde_json::from_str::<RecentProjects>(&content) {
                Ok(recent) => recent.projects,
                Err(_) => Vec::new(),
            }
        }
        Err(_) => Vec::new(),
    }
}

pub fn save_recent_projects(projects: &[ProjectInfo]) -> Result<(), String> {
    let data_dir = get_app_data_dir()?;
    
    // Ensure directory exists
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    
    let file_path = data_dir.join(RECENT_PROJECTS_FILE);
    let recent = RecentProjects {
        projects: projects.to_vec(),
    };
    
    let content = serde_json::to_string_pretty(&recent)
        .map_err(|e| format!("Failed to serialize recent projects: {}", e))?;
    
    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write recent projects: {}", e))?;
    
    Ok(())
}

pub fn add_recent_project(path: &str) -> Result<Vec<ProjectInfo>, String> {
    let mut projects = load_recent_projects();
    
    // Remove if already exists (we'll re-add at top)
    projects.retain(|p| p.path != path);
    
    // Validate and get project info
    let validation = validate_project(path)?;
    
    let project = ProjectInfo {
        path: path.to_string(),
        name: validation.name,
        last_opened: Utc::now().timestamp(),
        project_type: validation.project_type,
    };
    
    // Add to front
    projects.insert(0, project);
    
    // Trim to max size
    projects.truncate(MAX_RECENT_PROJECTS);
    
    save_recent_projects(&projects)?;
    
    Ok(projects)
}

pub fn remove_recent_project(path: &str) -> Result<Vec<ProjectInfo>, String> {
    let mut projects = load_recent_projects();
    projects.retain(|p| p.path != path);
    save_recent_projects(&projects)?;
    Ok(projects)
}

pub fn clear_recent_projects() -> Result<(), String> {
    save_recent_projects(&[])
}

// =============================================================================
// Project Validation
// =============================================================================

pub fn validate_project(path: &str) -> Result<ProjectValidation, String> {
    let path = Path::new(path);
    
    if !path.exists() {
        return Ok(ProjectValidation {
            is_valid: false,
            project_type: ProjectType::Unknown,
            name: String::new(),
            has_tuist: false,
            has_xcodeproj: false,
            has_package_swift: false,
            error: Some("Path does not exist".to_string()),
        });
    }
    
    if !path.is_dir() {
        return Ok(ProjectValidation {
            is_valid: false,
            project_type: ProjectType::Unknown,
            name: String::new(),
            has_tuist: false,
            has_xcodeproj: false,
            has_package_swift: false,
            error: Some("Path is not a directory".to_string()),
        });
    }
    
    let has_tuist = path.join("Project.swift").exists();
    let has_package_swift = path.join("Package.swift").exists();
    
    // Check for .xcodeproj or .xcworkspace
    let has_xcodeproj = fs::read_dir(path)
        .map(|entries| {
            entries.filter_map(|e| e.ok()).any(|e| {
                let path = e.path();
                let ext = path.extension().and_then(|s| s.to_str());
                ext == Some("xcodeproj") || ext == Some("xcworkspace")
            })
        })
        .unwrap_or(false);
    
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    let project_type = if has_tuist {
        ProjectType::Tuist
    } else if has_xcodeproj {
        ProjectType::Xcode
    } else if has_package_swift {
        ProjectType::SwiftPackage
    } else {
        ProjectType::Unknown
    };
    
    let is_valid = has_tuist || has_xcodeproj || has_package_swift;
    
    Ok(ProjectValidation {
        is_valid,
        project_type,
        name,
        has_tuist,
        has_xcodeproj,
        has_package_swift,
        error: if !is_valid {
            Some("No Xcode project, Tuist manifest, or Package.swift found".to_string())
        } else {
            None
        },
    })
}

// =============================================================================
// Project Creation
// =============================================================================

pub fn create_project(request: &CreateProjectRequest) -> Result<ProjectInfo, String> {
    fn expand_tilde(path: &str) -> PathBuf {
        if path == "~" {
            return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
        }
        if let Some(rest) = path.strip_prefix("~/") {
            return dirs::home_dir()
                .map(|home| home.join(rest))
                .unwrap_or_else(|| PathBuf::from(path));
        }
        PathBuf::from(path)
    }

    let location_dir = expand_tilde(&request.location);
    let project_dir = location_dir.join(&request.name);
    
    // Check if directory already exists
    if project_dir.exists() {
        return Err(format!("Directory already exists: {}", project_dir.display()));
    }
    
    // Validate project name
    if !is_valid_project_name(&request.name) {
        return Err("Invalid project name. Use only letters, numbers, and hyphens.".to_string());
    }
    
    // Create project directory
    fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;
    
    // Create source directory
    let source_dir = project_dir.join(&request.name);
    fs::create_dir_all(&source_dir)
        .map_err(|e| format!("Failed to create source directory: {}", e))?;
    
    // Generate bundle ID
    let bundle_id_prefix = request
        .bundle_id_prefix
        .as_deref()
        .unwrap_or("com.example");
    let bundle_id = format!(
        "{}.{}",
        bundle_id_prefix,
        request.name.to_lowercase().replace("-", "")
    );
    
    // Write Tuist.swift
    fs::write(
        project_dir.join("Tuist.swift"),
        TEMPLATE_TUIST_SWIFT,
    ).map_err(|e| format!("Failed to write Tuist.swift: {}", e))?;
    
    // Write Project.swift
    let project_swift = TEMPLATE_PROJECT_SWIFT
        .replace("{{PROJECT_NAME}}", &request.name)
        .replace("{{BUNDLE_ID}}", &bundle_id);
    fs::write(
        project_dir.join("Project.swift"),
        project_swift,
    ).map_err(|e| format!("Failed to write Project.swift: {}", e))?;
    
    // Write .gitignore
    fs::write(
        project_dir.join(".gitignore"),
        TEMPLATE_GITIGNORE,
    ).map_err(|e| format!("Failed to write .gitignore: {}", e))?;
    
    // Write CLAUDE.md
    let claude_md = TEMPLATE_CLAUDE_MD
        .replace("{{PROJECT_NAME}}", &request.name)
        .replace("{{BUNDLE_ID}}", &bundle_id);
    fs::write(
        project_dir.join("CLAUDE.md"),
        claude_md,
    ).map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;
    
    // Write App.swift
    let app_swift = TEMPLATE_APP_SWIFT
        .replace("{{PROJECT_NAME}}", &request.name);
    fs::write(
        source_dir.join("App.swift"),
        app_swift,
    ).map_err(|e| format!("Failed to write App.swift: {}", e))?;
    
    // Write ContentView.swift
    fs::write(
        source_dir.join("ContentView.swift"),
        TEMPLATE_CONTENT_VIEW,
    ).map_err(|e| format!("Failed to write ContentView.swift: {}", e))?;
    
    // Create Assets.xcassets structure
    create_asset_catalog(&source_dir)?;
    
    // Run tuist generate
    let tuist_result = Command::new("tuist")
        .args(["generate", "--no-open"])
        .current_dir(&project_dir)
        .output();
    
    match tuist_result {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // Don't fail, just log - project files are created
                eprintln!("Warning: tuist generate had issues: {}", stderr);
            }
        }
        Err(e) => {
            eprintln!("Warning: Could not run tuist generate: {}. You may need to run it manually.", e);
        }
    }
    
    let project_path = project_dir.to_string_lossy().to_string();
    
    // Add to recent projects
    let _ = add_recent_project(&project_path);
    
    Ok(ProjectInfo {
        path: project_path,
        name: request.name.clone(),
        last_opened: Utc::now().timestamp(),
        project_type: ProjectType::Tuist,
    })
}

fn is_valid_project_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 50 {
        return false;
    }
    
    // Must start with letter
    if !name.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) {
        return false;
    }
    
    // Only alphanumeric and hyphens
    name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn create_asset_catalog(source_dir: &Path) -> Result<(), String> {
    let assets_dir = source_dir.join("Assets.xcassets");
    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create Assets.xcassets: {}", e))?;
    
    // Root Contents.json
    fs::write(
        assets_dir.join("Contents.json"),
        r#"{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}"#,
    ).map_err(|e| format!("Failed to write Assets Contents.json: {}", e))?;
    
    // AccentColor.colorset
    let accent_dir = assets_dir.join("AccentColor.colorset");
    fs::create_dir_all(&accent_dir)
        .map_err(|e| format!("Failed to create AccentColor.colorset: {}", e))?;
    fs::write(
        accent_dir.join("Contents.json"),
        r#"{
  "colors" : [
    {
      "idiom" : "universal"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}"#,
    ).map_err(|e| format!("Failed to write AccentColor Contents.json: {}", e))?;
    
    // AppIcon.appiconset
    let icon_dir = assets_dir.join("AppIcon.appiconset");
    fs::create_dir_all(&icon_dir)
        .map_err(|e| format!("Failed to create AppIcon.appiconset: {}", e))?;
    fs::write(
        icon_dir.join("Contents.json"),
        r#"{
  "images" : [
    {
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}"#,
    ).map_err(|e| format!("Failed to write AppIcon Contents.json: {}", e))?;
    
    Ok(())
}

// =============================================================================
// Templates
// =============================================================================

const TEMPLATE_TUIST_SWIFT: &str = r#"import ProjectDescription

let tuist = Tuist()
"#;

const TEMPLATE_PROJECT_SWIFT: &str = r#"import ProjectDescription

let project = Project(
    name: "{{PROJECT_NAME}}",
    targets: [
        .target(
            name: "{{PROJECT_NAME}}",
            destinations: [.iPhone, .iPad],
            product: .app,
            bundleId: "{{BUNDLE_ID}}",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .extendingDefault(with: [
                "UILaunchScreen": [
                    "UIColorName": "",
                    "UIImageName": "",
                ],
            ]),
            sources: ["{{PROJECT_NAME}}/**/*.swift"],
            resources: ["{{PROJECT_NAME}}/Assets.xcassets"],
            dependencies: []
        ),
    ]
)
"#;

const TEMPLATE_GITIGNORE: &str = r#"# Xcode
*.xcodeproj
*.xcworkspace
xcuserdata/
DerivedData/
*.pbxuser
*.perspectivev3
*.mode1v3
*.mode2v3
!default.pbxuser
!default.perspectivev3
!default.mode1v3
!default.mode2v3

# Tuist
Derived/
.tuist-derived/

# Swift Package Manager
.build/
.swiftpm/

# macOS
.DS_Store
*.swp
*~

# IDE
.idea/
*.xcuserdatad
"#;

const TEMPLATE_CLAUDE_MD: &str = r#"# {{PROJECT_NAME}}

## Project Overview
A SwiftUI iOS app managed with Tuist.

## Project Structure (Tuist)
This project uses **Tuist** for Xcode project generation. The xcodeproj is generated from `Project.swift`:
- **New Swift files are automatically included** - just create files in the `{{PROJECT_NAME}}/` directory
- Run `tuist generate` to regenerate the Xcode project if needed

## Build & Run
The project builds automatically when you click Run in Nocur.

```bash
# Manual commands if needed
tuist generate          # Generate Xcode project
tuist build             # Build the project
```

## Bundle ID
`{{BUNDLE_ID}}`

## Guidelines
- After ANY code change: build and verify with screenshot
- After ANY UI interaction: take screenshot to confirm
- Keep code simple and readable
- Use SwiftUI best practices
"#;

const TEMPLATE_APP_SWIFT: &str = r#"import SwiftUI

@main
struct {{PROJECT_NAME}}App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
"#;

const TEMPLATE_CONTENT_VIEW: &str = r#"import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "swift")
                .font(.system(size: 60))
                .foregroundStyle(.orange)
            
            Text("Hello, World!")
                .font(.largeTitle)
                .fontWeight(.bold)
            
            Text("Your app is ready to go.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
"#;
