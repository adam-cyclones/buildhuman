# Mould-Based Morphing System - Implementation Plan

## Implementation Status (as of 2026-01-09)

**Phases 1-3 Complete:**
- ✅ Phase 1: Single sphere mould proof of concept (marching cubes)
- ✅ Phase 2: Multiple moulds with smooth blending (6-sphere humanoid)
- ✅ Phase 3: Dual contouring implementation (gradient-based vertex projection)

**Current State:**
- 6 sphere moulds (head, torso, 2 arms, 2 legs) blend smoothly
- Dual contouring produces closed meshes with vertices projected onto isosurface
- Using THREE.DoubleSide rendering (triangle winding needs fixing)
- 32³ voxel resolution, world-space coordinate system
- Skeleton system foundation in place (not yet integrated)

**Next Steps (Phase 4):**
- Fix triangle winding order for proper front-face culling
- Increase voxel resolution (64³ or adaptive)
- Add more mould shapes (capsules, boxes)
- Integrate skeleton with mould attachment
- Add UI controls for individual mould manipulation

## Executive Summary

This document outlines the implementation plan for a novel character morphing system based on volumetric mould primitives and signed distance fields (SDF). The system inverts traditional mesh deformation by defining character regions as negative space "moulds" that carve into a volume, with the final character mesh extracted as a "latex coating" over the resulting form.

**Key Innovation**: Instead of manipulating vertices directly, users arrange volumetric mould primitives in 3D space. A voxel grid samples the combined influence of these moulds, and marching cubes (later dual contouring) extracts a smooth surface mesh.

**Primary Use Case**: Creating custom base meshes for export to other tools (Blender, game engines). Users adjust morphs to define proportions, then export the result as a static GLB file for further detailing, texturing, and rigging.

## Architectural Overview

### Four-Layer Architecture

```
┌─────────────────────────────────────────┐
│  Skeleton Layer                         │
│  - Joint hierarchy (root → pelvis →    │
│    spine → shoulders → arms...)         │
│  - Positions moulds in 3D space         │
│  - Provides "construction armature"     │
│  - Debug visualization (toggle-able)    │
└──────────────┬──────────────────────────┘
               │ Moulds attached to joints...
┌──────────────▼──────────────────────────┐
│  Mould Primitives Layer                 │
│  - Capsules, spheres, rounded boxes     │
│  - Low-poly proxy meshes                │
│  - Transform relative to parent joint   │
│  - Soft constraints (overlap, distance) │
│  - Per-mould voxel resolution settings  │
└──────────────┬──────────────────────────┘
               │ Define distances in...
┌──────────────▼──────────────────────────┐
│  Voxel Sampling Layer                   │
│  - 3D grid of signed distance values    │
│  - Adaptive resolution per region       │
│  - Gradient/normal information          │
│  - Spatial partitioning for updates     │
└──────────────┬──────────────────────────┘
               │ Surface extraction via...
┌──────────────▼──────────────────────────┐
│  Surface Mesh Layer                     │
│  - Marching cubes (initial)             │
│  - Dual contouring (tangent-aware)      │
│  - BufferGeometry output                │
│  - Three.js rendering → GLB export      │
└─────────────────────────────────────────┘
```

### Flow Diagram

```
User adjusts slider
    ↓
Transform mould (scale/position/rotate)
    ↓
Recalculate voxels in affected region only
    ↓
Extract surface mesh from updated voxels
    ↓
Update Three.js BufferGeometry
    ↓
Render updated character
```

## Technology Stack

### Migration: Babylon.js → Three.js

**Rationale**:
- Developer velocity (3x faster implementation with Three.js expertise)
- Better WebGPU integration path for future GPU compute optimization
- Richer ecosystem for voxel/SDF work (drei, PMNDRS, three-mesh-bvh)
- Desktop-only target (no browser compatibility concerns)

**Migration Cost**: ~2 hours (scene setup, camera, controls, mesh loading)

### Core Dependencies

```json
{
  "three": "^0.160.0",          // 3D rendering
  "three-stdlib": "^2.28.0"     // Useful utilities
}
```

### Optional (Future Optimization)
- `@webgpu/types` - GPU compute shaders
- `three-mesh-bvh` - BVH acceleration for ray-mould intersections

## Implementation Phases

### Phase 1: Proof of Concept (Step 1)
**Goal**: Validate the core mechanic with a single mould

**Deliverable**: Single sphere mould that deforms a surface in real-time

**Components**:
1. **VoxelGrid class** (24³ or 32³ resolution)
   - Stores signed distance values (Float32Array)
   - Stores gradient vectors for dual contouring (Float32Array, 3× size)
   - Evaluates SDF at each voxel position
   - Computes gradients via finite differences

2. **SDFPrimitives module**
   - `sphereSDF(point, center, radius)` - Returns distance to sphere
   - `capsuleSDF(point, start, end, radius)` - Returns distance to capsule
   - `smoothMin(a, b, k)` - Smooth blending function (polynomial version)

3. **MarchingCubes class**
   - Walks voxel grid
   - Generates triangles at zero-crossings
   - Outputs vertices + indices arrays
   - (Dual contouring in Phase 3 will use gradients)

4. **Simple UI Integration**
   - One slider: "Mould Size"
   - Scales the mould
   - Real-time surface updates

**Success Criteria**: Drag slider → surface visibly deforms around mould

**Technical Notes**:
- Start with uniform 32³ grid (no adaptive resolution yet)
- Use simple `Math.min()` for mould combination (sharp boundaries)
- Gradients computed but not used until Phase 3 (dual contouring)
- No UVs yet (solid color shader)

**File Structure**:
```
app/src/
  views/Humans/
    morphing/
      voxel-grid.ts         // VoxelGrid class
      sdf-primitives.ts     // Distance functions
      marching-cubes.ts     // Surface extraction
      types.ts              // Shared types
      mould-system.test.ts  // Unit tests
```

**Timeline**: 1-2 sessions (4-8 hours)

---

### Phase 2: Multiple Moulds & Skeleton (Step 2)
**Goal**: Prove emergent form from multiple mould interactions + introduce skeleton system

**Deliverable**: 6-8 sphere moulds attached to a simple skeleton, generating a smooth sphere surface

**New Components**:
1. **Skeleton System**
   - Joint hierarchy (parent-child relationships)
   - World-space transform calculation
   - Debug visualization (joints as spheres, bones as lines)

2. **MouldManager class**
   - Tracks multiple moulds
   - Combines SDF contributions with blend mode:
     - `'sharp'`: `Math.min()` for hard boundaries
     - `'smooth'`: `smoothMinPoly()` for organic blending
   - Handles mould transforms relative to parent joints

3. **Smooth Blending Implementation**
   - Polynomial smooth-min function (cheaper than exponential)
   - Blend parameter `k` (default: 0.1, adjustable per mould)
   - Visual comparison: sharp vs smooth blending

4. **Blend Zone Logic**
   - When moulds don't touch, surface interpolates smoothly
   - Visual test: multiple moulds → emergent sphere

**Success Criteria**: Multiple moulds attached to skeleton produce recognizable emergent shape with smooth, organic blending

**Technical Notes**:
- Use `smoothMinPoly()` for anatomical regions (shoulders, neck)
- Keep `Math.min()` available for mechanical/hard-edge features
- Still uniform 32³ grid (no adaptive resolution)

**Timeline**: 1-2 sessions (4-6 hours)

---

### Phase 3: Tangent-Aware Surface Quality (Step 3)
**Goal**: Improve surface smoothness using gradient information

**Deliverable**: Smoother output at lower voxel resolution

**Components**:
1. **Dual Contouring Implementation**
   - Replace marching cubes with dual contouring
   - Use voxel gradients (computed in Phase 1) for vertex placement
   - Hermite data: surface normals at edge crossings
   - Produces smooth curves without extra voxels
   - Handles sharp features (jawline, nose bridge) better than marching cubes

2. **QEF Solver** (Quadratic Error Function)
   - Find optimal vertex position within each voxel cell
   - Minimize distance to tangent planes at edge crossings
   - Produces feature-preserving surface

3. **Optional: Catmull-Clark Subdivision**
   - One pass of subdivision surface smoothing
   - Applied to dual contouring output for extra polish
   - Only if needed for ultra-smooth results

**Quality Improvement**: 8× fewer voxels for equivalent smoothness

**Technical Notes**:
- Dual contouring requires gradient data (already stored from Phase 1)
- More complex than marching cubes but worth it for quality
- Sharp features preserved (e.g., edges, corners)

**Timeline**: 1 session (3-5 hours)

---

### Phase 4: Constraints & Adaptive Resolution (Step 4)
**Goal**: Validate mould connections + per-mould voxel resolution (if performance requires)

**Deliverable**: Constraint solver ensures moulds stay connected; optionally add adaptive resolution

**Components**:
1. **Soft Constraint Solver**
   - Overlap constraints (moulds must touch by minimum amount)
   - Distance constraints (maintain spacing between moulds)
   - Gentle corrections (stiffness parameter 0.0-1.0)
   - Visual feedback (green = healthy, yellow = stretching, red = broken)

2. **Adaptive Resolution (OPTIONAL - assess need first)**
   - Decision point: Test Phase 3 performance at uniform 48³ or 64³
   - If performance is acceptable → skip adaptive resolution
   - If too slow → implement one of these approaches:

   **Option A: Overlapping Grids (Simpler)**
   - High-res and low-res grids overlap by 2-3 voxels
   - Blend distance values in overlap zone
   - Extract surface once from combined field
   - Easier than Transvoxel, no stitching artifacts

   **Option B: Transvoxel Algorithm (Proper solution)**
   - Seamless transitions between resolution levels
   - Complex but well-documented (transvoxel.org)
   - Use if Option A shows visible artifacts

3. **Region-Based Updates**
   - Only recalculate affected mould's voxel region
   - Cache unchanged regions

**Performance Win**: 5× fewer voxels (if adaptive resolution implemented)

**Technical Notes**:
- **START WITH UNIFORM RESOLUTION** - only add adaptive if performance demands it
- Gemini flagged stitching as hardest part - defer until proven necessary
- GPU optimization (Phase 8) might make adaptive resolution unnecessary

**Timeline**: 2-3 sessions (6-8 hours)

---

### Phase 5: Body Region Moulds (Step 5)
**Goal**: Implement anatomical mould library for human body

**Deliverable**: Working character with ~15-20 body region moulds (head, neck, shoulders, chest, arms, hands, hips, legs, feet)

**Components**:
1. **Mould Library**
   - Define standard human moulds (JSON format)
   - Low-poly proxy meshes (100-500 triangles each)
   - Default positions, scales, voxel resolutions

2. **Morph System Integration**
   - Hook into existing slider system in [Humans.tsx](../app/src/views/Humans/Humans.tsx)
   - Replace `generate_base_mesh` Tauri command with client-side morphing
   - Debounced updates (500ms)

3. **UV Mapping System**
   - **Phase 5a: Triplanar Mapping** (Initial approach)
     - No explicit UVs needed
     - Project textures from XYZ axes
     - Blend based on surface normal
     - Good enough for solid colors and simple textures

   - **Phase 5b: Mould-Based UV Projection** (If proper UVs needed)
     - Each mould defines UV space (cylindrical/spherical)
     - Vertex gets UVs from closest/most-influential mould
     - Seamless across overlapping mould boundaries

4. **Rigging for Export**
   - Automatic bone weight calculation
   - Inverse distance weighting from moulds to vertices
   - Top 4 influences per vertex (GLB standard)
   - Normalize weights to sum to 1.0
   - Export includes skeleton + weights

**Example Mould Definition**:
```typescript
{
  id: "shoulder_left",
  type: "capsule",
  position: [-0.35, 1.4, 0],
  rotation: [0, 0, 0.2],
  scale: [0.15, 0.2, 0.15],
  voxelResolution: 32,
  category: "upper_body"
}
```

**Timeline**: 2-3 sessions (8-12 hours)

---

### Phase 6: Basic Sculpting System (Step 6)
**Goal**: Add non-destructive sculpting capability via detail moulds

**Deliverable**: Working sculpt mode with basic brushes and muscle stamps

**Components**:
1. **Detail Mould Layer**
   - Separate high-resolution voxel grid (64³-128³) for sculpt details
   - Composites additively on top of base form (32³)
   - Bake option: merge detail into base or keep non-destructive

2. **Basic Sculpt Brushes**
   - **Add Brush**: Places positive moulds (creates bulges/muscles)
   - **Subtract Brush**: Places negative moulds (creates indents/wrinkles)
   - **Smooth Brush**: Averages nearby mould influences
   - Brush parameters: size, intensity, falloff

3. **Muscle Stamp Library**
   - Pre-made anatomical stamps (8-12 major muscles)
   - Click-to-place on surface (raycast positioning)
   - Auto-orient to surface normal
   - Intensity slider: 0% (invisible) → 100% (prominent)
   - Stamps: deltoid, bicep, tricep, pectoralis, abs, quadriceps, gastrocnemius, trapezius

4. **Symmetry Mode**
   - Toggle X-axis symmetry
   - Place mould on left → automatically mirrors to right
   - Essential for anatomical consistency

5. **Sculpt UI Controls**
   - Mode selector: Base Edit / Sculpt Mode
   - Brush selector palette
   - Brush size/intensity sliders
   - Symmetry toggle
   - Undo/redo for mould placement

**Success Criteria**:
- Place muscle stamp on shoulder → visible deltoid definition
- Paint with add brush → creates smooth bulge
- Subtract brush → creates natural-looking wrinkle
- Symmetry mode → both sides update simultaneously

**Timeline**: 3-4 sessions (10-16 hours)

---

### Phase 7: Advanced Sculpting (Step 7)
**Goal**: Optimize sculpting performance and add advanced features

**Deliverable**: Fast, high-resolution sculpting with professional features

**Components**:
1. **Adaptive Octree Subdivision**
   - Only allocate high-res voxels where detail exists
   - Most of body stays 32³ (base form)
   - Sculpted regions go 128³ or 256³ (detail)
   - Sparse storage (only non-empty voxels)

2. **Mould Clustering System**
   - Group nearby small moulds (from brush strokes) into clusters
   - Store as point cloud + influence values
   - Spatial hash grid for efficient evaluation
   - Dramatically improves performance with thousands of moulds

3. **Layer System**
   - Multiple sculpt layers (like Photoshop layers)
   - Each layer is independent detail mould collection
   - Toggle layer visibility
   - Merge/flatten layers
   - Use cases: "muscle layer", "vein layer", "wrinkle layer"

4. **Custom Stamp Creation**
   - User can save selection of moulds as custom stamp
   - Share custom stamps (JSON export/import)
   - Community stamp library (future marketplace)

5. **Advanced Brushes**
   - **Grab Brush**: Move existing moulds (like clay)
   - **Pinch Brush**: Pull surface toward brush center
   - **Inflate Brush**: Uniform expansion
   - **Crease Brush**: Sharp indents (tendons, bones)

**Performance Targets** (CPU):
- 128³ detail grid: <50ms update (acceptable for sculpting)
- Mould clustering: Support 10,000+ detail moulds
- Octree: 5× memory reduction, 3× speed improvement

**Timeline**: 3-4 sessions (10-14 hours)

---

### Phase 8: GPU Optimization (Step 8)
**Goal**: Move SDF evaluation to GPU compute shaders for real-time high-res sculpting

**Deliverable**: 60fps sculpting at 128³ resolution, 30fps at 256³

**Components**:
1. **WebGPU Compute Shaders**
   - Parallel voxel evaluation on GPU
   - Write results to buffer
   - Read back for marching cubes/dual contouring
   - Async compute (don't block render thread)

2. **GPU Mould Evaluation**
   - Upload mould data to GPU buffers
   - Evaluate all voxels in parallel
   - Spatial partitioning on GPU (compute only affected regions)

3. **Incremental Surface Extraction**
   - Only re-extract changed regions
   - Stitch boundaries seamlessly
   - Keep unchanged mesh cached

**Performance Targets** (GPU):
- 64³ voxel grid: <5ms (200fps capable)
- 128³ voxel grid: <16ms (60fps real-time sculpting)
- 256³ voxel grid: <33ms (30fps high-detail sculpting)

**Timeline**: 2-4 sessions (8-16 hours, requires WebGPU learning)

---

## File Structure (Final)

```
app/src/
  views/Humans/
    Humans.tsx                    // Main view (updated to use mould system)
    types.ts                      // Human type definitions
    components/
      3DViewport.tsx              // Updated for Three.js
      ThreeScene.tsx              // New: Three.js scene (replaces BabylonScene)
      HeightForAgeChart.tsx       // Unchanged
      WeightForAgeChart.tsx       // Unchanged
    morphing/
      types.ts                    // Mould, VoxelGrid, SDF types
      voxel-grid.ts               // VoxelGrid class
      sdf-primitives.ts           // Capsule, sphere, box distance functions
      sdf-mesh.ts                 // Mesh SDF (for custom mould shapes)
      marching-cubes.ts           // Initial surface extraction
      dual-contouring.ts          // Improved surface extraction
      mould-manager.ts            // Manages mould collection
      morph-controller.ts         // Hooks into UI sliders
      skeleton.ts                 // Joint hierarchy system
      constraint-solver.ts        // Soft constraints for mould connections
      mould-library.json          // Standard body region moulds
      sculpting/
        sculpt-controller.ts      // Sculpt mode state management
        sculpt-brush.ts           // Brush tool implementations
        detail-layer.ts           // High-res detail mould layer
        stamp-tool.ts             // Muscle stamp placement
        stamp-library.json        // Pre-made muscle/detail stamps
        symmetry.ts               // X-axis symmetry mirroring
        mould-clustering.ts       // Cluster small moulds for performance
        layer-system.ts           // Multi-layer sculpting
      gpu/
        compute-sdf.wgsl          // WebGPU compute shader
        gpu-evaluator.ts          // GPU compute wrapper
      utils/
        octree.ts                 // Spatial partitioning
        mesh-stitching.ts         // Blend different resolution regions
        sdf-compositor.ts         // Composite base + detail layers
      tests/
        voxel-grid.test.ts
        sdf-primitives.test.ts
        marching-cubes.test.ts
        mould-manager.test.ts
        sculpt-brush.test.ts
        symmetry.test.ts
```

---

## Integration with Existing System

### Current Flow (to be replaced)
```
User adjusts slider
  ↓
Update Human state (createSignal)
  ↓
Debounced invoke("generate_base_mesh") - Tauri backend
  ↓
Rust generates mesh
  ↓
Return GLB data
  ↓
Load into Babylon scene
```

### New Flow (client-side morphing)
```
User adjusts slider
  ↓
Update Human state (createSignal)
  ↓
Debounced MorphController.updateMorph(name, value)
  ↓
Transform relevant moulds
  ↓
Recalculate affected voxel regions
  ↓
Extract surface mesh
  ↓
Update Three.js BufferGeometry (no network call!)
```

### Modified Components

**[Humans.tsx](../app/src/views/Humans/Humans.tsx)**:
- Replace Babylon imports with Three.js
- Replace `invoke("generate_base_mesh")` with `morphController.applyMorphs(human)`
- Keep all slider/UI logic unchanged

**[3DViewport.tsx](../app/src/views/Humans/components/3DViewport.tsx)**:
- Swap BabylonScene component for ThreeScene component
- Pass `morphController` to ThreeScene

**New: ThreeScene.tsx**:
- Three.js scene setup (camera, lights, ground)
- Manages character mesh (BufferGeometry)
- Exposes `updateCharacterMesh(vertices, indices)` method

---

## Testing Strategy

### Unit Tests (Critical)
1. **SDF Primitives** - Test distance functions for accuracy
   ```typescript
   expect(sphereSDF([1, 0, 0], [0, 0, 0], 1)).toBeCloseTo(0)
   expect(sphereSDF([2, 0, 0], [0, 0, 0], 1)).toBeCloseTo(1)
   ```

2. **Voxel Grid** - Test evaluation and gradient calculation
   ```typescript
   const grid = new VoxelGrid(32)
   grid.evaluate(moulds)
   expect(grid.getValue(16, 16, 16)).toBeLessThan(0) // Inside
   ```

3. **Marching Cubes** - Test surface extraction produces valid geometry
   ```typescript
   const {vertices, indices} = marchingCubes(grid)
   expect(vertices.length % 3).toBe(0)
   expect(indices.length % 3).toBe(0)
   ```

### Visual Tests (Manual)
- Step 1: Single mould deformation feels responsive
- Step 2: Multiple moulds blend smoothly
- Step 3: Surface quality improves with dual contouring
- Step 4: No visible seams between different resolution regions

### Performance Tests (Benchmarks)
```typescript
benchmark('32³ voxel evaluation', () => {
  grid.evaluate(moulds)
}, { target: '<5ms' })

benchmark('marching cubes extraction', () => {
  marchingCubes(grid)
}, { target: '<10ms' })
```

---

## Performance Targets

### Phase 1-5: Base Form (CPU)
| Operation | Resolution | Target | Acceptable |
|-----------|-----------|--------|------------|
| Single region update | 32³ | <5ms | <10ms |
| Full body update | 20 regions @ 32³ avg | <50ms | <100ms |
| Marching cubes | 32³ | <10ms | <20ms |

### Phase 6-7: Sculpting (CPU)
| Operation | Resolution | Target | Acceptable |
|-----------|-----------|--------|------------|
| Base layer update | 32³ | <10ms | <20ms |
| Detail layer update | 64³ local | <30ms | <50ms |
| Detail layer update | 128³ local | <80ms | <150ms |
| Brush stroke (100 moulds) | - | <50ms | <100ms |
| Stamp placement | - | <30ms | <50ms |

### Phase 8: GPU Optimization
| Operation | Resolution | Target | Acceptable |
|-----------|-----------|--------|------------|
| Full body update | 20 regions @ 64³ avg | <16ms | <33ms |
| Detail sculpting | 128³ local | <16ms (60fps) | <33ms (30fps) |
| Detail sculpting | 256³ local | <33ms (30fps) | <50ms (20fps) |
| SDF evaluation | 64³ | <2ms | <5ms |

---

## Risk Mitigation

### Risk 1: Performance - CPU too slow for real-time
**Mitigation**:
- Start with small voxel grids (32³)
- Optimize region-based updates first
- GPU compute shader path planned for Phase 7

### Risk 2: Surface Quality - Marching cubes too blocky
**Mitigation**:
- Phase 3 introduces dual contouring (tangent-aware)
- Optional Catmull-Clark subdivision
- Can increase voxel resolution for critical regions (head)

### Risk 3: Complex Interaction - Multiple moulds produce artifacts
**Mitigation**:
- Test blend zones thoroughly in Phase 2
- Min-distance SDF combination is well-understood
- Visual debug mode to inspect voxel values

### Risk 4: Integration Complexity - Hard to replace Babylon
**Mitigation**:
- Three.js migration is straightforward (scene setup is simple)
- Existing UI/slider code unchanged
- Incremental integration (can test morphing in isolation)

---

## Design Decisions

### Why SDF over mesh deformation?
- **Topology flexibility**: Can naturally handle disconnection/blending
- **Intuitive control**: "Place volumes" is more intuitive than "paint weights"
- **Region isolation**: No influence falloff - clean boundaries
- **Extensibility**: Stamps and user content are trivial to add

### Why voxels over direct ray marching?
- **Explicit mesh output**: Needed for export, rigging, other tools
- **Caching**: Voxel grid can be cached between frames
- **Partial updates**: Only recalculate affected regions

### Why Three.js over Babylon.js?
- **Developer velocity**: 3× faster implementation with existing expertise
- **Future-proof**: Better WebGPU ecosystem
- **Migration cost**: Minimal (2 hours of scene setup)

### Why client-side over Rust backend?
- **Instant feedback**: No IPC/network latency
- **Iteration speed**: TypeScript hot reload vs Rust rebuild
- **Deployment**: No Blender/mesh generation dependencies

### Why mould-based sculpting over traditional vertex sculpting?
- **Non-destructive**: Remove/edit any detail mould at any time
- **Proportions preserved**: Change height/weight after sculpting - detail follows
- **Symmetry guaranteed**: Mirror moulds across axis automatically
- **Clean topology**: No vertex explosion, always exportable
- **Stamping workflow**: Professional results faster (muscle library)
- **Compositing**: Base + detail layers = flexible workflow

---

## Sculpting Workflow Vision

### **Complete Creation Pipeline**

```
1. BASE FORM (Phases 1-5)
   ├─ Adjust sliders: height, weight, age, gender
   ├─ Skeleton positions moulds automatically
   └─ Output: Smooth, proportional mannequin (32³ resolution)

2. SCULPT MODE (Phase 6)
   ├─ Switch to Sculpt Mode
   ├─ Add muscles via stamps:
   │  ├─ Click shoulder → deltoid stamp appears
   │  ├─ Adjust intensity slider (0-100%)
   │  └─ Stamp auto-orients to surface
   ├─ Paint details with brushes:
   │  ├─ Add brush: veins, tendons, muscle striations
   │  ├─ Subtract brush: wrinkles, scars, dimples
   │  └─ Smooth brush: blend transitions
   └─ Output: Detailed character with 64³-128³ detail regions

3. REFINEMENT (Phase 7)
   ├─ Multi-layer workflow:
   │  ├─ Layer 1: Major muscles
   │  ├─ Layer 2: Surface veins
   │  ├─ Layer 3: Skin details (pores, wrinkles)
   │  └─ Toggle layers on/off, merge when satisfied
   ├─ Custom stamps:
   │  ├─ Save selection of moulds as reusable stamp
   │  └─ Build personal library
   └─ Advanced brushes: grab, pinch, crease, inflate

4. EXPORT
   ├─ Bake detail → single mesh (optional)
   ├─ Export as GLB
   └─ Use in: Blender, Unity, Unreal, etc.
```

### **Example Use Cases**

**Game Character Artist**:
- Base form (2 min): Set proportions via sliders
- Sculpt (30 min): Add muscles, facial features
- Export → texture in Substance → import to Unity

**Film/VFX Character**:
- Base form (5 min): Detailed proportions
- Sculpt (2 hours): High-detail anatomy, wrinkles, veins
- Layers: muscle layer, vein layer, skin layer
- Export → retopo in Maya → texture/shade/render

**3D Printing Miniature**:
- Base form (5 min): Heroic proportions
- Sculpt (1 hour): Exaggerated muscles, details
- 256³ resolution: Print-ready detail level
- Export STL → slice → print

**Character Turnaround Sheets**:
- Create base mesh with perfect symmetry
- Add light muscle definition (stamps only)
- Export front/side/back views
- Reference for 2D concept art

---

## Future Extensions

### Community Content System
- **User-submitted moulds**: Standard JSON format for sharing
- **Stamp marketplace**: Users contribute scar/muscle/detail stamps
- **Mould packs**: Fantasy races, creature features, alien biology

### Advanced Features
- **Mould hierarchies**: Parent-child relationships (hand inherits arm position)
- **Procedural moulds**: Noise-driven surfaces for organic detail
- **Physics simulation**: Soft-body deformation on top of mould base
- **Animation**: Mould transforms as animation keyframes

### Tool Ecosystem
- **Mould editor**: Visual tool for creating custom moulds
- **Blender plugin**: Export Blender meshes as BuildHuman moulds
- **Region templates**: Pre-configured mould arrangements (athletic, heavy, lean)

---

## Dependencies & Setup

### New NPM Dependencies
```bash
cd app
npm install three@^0.160.0
npm install --save-dev @types/three
```

### Development Workflow
```bash
# Terminal 1: Tauri dev server
cd app
npm run tauri dev

# Terminal 2: Run tests in watch mode
cd app
npm test
```

### Test Files to Create
```bash
app/src/views/Humans/morphing/tests/
  sdf-primitives.test.ts
  voxel-grid.test.ts
  marching-cubes.test.ts
  mould-manager.test.ts
```

---

## Success Metrics

### Phase 1 Success
- [ ] Single mould deforms surface in <10ms
- [ ] Slider feels responsive (no lag)
- [ ] Surface mesh updates correctly

### Phase 2 Success
- [ ] 8 moulds produce smooth sphere
- [ ] Blend zones are smooth (no gaps/artifacts)
- [ ] Multiple mould updates work correctly

### Phase 3 Success
- [ ] Dual contouring produces smoother results than marching cubes
- [ ] 32³ voxel grid quality matches 64³ marching cubes quality
- [ ] Visual improvement is obvious

### Phase 4 Success
- [ ] Different regions use different voxel resolutions
- [ ] No visible seams at boundaries
- [ ] 5× performance improvement over uniform grid

### Phase 5 Success
- [ ] Full humanoid character with 15-20 body regions
- [ ] All existing sliders (height, weight, gender) work
- [ ] Character looks recognizably human

### Phase 6 Success (Basic Sculpting)
- [ ] Place muscle stamp on shoulder → visible deltoid appears
- [ ] Add brush creates smooth bulges
- [ ] Subtract brush creates natural wrinkles
- [ ] Symmetry mode mirrors edits across X-axis
- [ ] Sculpt detail composites correctly on base form

### Phase 7 Success (Advanced Sculpting)
- [ ] Octree allows 256³ detail in sculpted regions
- [ ] Can sculpt with 1000+ detail moulds without lag
- [ ] Layer system works (toggle visibility, merge layers)
- [ ] Custom stamps save/load correctly
- [ ] Advanced brushes (grab, pinch, crease) feel responsive

### Phase 8 Success (GPU Optimization)
- [ ] GPU compute runs at 60fps for 128³ sculpting
- [ ] 256³ detail sculpting runs at 30fps
- [ ] System works on all target platforms (macOS, Windows, Linux)
- [ ] GPU fallback to CPU if WebGPU unavailable

---

## Questions & Open Issues

### Architecture Questions
1. **Voxel grid coordinate system**: World-space or local to each mould?
   - **Proposed**: Local to mould, transformed to world-space during evaluation

2. **Blend function**: Min-distance or smooth-min for softer blending?
   - **Proposed**: Start with min-distance (sharper), add smooth-min option later

3. **Mesh topology**: Dynamic or fixed vertex count?
   - **Proposed**: Dynamic (marching cubes output varies), handle in Three.js

### UI/UX Questions
1. **Morph slider mapping**: How do "Height" and "Weight" map to mould transforms?
   - **Proposed**: Height → uniform scale of torso/leg moulds; Weight → non-uniform scale (X/Z axis)

2. **Debug visualization**: Show moulds as wireframes in scene?
   - **Proposed**: Yes, toggle-able debug mode showing moulds + voxel boundaries

3. **Error handling**: What happens if voxel evaluation fails or produces degenerate mesh?
   - **Proposed**: Fallback to previous valid mesh, log error

### Performance Questions
1. **Voxel resolution**: What's the minimum acceptable for visual quality?
   - **Proposed**: 32³ for most regions, 64³ for head/hands

2. **Update frequency**: Should we throttle updates during rapid slider changes?
   - **Proposed**: 500ms debounce (existing pattern in codebase)

---

## References & Inspiration

### Academic
- **Marching Cubes**: Lorensen & Cline (1987) - Original paper
- **Dual Contouring**: Ju et al. (2002) - Hermite data approach
- **SDF Modeling**: Inigo Quilez - Distance function database

### Software
- **ZBrush DynaMesh**: Topology-independent sculpting
- **Houdini VDB**: Volume-based modeling workflows
- **MakeHuman**: Parametric character system (comparison point)

### Open Source
- **three-mesh-bvh**: BVH acceleration structures
- **marching-cubes**: Reference implementation by mikolalysenko
- **isosurface**: Multiple isosurface extraction algorithms

---

## Revision History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2026-01-08 | 0.1 | Initial draft - comprehensive implementation plan | Claude |

---

## Next Steps

### Immediate Actions (This Session)
1. [x] Create plan document
2. [ ] Get approval on approach from Adam
3. [ ] Decide: Migrate Babylon to Three.js now, or proof-of-concept first?
4. [ ] Create initial file structure
5. [ ] Begin Phase 1 implementation

### Phase 1 Kickoff
1. Create `morphing/` folder structure
2. Implement `sdf-primitives.ts` with sphere/capsule functions
3. Write tests for SDF primitives
4. Implement `VoxelGrid` class
5. Implement basic marching cubes
6. Create minimal UI with one slider
7. Integrate with existing Humans view

**Estimated Time to Working Demo**: 4-8 hours

---

*This plan is a living document and will be updated as implementation progresses and new insights emerge.*
