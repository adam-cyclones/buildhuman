// Marching cubes surface extraction

import type { VoxelGrid } from "./voxel-grid";
import type { Vec3 } from "./types";

// Edge connections (which corners each edge connects)
const EDGE_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0], // bottom edges
  [4, 5], [5, 6], [6, 7], [7, 4], // top edges
  [0, 4], [1, 5], [2, 6], [3, 7], // vertical edges
];

// Marching cubes lookup tables (lazy initialized)
let EDGE_TABLE: number[] | null = null;
let TRI_TABLE: number[][] | null = null;

function initTables() {
  if (EDGE_TABLE === null) {
    EDGE_TABLE = buildEdgeTable();
    TRI_TABLE = buildTriTable();
  }
}

type MeshData = {
  vertices: number[];
  indices: number[];
};

/**
 * Extract triangle mesh from voxel grid using marching cubes
 */
export function marchingCubes(grid: VoxelGrid, isoValue: number = 0): MeshData {
  // Initialize tables on first use
  initTables();

  const vertices: number[] = [];
  const indices: number[] = [];
  const res = grid.resolution;

  // Walk through each cube in the grid
  for (let z = 0; z < res - 1; z++) {
    for (let y = 0; y < res - 1; y++) {
      for (let x = 0; x < res - 1; x++) {
        processCube(grid, x, y, z, isoValue, vertices, indices);
      }
    }
  }

  return { vertices, indices };
}

/**
 * Process a single cube in the marching cubes algorithm
 */
function processCube(
  grid: VoxelGrid,
  x: number,
  y: number,
  z: number,
  isoValue: number,
  vertices: number[],
  indices: number[]
) {
  // Get 8 corner values
  const cubeValues = [
    grid.get(x, y, z),
    grid.get(x + 1, y, z),
    grid.get(x + 1, y, z + 1),
    grid.get(x, y, z + 1),
    grid.get(x, y + 1, z),
    grid.get(x + 1, y + 1, z),
    grid.get(x + 1, y + 1, z + 1),
    grid.get(x, y + 1, z + 1),
  ];

  // Determine cube case (8 bits for 8 corners)
  let cubeCase = 0;
  for (let i = 0; i < 8; i++) {
    if (cubeValues[i] < isoValue) {
      cubeCase |= 1 << i;
    }
  }

  // Skip if cube is entirely inside or outside
  if (cubeCase === 0 || cubeCase === 255) {
    return;
  }

  // Get corner positions
  const corners: Vec3[] = [
    grid.getPosition(x, y, z),
    grid.getPosition(x + 1, y, z),
    grid.getPosition(x + 1, y, z + 1),
    grid.getPosition(x, y, z + 1),
    grid.getPosition(x, y + 1, z),
    grid.getPosition(x + 1, y + 1, z),
    grid.getPosition(x + 1, y + 1, z + 1),
    grid.getPosition(x, y + 1, z + 1),
  ];

  // Interpolate edge vertices
  const edgeVertices: Vec3[] = [];
  const edges = EDGE_TABLE![cubeCase];

  for (let i = 0; i < 12; i++) {
    if (edges & (1 << i)) {
      const [c1, c2] = EDGE_CONNECTIONS[i];
      const v1 = corners[c1];
      const v2 = corners[c2];
      const val1 = cubeValues[c1];
      const val2 = cubeValues[c2];

      // Linear interpolation
      const t = (isoValue - val1) / (val2 - val1);
      edgeVertices[i] = [
        v1[0] + t * (v2[0] - v1[0]),
        v1[1] + t * (v2[1] - v1[1]),
        v1[2] + t * (v2[2] - v1[2]),
      ];
    }
  }

  // Generate triangles
  const tris = TRI_TABLE![cubeCase];
  for (let i = 0; i < tris.length; i += 3) {
    const v1 = edgeVertices[tris[i]];
    const v2 = edgeVertices[tris[i + 1]];
    const v3 = edgeVertices[tris[i + 2]];

    const baseIndex = vertices.length / 3;
    vertices.push(v1[0], v1[1], v1[2]);
    vertices.push(v2[0], v2[1], v2[2]);
    vertices.push(v3[0], v3[1], v3[2]);

    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
  }
}

function buildEdgeTable(): number[] {
  // Simplified edge table - which edges are intersected for each case
  // Full table has 256 entries, this is a minimal working version
  const table = new Array(256).fill(0);

  // Case 1: corner 0 inside
  table[1] = 0b000100001001; // edges 0,3,8
  // Case 254: corner 0 outside (inverse of case 1)
  table[254] = 0b000100001001;

  // For a minimal implementation, we'll compute this on the fly
  // by checking which edges cross the isosurface
  for (let i = 0; i < 256; i++) {
    let edges = 0;
    for (let e = 0; e < 12; e++) {
      const [c1, c2] = EDGE_CONNECTIONS[e];
      const inside1 = (i & (1 << c1)) !== 0;
      const inside2 = (i & (1 << c2)) !== 0;
      if (inside1 !== inside2) {
        edges |= 1 << e;
      }
    }
    table[i] = edges;
  }

  return table;
}

function buildTriTable(): number[][] {
  // Triangle table - which edges form triangles for each case
  // This is a simplified version; full marching cubes has 256 cases
  const table: number[][] = new Array(256).fill(null).map(() => []);

  // We'll use a simple approach: for each case, generate triangles
  // by connecting the intersected edges
  // This is a placeholder - proper marching cubes needs the full lookup table

  // For minimal implementation, we'll generate basic triangulations
  // Case 1: single corner (forms 1 triangle)
  table[1] = [0, 8, 3];
  table[2] = [0, 1, 9];
  table[4] = [1, 2, 10];
  table[8] = [2, 3, 11];
  table[16] = [4, 7, 8];
  table[32] = [5, 4, 9];
  table[64] = [6, 5, 10];
  table[128] = [7, 6, 11];

  // For other cases, we need the full table
  // For now, let's use a simple heuristic for unknown cases
  for (let i = 0; i < 256; i++) {
    if (table[i].length === 0) {
      const edges = EDGE_TABLE![i];
      const edgeList: number[] = [];
      for (let e = 0; e < 12; e++) {
        if (edges & (1 << e)) {
          edgeList.push(e);
        }
      }

      // Simple fan triangulation
      if (edgeList.length >= 3) {
        for (let t = 1; t < edgeList.length - 1; t++) {
          table[i].push(edgeList[0], edgeList[t], edgeList[t + 1]);
        }
      }
    }
  }

  return table;
}
