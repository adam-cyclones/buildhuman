// Sparse Dual Contouring Compute Shader (Brick-based)
// Phase 1: Detect surface cells and generate vertices
// Phase 2: Generate face indices between adjacent cells

const BRICK_SIZE: u32 = 8u;
const BRICK_SDF_SIZE: u32 = BRICK_SIZE + 1u;
const BRICK_SDF_VOXELS: u32 = BRICK_SDF_SIZE * BRICK_SDF_SIZE * BRICK_SDF_SIZE;
const BRICK_CELL_VOXELS: u32 = BRICK_SIZE * BRICK_SIZE * BRICK_SIZE;

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

struct BrickMeta {
    coord: vec3<u32>,
    _pad: u32,
};

struct Mould {
    center: vec3<f32>,
    shape: u32,
    end_point: vec3<f32>,
    radius: f32,
    blend_radius: f32,
    separation_bias: f32,
    blend_group: u32,
    profile_offset: u32,
    profile_segments: u32,
    profile_ring_points: u32,
    profile_flags: u32,
    _padding: u32,
};

struct Counters {
    vertex_count: atomic<u32>,
    index_count: atomic<u32>,
};

// Bind groups
@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<uniform> sparse_params: SparseParams;
@group(0) @binding(2) var<storage, read> moulds: array<Mould>;
@group(0) @binding(3) var<storage, read> brick_meta: array<BrickMeta>;
@group(0) @binding(4) var<storage, read_write> sdf_bricks: array<f32>;
@group(0) @binding(5) var<storage, read_write> counters: Counters;
@group(0) @binding(6) var<storage, read_write> vertices: array<f32>;  // [x, y, z, nx, ny, nz, ...]
@group(0) @binding(7) var<storage, read_write> indices: array<u32>;
@group(0) @binding(8) var<storage, read_write> cell_to_vertex: array<u32>;
@group(0) @binding(9) var<storage, read> brick_index_grid: array<u32>;

const INVALID_VERTEX: u32 = 0xFFFFFFFFu;

fn sdf_index(x: u32, y: u32, z: u32) -> u32 {
    return x + y * BRICK_SDF_SIZE + z * BRICK_SDF_SIZE * BRICK_SDF_SIZE;
}

fn cell_index(x: u32, y: u32, z: u32) -> u32 {
    return x + y * BRICK_SIZE + z * BRICK_SIZE * BRICK_SIZE;
}

fn get_sdf(brick_index: u32, x: u32, y: u32, z: u32) -> f32 {
    let idx = brick_index * BRICK_SDF_VOXELS + sdf_index(x, y, z);
    return sdf_bricks[idx];
}

fn brick_axis() -> u32 {
    return params.resolution_pad.x / BRICK_SIZE;
}

fn brick_index_at(bx: u32, by: u32, bz: u32) -> u32 {
    let axis = brick_axis();
    if (bx >= axis || by >= axis || bz >= axis) {
        return INVALID_VERTEX;
    }
    return brick_index_grid[bx + by * axis + bz * axis * axis];
}

fn cell_vertex_at(global_cell: vec3<u32>) -> u32 {
    let brick_coord = global_cell / BRICK_SIZE;
    let local = global_cell % BRICK_SIZE;
    let bi = brick_index_at(brick_coord.x, brick_coord.y, brick_coord.z);
    if (bi == INVALID_VERTEX) {
        return INVALID_VERTEX;
    }
    let local_index = local.x + local.y * BRICK_SIZE + local.z * BRICK_SIZE * BRICK_SIZE;
    let base = bi * BRICK_CELL_VOXELS;
    return cell_to_vertex[base + local_index];
}

fn get_sdf_clamped(brick_index: u32, x: i32, y: i32, z: i32) -> f32 {
    let cx = clamp(x, 0, i32(BRICK_SDF_SIZE) - 1);
    let cy = clamp(y, 0, i32(BRICK_SDF_SIZE) - 1);
    let cz = clamp(z, 0, i32(BRICK_SDF_SIZE) - 1);
    return get_sdf(brick_index, u32(cx), u32(cy), u32(cz));
}

fn cell_intersects_surface(brick_index: u32, x: u32, y: u32, z: u32, iso: f32) -> bool {
    let corners = array<f32, 8>(
        get_sdf(brick_index, x, y, z),
        get_sdf(brick_index, x + 1u, y, z),
        get_sdf(brick_index, x + 1u, y, z + 1u),
        get_sdf(brick_index, x, y, z + 1u),
        get_sdf(brick_index, x, y + 1u, z),
        get_sdf(brick_index, x + 1u, y + 1u, z),
        get_sdf(brick_index, x + 1u, y + 1u, z + 1u),
        get_sdf(brick_index, x, y + 1u, z + 1u),
    );

    var has_inside = false;
    var has_outside = false;

    for (var i = 0u; i < 8u; i++) {
        if (corners[i] < iso) {
            has_inside = true;
        } else {
            has_outside = true;
        }
    }

    return has_inside && has_outside;
}

fn compute_gradient(brick_index: u32, x: u32, y: u32, z: u32, cell_size: f32) -> vec3<f32> {
    let xi = i32(x);
    let yi = i32(y);
    let zi = i32(z);

    let dx = (get_sdf_clamped(brick_index, xi + 1, yi, zi) - get_sdf_clamped(brick_index, xi - 1, yi, zi)) / (2.0 * cell_size);
    let dy = (get_sdf_clamped(brick_index, xi, yi + 1, zi) - get_sdf_clamped(brick_index, xi, yi - 1, zi)) / (2.0 * cell_size);
    let dz = (get_sdf_clamped(brick_index, xi, yi, zi + 1) - get_sdf_clamped(brick_index, xi, yi, zi - 1)) / (2.0 * cell_size);

    return vec3<f32>(dx, dy, dz);
}

fn edge_intersection(p0: vec3<f32>, p1: vec3<f32>, s0: f32, s1: f32) -> vec3<f32> {
    let t = clamp(s0 / (s0 - s1), 0.0, 1.0);
    return p0 + t * (p1 - p0);
}

// Surface nets vertex placement: average of all edge crossing points.
// DC QEF is avoided here because organic/smooth surfaces produce near-rank-1
// normal matrices (all normals nearly parallel), causing the QEF solve to
// return world origin and vertices to snap to cell corners.
fn cell_vertex_position(
    brick_index: u32,
    brick_origin: vec3<f32>,
    cell_origin: vec3<f32>,
    cell_size: f32,
) -> vec3<f32> {
    let lx = u32(cell_origin.x);
    let ly = u32(cell_origin.y);
    let lz = u32(cell_origin.z);

    let s000 = get_sdf(brick_index, lx,     ly,     lz);
    let s100 = get_sdf(brick_index, lx + 1u, ly,     lz);
    let s010 = get_sdf(brick_index, lx,     ly + 1u, lz);
    let s110 = get_sdf(brick_index, lx + 1u, ly + 1u, lz);
    let s001 = get_sdf(brick_index, lx,     ly,     lz + 1u);
    let s101 = get_sdf(brick_index, lx + 1u, ly,     lz + 1u);
    let s011 = get_sdf(brick_index, lx,     ly + 1u, lz + 1u);
    let s111 = get_sdf(brick_index, lx + 1u, ly + 1u, lz + 1u);

    let base = params.bounds_min.xyz + (brick_origin + cell_origin) * cell_size;
    let dx = vec3<f32>(cell_size, 0.0, 0.0);
    let dy = vec3<f32>(0.0, cell_size, 0.0);
    let dz = vec3<f32>(0.0, 0.0, cell_size);

    var sum = vec3<f32>(0.0);
    var count = 0u;

    // 4 X-aligned edges
    if (s000 * s100 < 0.0) { sum += edge_intersection(base,        base + dx,        s000, s100); count++; }
    if (s010 * s110 < 0.0) { sum += edge_intersection(base + dy,   base + dy + dx,   s010, s110); count++; }
    if (s001 * s101 < 0.0) { sum += edge_intersection(base + dz,   base + dz + dx,   s001, s101); count++; }
    if (s011 * s111 < 0.0) { sum += edge_intersection(base+dy+dz,  base+dy+dz + dx,  s011, s111); count++; }

    // 4 Y-aligned edges
    if (s000 * s010 < 0.0) { sum += edge_intersection(base,        base + dy,        s000, s010); count++; }
    if (s100 * s110 < 0.0) { sum += edge_intersection(base + dx,   base + dx + dy,   s100, s110); count++; }
    if (s001 * s011 < 0.0) { sum += edge_intersection(base + dz,   base + dz + dy,   s001, s011); count++; }
    if (s101 * s111 < 0.0) { sum += edge_intersection(base+dx+dz,  base+dx+dz + dy,  s101, s111); count++; }

    // 4 Z-aligned edges
    if (s000 * s001 < 0.0) { sum += edge_intersection(base,        base + dz,        s000, s001); count++; }
    if (s100 * s101 < 0.0) { sum += edge_intersection(base + dx,   base + dx + dz,   s100, s101); count++; }
    if (s010 * s011 < 0.0) { sum += edge_intersection(base + dy,   base + dy + dz,   s010, s011); count++; }
    if (s110 * s111 < 0.0) { sum += edge_intersection(base+dx+dy,  base+dx+dy + dz,  s110, s111); count++; }

    if (count > 0u) {
        return sum / f32(count);
    }

    return base + vec3<f32>(0.5, 0.5, 0.5) * cell_size;
}

fn vertex_pos(idx: u32) -> vec3<f32> {
    let base = idx * 6u;
    return vec3<f32>(vertices[base + 0u], vertices[base + 1u], vertices[base + 2u]);
}

// ============================================================================
// Phase 1: Detect surface cells and generate vertices
// ============================================================================
@compute @workgroup_size(64, 1, 1)
fn detect_surface_cells(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let brick_index = index / BRICK_CELL_VOXELS;

    if (brick_index >= sparse_params.data[0].x) {
        return;
    }

    let local_index = index - brick_index * BRICK_CELL_VOXELS;
    let x = local_index % BRICK_SIZE;
    let y = (local_index / BRICK_SIZE) % BRICK_SIZE;
    let z = local_index / (BRICK_SIZE * BRICK_SIZE);

    let base = brick_index * BRICK_CELL_VOXELS;
    let cell_idx = base + local_index;
    cell_to_vertex[cell_idx] = INVALID_VERTEX;

    if (!cell_intersects_surface(brick_index, x, y, z, params.iso_value)) {
        return;
    }

    let vertex_index = atomicAdd(&counters.vertex_count, 1u);
    cell_to_vertex[cell_idx] = vertex_index;

    let cell_size = params.bounds_max_cell.w;
    let bounds_min = params.bounds_min.xyz;
    let brick = brick_meta[brick_index];
    let brick_origin = vec3<f32>(brick.coord) * f32(BRICK_SIZE);

    let cell_origin = vec3<f32>(f32(x), f32(y), f32(z));
    let cell_center = bounds_min + (brick_origin + cell_origin + vec3<f32>(0.5, 0.5, 0.5)) * cell_size;

    let out_base = vertex_index * 6u;
    let fast_mode = sparse_params.data[0].y == 1u;
    let final_pos = select(
        cell_vertex_position(brick_index, brick_origin, cell_origin, cell_size),
        cell_center,
        fast_mode
    );
    let gradient = compute_gradient(brick_index, x, y, z, cell_size);
    let normal = normalize(gradient);

    vertices[out_base + 0u] = final_pos.x;
    vertices[out_base + 1u] = final_pos.y;
    vertices[out_base + 2u] = final_pos.z;
    vertices[out_base + 3u] = normal.x;
    vertices[out_base + 4u] = normal.y;
    vertices[out_base + 5u] = normal.z;
}

// ============================================================================
// Phase 2: Generate faces between adjacent surface cells
// ============================================================================
@compute @workgroup_size(64, 1, 1)
fn generate_faces(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let brick_index = index / BRICK_CELL_VOXELS;

    if (brick_index >= sparse_params.data[0].x) {
        return;
    }

    let local_index = index - brick_index * BRICK_CELL_VOXELS;
    let x = local_index % BRICK_SIZE;
    let y = (local_index / BRICK_SIZE) % BRICK_SIZE;
    let z = local_index / (BRICK_SIZE * BRICK_SIZE);

    let brick = brick_meta[brick_index];
    let brick_origin = brick.coord * BRICK_SIZE;
    let global_cell = brick_origin + vec3<u32>(x, y, z);
    let v0_idx = cell_vertex_at(global_cell);
    if (v0_idx == INVALID_VERTEX) {
        return;
    }

    // X-face: check edge perpendicular to X axis at (x, y+1, z+1)
    // SDF grid is 9x9x9, so y+1 and z+1 are always valid (max 8)
    {
        let s0 = get_sdf(brick_index, x, y + 1u, z + 1u) < params.iso_value;
        let s1 = get_sdf(brick_index, x + 1u, y + 1u, z + 1u) < params.iso_value;

        if (s0 != s1) {
            let v0 = cell_vertex_at(global_cell);
            let v1 = cell_vertex_at(global_cell + vec3<u32>(0u, 0u, 1u));
            let v2 = cell_vertex_at(global_cell + vec3<u32>(0u, 1u, 1u));
            let v3 = cell_vertex_at(global_cell + vec3<u32>(0u, 1u, 0u));

            if (v0 != INVALID_VERTEX && v1 != INVALID_VERTEX &&
                v2 != INVALID_VERTEX && v3 != INVALID_VERTEX) {
                let idx_base = atomicAdd(&counters.index_count, 6u);
                let d02 = distance(vertex_pos(v0), vertex_pos(v2));
                let d13 = distance(vertex_pos(v1), vertex_pos(v3));
                let use_02 = d02 <= d13;

                if (!s0) {
                    if (use_02) {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v2;
                        indices[idx_base + 2u] = v1;
                        indices[idx_base + 3u] = v0;
                        indices[idx_base + 4u] = v3;
                        indices[idx_base + 5u] = v2;
                    } else {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v3;
                        indices[idx_base + 3u] = v1;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    }
                } else {
                    if (use_02) {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v2;
                        indices[idx_base + 3u] = v0;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    } else {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v3;
                        indices[idx_base + 3u] = v1;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    }
                }
            }
        }
    }

    // Y-face: check edge perpendicular to Y axis at (x+1, y, z+1)
    {
        let s0 = get_sdf(brick_index, x + 1u, y, z + 1u) < params.iso_value;
        let s1 = get_sdf(brick_index, x + 1u, y + 1u, z + 1u) < params.iso_value;

        if (s0 != s1) {
            let v0 = cell_vertex_at(global_cell);
            let v1 = cell_vertex_at(global_cell + vec3<u32>(1u, 0u, 0u));
            let v2 = cell_vertex_at(global_cell + vec3<u32>(1u, 0u, 1u));
            let v3 = cell_vertex_at(global_cell + vec3<u32>(0u, 0u, 1u));

            if (v0 != INVALID_VERTEX && v1 != INVALID_VERTEX &&
                v2 != INVALID_VERTEX && v3 != INVALID_VERTEX) {
                let idx_base = atomicAdd(&counters.index_count, 6u);
                let d02 = distance(vertex_pos(v0), vertex_pos(v2));
                let d13 = distance(vertex_pos(v1), vertex_pos(v3));
                let use_02 = d02 <= d13;

                if (!s0) {
                    if (use_02) {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v2;
                        indices[idx_base + 2u] = v1;
                        indices[idx_base + 3u] = v0;
                        indices[idx_base + 4u] = v3;
                        indices[idx_base + 5u] = v2;
                    } else {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v3;
                        indices[idx_base + 3u] = v1;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    }
                } else {
                    if (use_02) {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v2;
                        indices[idx_base + 3u] = v0;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    } else {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v3;
                        indices[idx_base + 3u] = v1;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    }
                }
            }
        }
    }

    // Z-face: check edge perpendicular to Z axis at (x+1, y+1, z)
    {
        let s0 = get_sdf(brick_index, x + 1u, y + 1u, z) < params.iso_value;
        let s1 = get_sdf(brick_index, x + 1u, y + 1u, z + 1u) < params.iso_value;

        if (s0 != s1) {
            let v0 = cell_vertex_at(global_cell);
            let v1 = cell_vertex_at(global_cell + vec3<u32>(1u, 0u, 0u));
            let v2 = cell_vertex_at(global_cell + vec3<u32>(1u, 1u, 0u));
            let v3 = cell_vertex_at(global_cell + vec3<u32>(0u, 1u, 0u));

            if (v0 != INVALID_VERTEX && v1 != INVALID_VERTEX &&
                v2 != INVALID_VERTEX && v3 != INVALID_VERTEX) {
                let idx_base = atomicAdd(&counters.index_count, 6u);
                let d02 = distance(vertex_pos(v0), vertex_pos(v2));
                let d13 = distance(vertex_pos(v1), vertex_pos(v3));
                let use_02 = d02 <= d13;

                if (s0) {
                    if (use_02) {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v2;
                        indices[idx_base + 2u] = v1;
                        indices[idx_base + 3u] = v0;
                        indices[idx_base + 4u] = v3;
                        indices[idx_base + 5u] = v2;
                    } else {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v3;
                        indices[idx_base + 3u] = v1;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    }
                } else {
                    if (use_02) {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v2;
                        indices[idx_base + 3u] = v0;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    } else {
                        indices[idx_base + 0u] = v0;
                        indices[idx_base + 1u] = v1;
                        indices[idx_base + 2u] = v3;
                        indices[idx_base + 3u] = v1;
                        indices[idx_base + 4u] = v2;
                        indices[idx_base + 5u] = v3;
                    }
                }
            }
        }
    }
}
