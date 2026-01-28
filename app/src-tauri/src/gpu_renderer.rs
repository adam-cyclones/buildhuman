use std::sync::Arc;
use tauri::{Runtime, WebviewWindow, Manager};
use wgpu::{
    util::DeviceExt, Device, Queue, Surface, SurfaceConfiguration,
};

pub struct ViewportInfo {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// UI layout bounds (in pixels from top-left)
pub struct UiBounds {
    pub menu_bar_height: u32,
    pub right_sidebar_width: u32,
}

impl Default for UiBounds {
    fn default() -> Self {
        Self {
            menu_bar_height: 117,      // Menu bar + tabs
            right_sidebar_width: 340, // Right sidebar
        }
    }
}

pub struct GpuRenderer {
    device: Arc<Device>,
    queue: Arc<Queue>,
    surface: Surface<'static>,
    surface_config: SurfaceConfiguration,
    render_pipeline: wgpu::RenderPipeline,
    viewport: ViewportInfo,
}

impl GpuRenderer {
    pub async fn new<R: Runtime>(
        window: &WebviewWindow<R>,
        viewport_x: u32,
        viewport_y: u32,
        viewport_width: u32,
        viewport_height: u32,
    ) -> Result<Self, String> {
        // Create wgpu instance
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        // Create surface from the WebviewWindow directly
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| format!("Failed to create surface: {}", e))?;

        // Request adapter
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or("Failed to find suitable GPU adapter")?;

        // Request device and queue
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("BuildHuman GPU Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: Default::default(),
                },
                None,
            )
            .await
            .map_err(|e| format!("Failed to create device: {}", e))?;

        let device = Arc::new(device);
        let queue = Arc::new(queue);

        // Get full window size for surface
        let size = window
            .inner_size()
            .map_err(|e| format!("Failed to get window size: {}", e))?;

        // Configure surface with full window size
        // The viewport/scissor will restrict where we draw, but the surface is window-sized
        let surface_caps = surface.get_capabilities(&adapter);
        let surface_format = surface_caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(surface_caps.formats[0]);

        // Use Mailbox if available for lower latency, otherwise Fifo
        let present_mode = if surface_caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
            wgpu::PresentMode::Mailbox
        } else {
            wgpu::PresentMode::Fifo
        };

        let surface_config = SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: size.width,
            height: size.height,
            present_mode,
            alpha_mode: surface_caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };

        surface.configure(&device, &surface_config);

        // Create render pipeline
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/basic.wgsl").into()),
        });

        let render_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Render Pipeline Layout"),
                bind_group_layouts: &[],
                push_constant_ranges: &[],
            });

        // Vertex layout: position (vec3) + color (vec3) = 6 floats per vertex
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Render Pipeline"),
            layout: Some(&render_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<[f32; 6]>() as wgpu::BufferAddress,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                }],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Back),
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: 1,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        Ok(Self {
            device,
            queue,
            surface,
            surface_config,
            render_pipeline,
            viewport: ViewportInfo {
                x: viewport_x,
                y: viewport_y,
                width: viewport_width,
                height: viewport_height,
            },
        })
    }

    pub fn update_viewport(&mut self, x: u32, y: u32, width: u32, height: u32) {
        self.viewport = ViewportInfo { x, y, width, height };
    }

    pub fn resize_window(&mut self, window_width: u32, window_height: u32) {
        if window_width > 0 && window_height > 0 {
            self.surface_config.width = window_width;
            self.surface_config.height = window_height;
            self.surface.configure(&self.device, &self.surface_config);
        }
    }

    /// Render UI backgrounds and optionally 3D scene content
    /// ui_vertices/ui_indices: UI background quads (rendered to full surface)
    /// scene_vertices/scene_indices: 3D content (rendered within scissor rect)
    pub fn render(&self, vertices: &[f32], indices: &[u32]) -> Result<(), String> {
        self.render_with_scene(vertices, indices, &[], &[])
    }

    /// Render UI backgrounds and 3D scene content with scissor rect
    pub fn render_with_scene(
        &self,
        ui_vertices: &[f32],
        ui_indices: &[u32],
        scene_vertices: &[f32],
        scene_indices: &[u32],
    ) -> Result<(), String> {
        // Don't render until viewport has been properly set
        if self.viewport.width == 0 || self.viewport.height == 0 {
            return Ok(());
        }

        // Create UI buffers
        let ui_vertex_buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("UI Vertex Buffer"),
                contents: bytemuck::cast_slice(ui_vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });

        let ui_index_buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("UI Index Buffer"),
                contents: bytemuck::cast_slice(ui_indices),
                usage: wgpu::BufferUsages::INDEX,
            });

        let ui_num_indices = ui_indices.len() as u32;

        // Create scene buffers if we have scene data
        let (scene_vertex_buffer, scene_index_buffer, scene_num_indices) = if !scene_vertices.is_empty() && !scene_indices.is_empty() {
            let vb = self
                .device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("Scene Vertex Buffer"),
                    contents: bytemuck::cast_slice(scene_vertices),
                    usage: wgpu::BufferUsages::VERTEX,
                });

            let ib = self
                .device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("Scene Index Buffer"),
                    contents: bytemuck::cast_slice(scene_indices),
                    usage: wgpu::BufferUsages::INDEX,
                });

            (Some(vb), Some(ib), scene_indices.len() as u32)
        } else {
            (None, None, 0)
        };

        // Get current surface texture
        let output = self
            .surface
            .get_current_texture()
            .map_err(|e| format!("Failed to get surface texture: {}", e))?;

        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Render Encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        // Clear to black
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.0,
                            g: 0.0,
                            b: 0.0,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&self.render_pipeline);

            // === Phase 1: Draw UI backgrounds (full surface) ===
            render_pass.set_viewport(
                0.0,
                0.0,
                self.surface_config.width as f32,
                self.surface_config.height as f32,
                0.0,
                1.0,
            );
            render_pass.set_scissor_rect(
                0,
                0,
                self.surface_config.width,
                self.surface_config.height,
            );

            render_pass.set_vertex_buffer(0, ui_vertex_buffer.slice(..));
            render_pass.set_index_buffer(ui_index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            render_pass.draw_indexed(0..ui_num_indices, 0, 0..1);

            // === Phase 2: Draw 3D scene (viewport + scissor constrained) ===
            if let (Some(ref scene_vb), Some(ref scene_ib)) = (&scene_vertex_buffer, &scene_index_buffer) {
                println!("Drawing scene with {} indices, viewport: ({}, {}, {}, {})",
                         scene_num_indices,
                         self.viewport.x, self.viewport.y,
                         self.viewport.width, self.viewport.height);

                // Set viewport to the scene area - this makes NDC coords (-1 to 1) map to this region
                render_pass.set_viewport(
                    self.viewport.x as f32,
                    self.viewport.y as f32,
                    self.viewport.width as f32,
                    self.viewport.height as f32,
                    0.0,
                    1.0,
                );

                // Scissor rect clips any pixels outside the viewport area
                render_pass.set_scissor_rect(
                    self.viewport.x,
                    self.viewport.y,
                    self.viewport.width,
                    self.viewport.height,
                );

                render_pass.set_vertex_buffer(0, scene_vb.slice(..));
                render_pass.set_index_buffer(scene_ib.slice(..), wgpu::IndexFormat::Uint32);
                render_pass.draw_indexed(0..scene_num_indices, 0, 0..1);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();

        Ok(())
    }

    /// Get the current viewport bounds (for use by scene rendering)
    pub fn get_viewport(&self) -> &ViewportInfo {
        &self.viewport
    }
}

// Global renderer storage
use once_cell::sync::Lazy;
use std::sync::Mutex;

static GPU_RENDERER: Lazy<Mutex<Option<GpuRenderer>>> = Lazy::new(|| Mutex::new(None));
static LAST_RESIZE: Lazy<Mutex<std::time::Instant>> = Lazy::new(|| Mutex::new(std::time::Instant::now()));
static SCALE_FACTOR: Lazy<Mutex<f64>> = Lazy::new(|| Mutex::new(2.0)); // Default to Retina

// Store last scene data for re-rendering on resize
static LAST_SCENE_VERTICES: Lazy<Mutex<Vec<f32>>> = Lazy::new(|| Mutex::new(Vec::new()));
static LAST_SCENE_INDICES: Lazy<Mutex<Vec<u32>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub fn set_global_renderer(renderer: GpuRenderer) {
    let mut global_renderer = GPU_RENDERER.lock().unwrap();
    *global_renderer = Some(renderer);
}

pub fn set_scale_factor(scale: f64) {
    let mut sf = SCALE_FACTOR.lock().unwrap();
    *sf = scale;
}

fn get_scale_factor() -> f64 {
    *SCALE_FACTOR.lock().unwrap()
}

/// Generate vertices for UI bound rectangles (for debugging/visualization)
/// Returns (vertices, indices) where vertices are [x, y, z, r, g, b] per vertex
/// window_width/height are in physical pixels, scale_factor converts logical to physical
pub fn generate_ui_bounds(window_width: u32, window_height: u32, scale_factor: f64) -> (Vec<f32>, Vec<u32>) {
    let bounds = UiBounds::default();
    let mut vertices = Vec::new();
    let mut indices = Vec::new();

    // Scale logical pixels to physical pixels
    let scale = |logical: u32| -> u32 { (logical as f64 * scale_factor) as u32 };

    let menu_bar_height = scale(bounds.menu_bar_height);
    let right_sidebar_width = scale(bounds.right_sidebar_width);

    // Convert pixel coords to NDC (-1 to 1)
    let to_ndc_x = |px: u32| -> f32 { (px as f32 / window_width as f32) * 2.0 - 1.0 };
    let to_ndc_y = |py: u32| -> f32 { 1.0 - (py as f32 / window_height as f32) * 2.0 }; // flip Y

    // Helper to add a colored quad
    let mut add_quad = |x1: u32, y1: u32, x2: u32, y2: u32, r: f32, g: f32, b: f32| {
        let base = (vertices.len() / 6) as u32;

        // 4 vertices for quad (position + color)
        // Top-left
        vertices.extend_from_slice(&[to_ndc_x(x1), to_ndc_y(y1), 0.0, r, g, b]);
        // Top-right
        vertices.extend_from_slice(&[to_ndc_x(x2), to_ndc_y(y1), 0.0, r, g, b]);
        // Bottom-right
        vertices.extend_from_slice(&[to_ndc_x(x2), to_ndc_y(y2), 0.0, r, g, b]);
        // Bottom-left
        vertices.extend_from_slice(&[to_ndc_x(x1), to_ndc_y(y2), 0.0, r, g, b]);

        // 2 triangles for quad (clockwise winding for front-facing when viewed from +Z)
        indices.extend_from_slice(&[base, base + 2, base + 1, base, base + 3, base + 2]);
    };

    // Colors matching CSS variables
    // sRGB surface applies gamma, so we need LINEAR values
    // For sRGB hex value X, linear = (X/255)^2.2 approximately
    // #1a1a1a (26/255=0.102) -> 0.102^2.2 ≈ 0.0085
    // #0f0f0f (15/255=0.059) -> 0.059^2.2 ≈ 0.0024
    let medium_gray = (0.0085, 0.0085, 0.0085); // #1a1a1a - sidebar (linear)
    let dark_gray = (0.0024, 0.0024, 0.0024);   // #0f0f0f - viewport background (linear)

    // Draw all UI background regions (DOM has transparent bg in gpu-mode)

    // Top bar (menu + tabs) - use medium_gray to match sidebar
    add_quad(0, 0, window_width, menu_bar_height, medium_gray.0, medium_gray.1, medium_gray.2);

    // Right sidebar - medium gray
    add_quad(window_width - right_sidebar_width, menu_bar_height, window_width, window_height, medium_gray.0, medium_gray.1, medium_gray.2);

    // 3D viewport area (the remaining space) - dark gray
    add_quad(
        0,
        menu_bar_height,
        window_width - right_sidebar_width,
        window_height,
        dark_gray.0, dark_gray.1, dark_gray.2,
    );

    (vertices, indices)
}

pub fn handle_window_resize(width: u32, height: u32) {
    // Throttle: only process resize every 16ms (~60fps)
    {
        let mut last_resize = LAST_RESIZE.lock().unwrap();
        let now = std::time::Instant::now();
        if now.duration_since(*last_resize).as_millis() < 16 {
            return;
        }
        *last_resize = now;
    }

    let mut renderer = GPU_RENDERER.lock().unwrap();
    if let Some(ref mut renderer) = *renderer {
        renderer.resize_window(width, height);

        // Re-render UI bounds + last scene after resize
        let scale = get_scale_factor();
        let (ui_vertices, ui_indices) = generate_ui_bounds(width, height, scale);

        // Get last scene data
        let scene_vertices = LAST_SCENE_VERTICES.lock().unwrap();
        let scene_indices = LAST_SCENE_INDICES.lock().unwrap();

        let _ = renderer.render_with_scene(&ui_vertices, &ui_indices, &scene_vertices, &scene_indices);
    }
}

#[tauri::command]
pub fn init_gpu_renderer<R: Runtime>(
    window: WebviewWindow<R>,
    viewport_x: u32,
    viewport_y: u32,
    viewport_width: u32,
    viewport_height: u32,
) -> Result<String, String> {
    // Must run on main thread for Metal
    let renderer = pollster::block_on(GpuRenderer::new(&window, viewport_x, viewport_y, viewport_width, viewport_height))?;

    // Do an initial render with a test triangle
    let vertices: Vec<f32> = vec![
        0.0,  0.5, 0.0,  // top
       -0.5, -0.5, 0.0,  // bottom left
        0.5, -0.5, 0.0,  // bottom right
    ];
    let indices: Vec<u32> = vec![0, 1, 2];
    renderer.render(&vertices, &indices)?;

    let mut global_renderer = GPU_RENDERER.lock().unwrap();
    *global_renderer = Some(renderer);

    Ok("GPU renderer initialized successfully".to_string())
}

#[tauri::command]
pub async fn update_gpu_viewport(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let mut renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref mut renderer) = *renderer {
        renderer.update_viewport(x, y, width, height);
        Ok(())
    } else {
        Err("GPU renderer not initialized".to_string())
    }
}

#[tauri::command]
pub async fn resize_gpu_window(
    window_width: u32,
    window_height: u32,
) -> Result<(), String> {
    let mut renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref mut renderer) = *renderer {
        renderer.resize_window(window_width, window_height);
        Ok(())
    } else {
        Err("GPU renderer not initialized".to_string())
    }
}

#[tauri::command]
pub async fn render_mesh_gpu(
    vertices: Vec<f32>,
    indices: Vec<u32>,
) -> Result<(), String> {
    let renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref renderer) = *renderer {
        renderer.render(&vertices, &indices)?;
        Ok(())
    } else {
        Err("GPU renderer not initialized".to_string())
    }
}

/// Render a 3D scene with UI backgrounds, using scissor rect to constrain scene to viewport
#[tauri::command]
pub async fn render_scene_gpu(
    scene_vertices: Vec<f64>,  // JS numbers come as f64
    scene_indices: Vec<u32>,
) -> Result<(), String> {
    println!("render_scene_gpu called with {} vertices, {} indices",
             scene_vertices.len(), scene_indices.len());

    let renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref renderer) = *renderer {
        // Convert f64 to f32
        let scene_vertices_f32: Vec<f32> = scene_vertices.iter().map(|&v| v as f32).collect();

        // Store scene data for re-rendering on resize
        {
            let mut stored_verts = LAST_SCENE_VERTICES.lock().unwrap();
            let mut stored_inds = LAST_SCENE_INDICES.lock().unwrap();
            *stored_verts = scene_vertices_f32.clone();
            *stored_inds = scene_indices.clone();
        }

        println!("Viewport: x={}, y={}, w={}, h={}",
                 renderer.viewport.x, renderer.viewport.y,
                 renderer.viewport.width, renderer.viewport.height);

        // Generate UI background quads
        let scale = get_scale_factor();
        let (ui_vertices, ui_indices) = generate_ui_bounds(
            renderer.surface_config.width,
            renderer.surface_config.height,
            scale,
        );

        // Render UI + scene with scissor rect
        renderer.render_with_scene(&ui_vertices, &ui_indices, &scene_vertices_f32, &scene_indices)?;
        println!("render_scene_gpu completed successfully");
        Ok(())
    } else {
        Err("GPU renderer not initialized".to_string())
    }
}

#[tauri::command]
pub async fn shutdown_gpu_renderer() -> Result<(), String> {
    let mut renderer = GPU_RENDERER.lock().unwrap();
    *renderer = None;
    Ok(())
}
