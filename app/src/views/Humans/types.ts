/**
 * Types for 3D Editor view
 */

export type Human = {
  id: number;
  name: string;
  gender: string;
  ageGroup: string;
  height: number;
  weight: number;
};

export type JointData = {
  id: string;
  parentId?: string;
  children: string[];
};

export type MouldData = {
  id: string;
  shape: "sphere" | "capsule";
  parentJointId?: string;
};
