// SDF Evaluation Compute Shader
// Evaluates signed distance field for voxel grid in parallel
// Each thread handles one voxel

// Grid parameters (must match Rust GridParams layout exactly - 64 bytes total)
struct GridParams {
    resolution_pad: vec4<u32>,  // x = resolution, yzw = padding (offset 0)
    bounds_min: vec4<f32>,      // xyz = min bounds, w = unused (offset 16)
    bounds_max_cell: vec4<f32>, // xyz = max bounds, w = cell_size (offset 32)
    num_moulds: u32,            // offset 48
    iso_value: f32,             // offset 52
    _pad: vec2<f32>,            // offset 56, padding to 64
};

// Mould primitive data (matches Rust MouldData)
// Packed for GPU alignment (16-byte aligned)
struct Mould {
    // vec4 0: center.xyz + shape
    center: vec3<f32>,
    shape: u32,  // 0=Sphere, 1=Capsule, 2=ProfiledCapsule (not supported in GPU yet)

    // vec4 1: end_point.xyz + radius
    end_point: vec3<f32>,
    radius: f32,

    // vec4 2: blend_radius + padding
    blend_radius: f32,
    _padding: vec3<f32>,
};

// Bind groups
@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<storage, read> moulds: array<Mould>;
@group(0) @binding(2) var<storage, read_write> sdf_grid: array<f32>;

// SDF primitives
fn sphere_sdf(point: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
    return length(point - center) - radius;
}

fn capsule_sdf(point: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radius: f32) -> f32 {
    let ba = b - a;
    let pa = point - a;
    let ba_dot = dot(ba, ba);

    if (ba_dot < 1e-8) {
        // Degenerate capsule, treat as sphere
        return length(point - a) - radius;
    }

    let h = clamp(dot(pa, ba) / ba_dot, 0.0, 1.0);
    let closest = a + ba * h;
    return length(point - closest) - radius;
}

// Smooth minimum for blending SDFs
fn smooth_min_poly(a: f32, b: f32, k: f32) -> f32 {
    // Guard against zero blend radius (would cause division by zero)
    if (k < 0.0001) {
        return min(a, b);
    }
    let h = max(k - abs(a - b), 0.0);
    return min(a, b) - h * h * 0.25 / k;
}

// Convert 1D index to 3D grid coordinates
fn index_to_coords(index: u32, res: u32) -> vec3<u32> {
    let x = index % res;
    let y = (index / res) % res;
    let z = index / (res * res);
    return vec3<u32>(x, y, z);
}

// Convert grid coordinates to world position
fn grid_to_world(coords: vec3<u32>, cell_size: f32, bounds_min: vec3<f32>) -> vec3<f32> {
    return bounds_min + vec3<f32>(coords) * cell_size;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let resolution = params.resolution_pad.x;
    let total_voxels = resolution * resolution * resolution;

    if (index >= total_voxels) {
        return;
    }

    // Get 3D coordinates and world position
    let coords = index_to_coords(index, resolution);
    let cell_size = params.bounds_max_cell.w;
    let bounds_min = params.bounds_min.xyz;
    let world_pos = grid_to_world(coords, cell_size, bounds_min);

    // Evaluate SDF for all moulds
    var result = 1e10;  // Large positive = far outside

    for (var i = 0u; i < params.num_moulds; i++) {
        let mould = moulds[i];
        var sdf_value: f32;

        if (mould.shape == 0u) {
            // Sphere
            sdf_value = sphere_sdf(world_pos, mould.center, mould.radius);
        } else if (mould.shape == 1u) {
            // Capsule
            sdf_value = capsule_sdf(world_pos, mould.center, mould.end_point, mould.radius);
        } else {
            // ProfiledCapsule - fallback to capsule for now
            // Full profiled capsule support requires texture lookups for radial profiles
            sdf_value = capsule_sdf(world_pos, mould.center, mould.end_point, mould.radius);
        }

        // Blend with smooth min
        result = smooth_min_poly(result, sdf_value, mould.blend_radius);
    }

    sdf_grid[index] = result;
}
