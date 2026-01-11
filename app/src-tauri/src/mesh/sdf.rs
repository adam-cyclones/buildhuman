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
