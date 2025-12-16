//! ACE (Agentic Context Engineering) Persistence Module
//!
//! Handles storage and retrieval of playbooks and reflections using JSON files.
//! Files are stored in the app's data directory under `ace/playbooks/` and `ace/reflections/`.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use sha2::{Digest, Sha256};

/// Bullet section types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BulletSection {
    StrategiesAndHardRules,
    UsefulCodeSnippets,
    TroubleshootingAndPitfalls,
    ApisToUseForSpecificInformation,
    VerificationChecklist,
    DomainGlossary,
}

/// Tag types for bullet feedback
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BulletTag {
    Helpful,
    Harmful,
    Neutral,
}

/// Core Bullet structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bullet {
    pub id: String,
    pub project_id: String,
    pub section: BulletSection,
    pub content: String,
    pub helpful_count: i32,
    pub harmful_count: i32,
    pub neutral_count: i32,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_used_at: Option<u64>,
    pub active: bool,
}

/// Playbook structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playbook {
    pub project_id: String,
    pub project_path: String,
    pub ace_enabled: bool,
    pub max_bullets: i32,
    pub max_tokens: i32,
    pub bullets: Vec<Bullet>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Bullet tag entry from reflector
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulletTagEntry {
    pub id: String,
    pub tag: BulletTag,
}

/// Reflection result from reflector agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionResult {
    pub reasoning: String,
    pub error_identification: String,
    pub root_cause_analysis: String,
    pub correct_approach: String,
    pub key_insight: String,
    pub bullet_tags: Vec<BulletTagEntry>,
}

/// Stored reflection with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredReflection {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub task: String,
    pub outcome: String,
    pub reflection: ReflectionResult,
    pub bullets_used: Vec<String>,
    pub created_at: u64,
}

/// Reflections log for a project
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionsLog {
    pub project_id: String,
    pub reflections: Vec<StoredReflection>,
}

/// ACE configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ACEConfig {
    pub enabled: bool,
    pub default_max_bullets: i32,
    pub default_max_tokens: i32,
    pub reflector_model: String,
    pub curator_model: String,
    pub auto_reflect: bool,
    pub auto_curate: bool,
    pub similarity_threshold: f64,
}

impl Default for ACEConfig {
    fn default() -> Self {
        ACEConfig {
            enabled: true,
            default_max_bullets: 100,
            default_max_tokens: 8000,
            reflector_model: "claude-sonnet-4-20250514".to_string(),
            curator_model: "claude-sonnet-4-20250514".to_string(),
            auto_reflect: false,
            auto_curate: false,
            similarity_threshold: 0.85,
        }
    }
}

/// Generate a project ID from a path
pub fn generate_project_id(path: &str) -> String {
    stable_project_id(path)
}

fn stable_project_id(path: &str) -> String {
    // Prefer a canonical path so the same project gets the same ID even if
    // opened via symlinks / relative paths.
    let canonical = fs::canonicalize(path)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let digest = hasher.finalize();

    // Keep IDs short (matches legacy 16-hex format) while remaining stable.
    digest.iter().take(8).map(|b| format!("{:02x}", b)).collect()
}

fn legacy_project_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Get the ACE data directory
fn get_ace_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set")?;
    let ace_dir = PathBuf::from(home).join(".config/nocur/ace");
    Ok(ace_dir)
}

/// Get the playbooks directory
fn get_playbooks_dir() -> Result<PathBuf, String> {
    let dir = get_ace_dir()?.join("playbooks");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create playbooks dir: {}", e))?;
    Ok(dir)
}

/// Get the reflections directory
fn get_reflections_dir() -> Result<PathBuf, String> {
    let dir = get_ace_dir()?.join("reflections");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create reflections dir: {}", e))?;
    Ok(dir)
}

/// Get the config file path
fn get_config_path() -> Result<PathBuf, String> {
    let ace_dir = get_ace_dir()?;
    fs::create_dir_all(&ace_dir).map_err(|e| format!("Failed to create ACE dir: {}", e))?;
    Ok(ace_dir.join("config.json"))
}

/// Load ACE configuration
pub fn load_ace_config() -> ACEConfig {
    let path = match get_config_path() {
        Ok(p) => p,
        Err(_) => return ACEConfig::default(),
    };

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => ACEConfig::default(),
    }
}

/// Save ACE configuration
pub fn save_ace_config(config: &ACEConfig) -> Result<(), String> {
    let path = get_config_path()?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

/// Load a playbook for a project
pub fn load_playbook(project_path: &str) -> Result<Option<Playbook>, String> {
    let project_id = generate_project_id(project_path);
    let playbooks_dir = get_playbooks_dir()?;
    let path = playbooks_dir.join(format!("{}.json", project_id));

    if !path.exists() {
        // Backward compatibility: migrate legacy DefaultHasher-based IDs.
        let legacy_id = legacy_project_id(project_path);
        let legacy_path = playbooks_dir.join(format!("{}.json", legacy_id));
        if legacy_path.exists() {
            let content = fs::read_to_string(&legacy_path)
                .map_err(|e| format!("Failed to read playbook: {}", e))?;
            let mut playbook: Playbook = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse playbook: {}", e))?;

            playbook.project_id = project_id.clone();
            playbook.project_path = project_path.to_string();
            for bullet in &mut playbook.bullets {
                bullet.project_id = project_id.clone();
            }

            save_playbook(&playbook)?;
            let _ = fs::remove_file(&legacy_path);
            return Ok(Some(playbook));
        }

        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read playbook: {}", e))?;
    let playbook: Playbook = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse playbook: {}", e))?;

    Ok(Some(playbook))
}

/// Save a playbook
pub fn save_playbook(playbook: &Playbook) -> Result<(), String> {
    let playbooks_dir = get_playbooks_dir()?;
    let path = playbooks_dir.join(format!("{}.json", playbook.project_id));

    let content = serde_json::to_string_pretty(playbook)
        .map_err(|e| format!("Failed to serialize playbook: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write playbook: {}", e))?;

    Ok(())
}

/// Create a new playbook for a project
pub fn create_playbook(project_path: &str) -> Result<Playbook, String> {
    let config = load_ace_config();
    let project_id = generate_project_id(project_path);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let playbook = Playbook {
        project_id,
        project_path: project_path.to_string(),
        ace_enabled: config.enabled,
        max_bullets: config.default_max_bullets,
        max_tokens: config.default_max_tokens,
        bullets: vec![],
        created_at: now,
        updated_at: now,
    };

    save_playbook(&playbook)?;
    Ok(playbook)
}

/// Get or create a playbook for a project
pub fn get_or_create_playbook(project_path: &str) -> Result<Playbook, String> {
    match load_playbook(project_path)? {
        Some(playbook) => Ok(playbook),
        None => create_playbook(project_path),
    }
}

/// Generate a new bullet ID
fn generate_bullet_id(section: &BulletSection) -> String {
    let prefix = match section {
        BulletSection::StrategiesAndHardRules => "strat",
        BulletSection::UsefulCodeSnippets => "code",
        BulletSection::TroubleshootingAndPitfalls => "trou",
        BulletSection::ApisToUseForSpecificInformation => "apis",
        BulletSection::VerificationChecklist => "veri",
        BulletSection::DomainGlossary => "doma",
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let random: u32 = rand::random();
    format!("{}-{:x}{:04x}", prefix, timestamp % 0xFFFFFF, random % 0xFFFF)
}

/// Add a bullet to a playbook
pub fn add_bullet(
    project_path: &str,
    section: BulletSection,
    content: String,
) -> Result<Bullet, String> {
    let mut playbook = get_or_create_playbook(project_path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let bullet = Bullet {
        id: generate_bullet_id(&section),
        project_id: playbook.project_id.clone(),
        section,
        content,
        helpful_count: 0,
        harmful_count: 0,
        neutral_count: 0,
        created_at: now,
        updated_at: now,
        last_used_at: None,
        active: true,
    };

    playbook.bullets.push(bullet.clone());
    playbook.updated_at = now;
    save_playbook(&playbook)?;

    Ok(bullet)
}

/// Update a bullet's content
pub fn update_bullet(
    project_path: &str,
    bullet_id: &str,
    content: String,
) -> Result<Bullet, String> {
    let mut playbook = get_or_create_playbook(project_path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let bullet = playbook
        .bullets
        .iter_mut()
        .find(|b| b.id == bullet_id)
        .ok_or_else(|| format!("Bullet not found: {}", bullet_id))?;

    bullet.content = content;
    bullet.updated_at = now;
    let updated = bullet.clone();

    playbook.updated_at = now;
    save_playbook(&playbook)?;

    Ok(updated)
}

/// Delete a bullet (actually deactivates it)
pub fn delete_bullet(project_path: &str, bullet_id: &str) -> Result<(), String> {
    let mut playbook = get_or_create_playbook(project_path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let bullet = playbook
        .bullets
        .iter_mut()
        .find(|b| b.id == bullet_id)
        .ok_or_else(|| format!("Bullet not found: {}", bullet_id))?;

    bullet.active = false;
    bullet.updated_at = now;

    playbook.updated_at = now;
    save_playbook(&playbook)?;

    Ok(())
}

/// Update bullet tags (helpful/harmful/neutral counts)
pub fn update_bullet_tags(
    project_path: &str,
    tags: Vec<BulletTagEntry>,
) -> Result<(), String> {
    let mut playbook = get_or_create_playbook(project_path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    for tag_entry in tags {
        if let Some(bullet) = playbook.bullets.iter_mut().find(|b| b.id == tag_entry.id) {
            match tag_entry.tag {
                BulletTag::Helpful => bullet.helpful_count += 1,
                BulletTag::Harmful => bullet.harmful_count += 1,
                BulletTag::Neutral => bullet.neutral_count += 1,
            }
            bullet.last_used_at = Some(now);
            bullet.updated_at = now;
        }
    }

    playbook.updated_at = now;
    save_playbook(&playbook)?;

    Ok(())
}

/// Toggle ACE enabled for a project
pub fn set_ace_enabled(project_path: &str, enabled: bool) -> Result<(), String> {
    let mut playbook = get_or_create_playbook(project_path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    playbook.ace_enabled = enabled;
    playbook.updated_at = now;
    save_playbook(&playbook)?;

    Ok(())
}

/// Load reflections for a project
pub fn load_reflections(project_path: &str) -> Result<Vec<StoredReflection>, String> {
    let project_id = generate_project_id(project_path);
    let reflections_dir = get_reflections_dir()?;
    let path = reflections_dir.join(format!("{}.json", project_id));

    if !path.exists() {
        // Backward compatibility: migrate legacy DefaultHasher-based IDs.
        let legacy_id = legacy_project_id(project_path);
        let legacy_path = reflections_dir.join(format!("{}.json", legacy_id));
        if legacy_path.exists() {
            let content = fs::read_to_string(&legacy_path)
                .map_err(|e| format!("Failed to read reflections: {}", e))?;
            let mut log: ReflectionsLog = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse reflections: {}", e))?;

            log.project_id = project_id.clone();
            for reflection in &mut log.reflections {
                reflection.project_id = project_id.clone();
            }

            let migrated = log.reflections.clone();
            let content = serde_json::to_string_pretty(&log)
                .map_err(|e| format!("Failed to serialize reflections: {}", e))?;
            fs::write(&path, content)
                .map_err(|e| format!("Failed to write reflections: {}", e))?;
            let _ = fs::remove_file(&legacy_path);
            return Ok(migrated);
        }

        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read reflections: {}", e))?;
    let log: ReflectionsLog = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse reflections: {}", e))?;

    Ok(log.reflections)
}

/// Save a reflection
pub fn save_reflection(project_path: &str, reflection: StoredReflection) -> Result<(), String> {
    let project_id = generate_project_id(project_path);
    let reflections_dir = get_reflections_dir()?;
    let path = reflections_dir.join(format!("{}.json", project_id));

    let mut log = if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read reflections: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse reflections: {}", e))?
    } else {
        ReflectionsLog {
            project_id: project_id.clone(),
            reflections: vec![],
        }
    };

    log.reflections.push(reflection);

    let content = serde_json::to_string_pretty(&log)
        .map_err(|e| format!("Failed to serialize reflections: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write reflections: {}", e))?;

    Ok(())
}

/// List all playbook project IDs
pub fn list_playbooks() -> Result<Vec<String>, String> {
    let playbooks_dir = get_playbooks_dir()?;

    let entries = fs::read_dir(&playbooks_dir)
        .map_err(|e| format!("Failed to read playbooks dir: {}", e))?;

    let mut project_ids = vec![];
    for entry in entries {
        if let Ok(entry) = entry {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".json") {
                    project_ids.push(name.trim_end_matches(".json").to_string());
                }
            }
        }
    }

    Ok(project_ids)
}

// Needed for random bullet ID generation
mod rand {
    pub fn random<T: Default + From<u32>>() -> T {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos();
        T::from(nanos)
    }
}
