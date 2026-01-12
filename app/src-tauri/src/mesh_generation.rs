// Global state management for mesh generation
// This module provides Tauri commands to sync skeleton/mould state from TypeScript
// and generate meshes using Rust-based dual contouring

use crate::mesh::{
    dual_contouring, dual_contouring_fast, dual_contouring_brick_map, BrickMap, JointData,
    MouldData, MouldManager, Skeleton, VoxelGrid, MeshData, Pt3, AABB,
};
use once_cell::sync::Lazy;
use std::sync::Mutex;

/// Global state holding the skeleton and mould manager
pub struct MeshGeneratorState {
    skeleton: Option<Skeleton>,
    mould_manager: Option<MouldManager>,
}

impl MeshGeneratorState {
    pub fn new() -> Self {
        Self {
            skeleton: None,
            mould_manager: None,
        }
    }
}

static MESH_STATE: Lazy<Mutex<MeshGeneratorState>> = Lazy::new(|| {
    Mutex::new(MeshGeneratorState::new())
});

/// Update the skeleton from TypeScript
pub fn update_skeleton(joints: Vec<JointData>) {
    let mut state = MESH_STATE.lock().unwrap();

    let mut skeleton = Skeleton::new();
    for joint_data in joints {
        skeleton.add_joint(joint_data.into());
    }

    let num_joints = skeleton.get_joints().len();
    println!("Skeleton updated with {} joints", num_joints);

    // Clone skeleton for mould_manager
    let skeleton_clone = skeleton.clone();
    state.skeleton = Some(skeleton);

    if let Some(ref mut mould_manager) = state.mould_manager {
        mould_manager.set_skeleton(skeleton_clone);
    }
}

/// Update the moulds from TypeScript
pub fn update_moulds(moulds: Vec<MouldData>) {
    let mut state = MESH_STATE.lock().unwrap();

    let mut mould_manager = MouldManager::new();

    for mould_data in moulds {
        mould_manager.add_mould(mould_data.into());
    }

    // Set skeleton if available
    if let Some(ref skeleton) = state.skeleton {
        mould_manager.set_skeleton(skeleton.clone());
    }

    let num_moulds = mould_manager.get_moulds().len();
    println!("Moulds updated with {} moulds", num_moulds);

    state.mould_manager = Some(mould_manager);
}

/// Generate mesh from current state using dual contouring
/// Use fast_mode=true for realtime interaction (skips Newton projection)
/// Automatically chooses between dense VoxelGrid (< 96) or sparse BrickMap (>= 96)
pub fn generate_mesh_from_state_with_quality(
    resolution: u32,
    fast_mode: bool,
) -> Result<MeshData, String> {
    // Automatically choose implementation based on resolution
    // Dense grid for low/med res, brick map for high res
    const BRICK_MAP_THRESHOLD: u32 = 96;

    if resolution >= BRICK_MAP_THRESHOLD {
        // High resolution: use brick map for memory efficiency
        generate_mesh_from_state_brick_map(resolution, fast_mode)
    } else {
        // Low/medium resolution: use dense grid (simpler, faster for small grids)
        generate_mesh_from_state_dense(resolution, fast_mode)
    }
}

/// Generate mesh using dense VoxelGrid (for resolutions < 96)
fn generate_mesh_from_state_dense(
    resolution: u32,
    fast_mode: bool,
) -> Result<MeshData, String> {
    let mut state = MESH_STATE.lock().unwrap();

    let mould_manager = state
        .mould_manager
        .as_mut()
        .ok_or("No mould manager initialized")?;

    // CRITICAL OPTIMIZATION: Rebuild transform cache before grid evaluation
    // This caches all skeleton transforms once instead of recalculating per-voxel
    mould_manager.rebuild_cache();

    // Define bounds for the mesh (slightly larger than character)
    let bounds = AABB {
        min: Pt3::new(-1.0, -1.0, -1.0),
        max: Pt3::new(1.0, 1.5, 1.0),
    };

    // Create and evaluate voxel grid
    let mut grid = VoxelGrid::new(resolution, bounds);
    grid.evaluate(mould_manager);

    // Extract mesh using dual contouring (fast or quality mode)
    let mesh = if fast_mode {
        dual_contouring_fast(&grid, mould_manager, 0.0)
    } else {
        dual_contouring(&grid, mould_manager, 0.0)
    };

    Ok(mesh)
}

/// Legacy API - uses quality mode
pub fn generate_mesh_from_state(resolution: u32) -> Result<MeshData, String> {
    generate_mesh_from_state_with_quality(resolution, false)
}

/// Generate high-resolution mesh using sparse brick map storage
/// Recommended for resolutions >= 128
/// Uses two-pass algorithm to only allocate memory near the surface
pub fn generate_mesh_from_state_brick_map(
    resolution: u32,
    fast_mode: bool,
) -> Result<MeshData, String> {
    let mut state = MESH_STATE.lock().unwrap();

    let mould_manager = state
        .mould_manager
        .as_mut()
        .ok_or("No mould manager initialized")?;

    // Rebuild transform cache before grid evaluation
    mould_manager.rebuild_cache();

    // Define bounds for the mesh
    let bounds = AABB {
        min: Pt3::new(-1.0, -1.0, -1.0),
        max: Pt3::new(1.0, 1.5, 1.0),
    };

    // Create brick map (initially empty)
    let mut brick_map = BrickMap::new(resolution, bounds);

    // Allocate and evaluate only surface bricks (two-pass algorithm)
    // surface_thickness controls how far from surface to allocate bricks
    let surface_thickness = 0.2; // Allocate bricks within 0.2 units of surface
    brick_map.allocate_surface_bricks(mould_manager, surface_thickness);

    // Extract mesh using dual contouring
    let mesh = dual_contouring_brick_map(&brick_map, mould_manager, 0.0, fast_mode);

    Ok(mesh)
}
