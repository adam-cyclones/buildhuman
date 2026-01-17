/// Catmull-Rom spline utilities for smooth profile interpolation
///
/// Catmull-Rom splines:
/// - Pass through all control points (predictable)
/// - C1 continuous (smooth tangents)
/// - Perfect for hand-crafted body profiles with few control points

/// Sample a Catmull-Rom spline at parameter t ∈ [0, 1]
///
/// Given 4 control points P0, P1, P2, P3:
/// - Returns interpolated value between P1 and P2
/// - P0 and P3 are used only for tangent calculation
/// - t=0 returns P1, t=1 returns P2
pub fn catmull_rom(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    let t2 = t * t;
    let t3 = t2 * t;

    // Catmull-Rom basis functions with tau=0.5 (standard centripetal)
    let a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
    let b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
    let c = -0.5 * p0 + 0.5 * p2;
    let d = p1;

    a * t3 + b * t2 + c * t + d
}

/// Sample a Catmull-Rom spline through an array of control points
///
/// - `values`: Array of control points
/// - `t`: Parameter in range [0, 1] across entire spline
/// - Returns interpolated value
///
/// For n control points, there are (n-1) segments
pub fn catmull_rom_array(values: &[f32], t: f32) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    if values.len() == 1 {
        return values[0];
    }
    if values.len() == 2 {
        // Linear interpolation for 2 points
        return values[0] * (1.0 - t) + values[1] * t;
    }

    // Clamp t to [0, 1]
    let t_clamped = t.clamp(0.0, 1.0);

    // Determine which segment we're in
    let num_segments = values.len() - 1;
    let segment_float = t_clamped * num_segments as f32;
    let segment_idx = (segment_float.floor() as usize).min(num_segments - 1);
    let local_t = segment_float - segment_idx as f32;

    // Get the 4 control points for this segment
    // Handle boundary conditions by repeating first/last points
    let p0 = if segment_idx == 0 {
        values[0] // Repeat first point for tangent
    } else {
        values[segment_idx - 1]
    };
    let p1 = values[segment_idx];
    let p2 = values[segment_idx + 1];
    let p3 = if segment_idx + 2 >= values.len() {
        values[values.len() - 1] // Repeat last point for tangent
    } else {
        values[segment_idx + 2]
    };

    catmull_rom(p0, p1, p2, p3, local_t)
}

/// Sample a closed Catmull-Rom spline (wraps around for rings)
///
/// - `values`: Array of control points (forms a closed loop)
/// - `angle`: Angle in radians [0, 2π] around the loop
/// - Returns interpolated value
pub fn catmull_rom_closed(values: &[f32], angle: f32) -> f32 {
    use std::f32::consts::PI;

    if values.is_empty() {
        return 0.0;
    }
    if values.len() == 1 {
        return values[0];
    }

    let n = values.len();

    // Normalize angle to [0, 2π]
    let normalized_angle = ((angle % (2.0 * PI)) + (2.0 * PI)) % (2.0 * PI);

    // Convert angle to parameter t ∈ [0, n]
    let t = (normalized_angle / (2.0 * PI)) * n as f32;

    // Determine which segment
    let segment_idx = (t.floor() as usize) % n;
    let local_t = t - segment_idx as f32;

    // Get 4 control points with wrapping
    let p0 = values[(segment_idx + n - 1) % n];
    let p1 = values[segment_idx];
    let p2 = values[(segment_idx + 1) % n];
    let p3 = values[(segment_idx + 2) % n];

    catmull_rom(p0, p1, p2, p3, local_t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_catmull_rom_endpoints() {
        // At t=0, should return p1
        assert!((catmull_rom(0.0, 1.0, 2.0, 3.0, 0.0) - 1.0).abs() < 1e-6);

        // At t=1, should return p2
        assert!((catmull_rom(0.0, 1.0, 2.0, 3.0, 1.0) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn test_catmull_rom_array() {
        let values = vec![1.0, 2.0, 3.0, 4.0];

        // At t=0, should return first value
        assert!((catmull_rom_array(&values, 0.0) - 1.0).abs() < 1e-6);

        // At t=1, should return last value
        assert!((catmull_rom_array(&values, 1.0) - 4.0).abs() < 1e-6);

        // At t=0.5, should be somewhere in the middle
        let mid = catmull_rom_array(&values, 0.5);
        assert!(mid > 2.0 && mid < 3.0);
    }

    #[test]
    fn test_catmull_rom_closed() {
        use std::f32::consts::PI;

        let values = vec![1.0, 2.0, 3.0, 2.0];

        // Should wrap smoothly
        let v0 = catmull_rom_closed(&values, 0.0);
        let v_full = catmull_rom_closed(&values, 2.0 * PI);

        // At angle=0 and angle=2π (full loop), should be close due to wrapping
        assert!((v0 - v_full).abs() < 0.1);
    }
}
