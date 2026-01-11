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
    /// Cached world-space positions for fast SDF evaluation
    mould_cache: HashMap<String, CachedMouldTransform>,
    cache_valid: bool,
}

#[derive(Debug, Clone)]
struct CachedMouldTransform {
    world_center: Pt3,
    world_end: Option<Pt3>,
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
            mould_cache: HashMap::new(),
            cache_valid: false,
        }
    }

    pub fn add_mould(&mut self, mould: Mould) {
        self.moulds.insert(mould.id.clone(), mould);
        self.cache_valid = false;
    }

    pub fn set_skeleton(&mut self, skeleton: Skeleton) {
        self.skeleton = Some(skeleton);
        self.cache_valid = false;
    }

    /// Rebuild the transform cache - call this before evaluating grid
    pub fn rebuild_cache(&mut self) {
        if self.cache_valid {
            return;
        }

        self.mould_cache.clear();

        let skeleton = match self.skeleton.as_ref() {
            Some(s) => s,
            None => return,
        };

        for (id, mould) in &self.moulds {
            let (world_center, world_end) = if let Some(ref joint_id) = mould.parent_joint_id {
                let center = skeleton.transform_point_to_world(joint_id, &mould.center);
                let end = mould
                    .end_point
                    .map(|ep| skeleton.transform_point_to_world(joint_id, &ep));
                (center, end)
            } else {
                (mould.center, mould.end_point)
            };

            self.mould_cache.insert(
                id.clone(),
                CachedMouldTransform {
                    world_center,
                    world_end,
                },
            );
        }

        self.cache_valid = true;
    }

    pub fn get_moulds(&self) -> Vec<&Mould> {
        self.moulds.values().collect()
    }

    /// Evaluate the SDF at a given world-space point using cached transforms
    /// This must be immutable (&self) for parallel iteration with rayon
    pub fn evaluate_sdf(&self, point: &Pt3) -> f32 {
        if self.moulds.is_empty() {
            return 1.0; // Outside
        }

        // Blend all moulds with smooth min using CACHED transforms
        let mut result = f32::INFINITY;

        for (id, mould) in &self.moulds {
            // Use cached world-space positions - HUGE performance win!
            let cached = self.mould_cache.get(id).expect("Cache not built");

            let sdf_value = match mould.shape {
                MouldShape::Sphere => {
                    sphere_sdf(point, &cached.world_center, mould.radius)
                }
                MouldShape::Capsule => {
                    if let Some(world_end) = cached.world_end {
                        capsule_sdf(point, &cached.world_center, &world_end, mould.radius)
                    } else {
                        // Degenerate capsule, treat as sphere
                        sphere_sdf(point, &cached.world_center, mould.radius)
                    }
                }
            };

            result = smooth_min_poly(result, sdf_value, mould.blend_radius);
        }

        result
    }
}
