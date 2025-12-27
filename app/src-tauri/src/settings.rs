use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub author_name: String,
    pub default_editor: String,
    pub default_editor_type: String,  // "blender", "maya", etc.
    pub custom_assets_folder: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            author_name: String::new(),
            default_editor: String::new(),
            default_editor_type: String::new(),
            custom_assets_folder: String::new(),
        }
    }
}

fn get_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = crate::asset_manager::get_app_data_dir(app)?;
    Ok(app_data.join("settings.json"))
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    let settings_path = get_settings_path(&app)?;

    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        let settings: AppSettings = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse settings: {}", e))?;
        Ok(settings)
    } else {
        // Return default settings with created-assets path set
        let app_data = crate::asset_manager::get_app_data_dir(&app)?;
        let default_assets_path = app_data.join("created-assets");

        let settings = AppSettings {
            custom_assets_folder: default_assets_path.to_string_lossy().to_string(),
            ..AppSettings::default()
        };

        Ok(settings)
    }
}

#[tauri::command]
pub fn save_app_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let settings_path = get_settings_path(&app)?;

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, content).map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}
