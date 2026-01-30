// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asset_manager;
mod settings;
mod mesh;
mod mesh_generation;
mod gpu_renderer;

use mesh::MeshData;
use tauri::{Manager, Listener, Emitter, async_runtime, RunEvent, WindowEvent};
use tokio::sync::oneshot;
use tokio::time;
use std::sync::Arc;

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
        .setup(|app| {
            // Clean up stale .blend files from previous session
            println!("BuildHuman starting up...");

            // Check if GPU mode is enabled and initialize renderer on main thread
            let settings = settings::load_settings_sync();
            if settings.render_mode == "gpu" {
                println!("GPU mode enabled, initializing wgpu renderer...");

                if let Some(window) = app.get_webview_window("main") {
                    // Get actual physical size and scale factor (accounts for Retina/HiDPI)
                    let size = window.inner_size().unwrap_or(tauri::PhysicalSize { width: 1400, height: 900 });
                    let scale_factor = window.scale_factor().unwrap_or(2.0);
                    let width = size.width;
                    let height = size.height;
                    println!("Window physical size: {}x{}, scale factor: {}", width, height, scale_factor);

                    // Store scale factor for resize handler
                    gpu_renderer::set_scale_factor(scale_factor);

                    // Use catch_unwind to prevent GPU init failures from crashing the app
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        async_runtime::block_on(
                            gpu_renderer::GpuRenderer::new(&window, 0, 0, width, height)
                        )
                    }));

                    match result {
                        Ok(Ok(mut renderer)) => {
                            // Do an initial render with UI bounds using physical size
                            let (vertices, indices) = gpu_renderer::generate_ui_bounds(width, height, scale_factor);
                            if let Err(e) = renderer.render_with_scene(&vertices, &indices, &[], &[]) {
                                println!("Initial render failed: {}", e);
                            } else {
                                println!("GPU renderer initialized and rendered UI bounds");
                            }
                            gpu_renderer::set_global_renderer(renderer);
                        }
                        Ok(Err(e)) => {
                            println!("Failed to initialize GPU renderer: {}", e);
                        }
                        Err(panic_info) => {
                            println!("GPU renderer initialization panicked: {:?}", panic_info);
                        }
                    }
                }
            }

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
            gpu_renderer::init_gpu_renderer,
            gpu_renderer::update_gpu_viewport,
            gpu_renderer::resize_gpu_window,
            gpu_renderer::render_mesh_gpu,
            gpu_renderer::render_scene_gpu,
            gpu_renderer::generate_and_render_gpu,
            gpu_renderer::shutdown_gpu_renderer,
        ])
        .build(generate_tauri_context())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } = event
            {
                // Reconfigure the wgpu surface on resize
                gpu_renderer::handle_window_resize(size.width, size.height);
            }
        });

    Ok(())
}