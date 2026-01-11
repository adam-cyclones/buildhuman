// Global state management for mesh generation
// This module provides Tauri commands to sync skeleton/mould state from TypeScript
// and generate meshes using Rust-based dual contouring

use crate::mesh::{
    dual_contouring, dual_contouring_fast, JointData, MouldData, MouldManager, Skeleton,
    VoxelGrid, MeshData, Pt3, AABB,
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
pub fn generate_mesh_from_state_with_quality(
    resolution: u32,
    fast_mode: bool,
) -> Result<MeshData, String> {
    let mut state = MESH_STATE.lock().unwrap();

    let mould_manager = state
        .mould_manager
        .as_mut()
        .ok_or("No mould manager initialized")?;

    println!(
        "Generating mesh with resolution {} (fast_mode: {})",
        resolution, fast_mode
    );

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

    println!("Voxel grid evaluated, extracting surface...");

    // Extract mesh using dual contouring (fast or quality mode)
    let mesh = if fast_mode {
        dual_contouring_fast(&grid, mould_manager, 0.0)
    } else {
        dual_contouring(&grid, mould_manager, 0.0)
    };

    println!(
        "Mesh generated: {} vertices, {} triangles",
        mesh.vertices.len() / 3,
        mesh.indices.len() / 3
    );

    Ok(mesh)
}

/// Legacy API - uses quality mode
pub fn generate_mesh_from_state(resolution: u32) -> Result<MeshData, String> {
    generate_mesh_from_state_with_quality(resolution, false)
}
