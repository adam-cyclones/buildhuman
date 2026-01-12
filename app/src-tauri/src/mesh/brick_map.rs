// Sparse voxel storage using brick maps
// Allocates memory only for regions near the surface, enabling high-resolution meshes

use crate::mesh::grid_trait::Grid;
use crate::mesh::mould::MouldManager;
use crate::mesh::types::{Pt3, AABB};
use rayon::prelude::*;
use std::collections::HashMap;

/// Size of each brick (must be power of 2 for efficient addressing)
pub const BRICK_SIZE: u32 = 8;

/// Coordinate of a brick in the brick grid
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct BrickCoord {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

/// A single brick containing 8x8x8 voxels
#[derive(Debug, Clone)]
pub struct Brick {
    /// Flattened array of SDF values [z][y][x]
    pub values: Box<[f32; (BRICK_SIZE * BRICK_SIZE * BRICK_SIZE) as usize]>,
}

impl Brick {
    pub fn new() -> Self {
        Self {
            values: Box::new([f32::INFINITY; (BRICK_SIZE * BRICK_SIZE * BRICK_SIZE) as usize]),
        }
    }

    /// Get voxel value at local brick coordinates (0..BRICK_SIZE)
    #[inline]
    pub fn get(&self, x: u32, y: u32, z: u32) -> f32 {
        let idx = (z * BRICK_SIZE * BRICK_SIZE + y * BRICK_SIZE + x) as usize;
        self.values[idx]
    }

    /// Set voxel value at local brick coordinates (0..BRICK_SIZE)
    #[inline]
    pub fn set(&mut self, x: u32, y: u32, z: u32, value: f32) {
        let idx = (z * BRICK_SIZE * BRICK_SIZE + y * BRICK_SIZE + x) as usize;
        self.values[idx] = value;
    }
}

/// Sparse voxel grid using brick-based storage
/// Only allocates memory for bricks that contain or are near the surface
pub struct BrickMap {
    /// Resolution of the virtual grid (total voxels = resolution^3)
    pub resolution: u32,
    /// World-space bounding box
    pub bounds: AABB,
    /// Sparse storage of bricks
    bricks: HashMap<BrickCoord, Brick>,
    /// Number of bricks along each axis
    brick_count: u32,
    /// Size of each voxel in world space
    voxel_size: f32,
}

impl BrickMap {
    /// Create a new brick map with the given resolution and bounds
    /// Initially contains no bricks - call allocate_surface_bricks() to populate
    pub fn new(resolution: u32, bounds: AABB) -> Self {
        assert!(
            resolution % BRICK_SIZE == 0,
            "Resolution must be multiple of brick size ({})",
            BRICK_SIZE
        );

        let brick_count = resolution / BRICK_SIZE;
        let extent = bounds.max - bounds.min;
        let voxel_size = extent.x / resolution as f32;

        Self {
            resolution,
            bounds,
            bricks: HashMap::new(),
            brick_count,
            voxel_size,
        }
    }

    /// Convert world position to brick coordinate
    fn world_to_brick_coord(&self, pos: &Pt3) -> BrickCoord {
        let local = *pos - self.bounds.min;
        let brick_size_world = self.voxel_size * BRICK_SIZE as f32;

        BrickCoord {
            x: (local.x / brick_size_world).floor() as i32,
            y: (local.y / brick_size_world).floor() as i32,
            z: (local.z / brick_size_world).floor() as i32,
        }
    }

    /// Convert voxel coordinates (0..resolution) to brick coordinate
    fn voxel_to_brick_coord(&self, x: u32, y: u32, z: u32) -> BrickCoord {
        BrickCoord {
            x: (x / BRICK_SIZE) as i32,
            y: (y / BRICK_SIZE) as i32,
            z: (z / BRICK_SIZE) as i32,
        }
    }

    /// Get voxel value at global coordinates (0..resolution)
    /// Returns f32::INFINITY if the brick is not allocated
    pub fn get(&self, x: u32, y: u32, z: u32) -> f32 {
        let brick_coord = self.voxel_to_brick_coord(x, y, z);

        match self.bricks.get(&brick_coord) {
            Some(brick) => {
                let local_x = x % BRICK_SIZE;
                let local_y = y % BRICK_SIZE;
                let local_z = z % BRICK_SIZE;
                brick.get(local_x, local_y, local_z)
            }
            None => f32::INFINITY, // Outside/unallocated = far from surface
        }
    }

    /// Set voxel value at global coordinates
    /// Allocates brick if it doesn't exist
    fn set(&mut self, x: u32, y: u32, z: u32, value: f32) {
        let brick_coord = self.voxel_to_brick_coord(x, y, z);

        let brick = self.bricks.entry(brick_coord).or_insert_with(Brick::new);

        let local_x = x % BRICK_SIZE;
        let local_y = y % BRICK_SIZE;
        let local_z = z % BRICK_SIZE;
        brick.set(local_x, local_y, local_z, value);
    }

    /// Convert voxel coordinates to world position (center of voxel)
    pub fn get_position(&self, x: f32, y: f32, z: f32) -> Pt3 {
        Pt3::new(
            self.bounds.min.x + x * self.voxel_size,
            self.bounds.min.y + y * self.voxel_size,
            self.bounds.min.z + z * self.voxel_size,
        )
    }

    /// Allocate bricks near the surface using a two-pass algorithm:
    /// 1. Sample SDF on coarse grid to find surface regions
    /// 2. Allocate and evaluate only bricks near the surface
    pub fn allocate_surface_bricks(&mut self, mould_manager: &MouldManager, surface_thickness: f32) {
        // Capture values needed in closures
        let brick_count = self.brick_count;
        let voxel_size = self.voxel_size;
        let bounds_min = self.bounds.min;

        // Pass 1: Coarse sampling to find which bricks contain the surface
        // Sample at brick centers
        let brick_positions: Vec<_> = (0..brick_count)
            .flat_map(|bz| {
                (0..brick_count).flat_map(move |by| {
                    (0..brick_count).map(move |bx| {
                        let brick_coord = BrickCoord {
                            x: bx as i32,
                            y: by as i32,
                            z: bz as i32,
                        };

                        // World position of brick center
                        let voxel_x = (bx * BRICK_SIZE + BRICK_SIZE / 2) as f32;
                        let voxel_y = (by * BRICK_SIZE + BRICK_SIZE / 2) as f32;
                        let voxel_z = (bz * BRICK_SIZE + BRICK_SIZE / 2) as f32;

                        let world_pos = Pt3::new(
                            bounds_min.x + voxel_x * voxel_size,
                            bounds_min.y + voxel_y * voxel_size,
                            bounds_min.z + voxel_z * voxel_size,
                        );

                        (brick_coord, world_pos)
                    })
                })
            })
            .collect();

        // Evaluate SDF at brick centers in parallel
        let surface_bricks: Vec<_> = brick_positions
            .par_iter()
            .filter_map(|(brick_coord, world_pos)| {
                let sdf = mould_manager.evaluate_sdf(world_pos);

                // Brick diagonal in world space (maximum distance from center to corner)
                let brick_diagonal = voxel_size * (BRICK_SIZE as f32) * 0.866; // sqrt(3)/2

                // Include brick if it's within surface_thickness + diagonal of the surface
                if sdf.abs() < surface_thickness + brick_diagonal {
                    Some(*brick_coord)
                } else {
                    None
                }
            })
            .collect();

        // Pass 2: Allocate and evaluate surface bricks
        for brick_coord in surface_bricks {
            self.bricks.insert(brick_coord, Brick::new());
        }

        // Evaluate all voxels in allocated bricks (in parallel)
        self.evaluate_allocated_bricks(mould_manager);
    }

    /// Evaluate SDF at all voxels in allocated bricks
    fn evaluate_allocated_bricks(&mut self, mould_manager: &MouldManager) {
        // Collect all voxel coordinates in allocated bricks
        let voxel_coords: Vec<_> = self.bricks
            .keys()
            .flat_map(|brick_coord| {
                (0..BRICK_SIZE).flat_map(move |lz| {
                    (0..BRICK_SIZE).flat_map(move |ly| {
                        (0..BRICK_SIZE).map(move |lx| {
                            let global_x = brick_coord.x as u32 * BRICK_SIZE + lx;
                            let global_y = brick_coord.y as u32 * BRICK_SIZE + ly;
                            let global_z = brick_coord.z as u32 * BRICK_SIZE + lz;
                            (global_x, global_y, global_z)
                        })
                    })
                })
            })
            .collect();

        // Evaluate in parallel
        let values: Vec<_> = voxel_coords
            .par_iter()
            .map(|(x, y, z)| {
                let pos = self.get_position(*x as f32 + 0.5, *y as f32 + 0.5, *z as f32 + 0.5);
                let sdf = mould_manager.evaluate_sdf(&pos);
                (*x, *y, *z, sdf)
            })
            .collect();

        // Store results
        for (x, y, z, sdf) in values {
            self.set(x, y, z, sdf);
        }
    }

    /// Get number of allocated bricks
    pub fn brick_count(&self) -> usize {
        self.bricks.len()
    }

    /// Get memory usage in bytes
    pub fn memory_usage(&self) -> usize {
        self.bricks.len() * std::mem::size_of::<Brick>()
    }
}

// Implement Grid trait for BrickMap
impl Grid for BrickMap {
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
