// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asset_manager;
mod bevy;
mod mesh;
mod mesh_commands;
mod settings;
mod tauri_plugin;
mod wgpu;

pub fn generate_tauri_context() -> tauri::Context {
    tauri::generate_context!()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Just run a basic Tauri app without Bevy or wgpu
    // 3D rendering is handled by Babylon.js in the frontend
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Clean up stale .blend files from previous session
            println!("BuildHuman starting up...");
            let _ = asset_manager::cleanup_blend_files(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            asset_manager::download_asset,
            asset_manager::list_cached_assets,
            asset_manager::get_cached_asset,
            asset_manager::delete_cached_asset,
            asset_manager::get_app_data_path,
            asset_manager::check_required_assets,
            asset_manager::open_folder,
            asset_manager::clear_cache,
            asset_manager::cleanup_blend_files,
            asset_manager::create_editable_copy,
            asset_manager::capture_asset_screenshot,
            asset_manager::set_asset_thumbnail,
            asset_manager::get_asset_thumbnail,
            asset_manager::update_asset_metadata,
            asset_manager::revert_to_original,
            asset_manager::open_in_editor,
            asset_manager::open_in_blender,
            asset_manager::watch_asset_file,
            asset_manager::stop_watching_asset,
            settings::get_app_settings,
            settings::save_app_settings,
        ])
        .run(generate_tauri_context())
        .expect("error while running tauri application");

    Ok(())
}
