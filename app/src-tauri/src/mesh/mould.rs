use crate::mesh::sdf::{capsule_sdf, smooth_min_poly, sphere_sdf};
use crate::mesh::skeleton::Skeleton;
use crate::mesh::types::{MouldData, MouldShape, Pt3};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Mould {
    pub id: String,
    pub shape: MouldShape,
    pub center: Pt3, // Local offset from parent bone
    pub radius: f32,
    pub blend_radius: f32,
    pub parent_joint_id: Option<String>,
    // Capsule-specific
    pub end_point: Option<Pt3>,
}

impl From<MouldData> for Mould {
    fn from(data: MouldData) -> Self {
        Mould {
            id: data.id,
            shape: data.shape,
            center: data.center.into(),
            radius: data.radius,
            blend_radius: data.blend_radius,
            parent_joint_id: data.parent_joint_id,
            end_point: data.end_point.map(|p| p.into()),
        }
    }
}

/// Manages a collection of moulds (primitives) that define the character shape
#[derive(Debug, Clone)]
pub struct MouldManager {
    moulds: HashMap<String, Mould>,
    skeleton: Option<Skeleton>,
}

impl Default for MouldManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MouldManager {
    pub fn new() -> Self {
        Self {
            moulds: HashMap::new(),
            skeleton: None,
        }
    }

    pub fn add_mould(&mut self, mould: Mould) {
        self.moulds.insert(mould.id.clone(), mould);
    }

    pub fn set_skeleton(&mut self, skeleton: Skeleton) {
        self.skeleton = Some(skeleton);
    }

    pub fn get_moulds(&self) -> Vec<&Mould> {
        self.moulds.values().collect()
    }

    /// Evaluate the SDF at a given world-space point
    /// This must be immutable (&self) for parallel iteration with rayon
    pub fn evaluate_sdf(&self, point: &Pt3) -> f32 {
        if self.moulds.is_empty() {
            return 1.0; // Outside
        }

        let skeleton = self
            .skeleton
            .as_ref()
            .expect("Skeleton not set on MouldManager");

        // Blend all moulds with smooth min
        let mut result = f32::INFINITY;

        for mould in self.moulds.values() {
            let sdf_value = match mould.shape {
                MouldShape::Sphere => {
                    let world_center = if let Some(ref joint_id) = mould.parent_joint_id {
                        skeleton.transform_point_to_world(joint_id, &mould.center)
                    } else {
                        mould.center
                    };
                    sphere_sdf(point, &world_center, mould.radius)
                }
                MouldShape::Capsule => {
                    if let Some(end_point) = mould.end_point {
                        let (world_start, world_end) =
                            if let Some(ref joint_id) = mould.parent_joint_id {
                                let start =
                                    skeleton.transform_point_to_world(joint_id, &mould.center);
                                let end = skeleton.transform_point_to_world(joint_id, &end_point);
                                (start, end)
                            } else {
                                (mould.center, end_point)
                            };
                        capsule_sdf(point, &world_start, &world_end, mould.radius)
                    } else {
                        // Degenerate capsule, treat as sphere
                        let world_center = if let Some(ref joint_id) = mould.parent_joint_id {
                            skeleton.transform_point_to_world(joint_id, &mould.center)
                        } else {
                            mould.center
                        };
                        sphere_sdf(point, &world_center, mould.radius)
                    }
                }
            };

            result = smooth_min_poly(result, sdf_value, mould.blend_radius);
        }

        result
    }
}
