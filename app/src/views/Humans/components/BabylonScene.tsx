import { onMount, onCleanup } from "solid-js";
import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  MeshBuilder,
  Color3,
  PBRMaterial,
} from "@babylonjs/core";

interface BabylonSceneProps {
  onSceneReady?: (scene: Scene) => void;
}

export default function BabylonScene(props: BabylonSceneProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let engine: Engine | undefined;
  let scene: Scene | undefined;

  onMount(() => {
    if (!canvasRef) return;

    // Create engine
    engine = new Engine(canvasRef, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    // Create scene
    scene = new Scene(engine);
    scene.clearColor = new Color3(0.1, 0.1, 0.1).toColor4();

    // Create camera
    const camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      Math.PI / 3,
      3,
      Vector3.Zero(),
      scene
    );
    camera.attachControl(canvasRef, true);
    camera.lowerRadiusLimit = 1;
    camera.upperRadiusLimit = 10;
    camera.wheelPrecision = 50;

    // Create lighting
    const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    // Create a simple PBR ground
    const ground = MeshBuilder.CreateGround(
      "ground",
      { width: 6, height: 6 },
      scene
    );
    const groundMaterial = new PBRMaterial("groundMat", scene);
    groundMaterial.albedoColor = new Color3(0.2, 0.2, 0.2);
    groundMaterial.metallic = 0.0;
    groundMaterial.roughness = 0.8;
    ground.material = groundMaterial;

    // Create a placeholder human mesh (sphere for now)
    const human = MeshBuilder.CreateSphere(
      "human",
      { diameter: 1, segments: 32 },
      scene
    );
    human.position.y = 0.5;

    // PBR material for human
    const humanMaterial = new PBRMaterial("humanMat", scene);
    humanMaterial.albedoColor = new Color3(0.95, 0.8, 0.7); // Skin tone
    humanMaterial.metallic = 0.0;
    humanMaterial.roughness = 0.5;
    humanMaterial.subSurface.isRefractionEnabled = false;
    humanMaterial.subSurface.isTranslucencyEnabled = true;
    humanMaterial.subSurface.translucencyIntensity = 0.3;
    human.material = humanMaterial;

    // Call onSceneReady callback
    if (props.onSceneReady) {
      props.onSceneReady(scene);
    }

    // Run render loop
    engine.runRenderLoop(() => {
      scene?.render();
    });

    // Handle resize
    const handleResize = () => {
      engine?.resize();
    };
    window.addEventListener("resize", handleResize);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      scene?.dispose();
      engine?.dispose();
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
