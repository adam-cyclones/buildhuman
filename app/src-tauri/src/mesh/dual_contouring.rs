use crate::mesh::brick_map::BrickMap;
use crate::mesh::grid_trait::Grid;
use crate::mesh::mould::MouldManager;
use crate::mesh::sdf::compute_gradient;
use crate::mesh::types::{MeshData, Pt3, Vec3};
use crate::mesh::voxel_grid::VoxelGrid;
use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::Mutex;

/// Cell vertex with position and index
#[derive(Debug, Clone)]
struct CellVertex {
    position: Pt3,
    index: u32,
}

/// Extract triangle mesh using Dual Contouring
/// Produces higher quality meshes than Marching Cubes by:
/// - Placing one vertex per cell (not per edge)
/// - Projecting vertices onto the actual isosurface
/// - Generating quads that triangulate cleanly
///
/// Set `fast_mode` to true for interactive previews (skips Newton projection)
pub fn dual_contouring(
    grid: &VoxelGrid,
    mould_manager: &MouldManager,
    iso_value: f32,
) -> MeshData {
    dual_contouring_impl(grid, mould_manager, iso_value, false)
}

/// Fast preview version for realtime interaction
pub fn dual_contouring_fast(
    grid: &VoxelGrid,
    mould_manager: &MouldManager,
    iso_value: f32,
) -> MeshData {
    dual_contouring_impl(grid, mould_manager, iso_value, true)
}

fn dual_contouring_impl(
    grid: &VoxelGrid,
    mould_manager: &MouldManager,
    iso_value: f32,
    fast_mode: bool,
) -> MeshData {
    let res = grid.resolution;

    // Step 1: Create vertices for cells that intersect the isosurface (PARALLEL)
    // Generate all cell coordinates
    let cell_coords: Vec<(u32, u32, u32)> = (0..res - 1)
        .flat_map(|z| {
            (0..res - 1).flat_map(move |y| {
                (0..res - 1).map(move |x| (x, y, z))
            })
        })
        .collect();

    // Parallel vertex creation
    let surface_cells: Vec<((u32, u32, u32), Pt3)> = cell_coords
        .par_iter()
        .filter_map(|&(x, y, z)| {
            // Check if this cell intersects the isosurface
            if !cell_intersects_surface(grid, x, y, z, iso_value) {
                return None;
            }

            // Find best vertex position for this cell
            let vertex_pos = if fast_mode {
                // Fast mode: just use cell center (no Newton iteration)
                grid.get_position(x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5)
            } else {
                find_cell_vertex(grid, mould_manager, x, y, z, iso_value)
            };

            Some(((x, y, z), vertex_pos))
        })
        .collect();

    // Build vertices array and cell_vertices map
    let mut vertices: Vec<f32> = Vec::with_capacity(surface_cells.len() * 3);
    let mut cell_vertices: HashMap<(u32, u32, u32), CellVertex> = HashMap::with_capacity(surface_cells.len());

    for ((x, y, z), vertex_pos) in surface_cells {
        let vertex_index = (vertices.len() / 3) as u32;
        vertices.push(vertex_pos.x);
        vertices.push(vertex_pos.y);
        vertices.push(vertex_pos.z);

        cell_vertices.insert(
            (x, y, z),
            CellVertex {
                position: vertex_pos,
                index: vertex_index,
            },
        );
    }

    // Step 2: Generate faces between adjacent cells (PARALLEL)
    // Create a face when exactly one of two neighboring cells has a vertex
    let face_coords: Vec<(u32, u32, u32)> = cell_vertices.keys().copied().collect();

    let indices = Mutex::new(Vec::new());

    face_coords.par_iter().for_each(|&(x, y, z)| {
        let mut local_indices = Vec::new();

        // Create face in +X direction (YZ plane)
        // Needs cells: (x,y,z), (x,y,z+1), (x,y+1,z+1), (x,y+1,z)
        if y < res - 2 && z < res - 2 {
            create_face_x(&cell_vertices, &mut local_indices, x, y, z);
        }

        // Create face in +Y direction (XZ plane)
        // Needs cells: (x,y,z), (x+1,y,z), (x+1,y,z+1), (x,y,z+1)
        if x < res - 2 && z < res - 2 {
            create_face_y(&cell_vertices, &mut local_indices, x, y, z);
        }

        // Create face in +Z direction (XY plane)
        // Needs cells: (x,y,z), (x+1,y,z), (x+1,y+1,z), (x,y+1,z)
        if x < res - 2 && y < res - 2 {
            create_face_z(&cell_vertices, &mut local_indices, x, y, z);
        }

        if !local_indices.is_empty() {
            indices.lock().unwrap().extend(local_indices);
        }
    });

    let indices = indices.into_inner().unwrap();

    // Compute normals (simple per-face normals for now)
    let normals = compute_normals(&vertices, &indices);

    MeshData {
        vertices,
        indices,
        normals,
    }
}

/// Check if a voxel cell intersects the isosurface
/// Returns true if corners have different signs (sign change = surface crossing)
fn cell_intersects_surface(grid: &VoxelGrid, x: u32, y: u32, z: u32, iso_value: f32) -> bool {
    // Get 8 corner values
    let corners = [
        grid.get(x, y, z),
        grid.get(x + 1, y, z),
        grid.get(x + 1, y, z + 1),
        grid.get(x, y, z + 1),
        grid.get(x, y + 1, z),
        grid.get(x + 1, y + 1, z),
        grid.get(x + 1, y + 1, z + 1),
        grid.get(x, y + 1, z + 1),
    ];

    // Check if any corner is inside (< isoValue) and any is outside (>= isoValue)
    let mut has_inside = false;
    let mut has_outside = false;

    for &value in &corners {
        if value < iso_value {
            has_inside = true;
        } else {
            has_outside = true;
        }
    }

    has_inside && has_outside
}

/// Find optimal vertex position for a cell using surface projection
/// Uses Newton's method to find the closest point on the isosurface to the cell center
fn find_cell_vertex(
    grid: &VoxelGrid,
    mould_manager: &MouldManager,
    x: u32,
    y: u32,
    z: u32,
    iso_value: f32,
) -> Pt3 {
    // Start at cell center
    let cell_center = grid.get_position(x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5);
    let mut pos = cell_center;

    // Use Newton's method for fast convergence to isosurface
    // Reduced iterations for better performance (was 20, now 8)
    let max_iterations = 8;
    let tolerance = 0.001; // Slightly relaxed tolerance

    for _ in 0..max_iterations {
        let dist = mould_manager.evaluate_sdf(&pos) - iso_value;

        // Close enough to surface
        if dist.abs() < tolerance {
            break;
        }

        // Compute gradient at current position
        let grad = compute_gradient(&pos, |p| mould_manager.evaluate_sdf(p));

        // Gradient magnitude for normalization
        let grad_len = grad.magnitude();

        if grad_len < 0.0001 {
            // Gradient too small, can't make progress
            break;
        }

        // Newton's method: move exactly to the surface along gradient direction
        // Distance to surface divided by gradient magnitude gives step size
        let step_size = dist / grad_len;

        pos = Pt3::new(
            pos.x - grad.x * step_size,
            pos.y - grad.y * step_size,
            pos.z - grad.z * step_size,
        );
    }

    pos
}

/// Create face between cells in X direction (perpendicular to X-axis)
/// Connects 4 cells in a 2x2 grid in the YZ plane
/// Winding order determined by face normal pointing outward
fn create_face_x(
    cell_vertices: &HashMap<(u32, u32, u32), CellVertex>,
    indices: &mut Vec<u32>,
    x: u32,
    y: u32,
    z: u32,
) {
    // Four cells form a quad in the YZ plane perpendicular to X-axis
    let v0 = cell_vertices.get(&(x, y, z));
    let v1 = cell_vertices.get(&(x, y, z + 1));
    let v2 = cell_vertices.get(&(x, y + 1, z + 1));
    let v3 = cell_vertices.get(&(x, y + 1, z));

    if v0.is_none() || v1.is_none() || v2.is_none() || v3.is_none() {
        return;
    }

    let v0 = v0.unwrap();
    let v1 = v1.unwrap();
    let v2 = v2.unwrap();
    let v3 = v3.unwrap();

    // Compute face normal using cross product
    // Edge from v0 to v1, edge from v0 to v3
    let e1 = v1.position - v0.position;
    let e2 = v3.position - v0.position;
    let face_normal = e1.cross(&e2);

    // Check if face normal points in +X or -X direction
    // If normal.x > 0, we want CCW from +X view
    // If normal.x < 0, we want CW from +X view (which is CCW from -X view)
    let flip = face_normal.x < 0.0;

    // Triangulate quad along shortest diagonal
    let diag02 = distance(&v0.position, &v2.position);
    let diag13 = distance(&v1.position, &v3.position);

    if diag02 < diag13 {
        // Diagonal from v0 to v2
        if flip {
            indices.push(v0.index);
            indices.push(v2.index);
            indices.push(v1.index);
            indices.push(v0.index);
            indices.push(v3.index);
            indices.push(v2.index);
        } else {
            indices.push(v0.index);
            indices.push(v1.index);
            indices.push(v2.index);
            indices.push(v0.index);
            indices.push(v2.index);
            indices.push(v3.index);
        }
    } else {
        // Diagonal from v1 to v3
        if flip {
            indices.push(v0.index);
            indices.push(v3.index);
            indices.push(v1.index);
            indices.push(v1.index);
            indices.push(v3.index);
            indices.push(v2.index);
        } else {
            indices.push(v0.index);
            indices.push(v1.index);
            indices.push(v3.index);
            indices.push(v1.index);
            indices.push(v2.index);
            indices.push(v3.index);
        }
    }
}

/// Create face between cells in Y direction (perpendicular to Y-axis)
/// Connects 4 cells in a 2x2 grid in the XZ plane
/// This face is created when the Y-axis edge crosses the isosurface
/// Winding order is CCW when viewed from +Y direction (outside)
fn create_face_y(
    cell_vertices: &HashMap<(u32, u32, u32), CellVertex>,
    indices: &mut Vec<u32>,
    x: u32,
    y: u32,
    z: u32,
) {
    // Four cells form a quad in the XZ plane perpendicular to Y-axis
    // The quad surrounds the Y-axis edge at (x,y,z) going to (x,y+1,z)
    let v0 = cell_vertices.get(&(x, y, z));         // (-X, -Z) relative to edge
    let v1 = cell_vertices.get(&(x + 1, y, z));     // (+X, -Z)
    let v2 = cell_vertices.get(&(x + 1, y, z + 1)); // (+X, +Z)
    let v3 = cell_vertices.get(&(x, y, z + 1));     // (-X, +Z)

    if v0.is_none() || v1.is_none() || v2.is_none() || v3.is_none() {
        return;
    }

    let v0 = v0.unwrap();
    let v1 = v1.unwrap();
    let v2 = v2.unwrap();
    let v3 = v3.unwrap();

    let diag02 = distance(&v0.position, &v2.position);
    let diag13 = distance(&v1.position, &v3.position);

    if diag02 < diag13 {
        // Diagonal from v0 to v2
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v2.index);

        indices.push(v0.index);
        indices.push(v2.index);
        indices.push(v3.index);
    } else {
        // Diagonal from v1 to v3
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v3.index);

        indices.push(v1.index);
        indices.push(v2.index);
        indices.push(v3.index);
    }
}

/// Create face between cells in Z direction (perpendicular to Z-axis)
/// Connects 4 cells in a 2x2 grid in the XY plane
/// This face is created when the Z-axis edge crosses the isosurface
/// Winding order is CCW when viewed from +Z direction (outside)
fn create_face_z(
    cell_vertices: &HashMap<(u32, u32, u32), CellVertex>,
    indices: &mut Vec<u32>,
    x: u32,
    y: u32,
    z: u32,
) {
    // Four cells form a quad in the XY plane perpendicular to Z-axis
    // The quad surrounds the Z-axis edge at (x,y,z) going to (x,y,z+1)
    let v0 = cell_vertices.get(&(x, y, z));         // (-X, -Y) relative to edge
    let v1 = cell_vertices.get(&(x + 1, y, z));     // (+X, -Y)
    let v2 = cell_vertices.get(&(x + 1, y + 1, z)); // (+X, +Y)
    let v3 = cell_vertices.get(&(x, y + 1, z));     // (-X, +Y)

    if v0.is_none() || v1.is_none() || v2.is_none() || v3.is_none() {
        return;
    }

    let v0 = v0.unwrap();
    let v1 = v1.unwrap();
    let v2 = v2.unwrap();
    let v3 = v3.unwrap();

    let diag02 = distance(&v0.position, &v2.position);
    let diag13 = distance(&v1.position, &v3.position);

    if diag02 < diag13 {
        // Diagonal from v0 to v2
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v2.index);

        indices.push(v0.index);
        indices.push(v2.index);
        indices.push(v3.index);
    } else {
        // Diagonal from v1 to v3
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v3.index);

        indices.push(v1.index);
        indices.push(v2.index);
        indices.push(v3.index);
    }
}

/// Compute Euclidean distance between two points
fn distance(a: &Pt3, b: &Pt3) -> f32 {
    (a - b).magnitude()
}

/// Compute per-vertex normals from triangle mesh
fn compute_normals(vertices: &[f32], indices: &[u32]) -> Vec<f32> {
    let num_vertices = vertices.len() / 3;
    let mut normals = vec![0.0; vertices.len()];

    // Accumulate face normals for each vertex
    for i in (0..indices.len()).step_by(3) {
        let i0 = indices[i] as usize;
        let i1 = indices[i + 1] as usize;
        let i2 = indices[i + 2] as usize;

        // Get triangle vertices
        let v0 = Vec3::new(
            vertices[i0 * 3],
            vertices[i0 * 3 + 1],
            vertices[i0 * 3 + 2],
        );
        let v1 = Vec3::new(
            vertices[i1 * 3],
            vertices[i1 * 3 + 1],
            vertices[i1 * 3 + 2],
        );
        let v2 = Vec3::new(
            vertices[i2 * 3],
            vertices[i2 * 3 + 1],
            vertices[i2 * 3 + 2],
        );

        // Compute face normal
        let edge1 = v1 - v0;
        let edge2 = v2 - v0;
        let normal = edge1.cross(&edge2);

        // Accumulate to vertex normals
        for &idx in &[i0, i1, i2] {
            normals[idx * 3] += normal.x;
            normals[idx * 3 + 1] += normal.y;
            normals[idx * 3 + 2] += normal.z;
        }
    }

    // Normalize all vertex normals
    for i in 0..num_vertices {
        let nx = normals[i * 3];
        let ny = normals[i * 3 + 1];
        let nz = normals[i * 3 + 2];
        let len = (nx * nx + ny * ny + nz * nz).sqrt();

        if len > 0.0001 {
            normals[i * 3] /= len;
            normals[i * 3 + 1] /= len;
            normals[i * 3 + 2] /= len;
        }
    }

    normals
}

/// Dual contouring for BrickMap (high-resolution sparse grids)
pub fn dual_contouring_brick_map(
    brick_map: &BrickMap,
    mould_manager: &MouldManager,
    iso_value: f32,
    fast_mode: bool,
) -> MeshData {
    // Use the generic Grid trait implementation
    dual_contouring_generic(brick_map, mould_manager, iso_value, fast_mode)
}

/// Generic dual contouring that works with any Grid implementation
fn dual_contouring_generic<G: Grid + Sync>(
    grid: &G,
    mould_manager: &MouldManager,
    iso_value: f32,
    fast_mode: bool,
) -> MeshData {
    let res = grid.resolution();

    // Step 1: Create vertices for cells that intersect the isosurface (PARALLEL)
    // Generate all cell coordinates
    let cell_coords: Vec<(u32, u32, u32)> = (0..res - 1)
        .flat_map(|z| {
            (0..res - 1).flat_map(move |y| {
                (0..res - 1).map(move |x| (x, y, z))
            })
        })
        .collect();

    // Parallel vertex creation
    let surface_cells: Vec<((u32, u32, u32), Pt3)> = cell_coords
        .par_iter()
        .filter_map(|&(x, y, z)| {
            // Check if this cell intersects the isosurface
            if !cell_intersects_surface_generic(grid, x, y, z, iso_value) {
                return None;
            }

            // Find best vertex position for this cell
            let vertex_pos = if fast_mode {
                // Fast mode: just use cell center (no Newton iteration)
                grid.get_position(x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5)
            } else {
                find_cell_vertex_generic(grid, mould_manager, x, y, z, iso_value)
            };

            Some(((x, y, z), vertex_pos))
        })
        .collect();

    // Build vertices array and cell_vertices map
    let mut vertices: Vec<f32> = Vec::with_capacity(surface_cells.len() * 3);
    let mut cell_vertices: HashMap<(u32, u32, u32), CellVertex> = HashMap::with_capacity(surface_cells.len());

    for ((x, y, z), vertex_pos) in surface_cells {
        let vertex_index = (vertices.len() / 3) as u32;
        vertices.push(vertex_pos.x);
        vertices.push(vertex_pos.y);
        vertices.push(vertex_pos.z);

        cell_vertices.insert(
            (x, y, z),
            CellVertex {
                position: vertex_pos,
                index: vertex_index,
            },
        );
    }

    // Step 2: Generate faces between adjacent cells (PARALLEL)
    let face_coords: Vec<(u32, u32, u32)> = cell_vertices.keys().copied().collect();

    let indices = Mutex::new(Vec::new());

    face_coords.par_iter().for_each(|&(x, y, z)| {
        let mut local_indices = Vec::new();

        // Create face in +X direction (YZ plane)
        if y < res - 2 && z < res - 2 {
            create_face_x(&cell_vertices, &mut local_indices, x, y, z);
        }

        // Create face in +Y direction (XZ plane)
        if x < res - 2 && z < res - 2 {
            create_face_y(&cell_vertices, &mut local_indices, x, y, z);
        }

        // Create face in +Z direction (XY plane)
        if x < res - 2 && y < res - 2 {
            create_face_z(&cell_vertices, &mut local_indices, x, y, z);
        }

        if !local_indices.is_empty() {
            indices.lock().unwrap().extend(local_indices);
        }
    });

    let indices = indices.into_inner().unwrap();

    // Compute normals
    let normals = compute_normals(&vertices, &indices);

    MeshData {
        vertices,
        indices,
        normals,
    }
}

/// Check if a voxel cell intersects the isosurface (generic version)
fn cell_intersects_surface_generic<G: Grid>(
    grid: &G,
    x: u32,
    y: u32,
    z: u32,
    iso_value: f32,
) -> bool {
    // Get 8 corner values
    let corners = [
        grid.get(x, y, z),
        grid.get(x + 1, y, z),
        grid.get(x + 1, y, z + 1),
        grid.get(x, y, z + 1),
        grid.get(x, y + 1, z),
        grid.get(x + 1, y + 1, z),
        grid.get(x + 1, y + 1, z + 1),
        grid.get(x, y + 1, z + 1),
    ];

    // Check if any corner is inside (< isoValue) and any is outside (>= isoValue)
    let mut has_inside = false;
    let mut has_outside = false;

    for &value in &corners {
        if value < iso_value {
            has_inside = true;
        } else {
            has_outside = true;
        }
    }

    has_inside && has_outside
}

/// Find optimal vertex position for a cell (generic version)
fn find_cell_vertex_generic<G: Grid>(
    grid: &G,
    mould_manager: &MouldManager,
    x: u32,
    y: u32,
    z: u32,
    iso_value: f32,
) -> Pt3 {
    // Start at cell center
    let cell_center = grid.get_position(x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5);
    let mut pos = cell_center;

    // Use Newton's method for fast convergence to isosurface
    let max_iterations = 8;
    let tolerance = 0.001;

    for _ in 0..max_iterations {
        let dist = mould_manager.evaluate_sdf(&pos) - iso_value;

        // Close enough to surface
        if dist.abs() < tolerance {
            break;
        }

        // Compute gradient at current position
        let grad = compute_gradient(&pos, |p| mould_manager.evaluate_sdf(p));

        // Gradient magnitude for normalization
        let grad_len = grad.magnitude();

        if grad_len < 0.0001 {
            // Gradient too small, can't make progress
            break;
        }

        // Newton's method: move exactly to the surface along gradient direction
        let step_size = dist / grad_len;

        pos = Pt3::new(
            pos.x - grad.x * step_size,
            pos.y - grad.y * step_size,
            pos.z - grad.z * step_size,
        );
    }

    pos
}
