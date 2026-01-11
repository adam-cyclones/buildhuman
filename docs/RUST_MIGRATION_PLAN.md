# Performance Migration Plan: TypeScript to Rust

## 1. Objective

The primary goal of this migration is to significantly improve the performance and responsiveness of the `BuildHuman` application by offloading computationally expensive tasks from the frontend (TypeScript) to the Tauri backend (Rust). This will result in a smoother user experience, faster mesh generation, and the ability to handle more complex models and higher resolutions.

## 2. High-Level Strategy

The migration will follow these key principles:

1.  **Identify Bottlenecks:** Pinpoint the most CPU-intensive operations in the current TypeScript codebase. These are primarily related to 3D mesh generation and manipulation.
2.  **Rewrite in Rust:** Port the identified TypeScript logic to performant, idiomatic Rust within the `src-tauri` directory.
3.  **Leverage Parallelism:** Use Rust's powerful concurrency features, specifically the `rayon` crate, to parallelize heavy computations across multiple CPU cores.
4.  **Efficient IPC:** Avoid JSON for large data payloads. Instead, use raw binary buffers (`Vec<u8>`) sent via `tauri::ipc::Response` for minimal overhead.
5.  **Zero-Copy on Frontend:** On the TypeScript side, receive the data as an `ArrayBuffer` and create typed array views (`Float32Array`, `Uint32Array`) directly on this buffer to update Three.js geometry without any memory copying.

## 3. Target Areas for Migration

The following modules are the primary candidates for migration, in order of priority:

### Priority 1: Mesh Generation

-   **Current Location:**
    -   `app/src/views/Humans/morphing/voxel-grid.ts`
    -   `app/src/views/Humans/morphing/sdf.ts`
    -   `app/src/views/Humans/morphing/dual-contouring.ts`
-   **Task:** This logic iterates over a 3D grid, evaluates a Signed Distance Field (SDF) at each point, and then extracts a surface mesh (vertices and indices).
-   **Rust Implementation Guide:**
    -   Create a new Rust module (e.g., `src-tauri/src/mesh_generation.rs`).
    -   Use the `rayon` crate to parallelize the voxel grid evaluation loop (`grid.evaluate(...)`).
    -   Use a performant linear algebra library like `nalgebra` for all vector math.
    -   The final Rust function should return a struct containing the mesh data, for example: `struct MeshData { vertices: Vec<f32>, indices: Vec<u32>, normals: Vec<f32> }`.

### Priority 2: Skeleton & Mould Kinematics

-   **Current Location:**
    -   `app/src/views/Humans/morphing/skeleton.ts`
    -   `app/src/views/Humans/morphing/transform.ts`
    -   `app/src/views/Humans/morphing/mould-manager.ts`
-   **Task:** This code handles the hierarchical structure of the human skeleton, including joint transforms, rotations, and the evaluation of attached "moulds".
-   **Rust Implementation Guide:**
    -   Create a new Rust module (e.g., `src-tauri/src/kinematics.rs`).
    -   Use `nalgebra` types like `Isometry3`, `UnitQuaternion`, and `Matrix4` to build the skeleton hierarchy.
    -   The Rust `Skeleton` struct should be able to apply local rotations and efficiently compute the world-space transform for every joint.

## 4. IPC (Inter-Process Communication) Design

This is the critical link between the Rust backend and the JavaScript frontend.

### Tauri Command in Rust

A new Tauri command will be created to trigger the mesh generation and return the binary data.

```rust
// In `src-tauri/src/main.rs`

// This struct will hold the final mesh data in Rust
struct MeshData {
    vertices: Vec<f32>,
    indices: Vec<u32>,
    normals: Vec<f32>,
}

#[tauri::command]
fn generate_mesh_binary(/* parameters like resolution, joint positions, etc. */) -> Result<tauri::ipc::Response, String> {
    // 1. Call your Rust mesh generation logic here
    let mesh: MeshData = my_rust_mesh_generator::generate();

    // 2. Serialize the MeshData into a single Vec<u8> using the protocol below
    let bytes: Vec<u8> = serialize_mesh_to_bytes(mesh);
    
    // 3. Return as a raw binary response
    Ok(tauri::ipc::Response::new(bytes))
}
```

### Binary Data Protocol

To ensure the frontend can correctly interpret the `Vec<u8>`, we will use the following byte-level protocol. All integer values are **little-endian**.

-   `[0..4]`: `vertex_data_len` (Length of vertex data in bytes, as `u32`)
-   `[4..8]`: `index_data_len` (Length of index data in bytes, as `u32`)
-   `[8..12]`: `normal_data_len` (Length of normal data in bytes, as `u32`)
-   `[12..]` : The actual binary data, concatenated in this order:
    1.  Vertex data (`[f32]`)
    2.  Index data (`[u32]`)
    3.  Normal data (`[f32]`)

### Frontend Data Handling

The frontend will use `invoke` to call the command and parse the resulting `ArrayBuffer`.

```typescript
// In a frontend file like `VoxelMorphScene.tsx`
import { invoke } from '@tauri-apps/api/core';
import * as THREE from 'three';

async function regenerateMeshFromRust() {
    // 1. Invoke the command to get the raw buffer
    const buffer = await invoke<ArrayBuffer>('generate_mesh_binary');

    // 2. Parse the metadata header
    const dataView = new DataView(buffer);
    const vertexDataLen = dataView.getUint32(0, true);
    const indexDataLen = dataView.getUint32(4, true);
    const normalDataLen = dataView.getUint32(8, true);
    let offset = 12;

    // 3. Create zero-copy typed array views on the buffer
    const vertices = new Float32Array(buffer, offset, vertexDataLen / 4);
    offset += vertexDataLen;
    const indices = new Uint32Array(buffer, offset, indexDataLen / 4);
    offset += indexDataLen;
    const normals = new Float32Array(buffer, offset, normalDataLen / 4);

    // 4. Update the Three.js BufferGeometry
    const geometry = myMesh.geometry as THREE.BufferGeometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // 5. Notify Three.js of the update
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    geometry.index.needsUpdate = true;
    geometry.computeBoundingSphere();
}
```

## 5. Actionable Plan for the Agent

1.  **Setup Environment:**
    -   Add `rayon` and `nalgebra` to `src-tauri/Cargo.toml`.
2.  **Port Mesh Generation:**
    -   Create `src-tauri/src/mesh_generation.rs`.
    -   Translate the logic from `voxel-grid.ts`, `sdf.ts`, and `dual-contouring.ts` into this new Rust file.
    -   Implement the parallel SDF evaluation using `rayon`.
3.  **Implement IPC:**
    -   Define the `generate_mesh_binary` command in `src-tauri/src/main.rs`.
    -   Implement the function to serialize the generated `MeshData` into a `Vec<u8>` according to the specified protocol.
4.  **Refactor Frontend:**
    -   In `VoxelMorphScene.tsx` (or the relevant component), replace the call to the local TypeScript mesh generation functions with an `invoke` call to `generate_mesh_binary`.
    -   Implement the `regenerateMeshFromRust` logic to parse the `ArrayBuffer` and update the Three.js mesh.
5.  **Test and Verify:**
    -   Run the application and confirm that the mesh is generated correctly by the Rust backend and rendered on the frontend.
6.  **Iterate:**
    -   Once mesh generation is working, repeat the process for the skeleton and mould kinematics, creating a new set of Tauri commands as needed.
