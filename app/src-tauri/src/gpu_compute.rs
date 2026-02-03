// GPU Compute Pipeline for Mesh Generation
// Evaluates SDF grid and generates mesh entirely on GPU
//
// Algorithm (surface voxelization, not true dual contouring):
// 1. SDF Evaluation: Compute signed distance at each grid vertex
// 2. Surface Cell Detection: Find cells where corners cross the iso-surface
// 3. Vertex Placement: One vertex per surface cell (at cell center)
// 4. Face Generation: Create quad faces between adjacent surface cells

use std::sync::Arc;
use wgpu::{util::DeviceExt, Device, Queue};
use crate::mesh::types::{MeshData, MouldShape, Pt3, AABB};
use crate::mesh::mould::MouldManager;

/// GPU-compatible mould data (must match WGSL Mould struct layout exactly)
/// Layout: 3 vec4s = 48 bytes total
#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuMould {
    // vec4 0: center.xyz + shape
    center: [f32; 3],
    shape: u32,  // 0=Sphere, 1=Capsule
    // vec4 1: end_point.xyz + radius
    end_point: [f32; 3],
    radius: f32,
    // vec4 2: blend_radius + padding
    blend_radius: f32,
    _padding: [f32; 3],
}

/// Grid parameters uniform (must match WGSL layout exactly)
/// Using vec4 for all vector types to ensure 16-byte alignment matches WGSL
#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct GridParams {
    // vec4 0: resolution in x, padding in yzw
    resolution: u32,
    _pad0: [u32; 3],
    // vec4 1: bounds_min xyz, padding in w
    bounds_min: [f32; 4],
    // vec4 2: bounds_max xyz, cell_size in w
    bounds_max: [f32; 3],
    cell_size: f32,
    // vec4 3: num_moulds, iso_value, padding
    num_moulds: u32,
    iso_value: f32,
    _pad1: [f32; 2],
}
// Total: 64 bytes (4 vec4s)

/// Atomic counters for variable-length output
#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct Counters {
    vertex_count: u32,
    index_count: u32,
}

/// GPU Compute Pipeline for mesh generation
pub struct GpuComputePipeline {
    device: Arc<Device>,
    queue: Arc<Queue>,
    // SDF evaluation
    sdf_pipeline: wgpu::ComputePipeline,
    sdf_bind_group_layout: wgpu::BindGroupLayout,
    // Dual contouring phase 1 (detect surface cells)
    dc_detect_pipeline: wgpu::ComputePipeline,
    // Dual contouring phase 2 (generate faces)
    dc_faces_pipeline: wgpu::ComputePipeline,
    dc_bind_group_layout: wgpu::BindGroupLayout,
    // Buffers (reused between frames)
    params_buffer: wgpu::Buffer,
    moulds_buffer: wgpu::Buffer,
    sdf_grid_buffer: wgpu::Buffer,
    counters_buffer: wgpu::Buffer,
    vertices_buffer: wgpu::Buffer,
    indices_buffer: wgpu::Buffer,
    cell_to_vertex_buffer: wgpu::Buffer,
    // Staging buffers for readback
    counters_staging: wgpu::Buffer,
    vertices_staging: wgpu::Buffer,
    indices_staging: wgpu::Buffer,
    // Current resolution (for buffer sizing)
    current_resolution: u32,
    max_moulds: u32,
}

impl GpuComputePipeline {
    pub fn new(device: Arc<Device>, queue: Arc<Queue>) -> Self {
        // Load compute shaders
        let sdf_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("SDF Compute Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/sdf_compute.wgsl").into()),
        });

        let dc_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Dual Contouring Compute Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/dual_contouring_compute.wgsl").into()),
        });

        // SDF bind group layout
        let sdf_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("SDF Bind Group Layout"),
            entries: &[
                // params: uniform
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // moulds: storage read
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // sdf_grid: storage read_write
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        // Dual contouring bind group layout
        let dc_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("DC Bind Group Layout"),
            entries: &[
                // params: uniform
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // sdf_grid: storage read
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // counters: storage read_write
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // vertices: storage read_write
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // indices: storage read_write
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // cell_to_vertex: storage read_write
                wgpu::BindGroupLayoutEntry {
                    binding: 5,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        // Create pipelines
        let sdf_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("SDF Pipeline Layout"),
            bind_group_layouts: &[&sdf_bind_group_layout],
            push_constant_ranges: &[],
        });

        let sdf_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("SDF Compute Pipeline"),
            layout: Some(&sdf_pipeline_layout),
            module: &sdf_shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let dc_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("DC Pipeline Layout"),
            bind_group_layouts: &[&dc_bind_group_layout],
            push_constant_ranges: &[],
        });

        let dc_detect_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("DC Detect Pipeline"),
            layout: Some(&dc_pipeline_layout),
            module: &dc_shader,
            entry_point: Some("detect_surface_cells"),
            compilation_options: Default::default(),
            cache: None,
        });

        let dc_faces_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("DC Faces Pipeline"),
            layout: Some(&dc_pipeline_layout),
            module: &dc_shader,
            entry_point: Some("generate_faces"),
            compilation_options: Default::default(),
            cache: None,
        });

        // Initial buffer sizes for resolution 64, max 64 moulds
        let initial_resolution = 64u32;
        let max_moulds = 64u32;
        let (params_buffer, moulds_buffer, sdf_grid_buffer, counters_buffer,
             vertices_buffer, indices_buffer, cell_to_vertex_buffer,
             counters_staging, vertices_staging, indices_staging) =
            Self::create_buffers(&device, initial_resolution, max_moulds);

        Self {
            device,
            queue,
            sdf_pipeline,
            sdf_bind_group_layout,
            dc_detect_pipeline,
            dc_faces_pipeline,
            dc_bind_group_layout,
            params_buffer,
            moulds_buffer,
            sdf_grid_buffer,
            counters_buffer,
            vertices_buffer,
            indices_buffer,
            cell_to_vertex_buffer,
            counters_staging,
            vertices_staging,
            indices_staging,
            current_resolution: initial_resolution,
            max_moulds,
        }
    }

    fn create_buffers(
        device: &Device,
        resolution: u32,
        max_moulds: u32,
    ) -> (
        wgpu::Buffer, wgpu::Buffer, wgpu::Buffer, wgpu::Buffer,
        wgpu::Buffer, wgpu::Buffer, wgpu::Buffer,
        wgpu::Buffer, wgpu::Buffer, wgpu::Buffer,
    ) {
        let grid_size = (resolution * resolution * resolution) as usize;
        let cell_count = ((resolution - 1) * (resolution - 1) * (resolution - 1)) as usize;
        // Estimate max vertices = cell_count (worst case: every cell has a vertex)
        // Estimate max indices = cell_count * 6 (each cell can contribute to ~2 faces = 6 indices)
        let max_vertices = cell_count;
        let max_indices = cell_count * 6;

        let params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Grid Params Buffer"),
            size: std::mem::size_of::<GridParams>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let moulds_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Moulds Buffer"),
            size: (max_moulds as usize * std::mem::size_of::<GpuMould>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let sdf_grid_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("SDF Grid Buffer"),
            size: (grid_size * std::mem::size_of::<f32>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let counters_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Counters Buffer"),
            size: std::mem::size_of::<Counters>() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        // 6 floats per vertex (pos + normal)
        let vertices_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Vertices Buffer"),
            size: (max_vertices * 6 * std::mem::size_of::<f32>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let indices_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Indices Buffer"),
            size: (max_indices * std::mem::size_of::<u32>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let cell_to_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Cell to Vertex Buffer"),
            size: (cell_count * std::mem::size_of::<u32>()) as u64,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });

        // Staging buffers for readback
        let counters_staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Counters Staging"),
            size: std::mem::size_of::<Counters>() as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let vertices_staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Vertices Staging"),
            size: (max_vertices * 6 * std::mem::size_of::<f32>()) as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let indices_staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Indices Staging"),
            size: (max_indices * std::mem::size_of::<u32>()) as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        (params_buffer, moulds_buffer, sdf_grid_buffer, counters_buffer,
         vertices_buffer, indices_buffer, cell_to_vertex_buffer,
         counters_staging, vertices_staging, indices_staging)
    }

    /// Resize buffers if resolution changed
    fn ensure_buffer_size(&mut self, resolution: u32) {
        if resolution != self.current_resolution {
            let (params_buffer, moulds_buffer, sdf_grid_buffer, counters_buffer,
                 vertices_buffer, indices_buffer, cell_to_vertex_buffer,
                 counters_staging, vertices_staging, indices_staging) =
                Self::create_buffers(&self.device, resolution, self.max_moulds);

            self.params_buffer = params_buffer;
            self.moulds_buffer = moulds_buffer;
            self.sdf_grid_buffer = sdf_grid_buffer;
            self.counters_buffer = counters_buffer;
            self.vertices_buffer = vertices_buffer;
            self.indices_buffer = indices_buffer;
            self.cell_to_vertex_buffer = cell_to_vertex_buffer;
            self.counters_staging = counters_staging;
            self.vertices_staging = vertices_staging;
            self.indices_staging = indices_staging;
            self.current_resolution = resolution;

            println!("GPU compute buffers resized for resolution {}", resolution);
        }
    }

    /// Generate mesh on GPU using world-space mould data
    pub async fn generate_mesh(
        &mut self,
        mould_manager: &MouldManager,
        resolution: u32,
        bounds: AABB,
    ) -> Result<MeshData, String> {
        self.ensure_buffer_size(resolution);

        // Get world-space moulds (with skeleton transforms applied)
        // ProfiledCapsules are converted to regular Capsules with average radius
        let world_moulds = mould_manager.get_moulds_world_space();
        let gpu_moulds: Vec<GpuMould> = world_moulds.iter().map(|m| {
            let shape = match m.shape {
                MouldShape::Sphere => 0u32,
                MouldShape::Capsule => 1u32,
                MouldShape::ProfiledCapsule => 1u32, // Fallback to capsule (shouldn't happen)
            };
            let end = m.world_end.unwrap_or(m.world_center);
            GpuMould {
                center: [m.world_center.x, m.world_center.y, m.world_center.z],
                shape,
                end_point: [end.x, end.y, end.z],
                radius: m.radius,
                blend_radius: m.blend_radius,
                _padding: [0.0; 3],
            }
        }).collect();

        if gpu_moulds.is_empty() {
            return Err("No moulds to render".to_string());
        }

        // Calculate cell size
        let size = Pt3::new(
            bounds.max.x - bounds.min.x,
            bounds.max.y - bounds.min.y,
            bounds.max.z - bounds.min.z,
        );
        let cell_size = size.x.max(size.y).max(size.z) / (resolution as f32 - 1.0);

        // Upload params
        let params = GridParams {
            resolution,
            _pad0: [0; 3],
            bounds_min: [bounds.min.x, bounds.min.y, bounds.min.z, 0.0],
            bounds_max: [bounds.max.x, bounds.max.y, bounds.max.z],
            cell_size,
            num_moulds: gpu_moulds.len() as u32,
            iso_value: 0.0,
            _pad1: [0.0; 2],
        };
        self.queue.write_buffer(&self.params_buffer, 0, bytemuck::cast_slice(&[params]));

        // Upload moulds
        self.queue.write_buffer(&self.moulds_buffer, 0, bytemuck::cast_slice(&gpu_moulds));

        // Reset counters
        let zero_counters = Counters { vertex_count: 0, index_count: 0 };
        self.queue.write_buffer(&self.counters_buffer, 0, bytemuck::cast_slice(&[zero_counters]));

        // Create bind groups
        let sdf_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("SDF Bind Group"),
            layout: &self.sdf_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.params_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.moulds_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: self.sdf_grid_buffer.as_entire_binding(),
                },
            ],
        });

        let dc_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("DC Bind Group"),
            layout: &self.dc_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.params_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.sdf_grid_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: self.counters_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: self.vertices_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: self.indices_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: self.cell_to_vertex_buffer.as_entire_binding(),
                },
            ],
        });

        // Encode compute passes
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Compute Encoder"),
        });

        // Pass 1: Evaluate SDF grid
        let grid_size = resolution * resolution * resolution;
        let workgroup_size = 64;
        let sdf_workgroups = (grid_size + workgroup_size - 1) / workgroup_size;

        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("SDF Compute Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.sdf_pipeline);
            pass.set_bind_group(0, &sdf_bind_group, &[]);
            pass.dispatch_workgroups(sdf_workgroups, 1, 1);
        }

        // Pass 2: Detect surface cells and generate vertices
        let cell_count = (resolution - 1) * (resolution - 1) * (resolution - 1);
        let dc_workgroups = (cell_count + workgroup_size - 1) / workgroup_size;

        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("DC Detect Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.dc_detect_pipeline);
            pass.set_bind_group(0, &dc_bind_group, &[]);
            pass.dispatch_workgroups(dc_workgroups, 1, 1);
        }

        // Pass 3: Generate faces
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("DC Faces Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.dc_faces_pipeline);
            pass.set_bind_group(0, &dc_bind_group, &[]);
            pass.dispatch_workgroups(dc_workgroups, 1, 1);
        }

        // Copy results to staging buffers
        encoder.copy_buffer_to_buffer(
            &self.counters_buffer, 0,
            &self.counters_staging, 0,
            std::mem::size_of::<Counters>() as u64,
        );

        self.queue.submit(std::iter::once(encoder.finish()));

        // Read counters first to know how much data to read
        let counters_slice = self.counters_staging.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        counters_slice.map_async(wgpu::MapMode::Read, move |result| {
            tx.send(result).unwrap();
        });
        self.device.poll(wgpu::Maintain::Wait);
        rx.recv().unwrap().map_err(|e| format!("Failed to map counters: {:?}", e))?;

        let counters: Counters = {
            let data = counters_slice.get_mapped_range();
            *bytemuck::from_bytes(&data)
        };
        self.counters_staging.unmap();

        println!("GPU compute: {} vertices, {} indices", counters.vertex_count, counters.index_count);

        if counters.vertex_count == 0 || counters.index_count == 0 {
            return Ok(MeshData {
                vertices: vec![],
                indices: vec![],
                normals: vec![],
            });
        }

        // Copy vertex and index data
        let vertex_bytes = counters.vertex_count as u64 * 6 * std::mem::size_of::<f32>() as u64;
        let index_bytes = counters.index_count as u64 * std::mem::size_of::<u32>() as u64;

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Readback Encoder"),
        });

        encoder.copy_buffer_to_buffer(&self.vertices_buffer, 0, &self.vertices_staging, 0, vertex_bytes);
        encoder.copy_buffer_to_buffer(&self.indices_buffer, 0, &self.indices_staging, 0, index_bytes);

        self.queue.submit(std::iter::once(encoder.finish()));

        // Read vertices
        let vertices_slice = self.vertices_staging.slice(..vertex_bytes);
        let (tx, rx) = std::sync::mpsc::channel();
        vertices_slice.map_async(wgpu::MapMode::Read, move |result| {
            tx.send(result).unwrap();
        });
        self.device.poll(wgpu::Maintain::Wait);
        rx.recv().unwrap().map_err(|e| format!("Failed to map vertices: {:?}", e))?;

        let vertex_data: Vec<f32> = {
            let data = vertices_slice.get_mapped_range();
            bytemuck::cast_slice(&data).to_vec()
        };
        self.vertices_staging.unmap();

        // Read indices
        let indices_slice = self.indices_staging.slice(..index_bytes);
        let (tx, rx) = std::sync::mpsc::channel();
        indices_slice.map_async(wgpu::MapMode::Read, move |result| {
            tx.send(result).unwrap();
        });
        self.device.poll(wgpu::Maintain::Wait);
        rx.recv().unwrap().map_err(|e| format!("Failed to map indices: {:?}", e))?;

        let index_data: Vec<u32> = {
            let data = indices_slice.get_mapped_range();
            bytemuck::cast_slice(&data).to_vec()
        };
        self.indices_staging.unmap();

        // Separate vertices and normals for MeshData format
        let vertex_count = counters.vertex_count as usize;
        let mut vertices = Vec::with_capacity(vertex_count * 3);
        let mut normals = Vec::with_capacity(vertex_count * 3);

        for i in 0..vertex_count {
            vertices.push(vertex_data[i * 6]);
            vertices.push(vertex_data[i * 6 + 1]);
            vertices.push(vertex_data[i * 6 + 2]);
            normals.push(vertex_data[i * 6 + 3]);
            normals.push(vertex_data[i * 6 + 4]);
            normals.push(vertex_data[i * 6 + 5]);
        }

        Ok(MeshData {
            vertices,
            indices: index_data,
            normals,
        })
    }
}
