// Types for mould-based morphing system

export type Vec3 = [number, number, number];

// Quaternion [x, y, z, w] - w is the scalar component
export type Quat = [number, number, number, number];

// 4x4 transformation matrix (column-major order)
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export type BlendMode = "smooth" | "union" | "subtract";

export type MouldShape = "sphere" | "capsule" | "profiled-capsule";

export type Mould = {
  id: string;
  shape: MouldShape;
  center: Vec3; // LOCAL offset from parent bone (not world space)
  radius: number;
  blendRadius?: number; // k parameter for smoothMinPoly (default 0.1)
  parentJointId?: string; // For skeleton attachment
  // Capsule-specific properties
  endPoint?: Vec3; // Second endpoint in LOCAL space
  // Profiled capsule-specific properties
  // 2D array: [segment_along_bone][control_point_around_ring]
  // Each segment has N radial control points defining the perimeter shape
  radialProfiles?: number[][];
};

export type Joint = {
  id: string;
  localOffset: Vec3; // Rest pose position relative to parent
  localRotation: Quat; // Rest pose rotation relative to parent (identity by default)
  parentId?: string; // null = root joint
  children: string[]; // Child joint IDs
};
