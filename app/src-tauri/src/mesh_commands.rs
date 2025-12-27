use crate::mesh::{
    export_to_gltf,
    generator::{AgeGroup, Gender, HumanParameters, MeshGenerator},
    lerp_meshes, multi_lerp, Mesh,
};
use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Resource, Clone)]
pub struct MeshState {
    pub base_meshes: Arc<Mutex<Vec<Mesh>>>,
    pub current_mesh: Arc<Mutex<Option<Mesh>>>,
}

impl Default for MeshState {
    fn default() -> Self {
        Self {
            base_meshes: Arc::new(Mutex::new(Vec::new())),
            current_mesh: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct GenerateMeshParams {
    pub gender: String,
    pub age_group: String,
    pub height: f32,
    pub weight: f32,
}

#[tauri::command]
pub fn generate_base_mesh(params: GenerateMeshParams) -> Result<String, String> {
    let gender = match params.gender.as_str() {
        "male" => Gender::Male,
        "female" => Gender::Female,
        _ => return Err("Invalid gender".to_string()),
    };

    let age_group = match params.age_group.as_str() {
        "child" => AgeGroup::Child,
        "teen" => AgeGroup::Teen,
        "adult" => AgeGroup::Adult,
        _ => return Err("Invalid age group".to_string()),
    };

    let human_params = HumanParameters::new(gender, age_group, params.height, params.weight);
    let mesh = MeshGenerator::generate_human(&human_params);

    export_to_gltf(&mesh)
}

#[tauri::command]
pub fn save_base_mesh(
    mesh_state: tauri::State<MeshState>,
    params: GenerateMeshParams,
) -> Result<(), String> {
    let gender = match params.gender.as_str() {
        "male" => Gender::Male,
        "female" => Gender::Female,
        _ => return Err("Invalid gender".to_string()),
    };

    let age_group = match params.age_group.as_str() {
        "child" => AgeGroup::Child,
        "teen" => AgeGroup::Teen,
        "adult" => AgeGroup::Adult,
        _ => return Err("Invalid age group".to_string()),
    };

    let human_params = HumanParameters::new(gender, age_group, params.height, params.weight);
    let mesh = MeshGenerator::generate_human(&human_params);

    let mut base_meshes = mesh_state.base_meshes.lock().map_err(|e| e.to_string())?;
    base_meshes.push(mesh);

    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct MultiLerpParams {
    pub weights: Vec<f32>,
}

#[tauri::command]
pub fn multi_lerp_meshes(
    mesh_state: tauri::State<MeshState>,
    params: MultiLerpParams,
) -> Result<String, String> {
    let base_meshes = mesh_state.base_meshes.lock().map_err(|e| e.to_string())?;

    if base_meshes.len() != params.weights.len() {
        return Err(format!(
            "Weight count ({}) doesn't match base mesh count ({})",
            params.weights.len(),
            base_meshes.len()
        ));
    }

    let meshes: Vec<Mesh> = base_meshes.iter().cloned().collect();
    let result = multi_lerp(&meshes, &params.weights)?;

    let mut current_mesh = mesh_state.current_mesh.lock().map_err(|e| e.to_string())?;
    *current_mesh = Some(result.clone());

    export_to_gltf(&result)
}

#[tauri::command]
pub fn get_base_mesh_count(mesh_state: tauri::State<MeshState>) -> Result<usize, String> {
    let base_meshes = mesh_state.base_meshes.lock().map_err(|e| e.to_string())?;
    Ok(base_meshes.len())
}

#[tauri::command]
pub fn clear_base_meshes(mesh_state: tauri::State<MeshState>) -> Result<(), String> {
    let mut base_meshes = mesh_state.base_meshes.lock().map_err(|e| e.to_string())?;
    base_meshes.clear();
    Ok(())
}

#[tauri::command]
pub fn export_human(params: GenerateMeshParams) -> Result<String, String> {
    let gender = match params.gender.as_str() {
        "male" => Gender::Male,
        "female" => Gender::Female,
        _ => return Err("Invalid gender".to_string()),
    };

    let age_group = match params.age_group.as_str() {
        "child" => AgeGroup::Child,
        "teen" => AgeGroup::Teen,
        "adult" => AgeGroup::Adult,
        _ => return Err("Invalid age group".to_string()),
    };

    let human_params = HumanParameters::new(gender, age_group, params.height, params.weight);
    let mesh = MeshGenerator::generate_human(&human_params);

    export_to_gltf(&mesh)
}
