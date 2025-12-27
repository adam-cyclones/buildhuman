use glam::Vec3;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
}

impl Vertex {
    pub fn new(position: [f32; 3], normal: [f32; 3]) -> Self {
        Self { position, normal }
    }

    pub fn from_vec3(position: Vec3, normal: Vec3) -> Self {
        Self {
            position: position.to_array(),
            normal: normal.to_array(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mesh {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
    pub name: String,
}

impl Mesh {
    pub fn new(name: String, vertices: Vec<Vertex>, indices: Vec<u32>) -> Self {
        Self {
            vertices,
            indices,
            name,
        }
    }

    pub fn vertex_count(&self) -> usize {
        self.vertices.len()
    }

    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    pub fn calculate_normals(&mut self) {
        let mut normals = vec![Vec3::ZERO; self.vertices.len()];

        for chunk in self.indices.chunks(3) {
            let i0 = chunk[0] as usize;
            let i1 = chunk[1] as usize;
            let i2 = chunk[2] as usize;

            let v0 = Vec3::from(self.vertices[i0].position);
            let v1 = Vec3::from(self.vertices[i1].position);
            let v2 = Vec3::from(self.vertices[i2].position);

            let edge1 = v1 - v0;
            let edge2 = v2 - v0;
            let normal = edge1.cross(edge2).normalize();

            normals[i0] += normal;
            normals[i1] += normal;
            normals[i2] += normal;
        }

        for (i, vertex) in self.vertices.iter_mut().enumerate() {
            vertex.normal = normals[i].normalize().to_array();
        }
    }
}
