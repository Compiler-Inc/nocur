use std::path::{Path, PathBuf};

const REPO_MARKER: &str = "src-tauri/Cargo.toml";

fn find_repo_root_from(start: &Path) -> Option<PathBuf> {
    for dir in start.ancestors() {
        if dir.join(REPO_MARKER).exists() {
            return Some(dir.to_path_buf());
        }
    }
    None
}

pub(crate) fn resolve_repo_root() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("NOCUR_REPO_ROOT") {
        let path = PathBuf::from(root);
        if path.join(REPO_MARKER).exists() {
            return Some(path);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest_dir.parent() {
        if root.join(REPO_MARKER).exists() {
            return Some(root.to_path_buf());
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.parent().and_then(find_repo_root_from) {
            return Some(root);
        }
        if let Some(root) = find_repo_root_from(&exe) {
            return Some(root);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if let Some(root) = find_repo_root_from(&cwd) {
            return Some(root);
        }
    }

    None
}

pub(crate) fn claude_service_entry(repo_root: &Path) -> PathBuf {
    repo_root.join("claude-service/dist/index.js")
}

pub(crate) fn resolve_claude_service_entry() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("NOCUR_CLAUDE_SERVICE_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }

    resolve_repo_root()
        .map(|root| claude_service_entry(&root))
        .filter(|p| p.exists())
}

pub(crate) fn nocur_swift_release_binary(repo_root: &Path) -> PathBuf {
    repo_root.join("nocur-swift/.build/release/nocur-swift")
}

pub(crate) fn resolve_nocur_swift_binary() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("NOCUR_SWIFT_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }

    resolve_repo_root()
        .map(|root| nocur_swift_release_binary(&root))
        .filter(|p| p.exists())
}

