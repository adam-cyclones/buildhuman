use crate::mesh::spline::{catmull_rom_array, catmull_rom_closed};
use crate::mesh::types::{Pt3, Vec3};

const EPSILON: f32 = 0.001;

/// Signed distance function for a sphere
pub fn sphere_sdf(point: &Pt3, center: &Pt3, radius: f32) -> f32 {
    (point - center).magnitude() - radius
}

/// Signed distance function for a capsule (line segment with radius)
pub fn capsule_sdf(point: &Pt3, a: &Pt3, b: &Pt3, radius: f32) -> f32 {
    let ba = b - a;
    let pa = point - a;
    let ba_dot = ba.magnitude_squared();

    if ba_dot < 1e-8 {
        // Degenerate capsule (a == b), treat as sphere
        return (point - a).magnitude() - radius;
    }

    let pa_dot = pa.dot(&ba);
    let h = (pa_dot / ba_dot).clamp(0.0, 1.0);
    let closest = a + ba * h;
    (point - closest).magnitude() - radius
}

/// Smooth minimum (polynomial approximation)
/// Blends two SDF values with smooth transition
pub fn smooth_min_poly(a: f32, b: f32, k: f32) -> f32 {
    let h = (k - (a - b).abs()).max(0.0);
    a.min(b) - h * h * 0.25 / k
}

/// Signed distance function for a profiled capsule with radial control points
/// radial_profiles is a 2D array: [segment_along_bone][control_point_around_ring]
/// Each segment defines a cross-sectional profile with N radial control points
/// use_splines: true = Catmull-Rom splines (smooth), false = linear interpolation
pub fn profiled_capsule_sdf(
    point: &Pt3,
    a: &Pt3,
    b: &Pt3,
    radial_profiles: &[Vec<f32>],
    use_splines: bool,
) -> f32 {
    let ba = b - a;
    let pa = point - a;
    let ba_dot = ba.magnitude_squared();

    if ba_dot < 1e-8 {
        // Degenerate case: a == b, treat as sphere with average of first profile
        if let Some(first_profile) = radial_profiles.first() {
            let avg_radius: f32 = first_profile.iter().sum::<f32>() / first_profile.len() as f32;
            return (point - a).magnitude() - avg_radius;
        }
        return (point - a).magnitude() - 0.1;
    }

    // Project point onto bone axis to get t parameter [0, 1]
    let pa_dot = pa.dot(&ba);
    let t_unclamped = pa_dot / ba_dot;
    let t = t_unclamped.clamp(0.0, 1.0);

    // If point is beyond capsule ends, use spherical end caps
    if t_unclamped < 0.0 {
        // Beyond start: use sphere with first profile's average radius
        let cap_radius = radial_profiles.first()
            .map(|ring| {
                let sum: f32 = ring.iter().sum();
                sum / ring.len() as f32
            })
            .unwrap_or(0.1);
        return (point - a).magnitude() - cap_radius;
    }
    if t_unclamped > 1.0 {
        // Beyond end: use sphere with last profile's average radius
        let cap_radius = radial_profiles.last()
            .map(|ring| {
                let sum: f32 = ring.iter().sum();
                sum / ring.len() as f32
            })
            .unwrap_or(0.1);
        return (point - b).magnitude() - cap_radius;
    }

    // Construct CONSISTENT local frame at t
    // CRITICAL: Use world-space reference (Y-up) to ensure angle=0° always points the same direction
    let bone_dir = ba.normalize();

    // Always use world Y-up as reference, except when bone is vertical
    let world_up = Vec3::new(0.0, 1.0, 0.0);
    let world_forward = Vec3::new(0.0, 0.0, 1.0);

    // Choose reference vector based on bone orientation
    let ref_vec = if bone_dir.y.abs() > 0.9 {
        // Bone is vertical, use forward as reference
        world_forward
    } else {
        // Bone is horizontal/diagonal, use up as reference
        world_up
    };

    // Right vector (perpendicular to bone, in consistent direction)
    let right = bone_dir.cross(&ref_vec).normalize();

    // Forward vector (completes orthonormal basis)
    // This ensures angle=0° always points in a consistent world direction
    let forward = right.cross(&bone_dir).normalize();

    // Centerline point at t
    let center_point = a + ba * t;

    // Vector from centerline to point (in plane perpendicular to bone)
    let to_point = point - center_point;
    let radial_vec = to_point - bone_dir * to_point.dot(&bone_dir);
    let radial_dist = radial_vec.magnitude();

    // Compute angle around bone axis
    let angle = if radial_dist < 1e-6 {
        0.0 // Point is on centerline
    } else {
        let normalized_radial = radial_vec / radial_dist;
        let x = normalized_radial.dot(&right);
        let y = normalized_radial.dot(&forward);
        y.atan2(x) // Angle in radians [-PI, PI]
    };

    // Sample the radial profile at (t, angle)
    let target_radius = sample_radial_profile(radial_profiles, t, angle, use_splines);

    // Distance from point to profile surface
    radial_dist - target_radius
}

/// Sample a 2D radial profile at (t along bone, angle around bone)
/// Uses either spline or linear interpolation based on use_splines flag
fn sample_radial_profile(profiles: &[Vec<f32>], t: f32, angle: f32, use_splines: bool) -> f32 {
    use std::f32::consts::PI;

    if profiles.is_empty() {
        return 0.1; // Default radius
    }

    // Normalize angle to [0, 2*PI]
    let normalized_angle = if angle < 0.0 { angle + 2.0 * PI } else { angle };

    if use_splines {
        // Spline mode: Smooth Catmull-Rom interpolation along both axes

        // Step 1: Sample each segment's ring at the given angle using splines
        let radii_along_bone: Vec<f32> = profiles
            .iter()
            .map(|ring| sample_ring_at_angle(ring, normalized_angle, true))
            .collect();

        // Step 2: Interpolate along bone axis using splines
        catmull_rom_array(&radii_along_bone, t)
    } else {
        // Linear mode: Bilinear interpolation (preserves sharp detail)

        // Sample along t (bone axis)
        let max_segment_index = (profiles.len() - 1) as f32;
        let float_segment = t * max_segment_index;
        let segment0 = float_segment.floor() as usize;
        let segment1 = (segment0 + 1).min(profiles.len() - 1);
        let t_frac = float_segment - segment0 as f32;

        // Sample both segments at the given angle
        let radius0 = sample_ring_at_angle(&profiles[segment0], normalized_angle, false);
        let radius1 = sample_ring_at_angle(&profiles[segment1], normalized_angle, false);

        // Linear interpolation between segments
        radius0 * (1.0 - t_frac) + radius1 * t_frac
    }
}

/// Sample a single ring profile at a given angle
/// Ring control points are evenly distributed around [0, 2*PI]
/// use_splines: true = Catmull-Rom (smooth), false = linear
pub fn sample_ring_at_angle(ring: &[f32], angle: f32, use_splines: bool) -> f32 {
    use std::f32::consts::PI;

    if ring.is_empty() {
        return 0.1;
    }
    if ring.len() == 1 {
        return ring[0];
    }

    if use_splines {
        // Spline mode: Catmull-Rom closed spline around the ring
        catmull_rom_closed(ring, angle)
    } else {
        // Linear mode: Linear interpolation between adjacent control points
        let num_points = ring.len();
        let angle_step = 2.0 * PI / num_points as f32;

        // Find which two control points the angle falls between
        let float_index = (angle / angle_step).rem_euclid(num_points as f32);
        let index0 = float_index.floor() as usize;
        let index1 = (index0 + 1) % num_points; // Wrap around
        let frac = float_index.fract();

        // Linear interpolation between control points
        ring[index0] * (1.0 - frac) + ring[index1] * frac
    }
}

/// Compute gradient of SDF using central differences
pub fn compute_gradient(point: &Pt3, evaluate_sdf: impl Fn(&Pt3) -> f32) -> Vec3 {
    let x = point.x;
    let y = point.y;
    let z = point.z;

    let dx = (evaluate_sdf(&Pt3::new(x + EPSILON, y, z))
        - evaluate_sdf(&Pt3::new(x - EPSILON, y, z)))
        / (2.0 * EPSILON);

    let dy = (evaluate_sdf(&Pt3::new(x, y + EPSILON, z))
        - evaluate_sdf(&Pt3::new(x, y - EPSILON, z)))
        / (2.0 * EPSILON);

    let dz = (evaluate_sdf(&Pt3::new(x, y, z + EPSILON))
        - evaluate_sdf(&Pt3::new(x, y, z - EPSILON)))
        / (2.0 * EPSILON);

    Vec3::new(dx, dy, dz)
}
