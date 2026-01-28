// Global state management for mesh generation
// This module provides Tauri commands to sync skeleton/mould state from TypeScript
// and generate meshes using Rust-based dual contouring

use crate::mesh::{
    dual_contouring, dual_contouring_fast, dual_contouring_brick_map, BrickMap, JointData,
    MouldData, MouldManager, Skeleton, VoxelGrid, MeshData, Pt3, AABB,
};
use once_cell::sync::Lazy;
use std::sync::Mutex;
use crate::mesh::types::Vec3;
use std::f32::consts::PI;

/// Global state holding the skeleton and mould manager
pub struct MeshGeneratorState {
    skeleton: Option<Skeleton>,
    mould_manager: Option<MouldManager>,
    last_skeleton: Option<Skeleton>,
    prev_skeleton: Option<Skeleton>,
    last_moulds: Vec<MouldData>,
    moved_joint_ids: Vec<String>,
    dirty_bounds: Option<AABB>,
    brick_map: Option<BrickMap>,
    brick_map_resolution: Option<u32>,
    last_mesh: Option<MeshData>,
}

impl MeshGeneratorState {
    pub fn new() -> Self {
        Self {
            skeleton: None,
            mould_manager: None,
            last_skeleton: None,
            prev_skeleton: None,
            last_moulds: Vec::new(),
            moved_joint_ids: Vec::new(),
            dirty_bounds: None,
            brick_map: None,
            brick_map_resolution: None,
            last_mesh: None,
        }
    }
}

static MESH_STATE: Lazy<Mutex<MeshGeneratorState>> = Lazy::new(|| {
    Mutex::new(MeshGeneratorState::new())
});

/// Update the skeleton from TypeScript
pub fn update_skeleton(joints: Vec<JointData>) {
    let mut state = MESH_STATE.lock().unwrap();

    let prev_skeleton = state.last_skeleton.clone();
    let mut skeleton = Skeleton::new();
    for joint_data in joints {
        skeleton.add_joint(joint_data.into());
    }

    let num_joints = skeleton.get_joints().len();
    println!("Skeleton updated with {} joints", num_joints);

    let moved_joint_ids = if let Some(prev) = prev_skeleton.as_ref() {
        compute_moved_joints(prev, &skeleton)
    } else {
        skeleton
            .get_joints()
            .iter()
            .map(|joint| joint.id.clone())
            .collect()
    };
    state.moved_joint_ids = moved_joint_ids;

    // Clone skeleton for mould_manager
    let skeleton_clone = skeleton.clone();
    state.skeleton = Some(skeleton);
    state.prev_skeleton = prev_skeleton;
    state.last_skeleton = Some(skeleton_clone.clone());

    if let Some(ref mut mould_manager) = state.mould_manager {
        mould_manager.set_skeleton(skeleton_clone);
    }
}

/// Update the moulds from TypeScript
pub fn update_moulds(moulds: Vec<MouldData>) {
    let mut state = MESH_STATE.lock().unwrap();

    let prev_moulds = std::mem::take(&mut state.last_moulds);
    let prev_skeleton = state.prev_skeleton.take();

    let mut mould_manager = MouldManager::new();

    for mould_data in &moulds {
        mould_manager.add_mould(mould_data.clone().into());
    }

    // Set skeleton if available
    if let Some(ref skeleton) = state.skeleton {
        mould_manager.set_skeleton(skeleton.clone());
    }

    let num_moulds = mould_manager.get_moulds().len();
    println!("Moulds updated with {} moulds", num_moulds);

    let mut dirty_bounds = None;
    let mut prev_mould_map = std::collections::HashMap::new();
    for mould in &prev_moulds {
        prev_mould_map.insert(mould.id.clone(), mould.clone());
    }

    let mut new_ids = std::collections::HashSet::new();
    for mould in &moulds {
        new_ids.insert(mould.id.clone());
        let parent_moved = mould
            .parent_joint_id
            .as_ref()
            .map(|id| state.moved_joint_ids.contains(id))
            .unwrap_or(false);
        let changed = parent_moved || prev_mould_map
            .get(&mould.id)
            .map(|old| mould_data_changed(old, mould))
            .unwrap_or(true);

        if changed {
            if let Some(skel) = state.skeleton.as_ref() {
                let bounds = mould_world_bounds(mould, skel);
                union_bounds(&mut dirty_bounds, bounds);
            }
            if let Some(old) = prev_mould_map.get(&mould.id) {
                if let Some(skel) = prev_skeleton.as_ref() {
                    let bounds = mould_world_bounds(old, skel);
                    union_bounds(&mut dirty_bounds, bounds);
                }
            }
        }
    }

    for old in &prev_moulds {
        if !new_ids.contains(&old.id) {
            if let Some(skel) = prev_skeleton.as_ref() {
                let bounds = mould_world_bounds(old, skel);
                union_bounds(&mut dirty_bounds, bounds);
            }
        }
    }

    state.mould_manager = Some(mould_manager);
    state.last_moulds = moulds;
    state.dirty_bounds = dirty_bounds;
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

    // Cache the mesh for control point extraction
    {
        let mut state = MESH_STATE.lock().unwrap();
        state.last_mesh = Some(mesh.clone());
    }

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

    let mut mould_manager = state
        .mould_manager
        .take()
        .ok_or("No mould manager initialized")?;
    let mut brick_map = state.brick_map.take();
    let mut brick_map_resolution = state.brick_map_resolution.take();
    let dirty_bounds = state.dirty_bounds.take();

    // Rebuild transform cache before grid evaluation
    mould_manager.rebuild_cache();

    // Define bounds for the mesh
    let bounds = AABB {
        min: Pt3::new(-1.0, -1.0, -1.0),
        max: Pt3::new(1.0, 1.5, 1.0),
    };

    // Create or reuse brick map for incremental updates
    let surface_thickness = 0.2; // Allocate bricks within 0.2 units of surface
    let needs_rebuild = brick_map_resolution.map(|res| res != resolution).unwrap_or(true)
        || brick_map.is_none();

    if needs_rebuild {
        let mut new_brick_map = BrickMap::new(resolution, bounds);
        new_brick_map.allocate_surface_bricks(&mould_manager, surface_thickness);
        brick_map = Some(new_brick_map);
        brick_map_resolution = Some(resolution);
    } else if let Some(ref bounds) = dirty_bounds {
        if let Some(ref mut map) = brick_map {
            map.update_surface_bricks_in_bounds(&mould_manager, bounds, surface_thickness);
        }
    }

    // Extract mesh using dual contouring
    let mesh = {
        let map = brick_map.as_ref().ok_or("Brick map unavailable")?;
        dual_contouring_brick_map(map, &mould_manager, 0.0, fast_mode)
    };

    state.mould_manager = Some(mould_manager);
    state.brick_map = brick_map;
    state.brick_map_resolution = brick_map_resolution;
    state.last_mesh = Some(mesh.clone());

    Ok(mesh)
}

fn compute_moved_joints(prev: &Skeleton, next: &Skeleton) -> Vec<String> {
    let mut moved = Vec::new();
    for joint in next.get_joints() {
        let id = &joint.id;
        let prev_joint = match prev.get_joint(id) {
            Some(_) => prev,
            None => {
                moved.push(id.clone());
                continue;
            }
        };
        let prev_t = prev_joint.get_world_transform_immutable(id);
        let next_t = next.get_world_transform_immutable(id);

        let delta = next_t.translation.vector - prev_t.translation.vector;
        let rot_delta = prev_t.rotation.inverse() * next_t.rotation;
        let moved_translation = delta.magnitude() > 1e-4;
        let moved_rotation = rot_delta.angle() > 1e-4;

        if moved_translation || moved_rotation {
            moved.push(id.clone());
        }
    }
    moved
}

fn mould_data_changed(old: &MouldData, new: &MouldData) -> bool {
    if old.shape != new.shape || old.parent_joint_id != new.parent_joint_id {
        return true;
    }
    let radius_changed = (old.radius - new.radius).abs() > 1e-4;
    let blend_changed = (old.blend_radius - new.blend_radius).abs() > 1e-4;
    let center_changed = vec3_changed(&old.center, &new.center);
    let end_changed = match (&old.end_point, &new.end_point) {
        (None, None) => false,
        (Some(a), Some(b)) => vec3_changed(a, b),
        _ => true,
    };

    radius_changed || blend_changed || center_changed || end_changed
}

fn vec3_changed(a: &crate::mesh::types::Vec3Data, b: &crate::mesh::types::Vec3Data) -> bool {
    (a.x - b.x).abs() > 1e-4 || (a.y - b.y).abs() > 1e-4 || (a.z - b.z).abs() > 1e-4
}

fn mould_world_bounds(mould: &MouldData, skeleton: &Skeleton) -> AABB {
    let center_local: Pt3 = mould.center.clone().into();
    let radius = mould.radius + mould.blend_radius;
    let center = if let Some(ref joint_id) = mould.parent_joint_id {
        skeleton.transform_point_to_world(joint_id, &center_local)
    } else {
        center_local
    };

    let end = mould.end_point.as_ref().map(|ep| {
        let end_local: Pt3 = ep.clone().into();
        if let Some(ref joint_id) = mould.parent_joint_id {
            skeleton.transform_point_to_world(joint_id, &end_local)
        } else {
            end_local
        }
    });

    let (min_base, max_base) = if let Some(end_point) = end {
        let min = Pt3::new(
            center.x.min(end_point.x),
            center.y.min(end_point.y),
            center.z.min(end_point.z),
        );
        let max = Pt3::new(
            center.x.max(end_point.x),
            center.y.max(end_point.y),
            center.z.max(end_point.z),
        );
        (min, max)
    } else {
        (center, center)
    };

    AABB {
        min: Pt3::new(min_base.x - radius, min_base.y - radius, min_base.z - radius),
        max: Pt3::new(max_base.x + radius, max_base.y + radius, max_base.z + radius),
    }
}

fn union_bounds(target: &mut Option<AABB>, bounds: AABB) {
    match target {
        Some(existing) => {
            existing.min.x = existing.min.x.min(bounds.min.x);
            existing.min.y = existing.min.y.min(bounds.min.y);
            existing.min.z = existing.min.z.min(bounds.min.z);
            existing.max.x = existing.max.x.max(bounds.max.x);
            existing.max.y = existing.max.y.max(bounds.max.y);
            existing.max.z = existing.max.z.max(bounds.max.z);
        }
        None => {
            *target = Some(bounds);
        }
    }
}

/// Get all control points for profiled capsules in world space
/// Extracts vertices from the cached mesh and projects them onto ring slices
/// Returns array of { mouldId, segmentIndex, pointIndex, position: {x, y, z} }
pub fn get_profile_control_points() -> Result<Vec<serde_json::Value>, String> {
    let state = MESH_STATE.lock().unwrap();

    let mould_manager = state
        .mould_manager
        .as_ref()
        .ok_or("No mould manager initialized")?;

    // For now, always use analytical control points from radial profiles
    // Mesh vertex extraction is a future optimization
    let points = mould_manager.get_control_points_world();
    let json_points = points
        .into_iter()
        .map(|(mould_id, seg_idx, pt_idx, pos)| {
            serde_json::json!({
                "mouldId": mould_id,
                "segmentIndex": seg_idx,
                "pointIndex": pt_idx,
                "position": {
                    "x": pos.x,
                    "y": pos.y,
                    "z": pos.z,
                }
            })
        })
        .collect();

    Ok(json_points)
}

/// Extract mesh vertices and project them onto rings for profiled capsules
fn extract_mesh_ring_vertices(
    mesh: &MeshData,
    mould_manager: &MouldManager,
) -> Result<Vec<serde_json::Value>, String> {


    let mut ring_points = Vec::new();

    // For each profiled capsule mould
    for mould in mould_manager.get_moulds() {
        if mould.shape != crate::mesh::types::MouldShape::ProfiledCapsule {
            continue;
        }

        let radial_profiles = match &mould.radial_profiles {
            Some(p) => p,
            None => continue,
        };

        // Get bone endpoints (similar to get_control_points_world)
        // TODO: This duplicates code - should refactor to share coordinate frame calculation

        // For now, fall back to analytical points for this mould
        // Full implementation would project mesh vertices onto bone slices
        continue;
    }

    Ok(ring_points)
}