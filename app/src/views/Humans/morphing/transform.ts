// Transform utilities for bone hierarchy
// Provides quaternion and matrix operations for bone transforms

import type { Vec3, Quat, Mat4 } from "./types";

/**
 * Identity quaternion (no rotation)
 */
export function identityQuat(): Quat {
  return [0, 0, 0, 1];
}

/**
 * Identity matrix (no transformation)
 */
export function identityMat4(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

/**
 * Create a transformation matrix from translation and rotation
 */
export function composeMat4(translation: Vec3, rotation: Quat): Mat4 {
  const [x, y, z, w] = rotation;
  const [tx, ty, tz] = translation;

  // Convert quaternion to rotation matrix
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    tx, ty, tz, 1
  ];
}

/**
 * Multiply two transformation matrices
 * Result = a * b (applies b first, then a)
 */
export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const result: Mat4 = [
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 1
  ];

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      result[i * 4 + j] =
        a[i * 4 + 0] * b[0 * 4 + j] +
        a[i * 4 + 1] * b[1 * 4 + j] +
        a[i * 4 + 2] * b[2 * 4 + j] +
        a[i * 4 + 3] * b[3 * 4 + j];
    }
  }

  return result;
}

/**
 * Transform a point by a matrix
 */
export function transformPoint(point: Vec3, matrix: Mat4): Vec3 {
  const [x, y, z] = point;

  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
  ];
}

/**
 * Extract translation from transformation matrix
 */
export function getTranslation(matrix: Mat4): Vec3 {
  return [matrix[12], matrix[13], matrix[14]];
}

/**
 * Add two Vec3 vectors
 */
export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * Subtract two Vec3 vectors (a - b)
 */
export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Create quaternion from Euler angles (in radians)
 * Order: ZYX (yaw, pitch, roll)
 */
export function eulerToQuat(x: number, y: number, z: number): Quat {
  const cx = Math.cos(x * 0.5);
  const cy = Math.cos(y * 0.5);
  const cz = Math.cos(z * 0.5);
  const sx = Math.sin(x * 0.5);
  const sy = Math.sin(y * 0.5);
  const sz = Math.sin(z * 0.5);

  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz
  ];
}

/**
 * Multiply two quaternions (combine rotations)
 * Result = a * b (applies b first, then a)
 */
export function multiplyQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;

  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

/**
 * Normalize a quaternion
 */
export function normalizeQuat(q: Quat): Quat {
  const [x, y, z, w] = q;
  const len = Math.sqrt(x * x + y * y + z * z + w * w);

  if (len === 0) {
    return identityQuat();
  }

  return [x / len, y / len, z / len, w / len];
}
