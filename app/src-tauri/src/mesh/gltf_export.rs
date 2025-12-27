use super::Mesh;
use base64::{engine::general_purpose, Engine as _};
use gltf_json as json;
use json::buffer::Stride;
use json::validation::Checked::Valid;
use json::validation::USize64;
use serde_json::to_string;

pub fn export_to_gltf(mesh: &Mesh) -> Result<String, String> {
    let mut positions = Vec::new();
    let mut normals = Vec::new();

    for vertex in &mesh.vertices {
        positions.extend_from_slice(&vertex.position);
        normals.extend_from_slice(&vertex.normal);
    }

    let positions_bytes: Vec<u8> = positions.iter().flat_map(|f| f.to_le_bytes()).collect();

    let normals_bytes: Vec<u8> = normals.iter().flat_map(|f| f.to_le_bytes()).collect();

    let indices_bytes: Vec<u8> = mesh.indices.iter().flat_map(|i| i.to_le_bytes()).collect();

    let total_buffer_length = positions_bytes.len() + normals_bytes.len() + indices_bytes.len();

    let buffer = json::Buffer {
        byte_length: USize64::from(total_buffer_length),
        extensions: Default::default(),
        extras: Default::default(),
        name: None,
        uri: None,
    };

    let positions_buffer_view = json::buffer::View {
        buffer: json::Index::new(0),
        byte_length: USize64::from(positions_bytes.len()),
        byte_offset: Some(USize64(0)),
        byte_stride: Some(Stride(12)),
        extensions: Default::default(),
        extras: Default::default(),
        name: None,
        target: Some(Valid(json::buffer::Target::ArrayBuffer)),
    };

    let normals_buffer_view = json::buffer::View {
        buffer: json::Index::new(0),
        byte_length: USize64::from(normals_bytes.len()),
        byte_offset: Some(USize64::from(positions_bytes.len())),
        byte_stride: Some(Stride(12)),
        extensions: Default::default(),
        extras: Default::default(),
        name: None,
        target: Some(Valid(json::buffer::Target::ArrayBuffer)),
    };

    let indices_buffer_view = json::buffer::View {
        buffer: json::Index::new(0),
        byte_length: USize64::from(indices_bytes.len()),
        byte_offset: Some(USize64::from(positions_bytes.len() + normals_bytes.len())),
        byte_stride: None,
        extensions: Default::default(),
        extras: Default::default(),
        name: None,
        target: Some(Valid(json::buffer::Target::ElementArrayBuffer)),
    };

    let mut min_pos = [f32::MAX, f32::MAX, f32::MAX];
    let mut max_pos = [f32::MIN, f32::MIN, f32::MIN];

    for vertex in &mesh.vertices {
        for i in 0..3 {
            min_pos[i] = min_pos[i].min(vertex.position[i]);
            max_pos[i] = max_pos[i].max(vertex.position[i]);
        }
    }

    let positions_accessor = json::Accessor {
        buffer_view: Some(json::Index::new(0)),
        byte_offset: Some(USize64(0)),
        count: USize64::from(mesh.vertices.len()),
        component_type: Valid(json::accessor::GenericComponentType(
            json::accessor::ComponentType::F32,
        )),
        extensions: Default::default(),
        extras: Default::default(),
        type_: Valid(json::accessor::Type::Vec3),
        min: Some(json::Value::from(Vec::from(min_pos))),
        max: Some(json::Value::from(Vec::from(max_pos))),
        name: None,
        normalized: false,
        sparse: None,
    };

    let normals_accessor = json::Accessor {
        buffer_view: Some(json::Index::new(1)),
        byte_offset: Some(USize64(0)),
        count: USize64::from(mesh.vertices.len()),
        component_type: Valid(json::accessor::GenericComponentType(
            json::accessor::ComponentType::F32,
        )),
        extensions: Default::default(),
        extras: Default::default(),
        type_: Valid(json::accessor::Type::Vec3),
        min: None,
        max: None,
        name: None,
        normalized: false,
        sparse: None,
    };

    let indices_accessor = json::Accessor {
        buffer_view: Some(json::Index::new(2)),
        byte_offset: Some(USize64(0)),
        count: USize64::from(mesh.indices.len()),
        component_type: Valid(json::accessor::GenericComponentType(
            json::accessor::ComponentType::U32,
        )),
        extensions: Default::default(),
        extras: Default::default(),
        type_: Valid(json::accessor::Type::Scalar),
        min: None,
        max: None,
        name: None,
        normalized: false,
        sparse: None,
    };

    let primitive = json::mesh::Primitive {
        attributes: {
            let mut map = std::collections::BTreeMap::new();
            map.insert(Valid(json::mesh::Semantic::Positions), json::Index::new(0));
            map.insert(Valid(json::mesh::Semantic::Normals), json::Index::new(1));
            map
        },
        extensions: Default::default(),
        extras: Default::default(),
        indices: Some(json::Index::new(2)),
        material: None,
        mode: Valid(json::mesh::Mode::Triangles),
        targets: None,
    };

    let gltf_mesh = json::Mesh {
        extensions: Default::default(),
        extras: Default::default(),
        name: Some(mesh.name.clone()),
        primitives: vec![primitive],
        weights: None,
    };

    let node = json::Node {
        camera: None,
        children: None,
        extensions: Default::default(),
        extras: Default::default(),
        matrix: None,
        mesh: Some(json::Index::new(0)),
        name: None,
        rotation: None,
        scale: None,
        translation: None,
        skin: None,
        weights: None,
    };

    let scene = json::Scene {
        extensions: Default::default(),
        extras: Default::default(),
        name: None,
        nodes: vec![json::Index::new(0)],
    };

    let root = json::Root {
        accessors: vec![positions_accessor, normals_accessor, indices_accessor],
        buffers: vec![buffer],
        buffer_views: vec![
            positions_buffer_view,
            normals_buffer_view,
            indices_buffer_view,
        ],
        meshes: vec![gltf_mesh],
        nodes: vec![node],
        scenes: vec![scene],
        scene: Some(json::Index::new(0)),
        ..Default::default()
    };

    let gltf_json = to_string(&root).map_err(|e| e.to_string())?;

    let mut combined_buffer = Vec::new();
    combined_buffer.extend_from_slice(&positions_bytes);
    combined_buffer.extend_from_slice(&normals_bytes);
    combined_buffer.extend_from_slice(&indices_bytes);

    let buffer_uri = format!(
        "data:application/octet-stream;base64,{}",
        general_purpose::STANDARD.encode(&combined_buffer)
    );

    let mut gltf_data: serde_json::Value =
        serde_json::from_str(&gltf_json).map_err(|e| e.to_string())?;

    if let Some(buffers) = gltf_data.get_mut("buffers") {
        if let Some(buffer_obj) = buffers.get_mut(0) {
            if let Some(obj) = buffer_obj.as_object_mut() {
                obj.insert("uri".to_string(), serde_json::Value::String(buffer_uri));
            }
        }
    }

    serde_json::to_string_pretty(&gltf_data).map_err(|e| e.to_string())
}
