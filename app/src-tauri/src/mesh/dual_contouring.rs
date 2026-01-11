use crate::mesh::mould::MouldManager;
use crate::mesh::sdf::compute_gradient;
use crate::mesh::types::{MeshData, Pt3, Vec3};
use crate::mesh::voxel_grid::VoxelGrid;
use std::collections::HashMap;

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
pub fn dual_contouring(
    grid: &VoxelGrid,
    mould_manager: &MouldManager,
    iso_value: f32,
) -> MeshData {
    let mut vertices: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let res = grid.resolution;

    // Store vertex index for each cell that contains the surface
    let mut cell_vertices: HashMap<(u32, u32, u32), CellVertex> = HashMap::new();

    // Step 1: Create vertices for cells that intersect the isosurface
    for z in 0..res - 1 {
        for y in 0..res - 1 {
            for x in 0..res - 1 {
                // Check if this cell intersects the isosurface
                if !cell_intersects_surface(grid, x, y, z, iso_value) {
                    continue;
                }

                // Find best vertex position for this cell
                let vertex_pos = find_cell_vertex(grid, mould_manager, x, y, z, iso_value);

                // Add to vertex array
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
        }
    }

    // Step 2: Generate faces between adjacent cells
    // Connect cells that both have vertices and share a face
    for z in 0..res - 1 {
        for y in 0..res - 1 {
            for x in 0..res - 1 {
                if !cell_vertices.contains_key(&(x, y, z)) {
                    continue;
                }

                // Create face in +X direction (YZ plane)
                if x < res - 2 {
                    create_face_x(&cell_vertices, &mut indices, x, y, z);
                }

                // Create face in +Y direction (XZ plane)
                if y < res - 2 {
                    create_face_y(&cell_vertices, &mut indices, x, y, z);
                }

                // Create face in +Z direction (XY plane)
                if z < res - 2 {
                    create_face_z(&cell_vertices, &mut indices, x, y, z);
                }
            }
        }
    }

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
    let max_iterations = 20;
    let tolerance = 0.0001;

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

/// Create face between cells in X direction
/// Connects 4 cells in a 2x2 grid in the YZ plane
fn create_face_x(
    cell_vertices: &HashMap<(u32, u32, u32), CellVertex>,
    indices: &mut Vec<u32>,
    x: u32,
    y: u32,
    z: u32,
) {
    // Four cells in YZ plane: (x,y,z), (x,y+1,z), (x,y,z+1), (x,y+1,z+1)
    let v0 = cell_vertices.get(&(x, y, z));
    let v1 = cell_vertices.get(&(x, y + 1, z));
    let v2 = cell_vertices.get(&(x, y + 1, z + 1));
    let v3 = cell_vertices.get(&(x, y, z + 1));

    if v0.is_none() || v1.is_none() || v2.is_none() || v3.is_none() {
        return;
    }

    let v0 = v0.unwrap();
    let v1 = v1.unwrap();
    let v2 = v2.unwrap();
    let v3 = v3.unwrap();

    // Triangulate quad along shortest diagonal
    let diag02 = distance(&v0.position, &v2.position);
    let diag13 = distance(&v1.position, &v3.position);

    if diag02 < diag13 {
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v2.index);

        indices.push(v0.index);
        indices.push(v2.index);
        indices.push(v3.index);
    } else {
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v3.index);

        indices.push(v1.index);
        indices.push(v2.index);
        indices.push(v3.index);
    }
}

/// Create face between cells in Y direction
/// Connects 4 cells in a 2x2 grid in the XZ plane
fn create_face_y(
    cell_vertices: &HashMap<(u32, u32, u32), CellVertex>,
    indices: &mut Vec<u32>,
    x: u32,
    y: u32,
    z: u32,
) {
    // Four cells in XZ plane: (x,y,z), (x+1,y,z), (x,y,z+1), (x+1,y,z+1)
    let v0 = cell_vertices.get(&(x, y, z));
    let v1 = cell_vertices.get(&(x + 1, y, z));
    let v2 = cell_vertices.get(&(x + 1, y, z + 1));
    let v3 = cell_vertices.get(&(x, y, z + 1));

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
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v2.index);

        indices.push(v0.index);
        indices.push(v2.index);
        indices.push(v3.index);
    } else {
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v3.index);

        indices.push(v1.index);
        indices.push(v2.index);
        indices.push(v3.index);
    }
}

/// Create face between cells in Z direction
/// Connects 4 cells in a 2x2 grid in the XY plane
fn create_face_z(
    cell_vertices: &HashMap<(u32, u32, u32), CellVertex>,
    indices: &mut Vec<u32>,
    x: u32,
    y: u32,
    z: u32,
) {
    // Four cells in XY plane: (x,y,z), (x+1,y,z), (x,y+1,z), (x+1,y+1,z)
    let v0 = cell_vertices.get(&(x, y, z));
    let v1 = cell_vertices.get(&(x + 1, y, z));
    let v2 = cell_vertices.get(&(x + 1, y + 1, z));
    let v3 = cell_vertices.get(&(x, y + 1, z));

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
        indices.push(v0.index);
        indices.push(v1.index);
        indices.push(v2.index);

        indices.push(v0.index);
        indices.push(v2.index);
        indices.push(v3.index);
    } else {
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
