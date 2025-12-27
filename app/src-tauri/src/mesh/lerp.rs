use super::{Mesh, Vertex};
use glam::Vec3;

pub fn lerp_meshes(mesh_a: &Mesh, mesh_b: &Mesh, t: f32) -> Result<Mesh, String> {
    if mesh_a.vertices.len() != mesh_b.vertices.len() {
        return Err(format!(
            "Mesh vertex count mismatch: {} vs {}",
            mesh_a.vertices.len(),
            mesh_b.vertices.len()
        ));
    }

    if mesh_a.indices.len() != mesh_b.indices.len() {
        return Err(format!(
            "Mesh index count mismatch: {} vs {}",
            mesh_a.indices.len(),
            mesh_b.indices.len()
        ));
    }

    let t = t.clamp(0.0, 1.0);

    let vertices: Vec<Vertex> = mesh_a
        .vertices
        .iter()
        .zip(mesh_b.vertices.iter())
        .map(|(v_a, v_b)| {
            let pos_a = Vec3::from(v_a.position);
            let pos_b = Vec3::from(v_b.position);
            let position = pos_a.lerp(pos_b, t);

            let norm_a = Vec3::from(v_a.normal);
            let norm_b = Vec3::from(v_b.normal);
            let normal = norm_a.lerp(norm_b, t).normalize();

            Vertex::from_vec3(position, normal)
        })
        .collect();

    Ok(Mesh::new(
        format!("Lerp_{}_{}", mesh_a.name, mesh_b.name),
        vertices,
        mesh_a.indices.clone(),
    ))
}

pub fn multi_lerp(meshes: &[Mesh], weights: &[f32]) -> Result<Mesh, String> {
    if meshes.is_empty() {
        return Err("No meshes provided for interpolation".to_string());
    }

    if meshes.len() != weights.len() {
        return Err(format!(
            "Mesh count ({}) doesn't match weight count ({})",
            meshes.len(),
            weights.len()
        ));
    }

    let weight_sum: f32 = weights.iter().sum();
    if weight_sum == 0.0 {
        return Err("Weight sum is zero".to_string());
    }

    let normalized_weights: Vec<f32> = weights.iter().map(|w| w / weight_sum).collect();

    let vertex_count = meshes[0].vertices.len();
    for (i, mesh) in meshes.iter().enumerate().skip(1) {
        if mesh.vertices.len() != vertex_count {
            return Err(format!(
                "Mesh {} vertex count mismatch: {} vs {}",
                i,
                mesh.vertices.len(),
                vertex_count
            ));
        }
    }

    let mut result_vertices = vec![Vertex::new([0.0, 0.0, 0.0], [0.0, 1.0, 0.0]); vertex_count];

    for (mesh, &weight) in meshes.iter().zip(normalized_weights.iter()) {
        for (i, vertex) in mesh.vertices.iter().enumerate() {
            let pos = Vec3::from(result_vertices[i].position);
            let new_pos = Vec3::from(vertex.position);
            result_vertices[i].position = (pos + new_pos * weight).to_array();

            let norm = Vec3::from(result_vertices[i].normal);
            let new_norm = Vec3::from(vertex.normal);
            result_vertices[i].normal = (norm + new_norm * weight).to_array();
        }
    }

    for vertex in &mut result_vertices {
        let normal = Vec3::from(vertex.normal).normalize();
        vertex.normal = normal.to_array();
    }

    Ok(Mesh::new(
        "MultiLerp_Result".to_string(),
        result_vertices,
        meshes[0].indices.clone(),
    ))
}
