import { Skeleton } from "./skeleton";
import { MouldManager } from "./mould-manager";
import { identityQuat } from "./transform";

export type HumanoidData = {
  skeleton: Skeleton;
  mouldManager: MouldManager;
  joints: Array<{ id: string; parentId?: string; children: string[] }>;
  moulds: Array<{ id: string; shape: "sphere" | "capsule" | "profiled-capsule"; parentJointId?: string }>;
};

export const initializeDefaultHumanoid = (): HumanoidData => {
  // Create skeleton with joints for a complete humanoid
  // Joints use localOffset (parent-relative) and localRotation
  const skeleton = new Skeleton();
  const identityRot = identityQuat();

  // Root joint (pelvis) - world position [0,0,0]
  skeleton.addJoint({
    id: "pelvis",
    localOffset: [0, 0, 0],
    localRotation: identityRot,
    children: ["spine-lower", "hip-left", "hip-right"],
  });

  // Spine chain
  skeleton.addJoint({
    id: "spine-lower",
    localOffset: [0, 0.15, 0],
    localRotation: identityRot,
    parentId: "pelvis",
    children: ["spine-upper"],
  });

  skeleton.addJoint({
    id: "spine-upper",
    localOffset: [0, 0.15, 0],
    localRotation: identityRot,
    parentId: "spine-lower",
    children: ["chest"],
  });

  skeleton.addJoint({
    id: "chest",
    localOffset: [0, 0.15, 0],
    localRotation: identityRot,
    parentId: "spine-upper",
    children: ["neck", "shoulder-left", "shoulder-right"],
  });

  // Neck and head
  skeleton.addJoint({
    id: "neck",
    localOffset: [0, 0.15, 0],
    localRotation: identityRot,
    parentId: "chest",
    children: ["head"],
  });

  skeleton.addJoint({
    id: "head",
    localOffset: [0, 0.1, 0],
    localRotation: identityRot,
    parentId: "neck",
    children: [],
  });

  // Left arm chain
  skeleton.addJoint({
    id: "shoulder-left",
    localOffset: [-0.15, 0.05, 0],
    localRotation: identityRot,
    parentId: "chest",
    children: ["elbow-left"],
  });

  skeleton.addJoint({
    id: "elbow-left",
    localOffset: [-0.25, 0, 0],
    localRotation: identityRot,
    parentId: "shoulder-left",
    children: ["wrist-left"],
  });

  skeleton.addJoint({
    id: "wrist-left",
    localOffset: [-0.2, 0, 0],
    localRotation: identityRot,
    parentId: "elbow-left",
    children: ["hand-left"],
  });

  skeleton.addJoint({
    id: "hand-left",
    localOffset: [-0.08, 0, 0],
    localRotation: identityRot,
    parentId: "wrist-left",
    children: [],
  });

  // Right arm chain
  skeleton.addJoint({
    id: "shoulder-right",
    localOffset: [0.15, 0.05, 0],
    localRotation: identityRot,
    parentId: "chest",
    children: ["elbow-right"],
  });

  skeleton.addJoint({
    id: "elbow-right",
    localOffset: [0.25, 0, 0],
    localRotation: identityRot,
    parentId: "shoulder-right",
    children: ["wrist-right"],
  });

  skeleton.addJoint({
    id: "wrist-right",
    localOffset: [0.2, 0, 0],
    localRotation: identityRot,
    parentId: "elbow-right",
    children: ["hand-right"],
  });

  skeleton.addJoint({
    id: "hand-right",
    localOffset: [0.08, 0, 0],
    localRotation: identityRot,
    parentId: "wrist-right",
    children: [],
  });

  // Left leg chain
  skeleton.addJoint({
    id: "hip-left",
    localOffset: [-0.1, 0, 0],
    localRotation: identityRot,
    parentId: "pelvis",
    children: ["knee-left"],
  });

  skeleton.addJoint({
    id: "knee-left",
    localOffset: [0, -0.4, 0],
    localRotation: identityRot,
    parentId: "hip-left",
    children: ["ankle-left"],
  });

  skeleton.addJoint({
    id: "ankle-left",
    localOffset: [0, -0.35, 0],
    localRotation: identityRot,
    parentId: "knee-left",
    children: ["foot-left"],
  });

  skeleton.addJoint({
    id: "foot-left",
    localOffset: [0, 0, 0.12],
    localRotation: identityRot,
    parentId: "ankle-left",
    children: ["toe-left"],
  });

  skeleton.addJoint({
    id: "toe-left",
    localOffset: [0, 0, 0.08],
    localRotation: identityRot,
    parentId: "foot-left",
    children: [],
  });

  // Right leg chain
  skeleton.addJoint({
    id: "hip-right",
    localOffset: [0.1, 0, 0],
    localRotation: identityRot,
    parentId: "pelvis",
    children: ["knee-right"],
  });

  skeleton.addJoint({
    id: "knee-right",
    localOffset: [0, -0.4, 0],
    localRotation: identityRot,
    parentId: "hip-right",
    children: ["ankle-right"],
  });

  skeleton.addJoint({
    id: "ankle-right",
    localOffset: [0, -0.35, 0],
    localRotation: identityRot,
    parentId: "knee-right",
    children: ["foot-right"],
  });

  skeleton.addJoint({
    id: "foot-right",
    localOffset: [0, 0, 0.12],
    localRotation: identityRot,
    parentId: "ankle-right",
    children: ["toe-right"],
  });

  skeleton.addJoint({
    id: "toe-right",
    localOffset: [0, 0, 0.08],
    localRotation: identityRot,
    parentId: "foot-right",
    children: [],
  });

  // Create mould manager
  const mouldManager = new MouldManager();

  // Create moulds structure following bone hierarchy
  // Head with profiled capsule
  mouldManager.addMould({
    id: "head",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, 0.1, 0],
    radius: 0.5 * 0.15,
    blendRadius: 0.06,
    parentJointId: "head",
    radialProfiles: [
      [0.060, 0.065, 0.080, 0.065, 0.060, 0.055, 0.045, 0.055],
      [0.068, 0.072, 0.088, 0.072, 0.068, 0.062, 0.050, 0.062],
      [0.074, 0.078, 0.092, 0.078, 0.074, 0.068, 0.054, 0.068],
      [0.076, 0.080, 0.090, 0.080, 0.076, 0.070, 0.056, 0.070],
      [0.078, 0.082, 0.088, 0.082, 0.078, 0.072, 0.058, 0.072],
      [0.074, 0.078, 0.084, 0.078, 0.074, 0.068, 0.056, 0.068],
    ],
  });

  // Neck with profiled capsule
  mouldManager.addMould({
    id: "neck",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, 0.1, 0],
    radius: 0.5 * 0.08,
    blendRadius: 0.06,
    parentJointId: "neck",
    radialProfiles: [
      [0.042, 0.044, 0.040, 0.044, 0.042, 0.046, 0.050, 0.046],
      [0.040, 0.041, 0.038, 0.041, 0.040, 0.043, 0.046, 0.043],
      [0.038, 0.039, 0.036, 0.039, 0.038, 0.040, 0.042, 0.040],
      [0.036, 0.037, 0.034, 0.037, 0.036, 0.038, 0.039, 0.038],
      [0.034, 0.035, 0.033, 0.035, 0.034, 0.036, 0.037, 0.036],
      [0.033, 0.034, 0.032, 0.034, 0.033, 0.035, 0.036, 0.035],
    ],
  });

  // Chest
  mouldManager.addMould({
    id: "chest",
    shape: "profiled-capsule",
    center: [0, -0.02, 0],
    endPoint: [0, 0.18, 0],
    radius: 0.5 * 0.18,
    blendRadius: 0.06,
    parentJointId: "chest",
    radialProfiles: [
      [0.090, 0.092, 0.095, 0.092, 0.090, 0.092, 0.096, 0.092],
      [0.100, 0.103, 0.108, 0.103, 0.100, 0.103, 0.110, 0.103],
      [0.110, 0.114, 0.120, 0.114, 0.110, 0.114, 0.122, 0.114],
      [0.106, 0.110, 0.116, 0.110, 0.106, 0.110, 0.118, 0.110],
      [0.098, 0.101, 0.106, 0.101, 0.098, 0.101, 0.108, 0.101],
    ],
  });

  // Upper spine
  mouldManager.addMould({
    id: "spine-upper",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, 0.15, 0],
    radius: 0.5 * 0.15,
    blendRadius: 0.06,
    parentJointId: "spine-upper",
    radialProfiles: [
      [0.090, 0.092, 0.095, 0.092, 0.090, 0.092, 0.096, 0.092],
      [0.088, 0.090, 0.093, 0.090, 0.088, 0.090, 0.094, 0.090],
      [0.084, 0.086, 0.089, 0.086, 0.084, 0.086, 0.090, 0.086],
      [0.080, 0.082, 0.085, 0.082, 0.080, 0.082, 0.086, 0.082],
      [0.076, 0.078, 0.081, 0.078, 0.076, 0.078, 0.082, 0.078],
    ],
  });

  // Lower spine
  mouldManager.addMould({
    id: "spine-lower",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, 0.15, 0],
    radius: 0.5 * 0.16,
    blendRadius: 0.06,
    parentJointId: "spine-lower",
    radialProfiles: [
      [0.090, 0.092, 0.095, 0.092, 0.090, 0.092, 0.096, 0.092],
      [0.084, 0.086, 0.089, 0.086, 0.084, 0.086, 0.090, 0.086],
      [0.078, 0.080, 0.083, 0.080, 0.078, 0.080, 0.084, 0.080],
      [0.074, 0.076, 0.079, 0.076, 0.074, 0.076, 0.080, 0.076],
      [0.072, 0.074, 0.077, 0.074, 0.072, 0.074, 0.078, 0.074],
    ],
  });

  // Pelvis
  mouldManager.addMould({
    id: "pelvis",
    shape: "profiled-capsule",
    center: [0, -0.04, 0],
    endPoint: [0, 0.16, 0],
    radius: 0.5 * 0.17,
    blendRadius: 0.06,
    parentJointId: "pelvis",
    radialProfiles: [
      [0.095, 0.095, 0.095, 0.095, 0.095, 0.095, 0.095, 0.095],
      [0.105, 0.105, 0.105, 0.105, 0.105, 0.105, 0.105, 0.105],
      [0.112, 0.112, 0.112, 0.112, 0.112, 0.112, 0.112, 0.112],
      [0.108, 0.108, 0.108, 0.108, 0.108, 0.108, 0.108, 0.108],
      [0.102, 0.102, 0.102, 0.102, 0.102, 0.102, 0.102, 0.102],
    ],
  });

  // Left arm - upper arm
  mouldManager.addMould({
    id: "upper-arm-left",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [-0.25, 0, 0],
    radius: 0.5 * 0.07,
    blendRadius: 0.02,
    parentJointId: "shoulder-left",
    radialProfiles: [
      [0.050, 0.052, 0.055, 0.052, 0.050, 0.052, 0.056, 0.052],
      [0.046, 0.048, 0.051, 0.048, 0.046, 0.048, 0.052, 0.048],
      [0.042, 0.044, 0.047, 0.044, 0.042, 0.044, 0.048, 0.044],
      [0.038, 0.040, 0.043, 0.040, 0.038, 0.040, 0.044, 0.040],
      [0.034, 0.035, 0.037, 0.035, 0.034, 0.035, 0.038, 0.035],
      [0.031, 0.032, 0.033, 0.032, 0.031, 0.032, 0.034, 0.032],
    ],
  });

  // Left forearm
  mouldManager.addMould({
    id: "forearm-left",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [-0.2, 0, 0],
    radius: 0.5 * 0.06,
    blendRadius: 0.06,
    parentJointId: "elbow-left",
    radialProfiles: [
      [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
      [0.032, 0.033, 0.034, 0.033, 0.031, 0.032, 0.033, 0.033],
      [0.033, 0.034, 0.035, 0.034, 0.032, 0.033, 0.034, 0.034],
      [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
      [0.026, 0.027, 0.028, 0.027, 0.025, 0.026, 0.027, 0.027],
      [0.022, 0.023, 0.024, 0.023, 0.021, 0.022, 0.023, 0.023],
    ],
  });

  // Left hand
  mouldManager.addMould({
    id: "hand-left",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [-0.10, 0, 0],
    radius: 0.5 * 0.07,
    blendRadius: 0.08,
    parentJointId: "hand-left",
    radialProfiles: [
      [0.044, 0.044, 0.044, 0.044, 0.044, 0.044, 0.044, 0.044],
      [0.050, 0.050, 0.050, 0.050, 0.050, 0.050, 0.050, 0.050],
      [0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048],
    ],
  });

  // Right arm - upper arm
  mouldManager.addMould({
    id: "upper-arm-right",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0.25, 0, 0],
    radius: 0.5 * 0.07,
    blendRadius: 0.02,
    parentJointId: "shoulder-right",
    radialProfiles: [
      [0.050, 0.052, 0.055, 0.052, 0.050, 0.052, 0.056, 0.052],
      [0.046, 0.048, 0.051, 0.048, 0.046, 0.048, 0.052, 0.048],
      [0.042, 0.044, 0.047, 0.044, 0.042, 0.044, 0.048, 0.044],
      [0.038, 0.040, 0.043, 0.040, 0.038, 0.040, 0.044, 0.040],
      [0.034, 0.035, 0.037, 0.035, 0.034, 0.035, 0.038, 0.035],
      [0.031, 0.032, 0.033, 0.032, 0.031, 0.032, 0.034, 0.032],
    ],
  });

  // Right forearm
  mouldManager.addMould({
    id: "forearm-right",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0.2, 0, 0],
    radius: 0.5 * 0.06,
    blendRadius: 0.06,
    parentJointId: "elbow-right",
    radialProfiles: [
      [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
      [0.032, 0.033, 0.034, 0.033, 0.031, 0.032, 0.033, 0.033],
      [0.033, 0.034, 0.035, 0.034, 0.032, 0.033, 0.034, 0.034],
      [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
      [0.026, 0.027, 0.028, 0.027, 0.025, 0.026, 0.027, 0.027],
      [0.022, 0.023, 0.024, 0.023, 0.021, 0.022, 0.023, 0.023],
    ],
  });

  // Right hand
  mouldManager.addMould({
    id: "hand-right",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0.10, 0, 0],
    radius: 0.5 * 0.07,
    blendRadius: 0.08,
    parentJointId: "hand-right",
    radialProfiles: [
      [0.044, 0.044, 0.044, 0.044, 0.044, 0.044, 0.044, 0.044],
      [0.050, 0.050, 0.050, 0.050, 0.050, 0.050, 0.050, 0.050],
      [0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048, 0.048],
    ],
  });

  // Left thigh
  mouldManager.addMould({
    id: "thigh-left",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, -0.4, 0],
    radius: 0.5 * 0.1,
    blendRadius: 0.06,
    parentJointId: "hip-left",
    radialProfiles: [
      [0.068, 0.070, 0.072, 0.070, 0.066, 0.068, 0.072, 0.070],
      [0.064, 0.066, 0.068, 0.066, 0.062, 0.064, 0.068, 0.066],
      [0.058, 0.060, 0.062, 0.060, 0.056, 0.058, 0.062, 0.060],
      [0.052, 0.054, 0.056, 0.054, 0.050, 0.052, 0.056, 0.054],
      [0.046, 0.048, 0.050, 0.048, 0.044, 0.046, 0.050, 0.048],
      [0.042, 0.043, 0.045, 0.043, 0.041, 0.042, 0.045, 0.043],
    ],
  });

  // Left shin
  mouldManager.addMould({
    id: "shin-left",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, -0.35, 0],
    radius: 0.5 * 0.08,
    blendRadius: 0.06,
    parentJointId: "knee-left",
    radialProfiles: [
      [0.040, 0.041, 0.043, 0.041, 0.038, 0.040, 0.043, 0.041],
      [0.044, 0.046, 0.048, 0.046, 0.042, 0.044, 0.048, 0.046],
      [0.050, 0.052, 0.054, 0.052, 0.048, 0.050, 0.054, 0.052],
      [0.046, 0.048, 0.050, 0.048, 0.044, 0.046, 0.050, 0.048],
      [0.040, 0.041, 0.043, 0.041, 0.038, 0.040, 0.043, 0.041],
      [0.035, 0.036, 0.037, 0.036, 0.033, 0.034, 0.037, 0.036],
    ],
  });

  // Left foot
  mouldManager.addMould({
    id: "foot-left",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, 0, 0.12],
    radius: 0.5 * 0.06,
    blendRadius: 0.06,
    parentJointId: "ankle-left",
    radialProfiles: [
      [0.032, 0.033, 0.036, 0.033, 0.032, 0.020, 0.015, 0.020],
      [0.036, 0.037, 0.038, 0.037, 0.036, 0.010, 0.005, 0.010],
      [0.038, 0.039, 0.039, 0.039, 0.038, 0.012, 0.008, 0.012],
      [0.036, 0.037, 0.037, 0.037, 0.036, 0.018, 0.015, 0.018],
      [0.030, 0.031, 0.032, 0.031, 0.030, 0.016, 0.014, 0.016],
      [0.022, 0.023, 0.024, 0.023, 0.022, 0.018, 0.017, 0.018],
    ],
  });

  // Right thigh
  mouldManager.addMould({
    id: "thigh-right",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, -0.4, 0],
    radius: 0.5 * 0.1,
    blendRadius: 0.06,
    parentJointId: "hip-right",
    radialProfiles: [
      [0.068, 0.070, 0.072, 0.070, 0.066, 0.068, 0.072, 0.070],
      [0.064, 0.066, 0.068, 0.066, 0.062, 0.064, 0.068, 0.066],
      [0.058, 0.060, 0.062, 0.060, 0.056, 0.058, 0.062, 0.060],
      [0.052, 0.054, 0.056, 0.054, 0.050, 0.052, 0.056, 0.054],
      [0.046, 0.048, 0.050, 0.048, 0.044, 0.046, 0.050, 0.048],
      [0.042, 0.043, 0.045, 0.043, 0.041, 0.042, 0.045, 0.043],
    ],
  });

  // Right shin
  mouldManager.addMould({
    id: "shin-right",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, -0.35, 0],
    radius: 0.5 * 0.08,
    blendRadius: 0.06,
    parentJointId: "knee-right",
    radialProfiles: [
      [0.040, 0.041, 0.043, 0.041, 0.038, 0.040, 0.043, 0.041],
      [0.044, 0.046, 0.048, 0.046, 0.042, 0.044, 0.048, 0.046],
      [0.050, 0.052, 0.054, 0.052, 0.048, 0.050, 0.054, 0.052],
      [0.046, 0.048, 0.050, 0.048, 0.044, 0.046, 0.050, 0.048],
      [0.040, 0.041, 0.043, 0.041, 0.038, 0.040, 0.043, 0.041],
      [0.035, 0.036, 0.037, 0.036, 0.033, 0.034, 0.037, 0.036],
    ],
  });

  // Right foot
  mouldManager.addMould({
    id: "foot-right",
    shape: "profiled-capsule",
    center: [0, 0, 0],
    endPoint: [0, 0, 0.12],
    radius: 0.5 * 0.06,
    blendRadius: 0.06,
    parentJointId: "ankle-right",
    radialProfiles: [
      [0.032, 0.033, 0.036, 0.033, 0.032, 0.020, 0.015, 0.020],
      [0.036, 0.037, 0.038, 0.037, 0.036, 0.010, 0.005, 0.010],
      [0.038, 0.039, 0.039, 0.039, 0.038, 0.012, 0.008, 0.012],
      [0.036, 0.037, 0.037, 0.037, 0.036, 0.018, 0.015, 0.018],
      [0.030, 0.031, 0.032, 0.031, 0.030, 0.016, 0.014, 0.016],
      [0.022, 0.023, 0.024, 0.023, 0.022, 0.018, 0.017, 0.018],
    ],
  });

  // Generate joints data for UI
  const joints = skeleton.getJoints().map((j) => ({
    id: j.id,
    parentId: j.parentId,
    children: j.children,
  }));

  // Generate moulds data for UI
  const moulds = mouldManager.getMoulds().map((m) => ({
    id: m.id,
    shape: m.shape,
    parentJointId: m.parentJointId,
  }));

  return { skeleton, mouldManager, joints, moulds };
};
