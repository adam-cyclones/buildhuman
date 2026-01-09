// Types for mould-based morphing system

export type Vec3 = [number, number, number];

export type BlendMode = "smooth" | "union" | "subtract";

export type Mould = {
  id: string;
  center: Vec3;
  radius: number;
  blendRadius?: number; // k parameter for smoothMinPoly (default 0.1)
  parentJointId?: string; // For skeleton attachment
};

export type Joint = {
  id: string;
  position: Vec3;
  parentId?: string; // null = root joint
  children: string[]; // Child joint IDs
};
