// Trait for abstracting over different grid storage implementations
// Allows dual contouring to work with both dense VoxelGrid and sparse BrickMap

use crate::mesh::types::Pt3;

/// Common interface for voxel grids (dense or sparse)
/// Must be Sync for parallel dual contouring
pub trait Grid: Sync {
    /// Get the resolution of the grid
    fn resolution(&self) -> u32;

    /// Get SDF value at grid coordinates (0..resolution)
    fn get(&self, x: u32, y: u32, z: u32) -> f32;

    /// Convert grid coordinates to world position
    /// Coordinates can be fractional (e.g., 0.5 for cell center)
    fn get_position(&self, x: f32, y: f32, z: f32) -> Pt3;
}
