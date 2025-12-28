use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Emitter};

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

pub fn get_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
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
pub fn cleanup_blend_files(app: AppHandle) -> Result<(), String> {
    let app_data = get_app_data_dir(&app)?;
    let created_assets_dir = app_data.join("created-assets");

    println!("Cleaning up orphaned files from previous session...");
    let mut blend_count = 0;

    if let Ok(entries) = fs::read_dir(&created_assets_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                // Clean up .blend files (temporary working files)
                if ext == "blend" {
                    println!("  → Deleting .blend: {:?}", path.file_name().unwrap());
                    if fs::remove_file(&path).is_ok() {
                        blend_count += 1;
                    }
                }
            }
        }
    }

    if blend_count > 0 {
        println!("✓ Cleaned up {} temporary .blend files", blend_count);
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

    // Auto-capture screenshot on first save
    match capture_asset_screenshot(
        app.clone(),
        edited_id.clone(),
        new_file_path.to_string_lossy().to_string(),
    ) {
        Ok(thumbnail_filename) => {
            new_metadata.thumbnail_url = Some(thumbnail_filename);
            println!("✓ Auto-captured screenshot for new editable copy");
        }
        Err(e) => {
            eprintln!("⚠ Warning: Failed to auto-capture screenshot: {}", e);
            // Continue without screenshot - not a critical error
        }
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

#[tauri::command]
pub fn open_in_blender(app: AppHandle, file_path: String, asset_id: String) -> Result<(), String> {
    use std::process::Command;

    let blender_path = "/Applications/Blender.app";
    println!("Using Blender at: {}", blender_path);

    // Create .blend file path (same location as GLB, but .blend extension)
    let blend_path = file_path.replace(".glb", ".blend");

    // Simple script: just import GLB and save as .blend
    let import_script = format!(
        "import bpy\nbpy.ops.wm.read_homefile(use_empty=True)\nbpy.ops.import_scene.gltf(filepath='{}')\nbpy.ops.wm.save_as_mainfile(filepath='{}')\nprint('BuildHuman: Ready to edit - changes will auto-save to GLB')",
        file_path.replace("'", "\\'"),
        blend_path.replace("'", "\\'")
    );

    println!("Opening Blender...");

    #[cfg(target_os = "macos")]
    {
        let blender_bin = format!("{}/Contents/MacOS/Blender", blender_path);
        Command::new(blender_bin)
            .arg("--python-expr")
            .arg(&import_script)
            .spawn()
            .map_err(|e| format!("Failed to open Blender: {}", e))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new(&blender_path)
            .arg("--python-expr")
            .arg(&import_script)
            .spawn()
            .map_err(|e| format!("Failed to open Blender: {}", e))?;
    }

    // Watch the .blend file (not the GLB) and export when it changes
    println!("Starting file watcher for .blend file: {}", blend_path);
    watch_blend_and_export(app, blend_path, file_path, asset_id)?;

    Ok(())
}

#[tauri::command]
pub fn open_in_editor(
    app: AppHandle,
    file_path: String,
    editor_path: String,
    asset_id: Option<String>,
) -> Result<(), String> {
    use std::process::Command;

    // Check if this is Blender and the file is GLB/GLTF
    let is_blender = editor_path.to_lowercase().contains("blender");
    let is_gltf = file_path.to_lowercase().ends_with(".glb")
        || file_path.to_lowercase().ends_with(".gltf");

    if is_blender && is_gltf {
        // For Blender with GLTF/GLB files, use import command + auto-export script

        // Read the auto-export template
        let template_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get exe path: {}", e))?
            .parent()
            .ok_or("Failed to get parent directory")?
            .parent()
            .ok_or("Failed to get Resources directory")?
            .join("blender_auto_export.py");

        let auto_export_script = std::fs::read_to_string(&template_path)
            .unwrap_or_else(|_| {
                // Fallback: inline the auto-export script if template not found
                r#"
import bpy
from bpy.app.handlers import persistent

EXPORT_PATH = "{export_path}"

@persistent
def auto_export_glb(dummy):
    try:
        print(f"BuildHuman: Auto-exporting GLB to {EXPORT_PATH}")
        bpy.ops.export_scene.gltf(
            filepath=EXPORT_PATH,
            export_format='GLB',
            export_keep_originals=False,
            export_texcoords=True,
            export_normals=True,
            export_materials='EXPORT',
            export_colors=True,
            export_cameras=False,
            export_lights=False,
            export_apply=True
        )
        print("BuildHuman: GLB export complete!")
    except Exception as e:
        print(f"BuildHuman: Export failed: {e}")

if auto_export_glb not in bpy.app.handlers.save_post:
    bpy.app.handlers.save_post.append(auto_export_glb)
    print(f"BuildHuman: Auto-export enabled for {EXPORT_PATH}")
"#.to_string()
            });

        // Replace the {export_path} placeholder with actual path
        let auto_export_with_path = auto_export_script.replace("{export_path}", &file_path.replace("\\", "\\\\"));

        // Create .blend file path (same location as GLB, but .blend extension)
        let blend_path = file_path.replace(".glb", ".blend");

        // Combine import script + auto-export script + auto-save .blend file
        let combined_script = format!(
            "import bpy\nbpy.ops.wm.read_homefile(use_empty=True)\nbpy.ops.import_scene.gltf(filepath='{}')\nbpy.ops.wm.save_as_mainfile(filepath='{}')\nprint('BuildHuman: .blend file created at {}')\n\n{}",
            file_path.replace("'", "\\'"),
            blend_path.replace("'", "\\'"),
            blend_path.replace("'", "\\'"),
            auto_export_with_path
        );

        #[cfg(target_os = "macos")]
        {
            // Extract the blender binary path from the .app bundle
            let blender_bin = if editor_path.ends_with(".app") {
                format!("{}/Contents/MacOS/Blender", editor_path)
            } else {
                editor_path.clone()
            };

            Command::new(blender_bin)
                .arg("--python-expr")
                .arg(&combined_script)
                .spawn()
                .map_err(|e| format!("Failed to open Blender: {}", e))?;
        }

        #[cfg(not(target_os = "macos"))]
        {
            Command::new(&editor_path)
                .arg("--python-expr")
                .arg(&combined_script)
                .spawn()
                .map_err(|e| format!("Failed to open Blender: {}", e))?;
        }

        // Start watching the file for changes if asset_id is provided
        if let Some(id) = asset_id {
            println!("Starting file watcher for asset: {}", id);
            watch_asset_file(app, file_path.clone(), id)?;
        }
    } else {
        // Regular file opening for other editors or file types
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg("-a")
                .arg(&editor_path)
                .arg(&file_path)
                .spawn()
                .map_err(|e| format!("Failed to open editor: {}", e))?;
        }

        #[cfg(target_os = "windows")]
        {
            Command::new(&editor_path)
                .arg(&file_path)
                .spawn()
                .map_err(|e| format!("Failed to open editor: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            Command::new(&editor_path)
                .arg(&file_path)
                .spawn()
                .map_err(|e| format!("Failed to open editor: {}", e))?;
        }
    }

    Ok(())
}

fn watch_blend_and_export(
    app: AppHandle,
    blend_path: String,
    glb_path: String,
    asset_id: String,
) -> Result<(), String> {
    use notify::{Watcher, RecursiveMode};
    use notify_debouncer_mini::new_debouncer;
    use std::time::Duration;
    use std::path::Path;
    use std::process::Command;

    println!("Setting up watcher for .blend file: {}", blend_path);

    // Spawn a thread to handle the watching
    std::thread::spawn(move || {
        // Wait for .blend file to be created (up to 30 seconds)
        println!("Waiting for .blend file to be created...");
        let mut found = false;
        for i in 0..300 {
            if Path::new(&blend_path).exists() {
                println!("✓ Found .blend file: {}", blend_path);
                found = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
            if i % 10 == 0 {
                println!("Still waiting for .blend file... ({}s)", i / 10);
            }
        }

        if !found {
            eprintln!("✗ Timeout: .blend file was not created");
            return;
        }

        // Now create the watcher
        let (tx, rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_millis(1000), tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("Failed to create debouncer: {}", e);
                return;
            }
        };

        // Start watching the .blend file
        if let Err(e) = debouncer.watcher().watch(Path::new(&blend_path), RecursiveMode::NonRecursive) {
            eprintln!("Failed to watch .blend file: {}", e);
            return;
        }

        println!("✓ Now watching .blend file for changes");

        // Listen for changes
        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    for event in events {
                        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                        println!("✓ .blend file changed: {:?}", event.path);
                        println!("→ Exporting GLB in background...");

                        let export_script = format!(
                            "import bpy; bpy.ops.wm.open_mainfile(filepath='{}'); bpy.ops.export_scene.gltf(filepath='{}', export_format='GLB', export_apply=True); print('✓ Export complete')",
                            blend_path.replace("'", "\\'"),
                            glb_path.replace("'", "\\'")
                        );

                        let blender_bin = "/Applications/Blender.app/Contents/MacOS/Blender";
                        match Command::new(blender_bin)
                            .arg("--background")
                            .arg("--python-expr")
                            .arg(&export_script)
                            .output()
                        {
                            Ok(output) => {
                                if output.status.success() {
                                    println!("✓ GLB export successful!");
                                    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

                                    // Emit event to frontend
                                    if let Err(e) = app.emit("asset-file-changed", asset_id.clone()) {
                                        eprintln!("Failed to emit event: {}", e);
                                    }
                                } else {
                                    eprintln!("✗ GLB export failed!");
                                    eprintln!("stderr: {}", String::from_utf8_lossy(&output.stderr));
                                }
                            }
                            Err(e) => {
                                eprintln!("✗ Failed to run Blender: {}", e);
                            }
                        }
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("File watch error: {:?}", e);
                }
                Err(e) => {
                    eprintln!("Channel closed: {:?}", e);
                    break;
                }
            }
        }

        // Keep debouncer alive until thread exits
        drop(debouncer);
    });

    Ok(())
}

#[tauri::command]
pub fn watch_asset_file(app: AppHandle, file_path: String, asset_id: String) -> Result<(), String> {
    use notify::{Watcher, RecursiveMode};
    use notify_debouncer_mini::new_debouncer;
    use std::time::Duration;
    use std::path::Path;

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    // Create a debounced watcher (prevents rapid-fire events)
    let (tx, rx) = std::sync::mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {}", e))?;

    // Spawn a thread to listen for file changes
    let app_clone = app.clone();
    let asset_id_clone = asset_id.clone();

    std::thread::spawn(move || {
        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    // File was modified - emit event to frontend
                    for event in events {
                        println!("Asset file changed: {:?}", event.path);

                        // Emit to frontend
                        let _ = app_clone.emit("asset-file-changed", asset_id_clone.clone());
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("File watch error: {:?}", e);
                }
                Err(e) => {
                    eprintln!("Channel receive error: {:?}", e);
                    break; // Exit thread if channel is closed
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_watching_asset(asset_id: String) -> Result<(), String> {
    // Note: In a production app, you'd want to maintain a registry of watchers
    // and stop them properly. For now, watchers will stop when the app closes.
    println!("Stop watching asset: {}", asset_id);
    Ok(())
}

#[tauri::command]
pub fn set_asset_thumbnail(
    app: AppHandle,
    asset_id: String,
    thumbnail_path: String,
) -> Result<String, String> {
    println!("🖼️  Setting custom thumbnail for asset: {}", asset_id);
    println!("  Source: {}", thumbnail_path);

    let app_data = get_app_data_dir(&app)?;
    let created_assets_dir = app_data.join("created-assets");

    // Determine file extension
    let source_path = std::path::Path::new(&thumbnail_path);
    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");

    let thumbnail_filename = format!("{}_thumbnail.{}", asset_id, ext);
    let dest_path = created_assets_dir.join(&thumbnail_filename);

    println!("  Destination: {:?}", dest_path);

    // Copy the image file
    fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy thumbnail: {}", e))?;

    // Update metadata
    let metadata_path = created_assets_dir.join(format!("{}_metadata.json", asset_id));
    if metadata_path.exists() {
        let metadata_content = fs::read_to_string(&metadata_path)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let mut metadata: AssetMetadata = serde_json::from_str(&metadata_content)
            .map_err(|e| format!("Failed to parse metadata: {}", e))?;

        metadata.thumbnail_url = Some(thumbnail_filename.clone());

        let metadata_json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
        fs::write(&metadata_path, metadata_json)
            .map_err(|e| format!("Failed to write metadata: {}", e))?;

        println!("✓ Thumbnail set successfully: {}", thumbnail_filename);
        Ok(thumbnail_filename)
    } else {
        Err("Asset metadata not found".to_string())
    }
}

#[tauri::command]
pub fn get_asset_thumbnail(app: AppHandle, asset_id: String) -> Result<String, String> {
    let app_data = get_app_data_dir(&app)?;
    let created_assets_dir = app_data.join("created-assets");

    let metadata_path = created_assets_dir.join(format!("{}_metadata.json", asset_id));
    if metadata_path.exists() {
        let metadata_content = fs::read_to_string(&metadata_path)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let metadata: AssetMetadata = serde_json::from_str(&metadata_content)
            .map_err(|e| format!("Failed to parse metadata: {}", e))?;

        metadata.thumbnail_url.ok_or("No thumbnail set".to_string())
    } else {
        Err("Asset metadata not found".to_string())
    }
}

#[tauri::command]
pub fn capture_asset_screenshot(
    app: AppHandle,
    asset_id: String,
    glb_path: String,
) -> Result<String, String> {
    println!("📸 Capturing screenshot for asset: {}", asset_id);

    let app_data = get_app_data_dir(&app)?;
    let created_assets_dir = app_data.join("created-assets");
    let thumbnail_filename = format!("{}_thumbnail.png", asset_id);
    let thumbnail_path = created_assets_dir.join(&thumbnail_filename);

    println!("  GLB path: {}", glb_path);
    println!("  Thumbnail will be saved to: {:?}", thumbnail_path);

    // Create Blender script to render thumbnail
    let render_script = format!(
        r#"import bpy
import sys

# Clear scene
bpy.ops.wm.read_homefile(use_empty=True)

# Import GLB
print("Importing GLB: {}")
try:
    bpy.ops.import_scene.gltf(filepath='{}')
except Exception as e:
    print(f"Import failed: {{e}}")
    sys.exit(1)

# Set up camera to frame object
bpy.ops.object.camera_add(location=(3, -3, 2))
camera = bpy.context.object
camera.rotation_euler = (1.1, 0, 0.785)

# Add light
bpy.ops.object.light_add(type='SUN', location=(5, 5, 5))
light = bpy.context.object
light.data.energy = 1.5

# Set camera as active
bpy.context.scene.camera = camera

# Configure render settings
bpy.context.scene.render.filepath = '{}'
bpy.context.scene.render.resolution_x = 512
bpy.context.scene.render.resolution_y = 512
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.render.film_transparent = False

# Set background color
bpy.context.scene.world.use_nodes = True
bg = bpy.context.scene.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.1, 0.1, 0.1, 1.0)

# Render
print("Rendering...")
bpy.ops.render.render(write_still=True)
print("Render complete!")
"#,
        glb_path.replace("'", "\\'"),
        glb_path.replace("'", "\\'"),
        thumbnail_path.to_string_lossy().replace("'", "\\'")
    );

    // Execute Blender in background mode
    let blender_bin = "/Applications/Blender.app/Contents/MacOS/Blender";
    println!("  Executing Blender...");

    let output = Command::new(blender_bin)
        .arg("--background")
        .arg("--python-expr")
        .arg(&render_script)
        .output()
        .map_err(|e| format!("Failed to run Blender: {}", e))?;

    // Check if successful
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("Blender stderr: {}", stderr);
        return Err(format!("Blender render failed: {}", stderr));
    }

    // Verify thumbnail was created
    if !thumbnail_path.exists() {
        return Err("Screenshot file was not created".to_string());
    }

    println!("✓ Screenshot captured successfully: {}", thumbnail_filename);

    // Return just the filename (not full path)
    Ok(thumbnail_filename)
}
