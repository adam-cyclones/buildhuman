import * as THREE from "three";
import type { MouldManager } from "../../../morphing/mould-manager";
import type { Skeleton } from "../../../morphing/skeleton";

/**
 * Creates a 2D canvas overlay showing the profile ring in its local coordinate system
 * This appears as a sprite/billboard in 3D space near the selected ring
 */
export function createProfileOverlay(
  scene: THREE.Scene,
  mouldId: string,
  segmentIndex: number,
  mouldManager: MouldManager,
  skeleton: Skeleton
): THREE.Sprite | null {
  console.log("Creating profile overlay for", mouldId, segmentIndex);

  const mould = mouldManager.getMould(mouldId);
  if (!mould || mould.shape !== "profiled-capsule" || !mould.radialProfiles) {
    console.error("Invalid mould for overlay", mouldId);
    return null;
  }

  const profile = mould.radialProfiles[segmentIndex];
  if (!profile) {
    console.error("No profile at segment", segmentIndex);
    return null;
  }

  // Get adjacent profiles for onion skinning
  const numProfiles = mould.radialProfiles.length;
  const prevIndex = segmentIndex - 1;
  const nextIndex = segmentIndex + 1;
  const prevProfile = prevIndex >= 0 ? mould.radialProfiles[prevIndex] : null;
  const nextProfile = nextIndex < numProfiles ? mould.radialProfiles[nextIndex] : null;

  // Get ring world position
  const worldStart = skeleton.transformToWorld(mould.parentJointId, mould.center);
  const worldEnd = skeleton.transformToWorld(mould.parentJointId, mould.endPoint);

  const numSegments = mould.radialProfiles.length;
  const t = segmentIndex / (numSegments - 1);

  const ringCenter = new THREE.Vector3(
    worldStart[0] + t * (worldEnd[0] - worldStart[0]),
    worldStart[1] + t * (worldEnd[1] - worldStart[1]),
    worldStart[2] + t * (worldEnd[2] - worldStart[2])
  );

  // Create canvas
  const canvasSize = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Draw the profile visualization with onion skin
  drawProfileToCanvas(ctx, profile, canvasSize, prevProfile, nextProfile);

  // Create sprite
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 1.0,
    depthTest: false, // Render on top
    depthWrite: false,
    sizeAttenuation: true,
  });

  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.renderOrder = 999; // Render last (on top)

  // Position sprite near the selected ring
  sprite.position.copy(ringCenter);

  // Scale sprite to reasonable size (0.15 units = 15cm in world space)
  sprite.scale.set(0.15, 0.15, 1);

  sprite.userData = {
    type: "profile-overlay",
    mouldId,
    segmentIndex,
  };

  scene.add(sprite);

  console.log("Profile overlay sprite created and added to scene:", {
    position: sprite.position,
    scale: sprite.scale,
    visible: sprite.visible,
    renderOrder: sprite.renderOrder,
    sceneChildren: scene.children.length
  });

  return sprite;
}

/**
 * Draw profile visualization to canvas
 */
function drawProfileToCanvas(
  ctx: CanvasRenderingContext2D,
  profile: number[],
  canvasSize: number,
  prevProfile?: number[] | null,
  nextProfile?: number[] | null
) {
  const centerX = canvasSize / 2;
  const centerY = canvasSize / 2;
  const scale = 800; // Scale factor for radius to pixels

  // Clear with semi-transparent dark background
  ctx.fillStyle = "rgba(26, 26, 26, 0.85)";
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  // Add subtle border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, canvasSize, canvasSize);

  // Draw thin grid
  ctx.strokeStyle = "rgba(51, 51, 51, 0.5)";
  ctx.lineWidth = 0.5;
  const gridSize = 30;
  for (let x = 0; x <= canvasSize; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasSize);
    ctx.stroke();
  }
  for (let y = 0; y <= canvasSize; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasSize, y);
    ctx.stroke();
  }

  // Draw center axes
  ctx.strokeStyle = "rgba(85, 85, 85, 0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(canvasSize, centerY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, canvasSize);
  ctx.stroke();

  // Draw "FRONT" label at top (north position - anatomical reference)
  ctx.fillStyle = "#00ff00";
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("FRONT", centerX, 5);

  // Draw arrow pointing upward
  ctx.strokeStyle = "#00ff00";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, 25);
  ctx.lineTo(centerX, 15);
  ctx.stroke();

  // Arrow head pointing up
  ctx.beginPath();
  ctx.moveTo(centerX, 15);
  ctx.lineTo(centerX - 3, 18);
  ctx.lineTo(centerX + 3, 18);
  ctx.closePath();
  ctx.fillStyle = "#00ff00";
  ctx.fill();

  // Draw onion skin - previous profile (semi-transparent gray)
  if (prevProfile) {
    ctx.strokeStyle = "rgba(128, 128, 128, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    const numPrevPoints = prevProfile.length;
    for (let i = 0; i <= numPrevPoints; i++) {
      const angle = (i % numPrevPoints / numPrevPoints) * Math.PI * 2;
      const radius = prevProfile[i % numPrevPoints];
      const x = centerX + radius * Math.cos(angle) * scale;
      const y = centerY - radius * Math.sin(angle) * scale;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  // Draw onion skin - next profile (semi-transparent gray)
  if (nextProfile) {
    ctx.strokeStyle = "rgba(128, 128, 128, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    const numNextPoints = nextProfile.length;
    for (let i = 0; i <= numNextPoints; i++) {
      const angle = (i % numNextPoints / numNextPoints) * Math.PI * 2;
      const radius = nextProfile[i % numNextPoints];
      const x = centerX + radius * Math.cos(angle) * scale;
      const y = centerY - radius * Math.sin(angle) * scale;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  // Draw profile curve (pink)
  ctx.strokeStyle = "#ff8888";
  ctx.lineWidth = 2;
  ctx.beginPath();

  const numPoints = profile.length;
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i % numPoints / numPoints) * Math.PI * 2;
    const radius = profile[i % numPoints];
    const x = centerX + radius * Math.cos(angle) * scale;
    const y = centerY - radius * Math.sin(angle) * scale; // Flip Y

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Draw control points (smaller blue dots)
  ctx.fillStyle = "#4444ff";
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const radius = profile[i];
    const x = centerX + radius * Math.cos(angle) * scale;
    const y = centerY - radius * Math.sin(angle) * scale;

    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Update sprite texture when profile changes
 */
export function updateProfileOverlay(
  sprite: THREE.Sprite,
  profile: number[]
): void {
  const material = sprite.material as THREE.SpriteMaterial;
  const texture = material.map as THREE.CanvasTexture;
  if (!texture || !texture.image) return;

  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  drawProfileToCanvas(ctx, profile, canvas.width);
  texture.needsUpdate = true;
}

/**
 * Remove sprite from scene and dispose resources
 */
export function disposeProfileOverlay(sprite: THREE.Sprite, scene: THREE.Scene): void {
  scene.remove(sprite);

  const material = sprite.material as THREE.SpriteMaterial;
  if (material.map) {
    material.map.dispose();
  }
  material.dispose();
}
