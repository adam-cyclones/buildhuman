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

/// Ensure default skeleton and moulds exist if not initialized.
/// Builds a full humanoid baseline for GPU rendering.
pub fn ensure_default_state() {
    let mut state = MESH_STATE.lock().unwrap();

    if state.mould_manager.is_some() {
        return; // Already initialized
    }

    // Create a full humanoid skeleton (mirrors VoxelMorphScene defaults)
    use crate::mesh::skeleton::Joint;
    use crate::mesh::mould::Mould;
    use crate::mesh::types::{Quat, MouldShape};
    use nalgebra::Vector3;

    let identity_quat = Quat::identity();

    let mut skeleton = Skeleton::new();

    // Root joint (pelvis)
    skeleton.add_joint(Joint {
        id: "pelvis".to_string(),
        local_offset: Vector3::new(0.0, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: None,
        children: vec![
            "spine-lower".to_string(),
            "hip-left".to_string(),
            "hip-right".to_string(),
        ],
    });

    // Spine chain
    skeleton.add_joint(Joint {
        id: "spine-lower".to_string(),
        local_offset: Vector3::new(0.0, 0.15, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("pelvis".to_string()),
        children: vec!["spine-upper".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "spine-upper".to_string(),
        local_offset: Vector3::new(0.0, 0.15, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("spine-lower".to_string()),
        children: vec!["chest".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "chest".to_string(),
        local_offset: Vector3::new(0.0, 0.15, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("spine-upper".to_string()),
        children: vec![
            "neck".to_string(),
            "shoulder-left".to_string(),
            "shoulder-right".to_string(),
        ],
    });

    // Neck and head
    skeleton.add_joint(Joint {
        id: "neck".to_string(),
        local_offset: Vector3::new(0.0, 0.15, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("chest".to_string()),
        children: vec!["head".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "head".to_string(),
        local_offset: Vector3::new(0.0, 0.1, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("neck".to_string()),
        children: vec![],
    });

    // Left arm chain
    skeleton.add_joint(Joint {
        id: "shoulder-left".to_string(),
        local_offset: Vector3::new(-0.15, 0.05, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("chest".to_string()),
        children: vec!["elbow-left".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "elbow-left".to_string(),
        local_offset: Vector3::new(-0.25, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("shoulder-left".to_string()),
        children: vec!["wrist-left".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "wrist-left".to_string(),
        local_offset: Vector3::new(-0.2, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("elbow-left".to_string()),
        children: vec!["hand-left".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "hand-left".to_string(),
        local_offset: Vector3::new(-0.08, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("wrist-left".to_string()),
        children: vec![],
    });

    // Right arm chain
    skeleton.add_joint(Joint {
        id: "shoulder-right".to_string(),
        local_offset: Vector3::new(0.15, 0.05, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("chest".to_string()),
        children: vec!["elbow-right".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "elbow-right".to_string(),
        local_offset: Vector3::new(0.25, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("shoulder-right".to_string()),
        children: vec!["wrist-right".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "wrist-right".to_string(),
        local_offset: Vector3::new(0.2, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("elbow-right".to_string()),
        children: vec!["hand-right".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "hand-right".to_string(),
        local_offset: Vector3::new(0.08, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("wrist-right".to_string()),
        children: vec![],
    });

    // Left leg chain
    skeleton.add_joint(Joint {
        id: "hip-left".to_string(),
        local_offset: Vector3::new(-0.1, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("pelvis".to_string()),
        children: vec!["knee-left".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "knee-left".to_string(),
        local_offset: Vector3::new(0.0, -0.4, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("hip-left".to_string()),
        children: vec!["ankle-left".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "ankle-left".to_string(),
        local_offset: Vector3::new(0.0, -0.35, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("knee-left".to_string()),
        children: vec!["foot-left".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "foot-left".to_string(),
        local_offset: Vector3::new(0.0, 0.0, 0.12),
        local_rotation: identity_quat,
        parent_id: Some("ankle-left".to_string()),
        children: vec![],
    });

    // Right leg chain
    skeleton.add_joint(Joint {
        id: "hip-right".to_string(),
        local_offset: Vector3::new(0.1, 0.0, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("pelvis".to_string()),
        children: vec!["knee-right".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "knee-right".to_string(),
        local_offset: Vector3::new(0.0, -0.4, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("hip-right".to_string()),
        children: vec!["ankle-right".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "ankle-right".to_string(),
        local_offset: Vector3::new(0.0, -0.35, 0.0),
        local_rotation: identity_quat,
        parent_id: Some("knee-right".to_string()),
        children: vec!["foot-right".to_string()],
    });
    skeleton.add_joint(Joint {
        id: "foot-right".to_string(),
        local_offset: Vector3::new(0.0, 0.0, 0.12),
        local_rotation: identity_quat,
        parent_id: Some("ankle-right".to_string()),
        children: vec![],
    });

    state.skeleton = Some(skeleton.clone());

    // Create mould manager with full humanoid moulds
    let mut mould_manager = MouldManager::new();
    mould_manager.set_skeleton(skeleton);

    let blend_radius = 0.2;

    // Head (profiled capsule)
    mould_manager.add_mould(Mould {
        id: "head".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, 0.1, 0.0)),
        radius: 0.5 * 0.15,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("head".to_string()),
        radial_profiles: Some(vec![
            vec![0.060, 0.065, 0.080, 0.065, 0.060, 0.055, 0.045, 0.055],
            vec![0.068, 0.072, 0.088, 0.072, 0.068, 0.062, 0.050, 0.062],
            vec![0.074, 0.078, 0.092, 0.078, 0.074, 0.068, 0.054, 0.068],
            vec![0.076, 0.080, 0.090, 0.080, 0.076, 0.070, 0.056, 0.070],
            vec![0.078, 0.082, 0.088, 0.082, 0.078, 0.072, 0.058, 0.072],
            vec![0.074, 0.078, 0.084, 0.078, 0.074, 0.068, 0.056, 0.068],
        ]),
        use_splines: true,
    });

    // Neck
    mould_manager.add_mould(Mould {
        id: "neck".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, 0.1, 0.0)),
        radius: 0.5 * 0.08,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("neck".to_string()),
        radial_profiles: Some(vec![
            vec![0.042, 0.044, 0.040, 0.044, 0.042, 0.046, 0.050, 0.046],
            vec![0.040, 0.041, 0.038, 0.041, 0.040, 0.043, 0.046, 0.043],
            vec![0.038, 0.039, 0.036, 0.039, 0.038, 0.040, 0.042, 0.040],
            vec![0.036, 0.037, 0.034, 0.037, 0.036, 0.038, 0.039, 0.038],
            vec![0.034, 0.035, 0.033, 0.035, 0.034, 0.036, 0.037, 0.036],
            vec![0.033, 0.034, 0.032, 0.034, 0.033, 0.035, 0.036, 0.035],
        ]),
        use_splines: true,
    });

    // Chest (profiled capsule - ribcage)
    mould_manager.add_mould(Mould {
        id: "chest".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, -0.02, 0.0),
        end_point: Some(Pt3::new(0.0, 0.18, 0.0)),
        radius: 0.5 * 0.18,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("chest".to_string()),
        radial_profiles: Some(vec![
            vec![0.090, 0.092, 0.095, 0.092, 0.090, 0.092, 0.096, 0.092],
            vec![0.100, 0.103, 0.108, 0.103, 0.100, 0.103, 0.110, 0.103],
            vec![0.110, 0.114, 0.120, 0.114, 0.110, 0.114, 0.122, 0.114],
            vec![0.106, 0.110, 0.116, 0.110, 0.106, 0.110, 0.118, 0.110],
            vec![0.098, 0.101, 0.106, 0.101, 0.098, 0.101, 0.108, 0.101],
        ]),
        use_splines: true,
    });

    // Upper spine (profiled capsule - taper into neck)
    mould_manager.add_mould(Mould {
        id: "spine-upper".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, 0.15, 0.0)),
        radius: 0.5 * 0.15,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("spine-upper".to_string()),
        radial_profiles: Some(vec![
            vec![0.090, 0.092, 0.095, 0.092, 0.090, 0.092, 0.096, 0.092],
            vec![0.088, 0.090, 0.093, 0.090, 0.088, 0.090, 0.094, 0.090],
            vec![0.084, 0.086, 0.089, 0.086, 0.084, 0.086, 0.090, 0.086],
            vec![0.080, 0.082, 0.085, 0.082, 0.080, 0.082, 0.086, 0.082],
            vec![0.076, 0.078, 0.081, 0.078, 0.076, 0.078, 0.082, 0.078],
        ]),
        use_splines: true,
    });

    // Lower spine (profiled capsule - waist taper)
    mould_manager.add_mould(Mould {
        id: "spine-lower".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, 0.15, 0.0)),
        radius: 0.5 * 0.16,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("spine-lower".to_string()),
        radial_profiles: Some(vec![
            vec![0.090, 0.092, 0.095, 0.092, 0.090, 0.092, 0.096, 0.092],
            vec![0.084, 0.086, 0.089, 0.086, 0.084, 0.086, 0.090, 0.086],
            vec![0.078, 0.080, 0.083, 0.080, 0.078, 0.080, 0.084, 0.080],
            vec![0.074, 0.076, 0.079, 0.076, 0.074, 0.076, 0.080, 0.076],
            vec![0.072, 0.074, 0.077, 0.074, 0.072, 0.074, 0.078, 0.074],
        ]),
        use_splines: true,
    });

    // Pelvis (profiled capsule)
    mould_manager.add_mould(Mould {
        id: "pelvis".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, -0.04, 0.0),
        end_point: Some(Pt3::new(0.0, 0.16, 0.0)),
        radius: 0.5 * 0.17,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("pelvis".to_string()),
        radial_profiles: Some(vec![
            vec![0.095, 0.095, 0.095, 0.095, 0.095, 0.095, 0.095, 0.095],
            vec![0.105, 0.105, 0.105, 0.105, 0.105, 0.105, 0.105, 0.105],
            vec![0.112, 0.112, 0.112, 0.112, 0.112, 0.112, 0.112, 0.112],
            vec![0.108, 0.108, 0.108, 0.108, 0.108, 0.108, 0.108, 0.108],
            vec![0.102, 0.102, 0.102, 0.102, 0.102, 0.102, 0.102, 0.102],
        ]),
        use_splines: true,
    });

    // Left arm
    mould_manager.add_mould(Mould {
        id: "upper-arm-left".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(-0.25, 0.0, 0.0)),
        radius: 0.5 * 0.07,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("shoulder-left".to_string()),
        radial_profiles: Some(vec![
            vec![0.050, 0.052, 0.055, 0.052, 0.050, 0.052, 0.056, 0.052],
            vec![0.046, 0.048, 0.051, 0.048, 0.046, 0.048, 0.052, 0.048],
            vec![0.042, 0.044, 0.047, 0.044, 0.042, 0.044, 0.048, 0.044],
            vec![0.038, 0.040, 0.043, 0.040, 0.038, 0.040, 0.044, 0.040],
            vec![0.034, 0.035, 0.037, 0.035, 0.034, 0.035, 0.038, 0.035],
            vec![0.031, 0.032, 0.033, 0.032, 0.031, 0.032, 0.034, 0.032],
        ]),
        use_splines: true,
    });

    mould_manager.add_mould(Mould {
        id: "forearm-left".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(-0.2, 0.0, 0.0)),
        radius: 0.5 * 0.06,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("elbow-left".to_string()),
        radial_profiles: Some(vec![
            vec![0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
            vec![0.032, 0.033, 0.034, 0.033, 0.031, 0.032, 0.033, 0.033],
            vec![0.033, 0.034, 0.035, 0.034, 0.032, 0.033, 0.034, 0.034],
            vec![0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
            vec![0.026, 0.027, 0.028, 0.027, 0.025, 0.026, 0.027, 0.027],
            vec![0.022, 0.023, 0.024, 0.023, 0.021, 0.022, 0.023, 0.023],
        ]),
        use_splines: true,
    });

    mould_manager.add_mould(Mould {
        id: "hand-left".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(-0.10, 0.0, 0.0)),
        radius: 0.5 * 0.07,
        blend_radius: 0.08,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("hand-left".to_string()),
        radial_profiles: Some(vec![
            vec![0.044, 0.044, 0.044, 0.044, 0.044, 0.044, 0.044, 0.044],
            vec![0.050, 0.050, 0.050, 0.050, 0.050, 0.050, 0.050, 0.050],
            vec![0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048],
        ]),
        use_splines: true,
    });

    // Right arm
    mould_manager.add_mould(Mould {
        id: "upper-arm-right".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.25, 0.0, 0.0)),
        radius: 0.5 * 0.07,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("shoulder-right".to_string()),
        radial_profiles: Some(vec![
            vec![0.050, 0.052, 0.055, 0.052, 0.050, 0.052, 0.056, 0.052],
            vec![0.046, 0.048, 0.051, 0.048, 0.046, 0.048, 0.052, 0.048],
            vec![0.042, 0.044, 0.047, 0.044, 0.042, 0.044, 0.048, 0.044],
            vec![0.038, 0.040, 0.043, 0.040, 0.038, 0.040, 0.044, 0.040],
            vec![0.034, 0.035, 0.037, 0.035, 0.034, 0.035, 0.038, 0.035],
            vec![0.031, 0.032, 0.033, 0.032, 0.031, 0.032, 0.034, 0.032],
        ]),
        use_splines: true,
    });

    mould_manager.add_mould(Mould {
        id: "forearm-right".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.2, 0.0, 0.0)),
        radius: 0.5 * 0.06,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("elbow-right".to_string()),
        radial_profiles: Some(vec![
            vec![0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
            vec![0.032, 0.033, 0.034, 0.033, 0.031, 0.032, 0.033, 0.033],
            vec![0.033, 0.034, 0.035, 0.034, 0.032, 0.033, 0.034, 0.034],
            vec![0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
            vec![0.026, 0.027, 0.028, 0.027, 0.025, 0.026, 0.027, 0.027],
            vec![0.022, 0.023, 0.024, 0.023, 0.021, 0.022, 0.023, 0.023],
        ]),
        use_splines: true,
    });

    mould_manager.add_mould(Mould {
        id: "hand-right".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.10, 0.0, 0.0)),
        radius: 0.5 * 0.07,
        blend_radius: 0.08,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("hand-right".to_string()),
        radial_profiles: Some(vec![
            vec![0.044, 0.044, 0.044, 0.044, 0.044, 0.044, 0.044, 0.044],
            vec![0.050, 0.050, 0.050, 0.050, 0.050, 0.050, 0.050, 0.050],
            vec![0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048],
        ]),
        use_splines: true,
    });

    // Left leg
    mould_manager.add_mould(Mould {
        id: "thigh-left".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, -0.4, 0.0)),
        radius: 0.5 * 0.1,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("hip-left".to_string()),
        radial_profiles: Some(vec![
            vec![0.068, 0.070, 0.072, 0.070, 0.066, 0.068, 0.072, 0.070],
            vec![0.064, 0.066, 0.068, 0.066, 0.062, 0.064, 0.068, 0.066],
            vec![0.058, 0.060, 0.062, 0.060, 0.056, 0.058, 0.062, 0.060],
            vec![0.052, 0.054, 0.056, 0.054, 0.050, 0.052, 0.056, 0.054],
            vec![0.046, 0.048, 0.050, 0.048, 0.044, 0.046, 0.050, 0.048],
            vec![0.042, 0.043, 0.045, 0.043, 0.041, 0.042, 0.045, 0.043],
        ]),
        use_splines: true,
    });

    mould_manager.add_mould(Mould {
        id: "shin-left".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, -0.35, 0.0)),
        radius: 0.5 * 0.08,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("knee-left".to_string()),
        radial_profiles: Some(vec![
            vec![0.040, 0.041, 0.043, 0.041, 0.038, 0.040, 0.043, 0.041],
            vec![0.044, 0.046, 0.048, 0.046, 0.042, 0.044, 0.048, 0.046],
            vec![0.050, 0.052, 0.054, 0.052, 0.048, 0.050, 0.054, 0.052],
            vec![0.046, 0.048, 0.050, 0.048, 0.044, 0.046, 0.050, 0.048],
            vec![0.040, 0.041, 0.043, 0.041, 0.038, 0.040, 0.043, 0.041],
            vec![0.035, 0.036, 0.037, 0.036, 0.033, 0.034, 0.037, 0.036],
        ]),
        use_splines: true,
    });

    mould_manager.add_mould(Mould {
        id: "foot-left".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, 0.0, 0.12)),
        radius: 0.5 * 0.06,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("ankle-left".to_string()),
        radial_profiles: Some(vec![
            vec![0.032, 0.033, 0.036, 0.033, 0.032, 0.020, 0.015, 0.020],
            vec![0.036, 0.037, 0.038, 0.037, 0.036, 0.010, 0.005, 0.010],
            vec![0.038, 0.039, 0.039, 0.039, 0.038, 0.012, 0.008, 0.012],
            vec![0.036, 0.037, 0.037, 0.037, 0.036, 0.018, 0.015, 0.018],
            vec![0.030, 0.031, 0.032, 0.031, 0.030, 0.016, 0.014, 0.016],
            vec![0.022, 0.023, 0.024, 0.023, 0.022, 0.018, 0.017, 0.018],
        ]),
        use_splines: true,
    });

    // Right leg
    mould_manager.add_mould(Mould {
        id: "thigh-right".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, -0.4, 0.0)),
        radius: 0.5 * 0.1,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("hip-right".to_string()),
        radial_profiles: Some(vec![
            vec![0.068, 0.070, 0.072, 0.070, 0.066, 0.068, 0.072, 0.070],
            vec![0.064, 0.066, 0.068, 0.066, 0.062, 0.064, 0.068, 0.066],
            vec![0.058, 0.060, 0.062, 0.060, 0.056, 0.058, 0.062, 0.060],
            vec![0.052, 0.054, 0.056, 0.054, 0.050, 0.052, 0.056, 0.054],
            vec![0.046, 0.048, 0.050, 0.048, 0.044, 0.046, 0.050, 0.048],
            vec![0.042, 0.043, 0.045, 0.043, 0.041, 0.042, 0.045, 0.043],
        ]),
        use_splines: true,
    });

    mould_manager.add_mould(Mould {
        id: "shin-right".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, -0.35, 0.0)),
        radius: 0.5 * 0.08,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("knee-right".to_string()),
        radial_profiles: Some(vec![
            vec![0.040, 0.041, 0.043, 0.041, 0.038, 0.040, 0.043, 0.041],
            vec![0.044, 0.046, 0.048, 0.046, 0.042, 0.044, 0.048, 0.046],
            vec![0.050, 0.052, 0.054, 0.052, 0.048, 0.050, 0.054, 0.052],
            vec![0.046, 0.048, 0.050, 0.048, 0.044, 0.046, 0.050, 0.048],
            vec![0.040, 0.041, 0.043, 0.041, 0.038, 0.040, 0.043, 0.041],
            vec![0.035, 0.036, 0.037, 0.036, 0.033, 0.034, 0.037, 0.036],
        ]),
        use_splines: true,
    });

    mould_manager.add_mould(Mould {
        id: "foot-right".to_string(),
        shape: MouldShape::ProfiledCapsule,
        center: Pt3::new(0.0, 0.0, 0.0),
        end_point: Some(Pt3::new(0.0, 0.0, 0.12)),
        radius: 0.5 * 0.06,
        blend_radius: 0.06,
        blend_group: 0,
        separation_bias: 0.0,
        parent_joint_id: Some("ankle-right".to_string()),
        radial_profiles: Some(vec![
            vec![0.032, 0.033, 0.036, 0.033, 0.032, 0.020, 0.015, 0.020],
            vec![0.036, 0.037, 0.038, 0.037, 0.036, 0.010, 0.005, 0.010],
            vec![0.038, 0.039, 0.039, 0.039, 0.038, 0.012, 0.008, 0.012],
            vec![0.036, 0.037, 0.037, 0.037, 0.036, 0.018, 0.015, 0.018],
            vec![0.030, 0.031, 0.032, 0.031, 0.030, 0.016, 0.014, 0.016],
            vec![0.022, 0.023, 0.024, 0.023, 0.022, 0.018, 0.017, 0.018],
        ]),
        use_splines: true,
    });

    state.mould_manager = Some(mould_manager);
}

/// Update the skeleton from TypeScript
pub fn update_skeleton(joints: Vec<JointData>) {
    let mut state = MESH_STATE.lock().unwrap();

    let prev_skeleton = state.last_skeleton.clone();
    let mut skeleton = Skeleton::new();
    for joint_data in joints {
        skeleton.add_joint(joint_data.into());
    }

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

/// Get a cloned MouldManager with cache rebuilt for GPU compute
/// This allows GPU compute to use the same skeleton/mould state as the CPU renderer
pub fn get_mould_manager_for_gpu() -> Result<MouldManager, String> {
    let mut state = MESH_STATE.lock().unwrap();

    let mould_manager = state
        .mould_manager
        .as_mut()
        .ok_or("No mould manager initialized")?;

    // Rebuild cache to compute world-space positions
    mould_manager.rebuild_cache();

    // Clone the mould manager so GPU compute has its own copy
    Ok(mould_manager.clone())
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
    // Must exceed max blend_radius (0.2) to capture blending regions between moulds
    let surface_thickness = 0.4;
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
    let group_changed = old.blend_group != new.blend_group;
    let sep_changed = (old.separation_bias.unwrap_or(0.0) - new.separation_bias.unwrap_or(0.0)).abs() > 1e-4;
    let center_changed = vec3_changed(&old.center, &new.center);
    let end_changed = match (&old.end_point, &new.end_point) {
        (None, None) => false,
        (Some(a), Some(b)) => vec3_changed(a, b),
        _ => true,
    };

    radius_changed || blend_changed || group_changed || sep_changed || center_changed || end_changed
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

/// Generate skeleton debug visualization geometry for GPU rendering
/// Returns interleaved vertex data [pos.x, pos.y, pos.z, norm.x, norm.y, norm.z, ...] and indices
/// Joint color is encoded in the normals (yellow = 1,1,0 for joints, cyan = 0,1,1 for bones)
pub fn generate_skeleton_debug_geometry() -> Result<(Vec<f32>, Vec<u32>), String> {
    let state = MESH_STATE.lock().unwrap();

    let skeleton = state.skeleton.as_ref().ok_or("No skeleton initialized")?;

    let mut vertices: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();

    let joint_radius = 0.03_f32;
    let bone_radius = 0.008_f32;

    // Joint color (yellow) - encoded as "normal" for unlit rendering
    let joint_color = [1.0_f32, 1.0, 0.0];
    // Bone color (cyan)
    let bone_color = [0.0_f32, 1.0, 1.0];

    // Generate geometry for each joint
    for joint in skeleton.get_joints() {
        let world_transform = skeleton.get_world_transform_immutable(&joint.id);
        let pos = world_transform.translation.vector;

        // Generate octahedron for joint (6 vertices, 8 triangles)
        let base_idx = (vertices.len() / 6) as u32;

        // Octahedron vertices: +X, -X, +Y, -Y, +Z, -Z
        let offsets = [
            [joint_radius, 0.0, 0.0],
            [-joint_radius, 0.0, 0.0],
            [0.0, joint_radius, 0.0],
            [0.0, -joint_radius, 0.0],
            [0.0, 0.0, joint_radius],
            [0.0, 0.0, -joint_radius],
        ];

        for offset in &offsets {
            vertices.extend_from_slice(&[
                pos.x + offset[0],
                pos.y + offset[1],
                pos.z + offset[2],
                joint_color[0],
                joint_color[1],
                joint_color[2],
            ]);
        }

        // Octahedron faces (8 triangles)
        // Top half (+Y)
        indices.extend_from_slice(&[base_idx + 2, base_idx + 4, base_idx + 0]); // +Y, +Z, +X
        indices.extend_from_slice(&[base_idx + 2, base_idx + 0, base_idx + 5]); // +Y, +X, -Z
        indices.extend_from_slice(&[base_idx + 2, base_idx + 5, base_idx + 1]); // +Y, -Z, -X
        indices.extend_from_slice(&[base_idx + 2, base_idx + 1, base_idx + 4]); // +Y, -X, +Z
        // Bottom half (-Y)
        indices.extend_from_slice(&[base_idx + 3, base_idx + 0, base_idx + 4]); // -Y, +X, +Z
        indices.extend_from_slice(&[base_idx + 3, base_idx + 5, base_idx + 0]); // -Y, -Z, +X
        indices.extend_from_slice(&[base_idx + 3, base_idx + 1, base_idx + 5]); // -Y, -X, -Z
        indices.extend_from_slice(&[base_idx + 3, base_idx + 4, base_idx + 1]); // -Y, +Z, -X

        // Generate bone to parent (cylinder approximation with 6 sides)
        if let Some(parent_id) = &joint.parent_id {
            let parent_transform = skeleton.get_world_transform_immutable(parent_id);
            let parent_pos = parent_transform.translation.vector;

            // Direction from parent to child
            let dir = pos - parent_pos;
            let length = dir.magnitude();
            if length > 0.001 {
                let dir_norm = dir / length;

                // Create orthonormal basis
                let up = if dir_norm.y.abs() < 0.9 {
                    nalgebra::Vector3::new(0.0, 1.0, 0.0)
                } else {
                    nalgebra::Vector3::new(1.0, 0.0, 0.0)
                };
                let right = dir_norm.cross(&up).normalize();
                let actual_up = right.cross(&dir_norm);

                let base_idx = (vertices.len() / 6) as u32;

                // 6-sided cylinder (12 vertices for 2 rings)
                let segments = 6;
                for ring in 0..2 {
                    let ring_center = if ring == 0 { parent_pos } else { pos };
                    for i in 0..segments {
                        let angle = (i as f32) * std::f32::consts::TAU / (segments as f32);
                        let cos_a = angle.cos();
                        let sin_a = angle.sin();
                        let offset = right * cos_a * bone_radius + actual_up * sin_a * bone_radius;

                        vertices.extend_from_slice(&[
                            ring_center.x + offset.x,
                            ring_center.y + offset.y,
                            ring_center.z + offset.z,
                            bone_color[0],
                            bone_color[1],
                            bone_color[2],
                        ]);
                    }
                }

                // Cylinder triangles (connecting the two rings)
                for i in 0..segments {
                    let next = (i + 1) % segments;
                    let i0 = base_idx + i as u32;
                    let i1 = base_idx + next as u32;
                    let i2 = base_idx + (segments + i) as u32;
                    let i3 = base_idx + (segments + next) as u32;

                    indices.extend_from_slice(&[i0, i2, i1]);
                    indices.extend_from_slice(&[i1, i2, i3]);
                }
            }
        }
    }

    Ok((vertices, indices))
}
