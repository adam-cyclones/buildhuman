use crate::mesh::types::{JointData, Pt3, Quat, Vec3};
use nalgebra::Isometry3;
use std::collections::HashMap;

pub type Transform = Isometry3<f32>;

#[derive(Debug, Clone)]
pub struct Joint {
    pub id: String,
    pub local_offset: Vec3,
    pub local_rotation: Quat,
    pub parent_id: Option<String>,
    pub children: Vec<String>,
}

impl From<JointData> for Joint {
    fn from(data: JointData) -> Self {
        Joint {
            id: data.id,
            local_offset: data.local_offset.into(),
            local_rotation: data.local_rotation.into(),
            parent_id: data.parent_id,
            children: data.children,
        }
    }
}

/// Skeleton: Hierarchical bone system with parent-relative transforms
/// Each joint defines a bone frame with translation and rotation
#[derive(Debug, Clone)]
pub struct Skeleton {
    joints: HashMap<String, Joint>,
    /// Cache world transforms to avoid recalculation
    world_transform_cache: HashMap<String, Transform>,
    cache_valid: bool,
}

impl Default for Skeleton {
    fn default() -> Self {
        Self::new()
    }
}

impl Skeleton {
    pub fn new() -> Self {
        Self {
            joints: HashMap::new(),
            world_transform_cache: HashMap::new(),
            cache_valid: false,
        }
    }

    /// Add a joint to the skeleton
    pub fn add_joint(&mut self, joint: Joint) {
        self.joints.insert(joint.id.clone(), joint);
        self.invalidate_cache();
    }

    /// Get a joint by ID
    pub fn get_joint(&self, id: &str) -> Option<&Joint> {
        self.joints.get(id)
    }

    /// Get a mutable reference to a joint by ID
    pub fn get_joint_mut(&mut self, id: &str) -> Option<&mut Joint> {
        self.joints.get_mut(id)
    }

    /// Get all joints
    pub fn get_joints(&self) -> Vec<&Joint> {
        self.joints.values().collect()
    }

    fn invalidate_cache(&mut self) {
        self.cache_valid = false;
        self.world_transform_cache.clear();
    }

    /// Get world transform for a joint (with caching)
    pub fn get_world_transform(&mut self, joint_id: &str) -> Transform {
        if self.cache_valid {
            if let Some(cached) = self.world_transform_cache.get(joint_id) {
                return *cached;
            }
        }

        let transform = self.compute_world_transform(joint_id);
        self.world_transform_cache
            .insert(joint_id.to_string(), transform);
        self.cache_valid = true;
        transform
    }

    /// Recursively compute world transform for a joint
    fn compute_world_transform(&self, joint_id: &str) -> Transform {
        let joint = self
            .joints
            .get(joint_id)
            .expect("Joint not found in skeleton");

        let local_transform = Transform::from_parts(
            joint.local_offset.into(),
            joint.local_rotation,
        );

        if let Some(parent_id) = &joint.parent_id {
            let parent_transform = self.compute_world_transform(parent_id);
            parent_transform * local_transform
        } else {
            local_transform
        }
    }

    /// Get world transform immutably (no caching, safe for parallel access)
    pub fn get_world_transform_immutable(&self, joint_id: &str) -> Transform {
        self.compute_world_transform(joint_id)
    }

    /// Set a joint's local rotation (invalidates cache)
    pub fn set_joint_local_rotation(&mut self, joint_id: &str, rotation: Quat) {
        if let Some(joint) = self.joints.get_mut(joint_id) {
            joint.local_rotation = rotation;
        }
        self.invalidate_cache();
    }

    /// Move a joint by an offset (adds to local offset, invalidates cache)
    pub fn move_joint(&mut self, joint_id: &str, offset: Vec3) {
        if let Some(joint) = self.joints.get_mut(joint_id) {
            joint.local_offset += offset;
        }
        self.invalidate_cache();
    }

    /// Transform a point from local joint space to world space
    pub fn transform_point_to_world(&self, joint_id: &str, local_point: &Pt3) -> Pt3 {
        let transform = self.get_world_transform_immutable(joint_id);
        transform * local_point
    }
}
