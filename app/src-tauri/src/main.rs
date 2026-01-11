// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asset_manager;
mod settings;
mod mesh;
mod mesh_generation;

use mesh::MeshData;

// A helper function to serialize mesh data into a byte buffer
fn serialize_mesh_to_bytes(mesh: MeshData) -> Vec<u8> {
    let vertex_data_len_bytes: u32 = (mesh.vertices.len() * std::mem::size_of::<f32>()) as u32;
    let index_data_len_bytes: u32 = (mesh.indices.len() * std::mem::size_of::<u32>()) as u32;
    let normal_data_len_bytes: u32 = (mesh.normals.len() * std::mem::size_of::<f32>()) as u32;

    let total_size = 12 + vertex_data_len_bytes + index_data_len_bytes + normal_data_len_bytes;
    let mut bytes = Vec::with_capacity(total_size as usize);
    
    bytes.extend_from_slice(&vertex_data_len_bytes.to_le_bytes());
    bytes.extend_from_slice(&index_data_len_bytes.to_le_bytes());
    bytes.extend_from_slice(&normal_data_len_bytes.to_le_bytes());

    unsafe {
        bytes.extend_from_slice(std::slice::from_raw_parts(
            mesh.vertices.as_ptr() as *const u8,
            vertex_data_len_bytes as usize,
        ));
        bytes.extend_from_slice(std::slice::from_raw_parts(
            mesh.indices.as_ptr() as *const u8,
            index_data_len_bytes as usize,
        ));
        bytes.extend_from_slice(std::slice::from_raw_parts(
            mesh.normals.as_ptr() as *const u8,
            normal_data_len_bytes as usize,
        ));
    }
    
    bytes
}

#[tauri::command]
async fn generate_mesh_binary(
    resolution: Option<u32>,
    fast_mode: Option<bool>,
) -> Result<tauri::ipc::Response, String> {
    // Use default resolution of 32 if not provided
    let res = resolution.unwrap_or(32);
    let fast = fast_mode.unwrap_or(false);

    // Run mesh generation in a background thread to avoid blocking
    let mesh = tokio::task::spawn_blocking(move || {
        mesh_generation::generate_mesh_from_state_with_quality(res, fast)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Serialize the MeshData into a single Vec<u8>
    let bytes = serialize_mesh_to_bytes(mesh);

    // Return as a raw binary response
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn update_skeleton(joints: Vec<mesh::JointData>) -> Result<(), String> {
    mesh_generation::update_skeleton(joints);
    Ok(())
}

#[tauri::command]
fn update_moulds(moulds: Vec<mesh::MouldData>) -> Result<(), String> {
    mesh_generation::update_moulds(moulds);
    Ok(())
}


pub fn generate_tauri_context() -> tauri::Context {
    tauri::generate_context!()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Just run a basic Tauri app without Bevy or wgpu
    // 3D rendering is handled by Babylon.js in the frontend
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| {
            // Clean up stale .blend files from previous session
            println!("BuildHuman starting up...");
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
            asset_manager::create_editable_copy,
            asset_manager::update_asset_metadata,
            asset_manager::revert_to_original,
            settings::get_app_settings,
            settings::save_app_settings,
            generate_mesh_binary,
            update_skeleton,
            update_moulds,
        ])
        .run(generate_tauri_context())
        .expect("error while running tauri application");

    Ok(())
}