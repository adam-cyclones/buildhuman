// Surface Voxelization Compute Shader
// Phase 1: Detect surface cells and generate vertices
// Phase 2: Generate face indices between adjacent cells

// Grid parameters (must match Rust GridParams layout exactly - 64 bytes total)
struct GridParams {
    resolution_pad: vec4<u32>,  // x = resolution, yzw = padding (offset 0)
    bounds_min: vec4<f32>,      // xyz = min bounds, w = unused (offset 16)
    bounds_max_cell: vec4<f32>, // xyz = max bounds, w = cell_size (offset 32)
    num_moulds: u32,            // offset 48
    iso_value: f32,             // offset 52
    _pad: vec2<f32>,            // offset 56, padding to 64
};

// Output counters for variable-length output
struct Counters {
    vertex_count: atomic<u32>,
    index_count: atomic<u32>,
};

// Cell info: maps cell coordinates to vertex index
// Using a hash map style approach with cell_index -> vertex_index
struct CellVertex {
    cell_index: u32,  // Original 1D cell index
    vertex_index: u32, // Index in output vertex array
};

// Bind groups
@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<storage, read> sdf_grid: array<f32>;
@group(0) @binding(2) var<storage, read_write> counters: Counters;
@group(0) @binding(3) var<storage, read_write> vertices: array<f32>;  // [x, y, z, nx, ny, nz, ...]
@group(0) @binding(4) var<storage, read_write> indices: array<u32>;
@group(0) @binding(5) var<storage, read_write> cell_to_vertex: array<u32>;  // Maps cell index to vertex index (or 0xFFFFFFFF if no vertex)

// Constants
const INVALID_VERTEX: u32 = 0xFFFFFFFFu;
const EPSILON: f32 = 0.001;

// Convert 1D index to 3D grid coordinates
fn index_to_coords(index: u32, res: u32) -> vec3<u32> {
    let x = index % res;
    let y = (index / res) % res;
    let z = index / (res * res);
    return vec3<u32>(x, y, z);
}

// Convert 3D cell coords to 1D cell index (cells are res-1 in each dimension)
fn cell_coords_to_index(coords: vec3<u32>, res: u32) -> u32 {
    let cell_res = res - 1u;
    return coords.x + coords.y * cell_res + coords.z * cell_res * cell_res;
}

// Convert grid coordinates to world position
fn grid_to_world(coords: vec3<f32>, cell_size: f32, bounds_min: vec3<f32>) -> vec3<f32> {
    return bounds_min + coords * cell_size;
}

// Get SDF value at grid point
fn get_sdf(x: u32, y: u32, z: u32, res: u32) -> f32 {
    return sdf_grid[x + y * res + z * res * res];
}

// Check if cell intersects isosurface
fn cell_intersects_surface(x: u32, y: u32, z: u32, res: u32, iso: f32) -> bool {
    // Get 8 corner values
    let corners = array<f32, 8>(
        get_sdf(x, y, z, res),
        get_sdf(x + 1u, y, z, res),
        get_sdf(x + 1u, y, z + 1u, res),
        get_sdf(x, y, z + 1u, res),
        get_sdf(x, y + 1u, z, res),
        get_sdf(x + 1u, y + 1u, z, res),
        get_sdf(x + 1u, y + 1u, z + 1u, res),
        get_sdf(x, y + 1u, z + 1u, res),
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

// Compute SDF gradient using central differences
fn compute_gradient(pos: vec3<f32>, res: u32, cell_size: f32, bounds_min: vec3<f32>) -> vec3<f32> {
    // Convert world pos to grid coordinates (fractional)
    let grid_pos = (pos - bounds_min) / cell_size;

    // Sample SDF at offset positions using trilinear interpolation
    // For simplicity, use grid-aligned sampling
    let gx = clamp(u32(grid_pos.x), 0u, res - 2u);
    let gy = clamp(u32(grid_pos.y), 0u, res - 2u);
    let gz = clamp(u32(grid_pos.z), 0u, res - 2u);

    let dx = (get_sdf(min(gx + 1u, res - 1u), gy, gz, res) - get_sdf(max(gx, 1u) - 1u, gy, gz, res)) / (2.0 * cell_size);
    let dy = (get_sdf(gx, min(gy + 1u, res - 1u), gz, res) - get_sdf(gx, max(gy, 1u) - 1u, gz, res)) / (2.0 * cell_size);
    let dz = (get_sdf(gx, gy, min(gz + 1u, res - 1u), res) - get_sdf(gx, gy, max(gz, 1u) - 1u, res)) / (2.0 * cell_size);

    return vec3<f32>(dx, dy, dz);
}

// ============================================================================
// Phase 1: Detect surface cells and generate vertices
// ============================================================================
@compute @workgroup_size(64, 1, 1)
fn detect_surface_cells(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let res = params.resolution_pad.x;
    let cell_size = params.bounds_max_cell.w;
    let bounds_min = params.bounds_min.xyz;
    let cell_res = res - 1u;
    let total_cells = cell_res * cell_res * cell_res;
    let cell_index = global_id.x;

    if (cell_index >= total_cells) {
        return;
    }

    // Initialize cell_to_vertex mapping
    cell_to_vertex[cell_index] = INVALID_VERTEX;

    // Get cell coordinates
    let x = cell_index % cell_res;
    let y = (cell_index / cell_res) % cell_res;
    let z = cell_index / (cell_res * cell_res);

    // Check if this cell intersects the isosurface
    if (!cell_intersects_surface(x, y, z, res, params.iso_value)) {
        return;
    }

    // Allocate vertex slot atomically
    let vertex_index = atomicAdd(&counters.vertex_count, 1u);

    // Store mapping from cell to vertex
    cell_to_vertex[cell_index] = vertex_index;

    // Compute vertex position (cell center for fast mode)
    let cell_center = grid_to_world(
        vec3<f32>(f32(x) + 0.5, f32(y) + 0.5, f32(z) + 0.5),
        cell_size,
        bounds_min
    );

    // Compute normal from SDF gradient
    let gradient = compute_gradient(cell_center, res, cell_size, bounds_min);
    let normal = normalize(gradient);

    // Write vertex data (position + normal = 6 floats)
    let base = vertex_index * 6u;
    vertices[base + 0u] = cell_center.x;
    vertices[base + 1u] = cell_center.y;
    vertices[base + 2u] = cell_center.z;
    vertices[base + 3u] = normal.x;
    vertices[base + 4u] = normal.y;
    vertices[base + 5u] = normal.z;
}

// ============================================================================
// Phase 2: Generate faces between adjacent surface cells
// ============================================================================
@compute @workgroup_size(64, 1, 1)
fn generate_faces(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let res = params.resolution_pad.x;
    let cell_res = res - 1u;
    let total_cells = cell_res * cell_res * cell_res;
    let cell_index = global_id.x;

    if (cell_index >= total_cells) {
        return;
    }

    // Only process cells that have vertices
    let v0_idx = cell_to_vertex[cell_index];
    if (v0_idx == INVALID_VERTEX) {
        return;
    }

    // Get cell coordinates
    let x = cell_index % cell_res;
    let y = (cell_index / cell_res) % cell_res;
    let z = cell_index / (cell_res * cell_res);

    // Check each of 3 face directions (+X, +Y, +Z)
    // Face in +X direction (YZ plane)
    if (x < cell_res - 1u && y < cell_res - 1u && z < cell_res - 1u) {
        let s0 = get_sdf(x, y + 1u, z + 1u, res) < params.iso_value;
        let s1 = get_sdf(x + 1u, y + 1u, z + 1u, res) < params.iso_value;

        if (s0 != s1) {
            // Get 4 cell vertices for the quad
            let c0 = cell_coords_to_index(vec3<u32>(x, y, z), res);
            let c1 = cell_coords_to_index(vec3<u32>(x, y, z + 1u), res);
            let c2 = cell_coords_to_index(vec3<u32>(x, y + 1u, z + 1u), res);
            let c3 = cell_coords_to_index(vec3<u32>(x, y + 1u, z), res);

            let v0 = cell_to_vertex[c0];
            let v1 = cell_to_vertex[c1];
            let v2 = cell_to_vertex[c2];
            let v3 = cell_to_vertex[c3];

            // All 4 vertices must exist
            if (v0 != INVALID_VERTEX && v1 != INVALID_VERTEX &&
                v2 != INVALID_VERTEX && v3 != INVALID_VERTEX) {
                // Allocate 6 indices for 2 triangles
                let idx_base = atomicAdd(&counters.index_count, 6u);

                if (s0) {
                    indices[idx_base + 0u] = v0;
                    indices[idx_base + 1u] = v2;
                    indices[idx_base + 2u] = v1;
                    indices[idx_base + 3u] = v0;
                    indices[idx_base + 4u] = v3;
                    indices[idx_base + 5u] = v2;
                } else {
                    indices[idx_base + 0u] = v0;
                    indices[idx_base + 1u] = v1;
                    indices[idx_base + 2u] = v2;
                    indices[idx_base + 3u] = v0;
                    indices[idx_base + 4u] = v2;
                    indices[idx_base + 5u] = v3;
                }
            }
        }
    }

    // Face in +Y direction (XZ plane)
    if (y < cell_res - 1u && x < cell_res - 1u && z < cell_res - 1u) {
        let s0 = get_sdf(x + 1u, y, z + 1u, res) < params.iso_value;
        let s1 = get_sdf(x + 1u, y + 1u, z + 1u, res) < params.iso_value;

        if (s0 != s1) {
            let c0 = cell_coords_to_index(vec3<u32>(x, y, z), res);
            let c1 = cell_coords_to_index(vec3<u32>(x + 1u, y, z), res);
            let c2 = cell_coords_to_index(vec3<u32>(x + 1u, y, z + 1u), res);
            let c3 = cell_coords_to_index(vec3<u32>(x, y, z + 1u), res);

            let v0 = cell_to_vertex[c0];
            let v1 = cell_to_vertex[c1];
            let v2 = cell_to_vertex[c2];
            let v3 = cell_to_vertex[c3];

            if (v0 != INVALID_VERTEX && v1 != INVALID_VERTEX &&
                v2 != INVALID_VERTEX && v3 != INVALID_VERTEX) {
                let idx_base = atomicAdd(&counters.index_count, 6u);

                if (s0) {
                    indices[idx_base + 0u] = v0;
                    indices[idx_base + 1u] = v2;
                    indices[idx_base + 2u] = v1;
                    indices[idx_base + 3u] = v0;
                    indices[idx_base + 4u] = v3;
                    indices[idx_base + 5u] = v2;
                } else {
                    indices[idx_base + 0u] = v0;
                    indices[idx_base + 1u] = v1;
                    indices[idx_base + 2u] = v2;
                    indices[idx_base + 3u] = v0;
                    indices[idx_base + 4u] = v2;
                    indices[idx_base + 5u] = v3;
                }
            }
        }
    }

    // Face in +Z direction (XY plane)
    if (z < cell_res - 1u && x < cell_res - 1u && y < cell_res - 1u) {
        let s0 = get_sdf(x + 1u, y + 1u, z, res) < params.iso_value;
        let s1 = get_sdf(x + 1u, y + 1u, z + 1u, res) < params.iso_value;

        if (s0 != s1) {
            let c0 = cell_coords_to_index(vec3<u32>(x, y, z), res);
            let c1 = cell_coords_to_index(vec3<u32>(x + 1u, y, z), res);
            let c2 = cell_coords_to_index(vec3<u32>(x + 1u, y + 1u, z), res);
            let c3 = cell_coords_to_index(vec3<u32>(x, y + 1u, z), res);

            let v0 = cell_to_vertex[c0];
            let v1 = cell_to_vertex[c1];
            let v2 = cell_to_vertex[c2];
            let v3 = cell_to_vertex[c3];

            if (v0 != INVALID_VERTEX && v1 != INVALID_VERTEX &&
                v2 != INVALID_VERTEX && v3 != INVALID_VERTEX) {
                let idx_base = atomicAdd(&counters.index_count, 6u);

                if (!s0) {
                    indices[idx_base + 0u] = v0;
                    indices[idx_base + 1u] = v2;
                    indices[idx_base + 2u] = v1;
                    indices[idx_base + 3u] = v0;
                    indices[idx_base + 4u] = v3;
                    indices[idx_base + 5u] = v2;
                } else {
                    indices[idx_base + 0u] = v0;
                    indices[idx_base + 1u] = v1;
                    indices[idx_base + 2u] = v2;
                    indices[idx_base + 3u] = v0;
                    indices[idx_base + 4u] = v2;
                    indices[idx_base + 5u] = v3;
                }
            }
        }
    }
}
