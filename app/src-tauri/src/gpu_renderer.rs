use std::sync::Arc;
use nalgebra::{Matrix4, Point3, Vector3};
use tauri::{Runtime, WebviewWindow};
use wgpu::{
    util::DeviceExt, Device, Queue, Surface, SurfaceConfiguration, TextureFormat,
};

pub struct ViewportInfo {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Orbit camera state - spherical coordinates around a target point
#[derive(Clone, Copy)]
pub struct OrbitCamera {
    pub yaw: f32,      // Horizontal rotation (radians)
    pub pitch: f32,    // Vertical rotation (radians), clamped to avoid gimbal lock
    pub distance: f32, // Distance from target
    pub target: Point3<f32>, // Point the camera orbits around
}

impl Default for OrbitCamera {
    fn default() -> Self {
        Self {
            yaw: 0.0,
            pitch: 0.0,
            distance: 2.0,
            target: Point3::new(0.0, 0.3, 0.0), // Center on the mesh (roughly torso height)
        }
    }
}

impl OrbitCamera {
    /// Calculate camera position from spherical coordinates
    pub fn position(&self) -> Point3<f32> {
        let cos_pitch = self.pitch.cos();
        let sin_pitch = self.pitch.sin();
        let cos_yaw = self.yaw.cos();
        let sin_yaw = self.yaw.sin();

        Point3::new(
            self.target.x + self.distance * cos_pitch * sin_yaw,
            self.target.y + self.distance * sin_pitch,
            self.target.z + self.distance * cos_pitch * cos_yaw,
        )
    }

    /// Build view matrix using nalgebra's look_at_rh (right-handed, -Z forward)
    pub fn view_matrix(&self) -> Matrix4<f32> {
        let eye = self.position();
        let up = Vector3::new(0.0, 1.0, 0.0);
        Matrix4::look_at_rh(&eye, &self.target, &up)
    }

    /// Build orthographic projection matrix for WGPU (Z maps to [0, 1])
    /// Uses distance-based scaling for intuitive zoom behavior
    pub fn ortho_projection(&self, aspect: f32) -> Matrix4<f32> {
        // Orthographic size scales with distance for intuitive zoom
        let half_height = self.distance * 0.5;
        let half_width = half_height * aspect;

        // Simple orthographic that maps a reasonable Z range to [0, 1]
        let z_scale = 0.1_f32;  // Compress Z to fit in [0, 1]
        let z_offset = 0.5_f32; // Center the range

        // nalgebra Matrix4::new() takes row-major input
        // WGSL expects column-major with translation in column 3
        // Standard projection matrix has translation in the last COLUMN (not row)
        // So we need: [sx, 0, 0, tx], [0, sy, 0, ty], [0, 0, sz, tz], [0, 0, 0, 1]
        // Which in row-major input means we transpose the visual layout
        #[rustfmt::skip]
        let proj = Matrix4::new(
            1.0 / half_width, 0.0,               0.0,      0.0,
            0.0,              1.0 / half_height, 0.0,      0.0,
            0.0,              0.0,               z_scale,  z_offset,
            0.0,              0.0,               0.0,      1.0,
        );
        proj
    }

    /// Build CameraUniform from current state using proper view + projection matrices
    pub fn to_uniform(&self, aspect: f32) -> CameraUniform {
        let view = self.view_matrix();
        let proj = self.ortho_projection(aspect);
        let view_proj = proj * view;
        let pos = self.position();

        CameraUniform {
            view_proj: matrix_to_array(&view_proj),
            view: matrix_to_array(&view),
            camera_pos: [pos.x, pos.y, pos.z],
            _padding: 0.0,
        }
    }
}

/// Convert nalgebra Matrix4 to column-major [[f32; 4]; 4] for WGSL
fn matrix_to_array(m: &Matrix4<f32>) -> [[f32; 4]; 4] {
    // nalgebra stores column-major internally
    // as_slice() returns the data in column-major order: [col0, col1, col2, col3]
    let data = m.as_slice();
    [
        [data[0], data[1], data[2], data[3]],    // column 0
        [data[4], data[5], data[6], data[7]],    // column 1
        [data[8], data[9], data[10], data[11]],  // column 2
        [data[12], data[13], data[14], data[15]], // column 3
    ]
}

/// Normalize a 3D vector (used for lighting)
fn normalize_vec3(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len > 0.0001 {
        [v[0] / len, v[1] / len, v[2] / len]
    } else {
        [0.0, 0.0, 1.0]
    }
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

/// Camera uniform data - must match shader layout
#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct CameraUniform {
    view_proj: [[f32; 4]; 4],
    view: [[f32; 4]; 4],
    camera_pos: [f32; 3],
    _padding: f32, // Align to 16 bytes
}

impl CameraUniform {
    fn new() -> Self {
        let identity = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        Self {
            view_proj: identity,
            view: identity,
            camera_pos: [0.0, 0.0, 3.0],
            _padding: 0.0,
        }
    }
}

/// Light uniform data - must match shader layout
#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct LightUniform {
    direction: [f32; 3],
    _padding1: f32,
    color: [f32; 3],
    _padding2: f32,
    ambient: [f32; 3],
    _padding3: f32,
}

impl Default for LightUniform {
    fn default() -> Self {
        // Directional light from upper-front-right
        let dir = normalize_vec3([1.0, 1.0, 1.0]);
        Self {
            direction: dir,
            _padding1: 0.0,
            color: [1.0, 0.98, 0.95], // Slightly warm white
            _padding2: 0.0,
            ambient: [0.15, 0.15, 0.18], // Cool ambient
            _padding3: 0.0,
        }
    }
}

fn create_depth_texture(
    device: &Device,
    width: u32,
    height: u32,
    format: TextureFormat,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Depth Texture"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

pub struct GpuRenderer {
    device: Arc<Device>,
    queue: Arc<Queue>,
    surface: Surface<'static>,
    surface_config: SurfaceConfiguration,
    ui_render_pipeline: wgpu::RenderPipeline,
    scene_render_pipeline: wgpu::RenderPipeline,
    camera_buffer: wgpu::Buffer,
    light_buffer: wgpu::Buffer,
    scene_bind_group: wgpu::BindGroup,
    scene_bind_group_layout: wgpu::BindGroupLayout,
    depth_texture: wgpu::Texture,
    depth_view: wgpu::TextureView,
    viewport: ViewportInfo,
    camera: OrbitCamera,
    ui_vertex_buffer: wgpu::Buffer,
    ui_index_buffer: wgpu::Buffer,
    ui_vertex_buffer_size: u64,
    ui_index_buffer_size: u64,
    scene_vertex_buffer: wgpu::Buffer,
    scene_index_buffer: wgpu::Buffer,
    scene_vertex_buffer_size: u64,
    scene_index_buffer_size: u64,
    ui_num_indices: u32,
    scene_num_indices: u32,
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

        // Create depth texture
        let depth_format = TextureFormat::Depth32Float;
        let (depth_texture, depth_view) = create_depth_texture(&device, size.width, size.height, depth_format);

        // Create camera uniform buffer
        let camera_uniform = CameraUniform::new();
        let camera_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Camera Buffer"),
            contents: bytemuck::cast_slice(&[camera_uniform]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // Create light uniform buffer
        let light_uniform = LightUniform::default();
        let light_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Light Buffer"),
            contents: bytemuck::cast_slice(&[light_uniform]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // Create bind group layout for scene (camera + light)
        let scene_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Scene Bind Group Layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                ],
            });

        // Create scene bind group
        let scene_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Scene Bind Group"),
            layout: &scene_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: light_buffer.as_entire_binding(),
                },
            ],
        });

        // Load shaders
        let ui_shader_source = r#"
            struct VertexInput {
                @location(0) position: vec3<f32>,
                @location(1) color: vec3<f32>,
            };
            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) color: vec3<f32>,
            };
            @vertex
            fn vs_main(input: VertexInput) -> VertexOutput {
                var output: VertexOutput;
                output.position = vec4<f32>(input.position, 1.0);
                output.color = input.color;
                return output;
            }
            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                return vec4<f32>(input.color, 1.0);
            }
        "#;

        let ui_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("UI Shader"),
            source: wgpu::ShaderSource::Wgsl(ui_shader_source.into()),
        });

        let scene_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Scene Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/basic.wgsl").into()),
        });

        // UI pipeline - no bind groups, direct NDC
        let ui_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("UI Pipeline Layout"),
                bind_group_layouts: &[],
                push_constant_ranges: &[],
            });

        // Scene pipeline - with camera + light bind group
        let scene_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Scene Pipeline Layout"),
                bind_group_layouts: &[&scene_bind_group_layout],
                push_constant_ranges: &[],
            });

        // UI Vertex layout: position (vec3) + color (vec3) = 6 floats per vertex
        let ui_vertex_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<[f32; 6]>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
        };

        // Scene Vertex layout: position (vec3) + normal (vec3) = 6 floats per vertex
        // (keeping 6 for now, UV can be added later for textures)
        let scene_vertex_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<[f32; 6]>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
        };

        let ui_render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("UI Render Pipeline"),
            layout: Some(&ui_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &ui_shader,
                entry_point: Some("vs_main"),
                buffers: &[ui_vertex_layout],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &ui_shader,
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
            // UI pipeline needs compatible depth format but doesn't write depth
            depth_stencil: Some(wgpu::DepthStencilState {
                format: depth_format,
                depth_write_enabled: false,
                depth_compare: wgpu::CompareFunction::Always, // Always pass depth test
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 1,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        let scene_render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Scene Render Pipeline"),
            layout: Some(&scene_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &scene_shader,
                entry_point: Some("vs_main"),
                buffers: &[scene_vertex_layout],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &scene_shader,
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
                cull_mode: Some(wgpu::Face::Back), // Back-face culling enabled
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: depth_format,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 1,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        let empty_buffer_desc = wgpu::util::BufferInitDescriptor {
            label: Some("Empty Placeholder Buffer"),
            contents: &[0; 4], // Smallest possible non-empty buffer
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
        };

        let ui_vertex_buffer = device.create_buffer_init(&empty_buffer_desc);
        let ui_index_buffer = device.create_buffer_init(&empty_buffer_desc);
        let scene_vertex_buffer = device.create_buffer_init(&empty_buffer_desc);
        let scene_index_buffer = device.create_buffer_init(&empty_buffer_desc);

        Ok(Self {
            device,
            queue,
            surface,
            surface_config,
            ui_render_pipeline,
            scene_render_pipeline,
            camera_buffer,
            light_buffer,
            scene_bind_group,
            scene_bind_group_layout,
            depth_texture,
            depth_view,
            viewport: ViewportInfo {
                x: viewport_x,
                y: viewport_y,
                width: viewport_width,
                height: viewport_height,
            },
            camera: OrbitCamera::default(),
            ui_vertex_buffer,
            ui_index_buffer,
            ui_vertex_buffer_size: 0,
            ui_index_buffer_size: 0,
            scene_vertex_buffer,
            scene_index_buffer,
            scene_vertex_buffer_size: 0,
            scene_index_buffer_size: 0,
            ui_num_indices: 0,
            scene_num_indices: 0,
        })
    }

    /// Update camera uniform buffer from current orbit camera state
    pub fn update_camera_uniform(&self) {
        if self.viewport.width == 0 || self.viewport.height == 0 {
            return;
        }
        let aspect = self.viewport.width as f32 / self.viewport.height as f32;
        let camera_uniform = self.camera.to_uniform(aspect);
        self.queue.write_buffer(&self.camera_buffer, 0, bytemuck::cast_slice(&[camera_uniform]));
    }

    /// Update orbit camera parameters and refresh the uniform buffer
    pub fn set_camera(&mut self, yaw: f32, pitch: f32, distance: f32) {
        // Clamp pitch to avoid gimbal lock (slightly less than 90 degrees)
        self.camera.pitch = pitch.clamp(-1.5, 1.5);
        self.camera.yaw = yaw;
        self.camera.distance = distance.max(0.5); // Minimum distance
        self.update_camera_uniform();
    }

    /// Get current camera state
    pub fn get_camera(&self) -> (f32, f32, f32) {
        (self.camera.yaw, self.camera.pitch, self.camera.distance)
    }

    /// Update UI vertex and index buffers, caching the number of indices
    pub fn update_ui_data(&mut self, vertices: &[f32], indices: &[u32]) {
        let vertex_stride = std::mem::size_of::<[f32; 6]>() as wgpu::BufferAddress;
        let required_vertex_size = (vertices.len() * std::mem::size_of::<f32>()) as u64;

        if required_vertex_size > self.ui_vertex_buffer_size {
            println!("Re-allocating UI vertex buffer. Old size: {}, New size: {}", self.ui_vertex_buffer_size, required_vertex_size);
            self.ui_vertex_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("UI Vertex Buffer"),
                size: required_vertex_size.max(vertex_stride),
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.ui_vertex_buffer_size = required_vertex_size;
        }

        if !vertices.is_empty() {
            self.queue.write_buffer(&self.ui_vertex_buffer, 0, bytemuck::cast_slice(vertices));
        }

        let required_index_size = (indices.len() * std::mem::size_of::<u32>()) as u64;

        if required_index_size > self.ui_index_buffer_size {
            println!("Re-allocating UI index buffer. Old size: {}, New size: {}", self.ui_index_buffer_size, required_index_size);
            self.ui_index_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("UI Index Buffer"),
                size: required_index_size.max(std::mem::size_of::<u32>() as u64),
                usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.ui_index_buffer_size = required_index_size;
        }

        if !indices.is_empty() {
            self.queue.write_buffer(&self.ui_index_buffer, 0, bytemuck::cast_slice(indices));
        }

        self.ui_num_indices = indices.len() as u32;
    }

    /// Update scene vertex and index buffers, caching the number of indices
    pub fn update_scene_data(&mut self, vertices: &[f32], indices: &[u32]) {
        if vertices.is_empty() || indices.is_empty() {
            self.scene_num_indices = 0;
            return;
        }

        let vertex_stride = std::mem::size_of::<[f32; 6]>() as wgpu::BufferAddress;
        let required_vertex_size = (vertices.len() * std::mem::size_of::<f32>()) as u64;

        if required_vertex_size > self.scene_vertex_buffer_size {
            println!("Re-allocating Scene vertex buffer. Old size: {}, New size: {}", self.scene_vertex_buffer_size, required_vertex_size);
            self.scene_vertex_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Scene Vertex Buffer"),
                size: required_vertex_size.max(vertex_stride),
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.scene_vertex_buffer_size = required_vertex_size;
        }

        self.queue.write_buffer(&self.scene_vertex_buffer, 0, bytemuck::cast_slice(vertices));

        let required_index_size = (indices.len() * std::mem::size_of::<u32>()) as u64;

        if required_index_size > self.scene_index_buffer_size {
            println!("Re-allocating Scene index buffer. Old size: {}, New size: {}", self.scene_index_buffer_size, required_index_size);
            self.scene_index_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Scene Index Buffer"),
                size: required_index_size.max(std::mem::size_of::<u32>() as u64),
                usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.scene_index_buffer_size = required_index_size;
        }

        self.queue.write_buffer(&self.scene_index_buffer, 0, bytemuck::cast_slice(indices));

        self.scene_num_indices = indices.len() as u32;
    }

    pub fn update_viewport(&mut self, x: u32, y: u32, width: u32, height: u32) {
        // Clamp viewport to not exceed surface dimensions
        let clamped_width = width.min(self.surface_config.width.saturating_sub(x));
        let clamped_height = height.min(self.surface_config.height.saturating_sub(y));

        self.viewport = ViewportInfo {
            x,
            y,
            width: clamped_width,
            height: clamped_height,
        };

        // Update camera projection for new aspect ratio
        self.update_camera_uniform();
    }

    pub fn resize_window(&mut self, window_width: u32, window_height: u32) {
        if window_width > 0 && window_height > 0 {
            self.surface_config.width = window_width;
            self.surface_config.height = window_height;
            self.surface.configure(&self.device, &self.surface_config);

            // Recreate depth texture at new size
            let (depth_texture, depth_view) = create_depth_texture(
                &self.device,
                window_width,
                window_height,
                TextureFormat::Depth32Float,
            );
            self.depth_texture = depth_texture;
            self.depth_view = depth_view;
        }
    }



    /// Render from cached buffers (UI and scene data must be set via update_ui_data/update_scene_data first)
    pub fn render(&self) -> Result<(), String> {
        // Don't render until viewport has been properly set
        if self.viewport.width == 0 || self.viewport.height == 0 {
            return Ok(());
        }

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
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // === Phase 1: Draw UI backgrounds (full surface, no camera, no depth) ===
            if self.ui_num_indices > 0 {
                render_pass.set_pipeline(&self.ui_render_pipeline);
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

                render_pass.set_vertex_buffer(0, self.ui_vertex_buffer.slice(..));
                render_pass.set_index_buffer(self.ui_index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                render_pass.draw_indexed(0..self.ui_num_indices, 0, 0..1);
            }

            // === Phase 2: Draw 3D scene (with camera projection and depth testing) ===
            if self.scene_num_indices > 0 {
                render_pass.set_pipeline(&self.scene_render_pipeline);
                render_pass.set_bind_group(0, &self.scene_bind_group, &[]);

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

                render_pass.set_vertex_buffer(0, self.scene_vertex_buffer.slice(..));
                render_pass.set_index_buffer(self.scene_index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                render_pass.draw_indexed(0..self.scene_num_indices, 0, 0..1);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();

        Ok(())
    }

    /// Render UI backgrounds and 3D scene content with scissor rect
    /// This is a convenience method that updates buffers and renders in one call
    pub fn render_with_scene(
        &mut self,
        ui_vertices: &[f32],
        ui_indices: &[u32],
        scene_vertices: &[f32],
        scene_indices: &[u32],
    ) -> Result<(), String> {
        self.update_ui_data(ui_vertices, ui_indices);
        self.update_scene_data(scene_vertices, scene_indices);
        self.render()
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



// Store the viewport offset (top-left corner) set by frontend - this stays fixed
static VIEWPORT_OFFSET: Lazy<Mutex<(u32, u32)>> = Lazy::new(|| Mutex::new((0, 0)));

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
    let to_ndc_y = |py: u32| -> f32 { (py as f32 / window_height as f32) * 2.0 - 1.0 }; // Y-down to Y-down

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

        // Use the stored viewport offset (set by frontend) and recalculate width/height
        let scale = get_scale_factor();
        let bounds = UiBounds::default();
        let right_sidebar_width = (bounds.right_sidebar_width as f64 * scale) as u32;

        let (viewport_x, viewport_y) = *VIEWPORT_OFFSET.lock().unwrap();
        let viewport_width = width.saturating_sub(right_sidebar_width).saturating_sub(viewport_x);
        let viewport_height = height.saturating_sub(viewport_y);

        renderer.update_viewport(viewport_x, viewport_y, viewport_width, viewport_height);

        // Re-render UI bounds only after resize (scene data is preserved in buffers)
        let (ui_vertices, ui_indices) = generate_ui_bounds(width, height, scale);
        renderer.update_ui_data(&ui_vertices, &ui_indices);
        let _ = renderer.render();
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
    let mut renderer = pollster::block_on(GpuRenderer::new(&window, viewport_x, viewport_y, viewport_width, viewport_height))?;

    // Do an initial render with a test triangle
    let vertices: Vec<f32> = vec![
        0.0,  -0.5, 0.0,  // top now bottom
       -0.5,  0.5, 0.0,  // bottom left now top left
        0.5,  0.5, 0.0,  // bottom right now top right
    ];
    let indices: Vec<u32> = vec![0, 1, 2];
    renderer.update_ui_data(&vertices, &indices);
    renderer.render()?;

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
    // Store the viewport offset for use during resize
    {
        let mut offset = VIEWPORT_OFFSET.lock().unwrap();
        *offset = (x, y);
    }

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

/// Update the orbit camera and re-render
#[tauri::command]
pub async fn update_gpu_camera(
    yaw: f32,
    pitch: f32,
    distance: f32,
) -> Result<(), String> {
    let mut renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref mut renderer) = *renderer {
        renderer.set_camera(yaw, pitch, distance);
        renderer.render()?;
        Ok(())
    } else {
        Err("GPU renderer not initialized".to_string())
    }
}

/// Get current camera state (for syncing UI)
#[tauri::command]
pub async fn get_gpu_camera() -> Result<(f32, f32, f32), String> {
    let renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref renderer) = *renderer {
        Ok(renderer.get_camera())
    } else {
        Err("GPU renderer not initialized".to_string())
    }
}

#[tauri::command]
pub async fn render_mesh_gpu(
    vertices: Vec<f32>,
    indices: Vec<u32>,
) -> Result<(), String> {
    let mut renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref mut renderer) = *renderer {
        renderer.update_ui_data(&vertices, &indices);
        renderer.render()?;
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
    let mut renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref mut renderer) = *renderer {
        // Convert f64 to f32
        let scene_vertices_f32: Vec<f32> = scene_vertices.iter().map(|&v| v as f32).collect();

        println!("Viewport: x={}, y={}, w={}, h={}",
                 renderer.viewport.x, renderer.viewport.y,
                 renderer.viewport.width, renderer.viewport.height);

        // Generate UI background quads and update buffers
        let scale = get_scale_factor();
        let (ui_vertices, ui_indices) = generate_ui_bounds(
            renderer.surface_config.width,
            renderer.surface_config.height,
            scale,
        );

        // Update buffers and render
        renderer.update_ui_data(&ui_vertices, &ui_indices);
        renderer.update_scene_data(&scene_vertices_f32, &scene_indices);
        renderer.render()?;
        println!("render_scene_gpu completed successfully");
        Ok(())
    } else {
        Err("GPU renderer not initialized".to_string())
    }
}

/// Generate mesh from current mould state and render directly to GPU
/// This is more efficient than round-tripping through JS
#[tauri::command]
pub async fn generate_and_render_gpu(
    resolution: Option<u32>,
    fast_mode: Option<bool>,
) -> Result<(), String> {
    let res = resolution.unwrap_or(32);
    let fast = fast_mode.unwrap_or(false);

    // Ensure default moulds exist if not initialized by frontend
    crate::mesh_generation::ensure_default_state();

    // Generate mesh in background thread
    let mesh_result = tokio::task::spawn_blocking(move || {
        crate::mesh_generation::generate_mesh_from_state_with_quality(res, fast)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    let mesh = match mesh_result {
        Ok(m) => m,
        Err(e) => {
            eprintln!("Mesh generation failed: {}", e);
            return Err(e);
        }
    };

    // Interleave vertices and normals: [pos.x, pos.y, pos.z, norm.x, norm.y, norm.z, ...]
    let vertex_count = mesh.vertices.len() / 3;
    let mut interleaved = Vec::with_capacity(vertex_count * 6);

    for i in 0..vertex_count {
        // Position
        interleaved.push(mesh.vertices[i * 3]);
        interleaved.push(mesh.vertices[i * 3 + 1]);
        interleaved.push(mesh.vertices[i * 3 + 2]);
        // Normal
        interleaved.push(mesh.normals[i * 3]);
        interleaved.push(mesh.normals[i * 3 + 1]);
        interleaved.push(mesh.normals[i * 3 + 2]);
    }

    let mut renderer = GPU_RENDERER.lock().unwrap();

    if let Some(ref mut renderer) = *renderer {
        // Generate UI background quads
        let scale = get_scale_factor();
        let (ui_vertices, ui_indices) = generate_ui_bounds(
            renderer.surface_config.width,
            renderer.surface_config.height,
            scale,
        );

        // Update buffers and render
        renderer.update_ui_data(&ui_vertices, &ui_indices);
        renderer.update_scene_data(&interleaved, &mesh.indices);
        renderer.render()?;
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
