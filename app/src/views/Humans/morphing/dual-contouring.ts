// Dual Contouring surface extraction (Surface Nets variant)
// Based on: https://people.compute.dtu.dk/janba/gallery/polygonization.html
//
// STATUS: Produces smooth closed meshes with Newton's method vertex projection
// to isosurface. Vertices are accurately positioned on the surface, not grid-aligned.
// Uses 2x2 grid face generation with shortest diagonal triangulation.
//
// TODO for better quality:
// - Fix triangle winding order for proper front-face culling (currently using DoubleSide)
// - Consider QEF (Quadratic Error Function) for even better vertex positioning
// - Add edge-based quad generation instead of grid-based for cleaner topology
// - Implement feature-preserving techniques for sharp edges

import type { VoxelGrid } from "./voxel-grid";
import type { Vec3 } from "./types";
import { computeGradient } from "./sdf";

type MeshData = {
  vertices: number[];
  indices: number[];
};

type CellVertex = {
  position: Vec3;
  index: number;
};

/**
 * Extract triangle mesh using Dual Contouring
 * Produces higher quality meshes than Marching Cubes by:
 * - Placing one vertex per cell (not per edge)
 * - Projecting vertices onto the actual isosurface
 * - Generating quads that triangulate cleanly
 */
export function dualContouring(
  grid: VoxelGrid,
  evaluateSDF: (p: Vec3) => number,
  isoValue: number = 0
): MeshData {
  const vertices: number[] = [];
  const indices: number[] = [];
  const res = grid.resolution;

  // Store vertex index for each cell that contains the surface
  const cellVertices = new Map<string, CellVertex>();

  // Step 1: Create vertices for cells that intersect the isosurface
  for (let z = 0; z < res - 1; z++) {
    for (let y = 0; y < res - 1; y++) {
      for (let x = 0; x < res - 1; x++) {
        const cellKey = `${x},${y},${z}`;

        // Check if this cell intersects the isosurface
        if (!cellIntersectsSurface(grid, x, y, z, isoValue)) {
          continue;
        }

        // Find best vertex position for this cell
        const vertexPos = findCellVertex(grid, evaluateSDF, x, y, z, isoValue);

        // Add to vertex array
        const vertexIndex = vertices.length / 3;
        vertices.push(vertexPos[0], vertexPos[1], vertexPos[2]);

        cellVertices.set(cellKey, {
          position: vertexPos,
          index: vertexIndex,
        });
      }
    }
  }

  // Step 2: Generate faces between adjacent cells
  // Connect cells that both have vertices and share a face
  for (let z = 0; z < res - 1; z++) {
    for (let y = 0; y < res - 1; y++) {
      for (let x = 0; x < res - 1; x++) {
        const cell = cellVertices.get(`${x},${y},${z}`);
        if (!cell) continue;

        // Create face in +X direction (YZ plane)
        if (x < res - 2) {
          createFaceX(cellVertices, indices, x, y, z);
        }

        // Create face in +Y direction (XZ plane)
        if (y < res - 2) {
          createFaceY(cellVertices, indices, x, y, z);
        }

        // Create face in +Z direction (XY plane)
        if (z < res - 2) {
          createFaceZ(cellVertices, indices, x, y, z);
        }
      }
    }
  }

  return { vertices, indices };
}

/**
 * Check if a voxel cell intersects the isosurface
 * Returns true if corners have different signs (sign change = surface crossing)
 */
function cellIntersectsSurface(
  grid: VoxelGrid,
  x: number,
  y: number,
  z: number,
  isoValue: number
): boolean {
  // Get 8 corner values
  const corners = [
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
  let hasInside = false;
  let hasOutside = false;

  for (const value of corners) {
    if (value < isoValue) {
      hasInside = true;
    } else {
      hasOutside = true;
    }
  }

  return hasInside && hasOutside;
}

/**
 * Find optimal vertex position for a cell using surface projection
 * Uses Newton's method to find the closest point on the isosurface to the cell center
 *
 * This implements the improved algorithm mentioned in the dual contouring reference:
 * "tries to find the point on the isosurface which is closest to the original cube corner"
 */
function findCellVertex(
  grid: VoxelGrid,
  evaluateSDF: (p: Vec3) => number,
  x: number,
  y: number,
  z: number,
  isoValue: number
): Vec3 {
  // Start at cell center
  const cellCenter = grid.getPosition(x + 0.5, y + 0.5, z + 0.5);
  let pos: Vec3 = [cellCenter[0], cellCenter[1], cellCenter[2]];

  // Use Newton's method for fast convergence to isosurface
  // This is more aggressive than gradient descent and converges faster
  const maxIterations = 20; // Increased from 8
  const tolerance = 0.0001; // Tighter tolerance (was 0.001)

  for (let iter = 0; iter < maxIterations; iter++) {
    const dist = evaluateSDF(pos) - isoValue;

    // Close enough to surface
    if (Math.abs(dist) < tolerance) {
      break;
    }

    // Compute gradient at current position
    const grad = computeGradient(pos, evaluateSDF);

    // Gradient magnitude for normalization
    const gradLen = Math.sqrt(grad[0] * grad[0] + grad[1] * grad[1] + grad[2] * grad[2]);

    if (gradLen < 0.0001) {
      // Gradient too small, can't make progress
      break;
    }

    // Newton's method: move exactly to the surface along gradient direction
    // Distance to surface divided by gradient magnitude gives step size
    const stepSize = dist / gradLen;

    pos = [
      pos[0] - grad[0] * stepSize,
      pos[1] - grad[1] * stepSize,
      pos[2] - grad[2] * stepSize,
    ];
  }

  return pos;
}

/**
 * Create face between cells in X direction
 * Connects 4 cells in a 2x2 grid in the YZ plane
 */
function createFaceX(
  cellVertices: Map<string, CellVertex>,
  indices: number[],
  x: number,
  y: number,
  z: number
): void {
  // Four cells in YZ plane: (x,y,z), (x,y+1,z), (x,y,z+1), (x,y+1,z+1)
  const v0 = cellVertices.get(`${x},${y},${z}`);
  const v1 = cellVertices.get(`${x},${y + 1},${z}`);
  const v2 = cellVertices.get(`${x},${y + 1},${z + 1}`);
  const v3 = cellVertices.get(`${x},${y},${z + 1}`);

  if (!v0 || !v1 || !v2 || !v3) return;

  // Triangulate quad along shortest diagonal
  const diag02 = distance(v0.position, v2.position);
  const diag13 = distance(v1.position, v3.position);

  if (diag02 < diag13) {
    indices.push(v0.index, v1.index, v2.index);
    indices.push(v0.index, v2.index, v3.index);
  } else {
    indices.push(v0.index, v1.index, v3.index);
    indices.push(v1.index, v2.index, v3.index);
  }
}

/**
 * Create face between cells in Y direction
 * Connects 4 cells in a 2x2 grid in the XZ plane
 */
function createFaceY(
  cellVertices: Map<string, CellVertex>,
  indices: number[],
  x: number,
  y: number,
  z: number
): void {
  // Four cells in XZ plane: (x,y,z), (x+1,y,z), (x,y,z+1), (x+1,y,z+1)
  const v0 = cellVertices.get(`${x},${y},${z}`);
  const v1 = cellVertices.get(`${x + 1},${y},${z}`);
  const v2 = cellVertices.get(`${x + 1},${y},${z + 1}`);
  const v3 = cellVertices.get(`${x},${y},${z + 1}`);

  if (!v0 || !v1 || !v2 || !v3) return;

  const diag02 = distance(v0.position, v2.position);
  const diag13 = distance(v1.position, v3.position);

  if (diag02 < diag13) {
    indices.push(v0.index, v1.index, v2.index);
    indices.push(v0.index, v2.index, v3.index);
  } else {
    indices.push(v0.index, v1.index, v3.index);
    indices.push(v1.index, v2.index, v3.index);
  }
}

/**
 * Create face between cells in Z direction
 * Connects 4 cells in a 2x2 grid in the XY plane
 */
function createFaceZ(
  cellVertices: Map<string, CellVertex>,
  indices: number[],
  x: number,
  y: number,
  z: number
): void {
  // Four cells in XY plane: (x,y,z), (x+1,y,z), (x,y+1,z), (x+1,y+1,z)
  const v0 = cellVertices.get(`${x},${y},${z}`);
  const v1 = cellVertices.get(`${x + 1},${y},${z}`);
  const v2 = cellVertices.get(`${x + 1},${y + 1},${z}`);
  const v3 = cellVertices.get(`${x},${y + 1},${z}`);

  if (!v0 || !v1 || !v2 || !v3) return;

  const diag02 = distance(v0.position, v2.position);
  const diag13 = distance(v1.position, v3.position);

  if (diag02 < diag13) {
    indices.push(v0.index, v1.index, v2.index);
    indices.push(v0.index, v2.index, v3.index);
  } else {
    indices.push(v0.index, v1.index, v3.index);
    indices.push(v1.index, v2.index, v3.index);
  }
}

/**
 * Compute Euclidean distance between two points
 */
function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
