use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter,
};

use crate::project::load_recent_projects;

/// Create the application menu
pub fn create_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    // App submenu (macOS only shows this)
    let app_menu = SubmenuBuilder::new(app, "Nocur")
        .item(&PredefinedMenuItem::about(app, Some("About Nocur"), None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    // File submenu
    let new_project = MenuItemBuilder::with_id("new-project", "New Project...")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    
    let open_project = MenuItemBuilder::with_id("open-project", "Open Project...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    // Build recent projects submenu
    let recent_menu = build_recent_projects_submenu(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_project)
        .item(&open_project)
        .item(&recent_menu)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Edit submenu
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // View submenu
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // Window submenu
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Help submenu
    let help_menu = SubmenuBuilder::new(app, "Help")
        .build()?;

    // Build the complete menu
    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

/// Build the "Open Recent" submenu
fn build_recent_projects_submenu(app: &AppHandle) -> Result<tauri::menu::Submenu<tauri::Wry>, tauri::Error> {
    let mut recent_builder = SubmenuBuilder::new(app, "Open Recent");
    
    let projects = load_recent_projects();
    
    if projects.is_empty() {
        let no_recent = MenuItemBuilder::with_id("no-recent", "No Recent Projects")
            .enabled(false)
            .build(app)?;
        recent_builder = recent_builder.item(&no_recent);
    } else {
        for (i, project) in projects.iter().take(10).enumerate() {
            // Shorten path for display (replace home dir with ~)
            let display_path = shorten_path(&project.path);
            let item = MenuItemBuilder::with_id(
                format!("recent-project-{}", i),
                &format!("{} - {}", project.name, display_path)
            ).build(app)?;
            recent_builder = recent_builder.item(&item);
        }
        
        recent_builder = recent_builder.separator();
        
        let clear_recent = MenuItemBuilder::with_id("clear-recent", "Clear Recent Projects")
            .build(app)?;
        recent_builder = recent_builder.item(&clear_recent);
    }
    
    recent_builder.build()
}

/// Shorten a path for display (replace home dir with ~)
fn shorten_path(path: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        if path.starts_with(home_str.as_ref()) {
            return path.replacen(home_str.as_ref(), "~", 1);
        }
    }
    path.to_string()
}

/// Handle menu events
pub fn handle_menu_event(app: &AppHandle, event_id: &str) {
    match event_id {
        "new-project" => {
            let _ = app.emit("menu-event", "new-project");
        }
        "open-project" => {
            let _ = app.emit("menu-event", "open-project");
        }
        "clear-recent" => {
            let _ = crate::project::clear_recent_projects();
            // Rebuild menu to reflect cleared state
            if let Ok(menu) = create_menu(app) {
                let _ = app.set_menu(menu);
            }
            let _ = app.emit("recent-projects-updated", ());
        }
        id if id.starts_with("recent-project-") => {
            // Extract index and get project
            if let Ok(index) = id.replace("recent-project-", "").parse::<usize>() {
                let projects = load_recent_projects();
                if let Some(project) = projects.get(index) {
                    let _ = app.emit("open-recent-project", project.path.clone());
                }
            }
        }
        _ => {}
    }
}

/// Update the recent projects menu
pub fn update_recent_menu(app: &AppHandle) {
    if let Ok(menu) = create_menu(app) {
        let _ = app.set_menu(menu);
    }
}
