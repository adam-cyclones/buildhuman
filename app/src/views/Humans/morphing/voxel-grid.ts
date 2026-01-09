// Voxel grid for SDF evaluation

import type { Vec3, Mould } from "./types";
import { sphereSDF } from "./sdf";

export class VoxelGrid {
  resolution: number;
  bounds: { min: Vec3; max: Vec3 };
  data: Float32Array;
  cellSize: number;

  constructor(resolution: number, bounds: { min: Vec3; max: Vec3 }) {
    this.resolution = resolution;
    this.bounds = bounds;
    this.data = new Float32Array(resolution * resolution * resolution);

    const size = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    this.cellSize = Math.max(...size) / (resolution - 1);
  }

  /**
   * Evaluate SDF at all voxel positions for given mould
   */
  evaluate(mould: Mould) {
    const { min } = this.bounds;
    const res = this.resolution;

    for (let z = 0; z < res; z++) {
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const point: Vec3 = [
            min[0] + x * this.cellSize,
            min[1] + y * this.cellSize,
            min[2] + z * this.cellSize,
          ];

          const distance = sphereSDF(point, mould.center, mould.radius);
          const index = x + y * res + z * res * res;
          this.data[index] = distance;
        }
      }
    }
  }

  /**
   * Get voxel value at grid position
   */
  get(x: number, y: number, z: number): number {
    const index = x + y * this.resolution + z * this.resolution * this.resolution;
    return this.data[index];
  }

  /**
   * Get world position of voxel
   */
  getPosition(x: number, y: number, z: number): Vec3 {
    return [
      this.bounds.min[0] + x * this.cellSize,
      this.bounds.min[1] + y * this.cellSize,
      this.bounds.min[2] + z * this.cellSize,
    ];
  }
}
