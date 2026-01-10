// Types for mould-based morphing system

export type Vec3 = [number, number, number];

export type BlendMode = "smooth" | "union" | "subtract";

export type MouldShape = "sphere" | "capsule";

export type Mould = {
  id: string;
  shape: MouldShape;
  center: Vec3;
  radius: number;
  blendRadius?: number; // k parameter for smoothMinPoly (default 0.1)
  parentJointId?: string; // For skeleton attachment
  // Capsule-specific properties
  endPoint?: Vec3; // Second endpoint for capsule (first is center)
};

export type Joint = {
  id: string;
  position: Vec3;
  parentId?: string; // null = root joint
  children: string[]; // Child joint IDs
};
