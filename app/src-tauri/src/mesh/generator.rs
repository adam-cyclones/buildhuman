use super::{Mesh, Vertex};
use glam::Vec3;
use std::f32::consts::PI;

#[derive(Debug, Clone)]
pub enum Gender {
    Male,
    Female,
}

#[derive(Debug, Clone)]
pub enum AgeGroup {
    Child,
    Teen,
    Adult,
}

#[derive(Debug, Clone)]
pub struct HumanParameters {
    pub gender: Gender,
    pub age_group: AgeGroup,
    pub height: f32,
    pub weight: f32,
    pub body_proportions: BodyProportions,
}

#[derive(Debug, Clone)]
pub struct BodyProportions {
    pub head_size: f32,
    pub torso_length: f32,
    pub torso_width: f32,
    pub leg_length: f32,
    pub arm_length: f32,
    pub shoulder_width: f32,
    pub hip_width: f32,
}

impl Default for BodyProportions {
    fn default() -> Self {
        Self {
            head_size: 1.0,
            torso_length: 1.0,
            torso_width: 1.0,
            leg_length: 1.0,
            arm_length: 1.0,
            shoulder_width: 1.0,
            hip_width: 1.0,
        }
    }
}

impl HumanParameters {
    pub fn new(gender: Gender, age_group: AgeGroup, height: f32, weight: f32) -> Self {
        let mut body_proportions = match (&gender, &age_group) {
            (Gender::Male, AgeGroup::Adult) => BodyProportions {
                head_size: 1.0,
                torso_length: 1.0,
                torso_width: 1.0,
                leg_length: 1.0,
                arm_length: 1.0,
                shoulder_width: 1.2,
                hip_width: 0.9,
            },
            (Gender::Female, AgeGroup::Adult) => BodyProportions {
                head_size: 0.95,
                torso_length: 0.95,
                torso_width: 0.85,
                leg_length: 1.05,
                arm_length: 0.95,
                shoulder_width: 1.0,
                hip_width: 1.1,
            },
            (_, AgeGroup::Teen) => BodyProportions {
                head_size: 1.1,
                torso_length: 0.9,
                torso_width: 0.8,
                leg_length: 0.95,
                arm_length: 0.9,
                shoulder_width: 0.9,
                hip_width: 0.85,
            },
            (_, AgeGroup::Child) => BodyProportions {
                head_size: 1.3,
                torso_length: 0.8,
                torso_width: 0.7,
                leg_length: 0.7,
                arm_length: 0.75,
                shoulder_width: 0.8,
                hip_width: 0.75,
            },
        };

        let bmi = weight / (height * height);
        // Normalize BMI around 22 as a baseline
        let weight_factor = (bmi / 22.0).max(0.5).min(2.0);

        body_proportions.torso_width *= weight_factor;
        body_proportions.hip_width *= weight_factor;

        Self {
            gender,
            age_group,
            height,
            weight,
            body_proportions,
        }
    }
}

pub struct MeshGenerator;

impl MeshGenerator {
    pub fn generate_human(params: &HumanParameters) -> Mesh {
        let mut vertices = Vec::new();
        let mut indices = Vec::new();

        let scale = params.height / 1.75;
        let props = &params.body_proportions;

        let head_height = 0.25 * props.head_size * scale;
        let head_radius = 0.12 * props.head_size * scale;
        let neck_height = 0.08 * scale;
        let torso_height = 0.6 * props.torso_length * scale;
        let torso_width = 0.35 * props.torso_width * scale;
        let shoulder_width = 0.45 * props.shoulder_width * scale;
        let hip_width = 0.35 * props.hip_width * scale;
        let leg_length = 0.9 * props.leg_length * scale;
        let arm_length = 0.65 * props.arm_length * scale;

        let mut current_index = 0u32;

        let head_center = Vec3::new(0.0, torso_height + neck_height + head_height / 2.0, 0.0);
        Self::add_sphere(
            &mut vertices,
            &mut indices,
            &mut current_index,
            head_center,
            head_radius,
            8,
            6,
        );

        let neck_base = Vec3::new(0.0, torso_height, 0.0);
        let neck_top = Vec3::new(0.0, torso_height + neck_height, 0.0);
        Self::add_cylinder(
            &mut vertices,
            &mut indices,
            &mut current_index,
            neck_base,
            neck_top,
            0.06 * scale,
            6,
        );

        let torso_bottom = Vec3::new(0.0, 0.0, 0.0);
        let torso_top = Vec3::new(0.0, torso_height, 0.0);
        Self::add_torso(
            &mut vertices,
            &mut indices,
            &mut current_index,
            torso_bottom,
            torso_top,
            shoulder_width,
            hip_width,
            torso_width,
            8,
        );

        let left_leg_start = Vec3::new(-hip_width * 0.4, 0.0, 0.0);
        let left_leg_end = Vec3::new(-hip_width * 0.4, -leg_length, 0.0);
        Self::add_cylinder(
            &mut vertices,
            &mut indices,
            &mut current_index,
            left_leg_start,
            left_leg_end,
            0.08 * scale,
            8,
        );

        let right_leg_start = Vec3::new(hip_width * 0.4, 0.0, 0.0);
        let right_leg_end = Vec3::new(hip_width * 0.4, -leg_length, 0.0);
        Self::add_cylinder(
            &mut vertices,
            &mut indices,
            &mut current_index,
            right_leg_start,
            right_leg_end,
            0.08 * scale,
            8,
        );

        let left_shoulder = Vec3::new(-shoulder_width * 0.5, torso_height * 0.9, 0.0);
        let left_hand = Vec3::new(
            -shoulder_width * 0.5 - arm_length * 0.3,
            torso_height * 0.4,
            0.0,
        );
        Self::add_cylinder(
            &mut vertices,
            &mut indices,
            &mut current_index,
            left_shoulder,
            left_hand,
            0.06 * scale,
            8,
        );

        let right_shoulder = Vec3::new(shoulder_width * 0.5, torso_height * 0.9, 0.0);
        let right_hand = Vec3::new(
            shoulder_width * 0.5 + arm_length * 0.3,
            torso_height * 0.4,
            0.0,
        );
        Self::add_cylinder(
            &mut vertices,
            &mut indices,
            &mut current_index,
            right_shoulder,
            right_hand,
            0.06 * scale,
            8,
        );

        let mut mesh = Mesh::new(
            format!("{:?}_{:?}_Human", params.gender, params.age_group),
            vertices,
            indices,
        );
        mesh.calculate_normals();
        mesh
    }

    fn add_sphere(
        vertices: &mut Vec<Vertex>,
        indices: &mut Vec<u32>,
        current_index: &mut u32,
        center: Vec3,
        radius: f32,
        stacks: usize,
        slices: usize,
    ) {
        let start_index = *current_index;

        for i in 0..=stacks {
            let phi = PI * i as f32 / stacks as f32;
            for j in 0..=slices {
                let theta = 2.0 * PI * j as f32 / slices as f32;

                let x = radius * phi.sin() * theta.cos();
                let y = radius * phi.cos();
                let z = radius * phi.sin() * theta.sin();

                let position = center + Vec3::new(x, y, z);
                let normal = Vec3::new(x, y, z).normalize();

                vertices.push(Vertex::from_vec3(position, normal));
                *current_index += 1;
            }
        }

        for i in 0..stacks {
            for j in 0..slices {
                let first = start_index + (i * (slices + 1) + j) as u32;
                let second = first + slices as u32 + 1;

                indices.push(first);
                indices.push(second);
                indices.push(first + 1);

                indices.push(second);
                indices.push(second + 1);
                indices.push(first + 1);
            }
        }
    }

    fn add_cylinder(
        vertices: &mut Vec<Vertex>,
        indices: &mut Vec<u32>,
        current_index: &mut u32,
        bottom: Vec3,
        top: Vec3,
        radius: f32,
        segments: usize,
    ) {
        let start_index = *current_index;
        let axis = (top - bottom).normalize();

        let arbitrary = if axis.y.abs() < 0.9 { Vec3::Y } else { Vec3::X };
        let tangent = axis.cross(arbitrary).normalize();
        let bitangent = axis.cross(tangent);

        for ring in 0..=1 {
            let y = if ring == 0 { bottom } else { top };
            for i in 0..=segments {
                let theta = 2.0 * PI * i as f32 / segments as f32;
                let x = radius * theta.cos();
                let z = radius * theta.sin();

                let offset = tangent * x + bitangent * z;
                let position = y + offset;
                let normal = offset.normalize();

                vertices.push(Vertex::from_vec3(position, normal));
                *current_index += 1;
            }
        }

        for i in 0..segments {
            let first = start_index + i as u32;
            let second = first + segments as u32 + 1;

            indices.push(first);
            indices.push(second);
            indices.push(first + 1);

            indices.push(second);
            indices.push(second + 1);
            indices.push(first + 1);
        }
    }

    fn add_torso(
        vertices: &mut Vec<Vertex>,
        indices: &mut Vec<u32>,
        current_index: &mut u32,
        bottom: Vec3,
        top: Vec3,
        top_width: f32,
        bottom_width: f32,
        depth: f32,
        segments: usize,
    ) {
        let start_index = *current_index;

        for ring in 0..=1 {
            let y = if ring == 0 { bottom } else { top };
            let width = if ring == 0 { bottom_width } else { top_width };

            for i in 0..=segments {
                let theta = 2.0 * PI * i as f32 / segments as f32;
                let x = width * 0.5 * theta.cos();
                let z = depth * 0.5 * theta.sin();

                let position = y + Vec3::new(x, 0.0, z);
                let normal = Vec3::new(x, 0.0, z).normalize();

                vertices.push(Vertex::from_vec3(position, normal));
                *current_index += 1;
            }
        }

        for i in 0..segments {
            let first = start_index + i as u32;
            let second = first + segments as u32 + 1;

            indices.push(first);
            indices.push(second);
            indices.push(first + 1);

            indices.push(second);
            indices.push(second + 1);
            indices.push(first + 1);
        }
    }
}
