use crate::mesh::sdf::{capsule_sdf, profiled_capsule_sdf, smooth_min_poly, sphere_sdf};
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
    pub blend_group: u32,
    pub separation_bias: f32,
    pub parent_joint_id: Option<String>,
    // Capsule-specific
    pub end_point: Option<Pt3>,
    // Profiled capsule-specific
    // 2D array: [segment_along_bone][control_point_around_ring]
    pub radial_profiles: Option<Vec<Vec<f32>>>,
    // Interpolation mode for profiled capsules
    pub use_splines: bool,
}

impl From<MouldData> for Mould {
    fn from(data: MouldData) -> Self {
        Mould {
            id: data.id,
            shape: data.shape,
            center: data.center.into(),
            radius: data.radius,
            blend_radius: data.blend_radius,
            blend_group: data.blend_group.unwrap_or(0),
            separation_bias: data.separation_bias.unwrap_or(0.0),
            parent_joint_id: data.parent_joint_id,
            end_point: data.end_point.map(|p| p.into()),
            radial_profiles: data.radial_profiles,
            // Default to spline interpolation for hand-crafted profiles
            use_splines: data.use_splines.unwrap_or(true),
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

    /// Get 3D world-space positions of all control points for profiled capsules
    /// Returns Vec of (mould_id, segment_index, control_point_index, world_position)
    pub fn get_control_points_world(&self) -> Vec<(String, usize, usize, Pt3)> {
        use crate::mesh::types::Vec3;
        use std::f32::consts::PI;

        let mut points = Vec::new();

        for (id, mould) in &self.moulds {
            // Only process profiled capsules
            if mould.shape != MouldShape::ProfiledCapsule {
                continue;
            }

            let radial_profiles = match &mould.radial_profiles {
                Some(p) => p,
                None => continue,
            };

            if radial_profiles.is_empty() {
                continue;
            }

            // Get world-space endpoints
            let cached = match self.mould_cache.get(id) {
                Some(c) => c,
                None => continue,
            };

            let world_end = match cached.world_end {
                Some(e) => e,
                None => continue,
            };

            let a = cached.world_center;
            let b = world_end;

            // Compute coordinate frame (same as in profiled_capsule_sdf)
            let bone_dir = Vec3::new(b.x - a.x, b.y - a.y, b.z - a.z).normalize();

            let world_up = Vec3::new(0.0, 1.0, 0.0);
            let world_forward = Vec3::new(0.0, 0.0, 1.0);

            let ref_vec = if bone_dir.y.abs() > 0.9 {
                world_forward
            } else {
                world_up
            };

            let right = bone_dir.cross(&ref_vec).normalize();
            let forward = right.cross(&bone_dir).normalize();

            // For each segment
            let num_segments = radial_profiles.len();
            for (seg_idx, ring_profile) in radial_profiles.iter().enumerate() {
                let t = if num_segments == 1 {
                    0.5
                } else {
                    seg_idx as f32 / (num_segments - 1) as f32
                };

                // Center point of this ring in world space
                let center = Pt3::new(
                    a.x + (b.x - a.x) * t,
                    a.y + (b.y - a.y) * t,
                    a.z + (b.z - a.z) * t,
                );

                // Sample the ring densely to show the splined surface
                // Use high resolution (64 samples) if splines are enabled, otherwise just control points
                let samples_per_ring = if mould.use_splines { 64 } else { ring_profile.len() };

                for sample_idx in 0..samples_per_ring {
                    // Compute angle for this sample
                    let angle = (sample_idx as f32 / samples_per_ring as f32) * 2.0 * PI;

                    // Sample radius at this angle using the same method as SDF
                    let radius = crate::mesh::sdf::sample_ring_at_angle(
                        ring_profile,
                        angle,
                        mould.use_splines,
                    );

                    // Position on ring: center + radius * (cos(angle)*right + sin(angle)*forward)
                    let world_pos = Pt3::new(
                        center.x + radius * (angle.cos() * right.x + angle.sin() * forward.x),
                        center.y + radius * (angle.cos() * right.y + angle.sin() * forward.y),
                        center.z + radius * (angle.cos() * right.z + angle.sin() * forward.z),
                    );

                    points.push((id.clone(), seg_idx, sample_idx, world_pos));
                }
            }
        }

        points
    }

    /// Evaluate the SDF at a given world-space point using cached transforms
    /// This must be immutable (&self) for parallel iteration with rayon
    pub fn evaluate_sdf(&self, point: &Pt3) -> f32 {
        if self.moulds.is_empty() {
            return 1.0; // Outside
        }

        // Blend all moulds with smooth min using CACHED transforms
        let mut result = f32::INFINITY;
        let mut best_group: u32 = 0;
        let mut best_sep: f32 = 0.0;
        let mut initialized = false;

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
                MouldShape::ProfiledCapsule => {
                    if let Some(world_end) = cached.world_end {
                        let radial_profiles = mould.radial_profiles.as_ref()
                            .expect("ProfiledCapsule must have radial_profiles");

                        profiled_capsule_sdf(
                            point,
                            &cached.world_center,
                            &world_end,
                            radial_profiles,
                            mould.use_splines,
                        )
                    } else {
                        // Degenerate profiled capsule, treat as sphere with first segment's average radius
                        let radius = mould.radial_profiles.as_ref()
                            .and_then(|profiles| profiles.first())
                            .and_then(|ring| {
                                let sum: f32 = ring.iter().sum();
                                Some(sum / ring.len() as f32)
                            })
                            .unwrap_or(mould.radius);
                        sphere_sdf(point, &cached.world_center, radius)
                    }
                }
            };

            if !initialized {
                result = sdf_value;
                best_group = mould.blend_group;
                best_sep = mould.separation_bias;
                initialized = true;
                continue;
            }

            let compatible = best_group == 0
                || mould.blend_group == 0
                || best_group == mould.blend_group;

            if compatible {
                result = smooth_min_poly(result, sdf_value, mould.blend_radius);
                if best_group == 0 || mould.blend_group == 0 {
                    best_group = 0;
                    best_sep = best_sep.max(mould.separation_bias);
                }
            } else {
                let min_before = result.min(sdf_value);
                let separation = best_sep.max(mould.separation_bias);
                result = crate::mesh::sdf::union_with_separation(result, sdf_value, separation);
                if sdf_value <= min_before {
                    best_group = mould.blend_group;
                    best_sep = mould.separation_bias;
                }
            }
        }

        result
    }

    /// Get moulds with world-space coordinates for GPU compute
    /// Returns mould data with center/end_point transformed to world space
    pub fn get_moulds_world_space(&self) -> Vec<WorldSpaceMould> {
        if !self.cache_valid {
            panic!("Cache must be rebuilt before calling get_moulds_world_space");
        }

        let mut result = Vec::new();
        let mut joint_best: HashMap<String, (String, Pt3, f32, f32)> = HashMap::new();

        let max_profile_radius = |mould: &Mould| -> f32 {
            if mould.shape == MouldShape::ProfiledCapsule {
                if let Some(ref profiles) = mould.radial_profiles {
                    let mut max_r = mould.radius;
                    for ring in profiles {
                        for &r in ring {
                            if r > max_r {
                                max_r = r;
                            }
                        }
                    }
                    return max_r;
                }
            }
            mould.radius
        };

        for (id, mould) in &self.moulds {
            let cached = self.mould_cache.get(id).expect("Mould not in cache");

            result.push(WorldSpaceMould {
                id: id.clone(),
                shape: mould.shape.clone(),
                world_center: cached.world_center,
                world_end: cached.world_end,
                radius: mould.radius,
                blend_radius: mould.blend_radius,
                blend_group: mould.blend_group,
                separation_bias: mould.separation_bias,
                radial_profiles: mould.radial_profiles.clone(),
                use_splines: mould.use_splines,
            });

            if let Some(ref joint_id) = mould.parent_joint_id {
                let effective_radius = max_profile_radius(mould);
                let entry = joint_best.entry(joint_id.clone());
                match entry {
                    std::collections::hash_map::Entry::Vacant(v) => {
                        v.insert((
                            id.clone(),
                            cached.world_center,
                            effective_radius,
                            mould.blend_radius,
                        ));
                    }
                    std::collections::hash_map::Entry::Occupied(mut o) => {
                        if effective_radius > o.get().2 {
                            o.insert((
                                id.clone(),
                                cached.world_center,
                                effective_radius,
                                mould.blend_radius,
                            ));
                        }
                    }
                }
            }
        }

        if let Some(ref skeleton) = self.skeleton {
            for joint in skeleton.get_joints() {
                if let Some(ref parent_id) = joint.parent_id {
                    let parent = joint_best.get(parent_id);
                    let child = joint_best.get(&joint.id);
                    if let (Some(parent), Some(child)) = (parent, child) {
                        let (parent_mould_id, parent_pos, parent_radius, parent_blend) = parent;
                        let (child_mould_id, child_pos, child_radius, child_blend) = child;

                        let base_radius = parent_radius.max(*child_radius);
                        let distance = (*child_pos - *parent_pos).magnitude();
                        let overlap_threshold = (parent_radius + child_radius) * 0.85;
                        let cap_radius = distance * 0.5;
                        let bridge_radius = base_radius.min(cap_radius) * 0.7;
                        let bridge_blend = parent_blend.max(*child_blend) * 0.5;

                        if distance > overlap_threshold && bridge_radius > 0.0001 {
                            result.push(WorldSpaceMould {
                                id: format!("bridge:{}->{}", parent_mould_id, child_mould_id),
                                shape: MouldShape::Capsule,
                                world_center: *parent_pos,
                                world_end: Some(*child_pos),
                                radius: bridge_radius,
                                blend_radius: bridge_blend,
                                blend_group: 0,
                                separation_bias: 0.0,
                                radial_profiles: None,
                                use_splines: false,
                            });
                        }
                    }
                }
            }
        }

        result
    }
}

/// Mould data with world-space coordinates (for GPU compute)
#[derive(Debug, Clone)]
pub struct WorldSpaceMould {
    pub id: String,
    pub shape: MouldShape,
    pub world_center: Pt3,
    pub world_end: Option<Pt3>,
    pub radius: f32,
    pub blend_radius: f32,
    pub blend_group: u32,
    pub separation_bias: f32,
    pub radial_profiles: Option<Vec<Vec<f32>>>,
    pub use_splines: bool,
}
