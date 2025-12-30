use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetMetadata {
    pub id: String,
    pub name: String,
    pub author: String,
    pub publish_date: String,
    pub rating: f32,
    pub rating_count: i32,
    pub license: String,
    pub r#type: String,
    pub category: String,
    pub downloads: i32,
    pub file_size: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub version: String,
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submission_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_edited_after_publish: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalAsset {
    pub metadata: AssetMetadata,
    pub file_path: String,
    pub downloaded_at: String,
    pub cached: bool,
    pub is_edited: bool,
    pub original_id: Option<String>,
}

pub fn get_app_data_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let app_data = home.join(".buildhuman");

    // Create directory structure
    fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    fs::create_dir_all(app_data.join("cache")).map_err(|e| e.to_string())?;
    fs::create_dir_all(app_data.join("cache/models")).map_err(|e| e.to_string())?;
    fs::create_dir_all(app_data.join("cache/environment")).map_err(|e| e.to_string())?;
    fs::create_dir_all(app_data.join("library")).map_err(|e| e.to_string())?;
    fs::create_dir_all(app_data.join("created-assets")).map_err(|e| e.to_string())?;

    Ok(app_data)
}

#[tauri::command]
pub async fn download_asset(
    app: AppHandle,
    asset_id: String,
    api_url: String,
) -> Result<LocalAsset, String> {
    // Get app data directory
    let app_data = get_app_data_dir(&app)?;

    // Fetch asset metadata
    let metadata_url = format!("{}/api/assets/{}", api_url, asset_id);
    let client = reqwest::Client::new();

    let metadata: AssetMetadata = client
        .get(&metadata_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch metadata: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;

    // Download asset file
    let download_url = format!("{}/api/assets/{}/download", api_url, asset_id);
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download asset: {}", e))?;

    // Determine file extension from content-disposition or metadata
    let file_ext = if let Some(content_disp) = response.headers().get("content-disposition") {
        content_disp
            .to_str()
            .ok()
            .and_then(|s| s.split("filename=\"").nth(1))
            .and_then(|s| s.split('"').next())
            .and_then(|name| name.split('.').last())
            .unwrap_or("glb")
    } else {
        "glb"
    };

    // Save to cache directory
    let cache_dir = app_data.join("cache").join(&metadata.r#type);
    let file_name = format!(
        "{}_{}.{}",
        asset_id,
        metadata.name.replace(" ", "_"),
        file_ext
    );
    let file_path = cache_dir.join(&file_name);

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read asset bytes: {}", e))?;

    fs::write(&file_path, bytes).map_err(|e| format!("Failed to write asset file: {}", e))?;

    // Save metadata
    let metadata_path = cache_dir.join(format!("{}_metadata.json", asset_id));
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(&metadata_path, metadata_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    // Create local asset record
    let local_asset = LocalAsset {
        metadata,
        file_path: file_path.to_string_lossy().to_string(),
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        cached: true,
        is_edited: false,
        original_id: None,
    };

    Ok(local_asset)
}

#[tauri::command]
pub fn list_cached_assets(app: AppHandle) -> Result<Vec<LocalAsset>, String> {
    let app_data = get_app_data_dir(&app)?;
    let cache_dir = app_data.join("cache");
    let created_assets_dir = app_data.join("created-assets");

    let mut assets = Vec::new();

    // Helper function to scan a directory for assets
    let scan_directory = |dir_path: &std::path::Path, is_edited: bool| -> Result<Vec<LocalAsset>, String> {
        let mut found_assets = Vec::new();

        if !dir_path.exists() {
            return Ok(found_assets);
        }

        let entries = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            // Look for metadata.json files (created assets) or _metadata.json files (cached assets)
            let is_metadata = path.extension().and_then(|s| s.to_str()) == Some("json")
                && path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s.ends_with("metadata.json"))
                    .unwrap_or(false);

            if is_metadata {
                let metadata_json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                let metadata: AssetMetadata =
                    serde_json::from_str(&metadata_json).map_err(|e| e.to_string())?;

                // Find corresponding asset file
                let asset_id = &metadata.id;
                let asset_files: Vec<_> = fs::read_dir(dir_path)
                    .map_err(|e| e.to_string())?
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path()
                            .file_name()
                            .and_then(|s| s.to_str())
                            .map(|s| s.starts_with(asset_id) && !s.ends_with("metadata.json") && s.ends_with(".glb"))
                            .unwrap_or(false)
                    })
                    .collect();

                if let Some(asset_file) = asset_files.first() {
                    let original_id = if is_edited {
                        // Handle both _editing and _edited_timestamp patterns
                        if asset_id.ends_with("_editing") {
                            Some(asset_id.replace("_editing", ""))
                        } else if asset_id.contains("_edited_") {
                            Some(asset_id.split("_edited_").next().unwrap_or(asset_id).to_string())
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    found_assets.push(LocalAsset {
                        metadata,
                        file_path: asset_file.path().to_string_lossy().to_string(),
                        downloaded_at: "unknown".to_string(),
                        cached: true,
                        is_edited,
                        original_id,
                    });
                }
            }
        }

        Ok(found_assets)
    };

    // Scan cache directories for downloaded assets
    for type_dir in &["models", "environment"] {
        let dir_path = cache_dir.join(type_dir);
        assets.extend(scan_directory(&dir_path, false)?);
    }

    // Scan created-assets directory for edited/forked assets
    assets.extend(scan_directory(&created_assets_dir, true)?);

    Ok(assets)
}

#[tauri::command]
pub fn get_cached_asset(app: AppHandle, asset_id: String) -> Result<Option<LocalAsset>, String> {
    let cached = list_cached_assets(app)?;
    Ok(cached.into_iter().find(|a| a.metadata.id == asset_id))
}

#[tauri::command]
pub fn delete_cached_asset(app: AppHandle, asset_id: String) -> Result<(), String> {
    let app_data = get_app_data_dir(&app)?;
    let cache_dir = app_data.join("cache");

    // Check if asset is required before deletion
    let cached = list_cached_assets(app.clone())?;
    if let Some(asset) = cached.iter().find(|a| a.metadata.id == asset_id) {
        if asset.metadata.required {
            return Err("Cannot delete required asset".to_string());
        }
    }

    // Search in all type directories
    for type_dir in &["models", "environment"] {
        let dir_path = cache_dir.join(type_dir);
        if !dir_path.exists() {
            continue;
        }

        let entries = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                if file_name.starts_with(&asset_id) {
                    fs::remove_file(path).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_app_data_path(app: AppHandle) -> Result<String, String> {
    get_app_data_dir(&app).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn clear_cache(app: AppHandle) -> Result<(), String> {
    let app_data = get_app_data_dir(&app)?;
    let cache_dir = app_data.join("cache");

    // Get list of cached assets
    let cached_assets = list_cached_assets(app.clone())?;

    // Delete non-required assets
    for asset in cached_assets {
        if !asset.metadata.required {
            // Delete asset files
            for type_dir in &["models", "environment"] {
                let dir_path = cache_dir.join(type_dir);
                if !dir_path.exists() {
                    continue;
                }

                let entries = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;

                for entry in entries {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let path = entry.path();

                    if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                        if file_name.starts_with(&asset.metadata.id) {
                            fs::remove_file(path).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequiredAssetsStatus {
    pub total: usize,
    pub downloaded: usize,
    pub updated: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn check_required_assets(
    app: AppHandle,
    api_url: String,
) -> Result<RequiredAssetsStatus, String> {
    let client = reqwest::Client::new();

    // Fetch required assets from API
    let required_url = format!("{}/api/assets/required/list", api_url);
    let required_assets: Vec<AssetMetadata> = client
        .get(&required_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch required assets: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse required assets: {}", e))?;

    let total = required_assets.len();
    let mut downloaded = 0;
    let mut updated = 0;
    let mut errors = Vec::new();

    // Get currently cached assets
    let cached_assets = list_cached_assets(app.clone())?;

    // Process each required asset
    for required_asset in required_assets {
        // Check if we have this asset cached
        let cached = cached_assets
            .iter()
            .find(|a| a.metadata.id == required_asset.id);

        let needs_download = if let Some(cached_asset) = cached {
            // Check if version is outdated
            cached_asset.metadata.version != required_asset.version
        } else {
            // Not cached at all
            true
        };

        if needs_download {
            // Download or update the asset
            match download_asset(app.clone(), required_asset.id.clone(), api_url.clone()).await {
                Ok(_) => {
                    if cached.is_some() {
                        updated += 1;
                    } else {
                        downloaded += 1;
                    }
                }
                Err(e) => {
                    errors.push(format!("Failed to download {}: {}", required_asset.name, e));
                }
            }
        }
    }

    Ok(RequiredAssetsStatus {
        total,
        downloaded,
        updated,
        errors,
    })
}

#[tauri::command]
pub fn create_editable_copy(app: AppHandle, asset_id: String) -> Result<LocalAsset, String> {
    let app_data = get_app_data_dir(&app)?;

    // Find the original asset in cache
    let cache_dir = app_data.join("cache");
    let mut original_metadata: Option<AssetMetadata> = None;
    let mut original_file_path: Option<PathBuf> = None;

    for type_dir in ["models", "environment"] {
        let type_cache_dir = cache_dir.join(type_dir);
        if !type_cache_dir.exists() {
            continue;
        }

        let metadata_path = type_cache_dir.join(format!("{}_metadata.json", asset_id));
        if metadata_path.exists() {
            let metadata_content = fs::read_to_string(&metadata_path)
                .map_err(|e| format!("Failed to read metadata: {}", e))?;
            let metadata: AssetMetadata = serde_json::from_str(&metadata_content)
                .map_err(|e| format!("Failed to parse metadata: {}", e))?;

            // Find the asset file
            if let Ok(entries) = fs::read_dir(&type_cache_dir) {
                let asset_files: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.file_name()
                            .to_str()
                            .map(|s| s.starts_with(&asset_id) && !s.ends_with("_metadata.json"))
                            .unwrap_or(false)
                    })
                    .collect();

                if let Some(asset_file) = asset_files.first() {
                    original_metadata = Some(metadata);
                    original_file_path = Some(asset_file.path());
                    break;
                }
            }
        }
    }

    let original_metadata = original_metadata.ok_or("Original asset not found in cache")?;
    let original_file_path = original_file_path.ok_or("Original asset file not found")?;

    // Create new ID for the edited version
    let edited_id = format!("{}_edited_{}", asset_id, chrono::Utc::now().timestamp());

    // Copy file to created-assets folder
    let created_assets_dir = app_data.join("created-assets");
    fs::create_dir_all(&created_assets_dir).map_err(|e| e.to_string())?;

    let file_ext = original_file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("glb");
    let new_file_name = format!("{}_{}.{}", edited_id, original_metadata.name.replace(" ", "_"), file_ext);
    let new_file_path = created_assets_dir.join(&new_file_name);

    fs::copy(&original_file_path, &new_file_path)
        .map_err(|e| format!("Failed to copy asset file: {}", e))?;

    // Load settings to get author name
    let settings = crate::settings::get_app_settings(app.clone())?;

    // Create new metadata with edited flag
    let mut new_metadata = original_metadata.clone();
    new_metadata.id = edited_id.clone();
    // Keep the original name clean (no "edited" suffix - we have the badge for that)
    // Set author to the user's configured name
    if !settings.author_name.is_empty() {
        new_metadata.author = settings.author_name;
    }

    // Save metadata
    let metadata_path = created_assets_dir.join(format!("{}_metadata.json", edited_id));
    let metadata_json = serde_json::to_string_pretty(&new_metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(&metadata_path, metadata_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    // Create local asset record
    let local_asset = LocalAsset {
        metadata: new_metadata,
        file_path: new_file_path.to_string_lossy().to_string(),
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        cached: false,
        is_edited: true,
        original_id: Some(asset_id),
    };

    Ok(local_asset)
}

#[tauri::command]
pub fn update_asset_metadata(app: AppHandle, asset_id: String, metadata: AssetMetadata) -> Result<(), String> {
    let app_data = get_app_data_dir(&app)?;
    let created_assets_dir = app_data.join("created-assets");

    let metadata_path = created_assets_dir.join(format!("{}_metadata.json", asset_id));
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(&metadata_path, metadata_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn revert_to_original(app: AppHandle, edited_id: String) -> Result<(), String> {
    let app_data = get_app_data_dir(&app)?;
    let created_assets_dir = app_data.join("created-assets");

    println!("Cleaning up edited asset: {}", edited_id);

    // Delete the edited asset files (.glb, .blend, and metadata)
    if let Ok(entries) = fs::read_dir(&created_assets_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let file_name = entry.file_name();
            if let Some(name_str) = file_name.to_str() {
                if name_str.starts_with(&edited_id) {
                    let path = entry.path();
                    println!("  → Deleting: {:?}", path);
                    fs::remove_file(&path)
                        .map_err(|e| format!("Failed to delete file {:?}: {}", path, e))?;
                }
            }
        }
    }

    println!("✓ Cleanup complete");
    Ok(())
}







