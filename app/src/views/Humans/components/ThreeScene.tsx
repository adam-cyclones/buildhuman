import { onMount, onCleanup } from "solid-js";
import * as THREE from "three";

type ThreeSceneProps = {
  onSceneReady?: (scene: THREE.Scene, mesh: THREE.Mesh) => void;
};

export default function ThreeScene(props: ThreeSceneProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let mesh: THREE.Mesh | undefined;
  let animationId: number | undefined;

  onMount(() => {
    if (!canvasRef) return;

    // Create renderer
    renderer = new THREE.WebGLRenderer({
      canvas: canvasRef,
      antialias: true,
    });
    renderer.setSize(canvasRef.clientWidth, canvasRef.clientHeight);
    renderer.setClearColor(0x1a1a1a);

    // Create scene
    scene = new THREE.Scene();

    // Create camera
    camera = new THREE.PerspectiveCamera(
      50,
      canvasRef.clientWidth / canvasRef.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);

    // Create lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // Create a placeholder mesh (will be replaced by voxel mesh)
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: 0x95c0d0,
      flatShading: true,
    });
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Call onSceneReady callback
    if (props.onSceneReady && mesh) {
      props.onSceneReady(scene, mesh);
    }

    // Animation loop
    const animate = () => {
      animationId = requestAnimationFrame(animate);

      // Rotate mesh
      if (mesh) {
        mesh.rotation.y += 0.005;
      }

      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!canvasRef || !camera || !renderer) return;
      const width = canvasRef.clientWidth;
      const height = canvasRef.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", handleResize);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      renderer?.dispose();
    });
  });

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        outline: "none",
      }}
    />
  );
}
