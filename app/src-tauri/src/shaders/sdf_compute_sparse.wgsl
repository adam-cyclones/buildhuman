// Sparse SDF Evaluation Compute Shader (Brick-based)
// Evaluates SDF only for active bricks

const BRICK_SIZE: u32 = 8u;
const BRICK_SDF_SIZE: u32 = BRICK_SIZE + 1u;
const BRICK_SDF_VOXELS: u32 = BRICK_SDF_SIZE * BRICK_SDF_SIZE * BRICK_SDF_SIZE;

// Grid parameters (must match Rust GridParams layout exactly - 64 bytes total)
struct GridParams {
    resolution_pad: vec4<u32>,  // x = resolution, yzw = padding (offset 0)
    bounds_min: vec4<f32>,      // xyz = min bounds, w = unused (offset 16)
    bounds_max_cell: vec4<f32>, // xyz = max bounds, w = cell_size (offset 32)
    num_moulds: u32,            // offset 48
    iso_value: f32,             // offset 52
    _pad: vec2<f32>,            // offset 56, padding to 64
};

struct SparseParams {
    data: array<vec4<u32>, 7>,
};

// Mould primitive data (matches Rust MouldData)
// Packed for GPU alignment (16-byte aligned)
struct Mould {
    // vec4 0: center.xyz + shape
    center: vec3<f32>,
    shape: u32,  // 0=Sphere, 1=Capsule, 2=ProfiledCapsule

    // vec4 1: end_point.xyz + radius
    end_point: vec3<f32>,
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
};

struct BrickMeta {
    coord: vec3<u32>,
    _pad: u32,
};

// Bind groups
@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<uniform> sparse_params: SparseParams;
@group(0) @binding(2) var<storage, read> moulds: array<Mould>;
@group(0) @binding(3) var<storage, read> brick_meta: array<BrickMeta>;
@group(0) @binding(4) var<storage, read_write> sdf_bricks: array<f32>;

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
    if (k < 0.0001) {
        return min(a, b);
    }
    let h = max(k - abs(a - b), 0.0);
    return min(a, b) - h * h * 0.25 / k;
}

// Union with separation bias to discourage merging between unrelated parts
fn union_with_separation(a: f32, b: f32, separation: f32) -> f32 {
    let m = min(a, b);
    if (a < 0.0 && b < 0.0) {
        return m + separation;
    }
    return m;
}

// Convert 1D index to 3D coords in [0..BRICK_SDF_SIZE)
fn index_to_coords(index: u32) -> vec3<u32> {
    let x = index % BRICK_SDF_SIZE;
    let y = (index / BRICK_SDF_SIZE) % BRICK_SDF_SIZE;
    let z = index / (BRICK_SDF_SIZE * BRICK_SDF_SIZE);
    return vec3<u32>(x, y, z);
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let brick_index = index / BRICK_SDF_VOXELS;

    if (brick_index >= sparse_params.data[0].x) {
        return;
    }

    let local_index = index - brick_index * BRICK_SDF_VOXELS;
    let local = index_to_coords(local_index);

    let brick = brick_meta[brick_index];
    let brick_origin = brick.coord * BRICK_SIZE;

    let global_voxel = brick_origin + local;
    let cell_size = params.bounds_max_cell.w;
    let bounds_min = params.bounds_min.xyz;
    let world_pos = bounds_min + vec3<f32>(global_voxel) * cell_size;

    var result = 1e10;
    var best_group: u32 = 0u;
    var best_sep: f32 = 0.0;
    var initialized = false;

    for (var i = 0u; i < params.num_moulds; i++) {
        let mould = moulds[i];
        var sdf_value: f32;

        if (mould.shape == 0u) {
            sdf_value = sphere_sdf(world_pos, mould.center, mould.radius);
        } else if (mould.shape == 1u) {
            sdf_value = capsule_sdf(world_pos, mould.center, mould.end_point, mould.radius);
        } else {
            sdf_value = capsule_sdf(world_pos, mould.center, mould.end_point, mould.radius);
        }

        if (!initialized) {
            result = sdf_value;
            best_group = mould.blend_group;
            best_sep = mould.separation_bias;
            initialized = true;
            continue;
        }

        let compatible = (best_group == 0u) || (mould.blend_group == 0u) || (best_group == mould.blend_group);

        if (compatible) {
            result = smooth_min_poly(result, sdf_value, mould.blend_radius);
            if (best_group == 0u || mould.blend_group == 0u) {
                best_group = 0u;
                best_sep = max(best_sep, mould.separation_bias);
            }
        } else {
            let min_before = min(result, sdf_value);
            let separation = max(best_sep, mould.separation_bias);
            result = union_with_separation(result, sdf_value, separation);
            if (sdf_value <= min_before) {
                best_group = mould.blend_group;
                best_sep = mould.separation_bias;
            }
        }
    }

    let out_index = brick_index * BRICK_SDF_VOXELS + local_index;
    sdf_bricks[out_index] = result;
}
