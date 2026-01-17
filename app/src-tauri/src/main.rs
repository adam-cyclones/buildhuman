// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asset_manager;
mod settings;
mod mesh;
mod mesh_generation;

use mesh::MeshData;
use tauri::{Manager, Listener, Emitter};
use tokio::sync::oneshot;
use tokio::time;

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

/// Request the frontend to capture a snapshot and return the saved path.
/// Emits `request-snapshot` and waits for a `snapshot-done` event carrying { path }.
#[tauri::command]
async fn request_snapshot(app: tauri::AppHandle, timeout_ms: Option<u64>) -> Result<Option<String>, String> {
    // Prepare oneshot channel to receive the snapshot path. Wrap the sender
    // in an Arc<Mutex<Option<_>>> so the `Fn` closure can attempt to send the
    // result without taking ownership of the sender itself (listen requires
    // an `Fn` handler, not `FnOnce`). The first successful send will consume
    // the inner Sender and subsequent calls will be ignored.
    let (tx, rx) = oneshot::channel::<Option<String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    // Listen for snapshot-done events. The handler receives a full `Event`;
    // extract the optional payload string via `event.payload()`.
    let app_clone = app.clone();
    let listener_id = app.listen("snapshot-done", move |event: tauri::Event| {
        let mut path_opt: Option<String> = None;
        let payload = event.payload();
        if !payload.is_empty() {
            if payload.starts_with('{') {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
                    if let Some(s) = v.get("path").and_then(|v| v.as_str()) {
                        path_opt = Some(s.to_string());
                    }
                }
            } else {
                path_opt = Some(payload.to_string());
            }
        }

        // Try to take the sender and send the path; ignore if it's already
        // been taken (duplicate events).
        if let Ok(mut guard) = tx.lock() {
            if let Some(s) = guard.take() {
                let _ = s.send(path_opt);
            }
        }
    });

    // Emit request to the main window. If your app uses a different window
    // label, change "main" accordingly. This avoids relying on the
    // `windows()` helper which may not be available in all bindings.
    if let Some(window) = app_clone.get_webview_window("main") {
        if let Err(e) = window.emit::<String>("request-snapshot", "".to_string()) {
            app_clone.unlisten(listener_id);
            return Err(format!("emit failed: {}", e));
        }
    } else {
        app_clone.unlisten(listener_id);
        return Err("no main window to emit to".to_string());
    }

    // Wait for event with timeout
    let to = timeout_ms.unwrap_or(15000);
    let res = time::timeout(std::time::Duration::from_millis(to), rx).await
        .map_err(|_| "timeout waiting for snapshot".to_string())
        .and_then(|r| r.map_err(|_| "listener dropped".to_string()));

    // cleanup listener
    app_clone.unlisten(listener_id);

    res
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

#[tauri::command]
fn get_profile_control_points() -> Result<Vec<serde_json::Value>, String> {
    mesh_generation::get_profile_control_points()
}


pub fn generate_tauri_context() -> tauri::Context {
    tauri::generate_context!()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Just run a basic Tauri app without Bevy or wgpu
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
            request_snapshot,
            update_skeleton,
            update_moulds,
            get_profile_control_points,
        ])
        .run(generate_tauri_context())
        .expect("error while running tauri application");

    Ok(())
}
