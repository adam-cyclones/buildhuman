use nalgebra::{Point3, UnitQuaternion, Vector3};
use serde::{Deserialize, Serialize};

// Type aliases for cleaner code
pub type Vec3 = Vector3<f32>;
pub type Pt3 = Point3<f32>;
pub type Quat = UnitQuaternion<f32>;

// Serializable types for Tauri IPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vec3Data {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl From<Vec3Data> for Vec3 {
    fn from(v: Vec3Data) -> Self {
        Vec3::new(v.x, v.y, v.z)
    }
}

impl From<Vec3Data> for Pt3 {
    fn from(v: Vec3Data) -> Self {
        Pt3::new(v.x, v.y, v.z)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuatData {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl From<QuatData> for Quat {
    fn from(q: QuatData) -> Self {
        Quat::from_quaternion(nalgebra::Quaternion::new(q.w, q.x, q.y, q.z))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JointData {
    pub id: String,
    pub local_offset: Vec3Data,
    pub local_rotation: QuatData,
    pub parent_id: Option<String>,
    pub children: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouldData {
    pub id: String,
    pub shape: MouldShape,
    pub center: Vec3Data,
    pub radius: f32,
    pub blend_radius: f32,
    pub parent_joint_id: Option<String>,
    pub end_point: Option<Vec3Data>,
    // Profiled capsule-specific properties
    // 2D array: [segment_along_bone][control_point_around_ring]
    // Each segment has N radial control points defining the perimeter shape
    pub radial_profiles: Option<Vec<Vec<f32>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MouldShape {
    Sphere,
    Capsule,
    ProfiledCapsule,
}

// Mesh output data
#[derive(Debug, Clone)]
pub struct MeshData {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    pub normals: Vec<f32>,
}

// Axis-aligned bounding box
#[derive(Debug, Clone)]
pub struct AABB {
    pub min: Pt3,
    pub max: Pt3,
}
