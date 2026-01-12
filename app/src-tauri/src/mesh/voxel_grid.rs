use crate::mesh::grid_trait::Grid;
use crate::mesh::mould::MouldManager;
use crate::mesh::types::{Pt3, Vec3, AABB};
use rayon::prelude::*;

/// Represents the voxel grid used for evaluating the Signed Distance Field (SDF).
#[derive(Debug, Clone)]
pub struct VoxelGrid {
    pub resolution: u32,
    pub bounds: AABB,
    /// The SDF values at each grid point. Stored in a flat array, indexed by `x + y*res + z*res*res`.
    pub data: Vec<f32>,
    /// The size of a single voxel cell in world units.
    pub cell_size: f32,
}

impl VoxelGrid {
    /// Creates a new, empty VoxelGrid.
    pub fn new(resolution: u32, bounds: AABB) -> Self {
        let size = bounds.max - bounds.min;
        let cell_size = size.x.max(size.y).max(size.z) / (resolution as f32 - 1.0);

        Self {
            resolution,
            bounds,
            data: vec![0.0; (resolution * resolution * resolution) as usize],
            cell_size,
        }
    }

    /// Evaluates the SDF for all points in the grid in parallel.
    pub fn evaluate(&mut self, mould_manager: &MouldManager) {
        let res = self.resolution;
        let min_bound = self.bounds.min;
        let cell_size = self.cell_size;

        self.data
            .par_iter_mut()
            .enumerate()
            .for_each(|(index, value)| {
                let i = index as u32;
                let x = i % res;
                let y = (i / res) % res;
                let z = i / (res * res);

                let pos = min_bound
                    + Vec3::new(
                        x as f32 * cell_size,
                        y as f32 * cell_size,
                        z as f32 * cell_size,
                    );

                *value = mould_manager.evaluate_sdf(&pos);
            });
    }

    /// Returns the SDF value at a given grid coordinate.
    #[inline]
    pub fn get(&self, x: u32, y: u32, z: u32) -> f32 {
        let res = self.resolution;
        self.data[(x + y * res + z * res * res) as usize]
    }

    /// Returns the world position of a grid point (can be fractional for cell centers)
    pub fn get_position(&self, x: f32, y: f32, z: f32) -> Pt3 {
        self.bounds.min
            + Vec3::new(
                x * self.cell_size,
                y * self.cell_size,
                z * self.cell_size,
            )
    }
}

// Implement Grid trait for VoxelGrid
impl Grid for VoxelGrid {
    fn resolution(&self) -> u32 {
        self.resolution
    }

    fn get(&self, x: u32, y: u32, z: u32) -> f32 {
        self.get(x, y, z)
    }

    fn get_position(&self, x: f32, y: f32, z: f32) -> Pt3 {
        self.get_position(x, y, z)
    }
}
