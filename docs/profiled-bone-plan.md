# Profiled Bone Primitive Plan (No Mesh Scan Yet)

## Goal
Add a new “profiled bone” SDF primitive that approximates realistic limb shapes (e.g., calf bias) without mesh scanning.

## Steps
1) **Data Model**
   - Add a new mould type, e.g. `ProfiledCapsule`.
   - Fields: `parent_joint_id`, `start`, `end`, `radius_profile[]`, `offset_profile[]`, `twist?`.
   - Profiles are sampled along the bone (t = 0..1).
   - Store in shared types + IPC payload.

2) **SDF Implementation**
   - Evaluate by projecting point onto bone axis to get `t`.
   - Sample `radius` and `offset` from profiles (linear interpolation).
   - Construct a local frame to apply lateral offset (for calf bias).
   - Compute distance to the resulting profile (like capsule SDF but with variable radius + offset).
   - Blend with existing moulds using current smooth-min.

3) **Default Profiles (Best Guess)**
   - For legs, set a profile with thinner shin and fuller calf:
     - `radius_profile`: [0.12, 0.10, 0.08, 0.09, 0.11, 0.12] for t=0..1.
     - `offset_profile`: [0.00, 0.01, 0.02, 0.03, 0.02, 0.00] backward bias.
   - Apply to left/right shin or thigh to validate look.

4) **Wire Into Scene**
   - Replace or augment current leg capsules in `app/src/views/Humans/components/VoxelMorphScene.tsx` with profiled capsules.
   - Keep old capsules available for A/B testing.

5) **Validation**
   - Generate snapshot after 10s (existing snapshot pipeline).
   - Compare silhouette vs current capsules.

## Future (Not Now)
- Base mesh scan to derive profiles.
- Mesh proxy SDFs for head/hands/feet.
- Group-aware blending to prevent limb merging.
