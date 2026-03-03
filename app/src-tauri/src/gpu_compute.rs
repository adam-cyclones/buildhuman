// GPU Compute Pipeline for Mesh Generation
// Evaluates SDF grid and generates mesh entirely on GPU
//
// Algorithm (surface voxelization, not true dual contouring):
// 1. SDF Evaluation: Compute signed distance at each grid vertex
// 2. Surface Cell Detection: Find cells where corners cross the iso-surface
// 3. Vertex Placement: One vertex per surface cell (at cell center)
// 4. Face Generation: Create quad faces between adjacent surface cells

use std::sync::Arc;
use wgpu::{Device, Queue};
use crate::mesh::types::{MeshData, MouldShape, Pt3, AABB};
use crate::mesh::sdf::sample_ring_at_angle;
use crate::mesh::mould::MouldManager;
use crate::mesh::brick_map::{BrickMap, BRICK_SIZE};

const BRICK_SDF_SIZE: u32 = BRICK_SIZE + 1;
const BRICK_SDF_VOXELS: u32 = BRICK_SDF_SIZE * BRICK_SDF_SIZE * BRICK_SDF_SIZE;
const BRICK_CELL_VOXELS: u32 = BRICK_SIZE * BRICK_SIZE * BRICK_SIZE;
const PROFILE_SEGMENTS: u32 = 8;
const PROFILE_RING_POINTS: u32 = 16;
const PROFILE_STRIDE: usize = (PROFILE_SEGMENTS * PROFILE_RING_POINTS) as usize;

/// GPU-compatible mould data (must match WGSL Mould struct layout exactly)
/// Layout: 3 vec4s = 48 bytes total
#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct GpuMould {
    // vec4 0: center.xyz + shape
    center: [f32; 3],
    shape: u32,  // 0=Sphere, 1=Capsule, 2=ProfiledCapsule
    // vec4 1: end_point.xyz + radius
    end_point: [f32; 3],
    radius: f32,
    // vec4 2: blend_radius + separation_bias + blend_group + profile_offset
    blend_radius: f32,
    separation_bias: f32,
    blend_group: u32,
    profile_offset: u32,
    // vec4 3: profile_segments + profile_ring_points + profile_flags + padding
    profile_segments: u32,
    profile_ring_points: u32,
    profile_flags: u32,
    _padding: u32,
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

/// Sparse brick metadata for GPU (brick grid coordinates)
#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct BrickMeta {
    coord: [u32; 3],
    _pad: u32,
}

/// Sparse params for GPU (brick count)
#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct SparseParams {
    data: [[u32; 4]; 7],
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
    // Surface Nets pipelines (uses same bind group as DC)
    sn_detect_pipeline: wgpu::ComputePipeline,
    sn_faces_pipeline: wgpu::ComputePipeline,
    // Sparse brick pipelines
    sparse_sdf_pipeline: wgpu::ComputePipeline,
    sparse_dc_detect_pipeline: wgpu::ComputePipeline,
    sparse_dc_faces_pipeline: wgpu::ComputePipeline,
    sparse_bind_group_layout: wgpu::BindGroupLayout,
    // Buffers (reused between frames)
    params_buffer: wgpu::Buffer,
    moulds_buffer: wgpu::Buffer,
    sdf_grid_buffer: wgpu::Buffer,
    profile_data_buffer: wgpu::Buffer,
    counters_buffer: wgpu::Buffer,
    vertices_buffer: wgpu::Buffer,
    indices_buffer: wgpu::Buffer,
    cell_to_vertex_buffer: wgpu::Buffer,
    // Sparse brick buffers
    sparse_params_buffer: wgpu::Buffer,
    sparse_brick_meta_buffer: wgpu::Buffer,
    sparse_sdf_buffer: wgpu::Buffer,
    sparse_cell_to_vertex_buffer: wgpu::Buffer,
    sparse_brick_index_buffer: wgpu::Buffer,
    // Staging buffers for readback
    counters_staging: wgpu::Buffer,
    vertices_staging: wgpu::Buffer,
    indices_staging: wgpu::Buffer,
    // Current resolution (for buffer sizing)
    current_resolution: u32,
    max_moulds: u32,
    // Current sparse brick capacity
    sparse_brick_capacity: u32,
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

        let sparse_sdf_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Sparse SDF Compute Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/sdf_compute_sparse.wgsl").into()),
        });

        let sparse_dc_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Sparse DC Compute Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/dual_contouring_sparse.wgsl").into()),
        });

        let surface_nets_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Surface Nets Compute Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/surface_nets.wgsl").into()),
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
                // profile_data: storage read
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
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

        // Sparse bind group layout (shared for sparse SDF + DC passes)
        let sparse_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Sparse Bind Group Layout"),
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
                // sparse_params: uniform
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
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
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // brick_meta: storage read
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // sdf_bricks: storage read_write
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
                // counters: storage read_write
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
                // vertices: storage read_write
                wgpu::BindGroupLayoutEntry {
                    binding: 6,
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
                    binding: 7,
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
                    binding: 8,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // brick_index_grid: storage read
                wgpu::BindGroupLayoutEntry {
                    binding: 9,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
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

        // Surface Nets pipelines (uses same bind group layout as DC)
        let sn_detect_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Surface Nets Detect Pipeline"),
            layout: Some(&dc_pipeline_layout),
            module: &surface_nets_shader,
            entry_point: Some("detect_surface_cells"),
            compilation_options: Default::default(),
            cache: None,
        });

        let sn_faces_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Surface Nets Faces Pipeline"),
            layout: Some(&dc_pipeline_layout),
            module: &surface_nets_shader,
            entry_point: Some("generate_faces"),
            compilation_options: Default::default(),
            cache: None,
        });

        let sparse_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Sparse Pipeline Layout"),
            bind_group_layouts: &[&sparse_bind_group_layout],
            push_constant_ranges: &[],
        });

        let sparse_sdf_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Sparse SDF Compute Pipeline"),
            layout: Some(&sparse_pipeline_layout),
            module: &sparse_sdf_shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let sparse_dc_detect_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Sparse DC Detect Pipeline"),
            layout: Some(&sparse_pipeline_layout),
            module: &sparse_dc_shader,
            entry_point: Some("detect_surface_cells"),
            compilation_options: Default::default(),
            cache: None,
        });

        let sparse_dc_faces_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Sparse DC Faces Pipeline"),
            layout: Some(&sparse_pipeline_layout),
            module: &sparse_dc_shader,
            entry_point: Some("generate_faces"),
            compilation_options: Default::default(),
            cache: None,
        });

        // Initial buffer sizes for resolution 64, max 64 moulds
        let initial_resolution = 64u32;
        let max_moulds = 64u32;
        let (params_buffer, moulds_buffer, sdf_grid_buffer, profile_data_buffer, counters_buffer,
             vertices_buffer, indices_buffer, cell_to_vertex_buffer,
             counters_staging, vertices_staging, indices_staging) =
            Self::create_buffers(&device, initial_resolution, max_moulds);

        let (sparse_params_buffer, sparse_brick_meta_buffer, sparse_sdf_buffer, sparse_cell_to_vertex_buffer, sparse_brick_index_buffer) =
            Self::create_sparse_buffers(&device, 1, 1);

        Self {
            device,
            queue,
            sdf_pipeline,
            sdf_bind_group_layout,
            dc_detect_pipeline,
            dc_faces_pipeline,
            dc_bind_group_layout,
            sn_detect_pipeline,
            sn_faces_pipeline,
            sparse_sdf_pipeline,
            sparse_dc_detect_pipeline,
            sparse_dc_faces_pipeline,
            sparse_bind_group_layout,
            params_buffer,
            moulds_buffer,
            sdf_grid_buffer,
            profile_data_buffer,
            counters_buffer,
            vertices_buffer,
            indices_buffer,
            cell_to_vertex_buffer,
            sparse_params_buffer,
            sparse_brick_meta_buffer,
            sparse_sdf_buffer,
            sparse_cell_to_vertex_buffer,
            sparse_brick_index_buffer,
            counters_staging,
            vertices_staging,
            indices_staging,
            current_resolution: initial_resolution,
            max_moulds,
            sparse_brick_capacity: 1,
        }
    }

    fn create_buffers(
        device: &Device,
        resolution: u32,
        max_moulds: u32,
    ) -> (
        wgpu::Buffer, wgpu::Buffer, wgpu::Buffer, wgpu::Buffer, wgpu::Buffer,
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

        let profile_data_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Profile Data Buffer"),
            size: (max_moulds as usize * PROFILE_STRIDE * std::mem::size_of::<f32>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
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

        (params_buffer, moulds_buffer, sdf_grid_buffer, profile_data_buffer, counters_buffer,
         vertices_buffer, indices_buffer, cell_to_vertex_buffer,
         counters_staging, vertices_staging, indices_staging)
    }

    fn create_sparse_buffers(
        device: &Device,
        brick_capacity: u32,
        brick_index_grid_len: u32,
    ) -> (wgpu::Buffer, wgpu::Buffer, wgpu::Buffer, wgpu::Buffer, wgpu::Buffer) {
        let sdf_size = brick_capacity as u64 * BRICK_SDF_VOXELS as u64 * std::mem::size_of::<f32>() as u64;
        let cell_map_size = brick_capacity as u64 * BRICK_CELL_VOXELS as u64 * std::mem::size_of::<u32>() as u64;
        let brick_meta_size = brick_capacity as u64 * std::mem::size_of::<BrickMeta>() as u64;
        let brick_index_size = brick_index_grid_len as u64 * std::mem::size_of::<u32>() as u64;

        let sparse_params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Sparse Params Buffer"),
            size: std::mem::size_of::<SparseParams>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let sparse_brick_meta_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Sparse Brick Meta Buffer"),
            size: brick_meta_size.max(4),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let sparse_sdf_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Sparse SDF Buffer"),
            size: sdf_size.max(4),
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });

        let sparse_cell_to_vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Sparse Cell To Vertex Buffer"),
            size: cell_map_size.max(4),
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });

        let sparse_brick_index_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Sparse Brick Index Buffer"),
            size: brick_index_size.max(4),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        (
            sparse_params_buffer,
            sparse_brick_meta_buffer,
            sparse_sdf_buffer,
            sparse_cell_to_vertex_buffer,
            sparse_brick_index_buffer,
        )
    }

    fn ensure_sparse_buffer_size(&mut self, brick_capacity: u32, brick_index_grid_len: u32) {
        let need_index_resize = {
            let wanted = brick_index_grid_len as u64 * std::mem::size_of::<u32>() as u64;
            wanted > self.sparse_brick_index_buffer.size()
        };

        if brick_capacity <= self.sparse_brick_capacity && !need_index_resize {
            return;
        }

        let (sparse_params_buffer, sparse_brick_meta_buffer, sparse_sdf_buffer, sparse_cell_to_vertex_buffer, sparse_brick_index_buffer) =
            Self::create_sparse_buffers(&self.device, brick_capacity, brick_index_grid_len);

        self.sparse_params_buffer = sparse_params_buffer;
        self.sparse_brick_meta_buffer = sparse_brick_meta_buffer;
        self.sparse_sdf_buffer = sparse_sdf_buffer;
        self.sparse_cell_to_vertex_buffer = sparse_cell_to_vertex_buffer;
        self.sparse_brick_index_buffer = sparse_brick_index_buffer;
        self.sparse_brick_capacity = brick_capacity;
    }

    /// Resize buffers if resolution changed
    fn ensure_buffer_size(&mut self, resolution: u32) {
        if resolution != self.current_resolution {
            let (params_buffer, moulds_buffer, sdf_grid_buffer, profile_data_buffer, counters_buffer,
                 vertices_buffer, indices_buffer, cell_to_vertex_buffer,
                 counters_staging, vertices_staging, indices_staging) =
                Self::create_buffers(&self.device, resolution, self.max_moulds);

            self.params_buffer = params_buffer;
            self.moulds_buffer = moulds_buffer;
            self.sdf_grid_buffer = sdf_grid_buffer;
            self.profile_data_buffer = profile_data_buffer;
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

    /// Resize only the vertex/index output buffers and their staging counterparts.
    /// Used by the sparse path so it sizes output to actual brick count rather than (res-1)^3.
    fn ensure_output_buffer_size(&mut self, max_vertices: usize) {
        let vertex_bytes = (max_vertices * 6 * std::mem::size_of::<f32>()) as u64;
        let index_bytes = (max_vertices * 6 * std::mem::size_of::<u32>()) as u64;

        if vertex_bytes > self.vertices_buffer.size() {
            self.vertices_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Vertices Buffer"),
                size: vertex_bytes,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            self.vertices_staging = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Vertices Staging Buffer"),
                size: vertex_bytes,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            println!("Resized vertex output buffer: {} MB", vertex_bytes / 1024 / 1024);
        }

        if index_bytes > self.indices_buffer.size() {
            self.indices_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Indices Buffer"),
                size: index_bytes,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            self.indices_staging = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Indices Staging Buffer"),
                size: index_bytes,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            println!("Resized index output buffer: {} MB", index_bytes / 1024 / 1024);
        }
    }

    fn build_gpu_moulds_and_profiles(
        world_moulds: &[crate::mesh::mould::WorldSpaceMould],
    ) -> (Vec<GpuMould>, Vec<f32>) {
        let mut gpu_moulds = Vec::with_capacity(world_moulds.len());
        let mut profile_data = vec![0.0f32; world_moulds.len() * PROFILE_STRIDE];

        for (i, mould) in world_moulds.iter().enumerate() {
            let mut shape = match mould.shape {
                MouldShape::Sphere => 0u32,
                MouldShape::Capsule => 1u32,
                MouldShape::ProfiledCapsule => 2u32,
            };

            let mut profile_segments = 0u32;
            let mut profile_ring_points = 0u32;
            let mut profile_flags = 0u32;

            if mould.shape == MouldShape::ProfiledCapsule {
                if let Some(ref profiles) = mould.radial_profiles {
                    if !profiles.is_empty() && !profiles[0].is_empty() {
                        profile_segments = profiles.len().min(PROFILE_SEGMENTS as usize) as u32;
                        profile_ring_points = PROFILE_RING_POINTS;
                        if mould.use_splines {
                            profile_flags |= 1u32;
                        }

                        let ring_count = PROFILE_RING_POINTS as usize;
                        for seg_idx in 0..profile_segments as usize {
                            let ring = &profiles[seg_idx];
                            for ring_idx in 0..ring_count {
                                let angle = (ring_idx as f32 / ring_count as f32)
                                    * 2.0
                                    * std::f32::consts::PI;
                                let radius = sample_ring_at_angle(ring, angle, mould.use_splines);
                                let dst = i * PROFILE_STRIDE
                                    + seg_idx * PROFILE_RING_POINTS as usize
                                    + ring_idx;
                                profile_data[dst] = radius;
                            }
                        }
                    } else {
                        shape = 1u32;
                    }
                } else {
                    shape = 1u32;
                }
            }

            let end = mould.world_end.unwrap_or(mould.world_center);
            gpu_moulds.push(GpuMould {
                center: [mould.world_center.x, mould.world_center.y, mould.world_center.z],
                shape,
                end_point: [end.x, end.y, end.z],
                radius: mould.radius,
                blend_radius: mould.blend_radius,
                separation_bias: mould.separation_bias,
                blend_group: mould.blend_group,
                profile_offset: (i * PROFILE_STRIDE) as u32,
                profile_segments,
                profile_ring_points,
                profile_flags,
                _padding: 0,
            });
        }

        (gpu_moulds, profile_data)
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
        let world_moulds = mould_manager.get_moulds_world_space();
        let (gpu_moulds, profile_data) = Self::build_gpu_moulds_and_profiles(&world_moulds);

        if gpu_moulds.is_empty() {
            return Err("No moulds to render".to_string());
        }

        // Calculate cubic grid bounds centered on the original AABB
        // This avoids axis-biased sampling when bounds are non-cubic.
        let extent = Pt3::new(
            bounds.max.x - bounds.min.x,
            bounds.max.y - bounds.min.y,
            bounds.max.z - bounds.min.z,
        );
        let max_extent = extent.x.max(extent.y).max(extent.z);
        let center = Pt3::new(
            (bounds.min.x + bounds.max.x) * 0.5,
            (bounds.min.y + bounds.max.y) * 0.5,
            (bounds.min.z + bounds.max.z) * 0.5,
        );
        let half = max_extent * 0.5;
        let grid_min = Pt3::new(center.x - half, center.y - half, center.z - half);
        let grid_max = Pt3::new(center.x + half, center.y + half, center.z + half);
        let cell_size = max_extent / (resolution as f32 - 1.0);

        // Upload params
        let params = GridParams {
            resolution,
            _pad0: [0; 3],
            bounds_min: [grid_min.x, grid_min.y, grid_min.z, 0.0],
            bounds_max: [grid_max.x, grid_max.y, grid_max.z],
            cell_size,
            num_moulds: gpu_moulds.len() as u32,
            iso_value: 0.0,
            _pad1: [0.0; 2],
        };
        self.queue.write_buffer(&self.params_buffer, 0, bytemuck::cast_slice(&[params]));

        // Upload moulds
        self.queue.write_buffer(&self.moulds_buffer, 0, bytemuck::cast_slice(&gpu_moulds));
        self.queue.write_buffer(&self.profile_data_buffer, 0, bytemuck::cast_slice(&profile_data));

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
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: self.profile_data_buffer.as_entire_binding(),
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

    /// Generate mesh using Surface Nets algorithm (simpler than DC, more robust)
    pub async fn generate_mesh_surface_nets(
        &mut self,
        mould_manager: &MouldManager,
        resolution: u32,
        bounds: AABB,
    ) -> Result<MeshData, String> {
        self.ensure_buffer_size(resolution);

        // Get world-space moulds
        let world_moulds = mould_manager.get_moulds_world_space();
        let (gpu_moulds, profile_data) = Self::build_gpu_moulds_and_profiles(&world_moulds);

        if gpu_moulds.is_empty() {
            return Err("No moulds to render".to_string());
        }

        // Calculate cubic grid bounds centered on the original AABB
        let extent = Pt3::new(
            bounds.max.x - bounds.min.x,
            bounds.max.y - bounds.min.y,
            bounds.max.z - bounds.min.z,
        );
        let max_extent = extent.x.max(extent.y).max(extent.z);
        let center = Pt3::new(
            (bounds.min.x + bounds.max.x) * 0.5,
            (bounds.min.y + bounds.max.y) * 0.5,
            (bounds.min.z + bounds.max.z) * 0.5,
        );
        let half = max_extent * 0.5;
        let grid_min = Pt3::new(center.x - half, center.y - half, center.z - half);
        let grid_max = Pt3::new(center.x + half, center.y + half, center.z + half);
        let cell_size = max_extent / (resolution as f32 - 1.0);

        // Upload params
        let params = GridParams {
            resolution,
            _pad0: [0; 3],
            bounds_min: [grid_min.x, grid_min.y, grid_min.z, 0.0],
            bounds_max: [grid_max.x, grid_max.y, grid_max.z],
            cell_size,
            num_moulds: gpu_moulds.len() as u32,
            iso_value: 0.0,
            _pad1: [0.0; 2],
        };
        self.queue.write_buffer(&self.params_buffer, 0, bytemuck::cast_slice(&[params]));
        self.queue.write_buffer(&self.moulds_buffer, 0, bytemuck::cast_slice(&gpu_moulds));
        self.queue.write_buffer(&self.profile_data_buffer, 0, bytemuck::cast_slice(&profile_data));

        // Reset counters
        let zero_counters = Counters { vertex_count: 0, index_count: 0 };
        self.queue.write_buffer(&self.counters_buffer, 0, bytemuck::cast_slice(&[zero_counters]));

        // Create bind groups (same as DC)
        let sdf_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("SDF Bind Group"),
            layout: &self.sdf_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: self.params_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: self.moulds_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: self.sdf_grid_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: self.profile_data_buffer.as_entire_binding() },
            ],
        });

        let sn_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Surface Nets Bind Group"),
            layout: &self.dc_bind_group_layout,  // Same layout as DC
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: self.params_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: self.sdf_grid_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: self.counters_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: self.vertices_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 4, resource: self.indices_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 5, resource: self.cell_to_vertex_buffer.as_entire_binding() },
            ],
        });

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Surface Nets Compute Encoder"),
        });

        let workgroup_size = 64u32;

        // Pass 1: Evaluate SDF grid
        let grid_size = resolution * resolution * resolution;
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

        // Pass 2: Surface Nets - detect cells and place vertices
        let cell_count = (resolution - 1) * (resolution - 1) * (resolution - 1);
        let sn_workgroups = (cell_count + workgroup_size - 1) / workgroup_size;
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Surface Nets Detect Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.sn_detect_pipeline);
            pass.set_bind_group(0, &sn_bind_group, &[]);
            pass.dispatch_workgroups(sn_workgroups, 1, 1);
        }

        // Pass 3: Surface Nets - generate faces
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Surface Nets Faces Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.sn_faces_pipeline);
            pass.set_bind_group(0, &sn_bind_group, &[]);
            pass.dispatch_workgroups(sn_workgroups, 1, 1);
        }

        // Copy counters to staging
        encoder.copy_buffer_to_buffer(
            &self.counters_buffer, 0,
            &self.counters_staging, 0,
            std::mem::size_of::<Counters>() as u64,
        );

        self.queue.submit(std::iter::once(encoder.finish()));

        // Read counters
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

        println!("Surface Nets: {} vertices, {} indices", counters.vertex_count, counters.index_count);

        if counters.vertex_count == 0 || counters.index_count == 0 {
            return Ok(MeshData {
                vertices: vec![],
                indices: vec![],
                normals: vec![],
            });
        }

        // Read back vertex and index data
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

        // Separate vertices and normals
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

    /// Generate mesh using sparse brick dispatch on GPU (fast path for realtime)
    pub async fn generate_mesh_sparse(
        &mut self,
        mould_manager: &MouldManager,
        resolution: u32,
        bounds: AABB,
        fast_mode: bool,
    ) -> Result<MeshData, String> {
        // Find surface bricks FIRST — before allocating any GPU output buffers.
        // This lets us size vertex/index output to actual surface geometry rather
        // than the (resolution-1)^3 worst case that overflows at resolution 256.
        let surface_thickness = 0.2;
        let brick_coords = BrickMap::compute_surface_brick_coords(
            resolution,
            &bounds,
            mould_manager,
            surface_thickness,
        );

        if brick_coords.is_empty() {
            return Ok(MeshData {
                vertices: vec![],
                indices: vec![],
                normals: vec![],
            });
        }

        let brick_count = brick_coords.len() as u32;
        let brick_axis = resolution / BRICK_SIZE;
        let brick_index_grid_len = brick_axis * brick_axis * brick_axis;

        // Allocate output buffers sized to actual brick surface, not (res-1)^3
        let max_vertices = (brick_count * BRICK_CELL_VOXELS) as usize;
        self.ensure_output_buffer_size(max_vertices);
        self.ensure_sparse_buffer_size(brick_count, brick_index_grid_len);

        // Get world-space moulds (with skeleton transforms applied)
        let world_moulds = mould_manager.get_moulds_world_space();
        let (gpu_moulds, profile_data) = Self::build_gpu_moulds_and_profiles(&world_moulds);

        if gpu_moulds.is_empty() {
            return Err("No moulds to render".to_string());
        }

        // Calculate cubic grid bounds centered on the original AABB
        let extent = Pt3::new(
            bounds.max.x - bounds.min.x,
            bounds.max.y - bounds.min.y,
            bounds.max.z - bounds.min.z,
        );
        let max_extent = extent.x.max(extent.y).max(extent.z);
        let center = Pt3::new(
            (bounds.min.x + bounds.max.x) * 0.5,
            (bounds.min.y + bounds.max.y) * 0.5,
            (bounds.min.z + bounds.max.z) * 0.5,
        );
        let half = max_extent * 0.5;
        let grid_min = Pt3::new(center.x - half, center.y - half, center.z - half);
        let grid_max = Pt3::new(center.x + half, center.y + half, center.z + half);
        let cell_size = max_extent / (resolution as f32 - 1.0);

        let params = GridParams {
            resolution,
            _pad0: [0; 3],
            bounds_min: [grid_min.x, grid_min.y, grid_min.z, 0.0],
            bounds_max: [grid_max.x, grid_max.y, grid_max.z],
            cell_size,
            num_moulds: gpu_moulds.len() as u32,
            iso_value: 0.0,
            _pad1: [0.0; 2],
        };
        self.queue.write_buffer(&self.params_buffer, 0, bytemuck::cast_slice(&[params]));

        let mut sparse_params = SparseParams { data: [[0; 4]; 7] };
        sparse_params.data[0][0] = brick_count;
        sparse_params.data[0][1] = if fast_mode { 1 } else { 0 };
        self.queue.write_buffer(&self.sparse_params_buffer, 0, bytemuck::cast_slice(&[sparse_params]));

        let brick_meta: Vec<BrickMeta> = brick_coords
            .iter()
            .map(|coord| BrickMeta {
                coord: [coord.x as u32, coord.y as u32, coord.z as u32],
                _pad: 0,
            })
            .collect();

        self.queue.write_buffer(&self.moulds_buffer, 0, bytemuck::cast_slice(&gpu_moulds));
        self.queue.write_buffer(&self.profile_data_buffer, 0, bytemuck::cast_slice(&profile_data));
        self.queue.write_buffer(&self.sparse_brick_meta_buffer, 0, bytemuck::cast_slice(&brick_meta));

        let mut brick_index_grid = vec![u32::MAX; brick_index_grid_len as usize];
        for (idx, coord) in brick_coords.iter().enumerate() {
            let x = coord.x as u32;
            let y = coord.y as u32;
            let z = coord.z as u32;
            let grid_index = x + y * brick_axis + z * brick_axis * brick_axis;
            brick_index_grid[grid_index as usize] = idx as u32;
        }
        self.queue.write_buffer(
            &self.sparse_brick_index_buffer,
            0,
            bytemuck::cast_slice(&brick_index_grid),
        );

        // Reset counters
        let zero_counters = Counters {
            vertex_count: 0,
            index_count: 0,
        };
        self.queue.write_buffer(&self.counters_buffer, 0, bytemuck::cast_slice(&[zero_counters]));

        let sparse_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Sparse Bind Group"),
            layout: &self.sparse_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.params_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.sparse_params_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: self.moulds_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: self.sparse_brick_meta_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: self.sparse_sdf_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: self.counters_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: self.vertices_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: self.indices_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 8,
                    resource: self.sparse_cell_to_vertex_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 9,
                    resource: self.sparse_brick_index_buffer.as_entire_binding(),
                },
            ],
        });

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Sparse Compute Encoder"),
        });

        let workgroup_size = 64;
        let sdf_invocations = brick_count * BRICK_SDF_VOXELS;
        let sdf_workgroups = (sdf_invocations + workgroup_size - 1) / workgroup_size;

        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Sparse SDF Compute Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.sparse_sdf_pipeline);
            pass.set_bind_group(0, &sparse_bind_group, &[]);
            pass.dispatch_workgroups(sdf_workgroups, 1, 1);
        }

        let dc_invocations = brick_count * BRICK_CELL_VOXELS;
        let dc_workgroups = (dc_invocations + workgroup_size - 1) / workgroup_size;

        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Sparse DC Detect Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.sparse_dc_detect_pipeline);
            pass.set_bind_group(0, &sparse_bind_group, &[]);
            pass.dispatch_workgroups(dc_workgroups, 1, 1);
        }

        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Sparse DC Faces Pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.sparse_dc_faces_pipeline);
            pass.set_bind_group(0, &sparse_bind_group, &[]);
            pass.dispatch_workgroups(dc_workgroups, 1, 1);
        }

        encoder.copy_buffer_to_buffer(
            &self.counters_buffer, 0,
            &self.counters_staging, 0,
            std::mem::size_of::<Counters>() as u64,
        );

        self.queue.submit(std::iter::once(encoder.finish()));

        // Read counters
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

        if counters.vertex_count == 0 || counters.index_count == 0 {
            return Ok(MeshData {
                vertices: vec![],
                indices: vec![],
                normals: vec![],
            });
        }

        let vertex_bytes = counters.vertex_count as u64 * 6 * std::mem::size_of::<f32>() as u64;
        let index_bytes = counters.index_count as u64 * std::mem::size_of::<u32>() as u64;

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Sparse Readback Encoder"),
        });

        encoder.copy_buffer_to_buffer(&self.vertices_buffer, 0, &self.vertices_staging, 0, vertex_bytes);
        encoder.copy_buffer_to_buffer(&self.indices_buffer, 0, &self.indices_staging, 0, index_bytes);

        self.queue.submit(std::iter::once(encoder.finish()));

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
