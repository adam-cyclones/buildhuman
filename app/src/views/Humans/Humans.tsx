import { createSignal, createEffect, For, Show, Switch, Match } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import ThreeDViewport from "./components/3DViewport";
import ProfileEditorPanel from "./components/ProfileEditorPanel";
import WeightForAgeChart from "./components/WeightForAgeChart";
import HeightForAgeChart from "./components/HeightForAgeChart";
import Tabs from "../../components/Tabs";
import Icon from "../../components/Icon";
import type { MouldManager } from "./morphing/mould-manager";
import type { Human } from "./types";
import "./Humans.css";

const BODY_REGIONS = ["HEAD & NECK", "TORSO", "LEFT ARM", "RIGHT ARM", "LEFT LEG", "RIGHT LEG", "OTHER"] as const;
type BodyRegion = typeof BODY_REGIONS[number];

const getBodyRegion = (id: string): BodyRegion => {
  const l = id.toLowerCase();
  const hasLeft = l.includes("left") || l.includes("_l") || l.includes("-l") || l.includes(".l") || l.startsWith("l_") || l.startsWith("l-") || l.endsWith("_l") || l.endsWith("-l") || l.endsWith(".l");
  const hasRight = l.includes("right") || l.includes("_r") || l.includes("-r") || l.includes(".r") || l.startsWith("r_") || l.startsWith("r-") || l.endsWith("_r") || l.endsWith("-r") || l.endsWith(".r");
  if (l.includes("head") || l.includes("neck") || l.includes("skull") || l.includes("face")) return "HEAD & NECK";
  if ((l.includes("arm") || l.includes("hand") || l.includes("forearm") || l.includes("wrist") || l.includes("elbow") || l.includes("shoulder")) && hasLeft) return "LEFT ARM";
  if ((l.includes("arm") || l.includes("hand") || l.includes("forearm") || l.includes("wrist") || l.includes("elbow") || l.includes("shoulder")) && hasRight) return "RIGHT ARM";
  if ((l.includes("leg") || l.includes("foot") || l.includes("toe") || l.includes("thigh") || l.includes("calf") || l.includes("shin") || l.includes("knee") || l.includes("ankle") || l.includes("hip")) && hasLeft) return "LEFT LEG";
  if ((l.includes("leg") || l.includes("foot") || l.includes("toe") || l.includes("thigh") || l.includes("calf") || l.includes("shin") || l.includes("knee") || l.includes("ankle") || l.includes("hip")) && hasRight) return "RIGHT LEG";
  if (l.includes("torso") || l.includes("chest") || l.includes("spine") || l.includes("shoulder") || l.includes("pelvis") || l.includes("abdomen")) return "TORSO";
  return "OTHER";
};

const formatRegionLabel = (region: string): string =>
  region
    .toLowerCase()
    .split(" ")
    .map(part => (part === "&" ? "&" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");

const Humans = () => {
  const maleNames = [
    "Alex", "Ben", "Chris", "Daniel", "Ethan", "Felix", "Gabriel", "Henry",
    "Isaac", "Jack", "Kevin", "Liam", "Mason", "Nathan", "Oliver", "Patrick",
    "Quinn", "Ryan", "Samuel", "Thomas", "Victor", "William", "Xavier", "Zachary"
  ];

  const femaleNames = [
    "Aria", "Bella", "Claire", "Diana", "Emma", "Fiona", "Grace", "Hannah",
    "Iris", "Julia", "Kate", "Lily", "Maya", "Nora", "Olivia", "Piper",
    "Quinn", "Rose", "Sophia", "Taylor", "Uma", "Violet", "Willow", "Zoe"
  ];

  const neutralNames = [
    "Alex", "Avery", "Blake", "Cameron", "Casey", "Charlie", "Dakota", "Eden",
    "Finley", "Harper", "Jordan", "Kennedy", "Logan", "Morgan", "Parker", "Quinn",
    "Reese", "Riley", "Sage", "Skyler", "Taylor", "River", "Rowan", "Phoenix"
  ];

  const [humans, setHumans] = createSignal<Human[]>([
    { id: 1, name: "Human", gender: "male", ageGroup: "adult", height: 1.75, weight: 70 },
  ]);
  const [selectedHumanId, setSelectedHumanId] = createSignal<number | null>(1);
  const [activeChart, setActiveChart] = createSignal<"height" | "weight">("weight");
  const [sceneTab, setSceneTab] = createSignal("Scene");
  const sceneTabs = ["Scene", "Properties"];
  const [mouldRadius, setMouldRadius] = createSignal(0.5);
  const [debouncedMouldRadius, setDebouncedMouldRadius] = createSignal(0.5);
  const [voxelResolution, setVoxelResolution] = createSignal<32 | 48 | 64 | 96 | 128 | 256>(96);
  const [jointMovement, setJointMovement] = createSignal<{ jointId: string; offset: [number, number, number] } | null>(null);
  const [jointRotation, setJointRotation] = createSignal<{ jointId: string; euler: [number, number, number] } | null>(null);
  const [showSkeleton, setShowSkeleton] = createSignal(true);
  const [selectedJointId, setSelectedJointId] = createSignal<string | null>(null);
  const [selectedBoneEdge, setSelectedBoneEdge] = createSignal<{ parentId: string; childId: string } | null>(null);
  const [selectedGraphType, setSelectedGraphType] = createSignal<"bone" | "joint" | null>(null);
  const [skeletonJoints, setSkeletonJoints] = createSignal<Array<{ id: string; parentId?: string; children: string[] }>>([]);
  const [moulds, setMoulds] = createSignal<Array<{ id: string; shape: "sphere" | "capsule" | "profiled-capsule"; parentJointId?: string }>>([]);

  // Track slider values for joint transforms (reset when joint selection changes)
  const [sliderRotX, setSliderRotX] = createSignal(0);
  const [sliderRotY, setSliderRotY] = createSignal(0);
  const [sliderRotZ, setSliderRotZ] = createSignal(0);
  const [sliderTransX, setSliderTransX] = createSignal(0);
  const [sliderTransY, setSliderTransY] = createSignal(0);
  const [sliderTransZ, setSliderTransZ] = createSignal(0);

  // Track base offset when joint is selected (for relative translation)
  const [baseOffsetX, setBaseOffsetX] = createSignal(0);
  const [baseOffsetY, setBaseOffsetY] = createSignal(0);
  const [baseOffsetZ, setBaseOffsetZ] = createSignal(0);

  // Profile editor state
  const [mouldProfilesVersion, setMouldProfilesVersion] = createSignal(0);
  const [selectedMouldId, setSelectedMouldId] = createSignal<string | null>(null);
  const [activeRingIndex, setActiveRingIndex] = createSignal(0);
  const [showGhostAbove, setShowGhostAbove] = createSignal(false);
  const [editingProfiles, setEditingProfiles] = createSignal<number[][] | null>(null);
  let mouldManagerRef: MouldManager | undefined;

  const selectJoint = (jointId: string | null) => {
    setSelectedGraphType(jointId ? "joint" : null);
    setSelectedBoneEdge(null);
    setSelectedJointId(jointId);
  };

  const selectBoneEdge = (parentId: string, childId: string) => {
    setSelectedGraphType("bone");
    setSelectedJointId(null);
    setSelectedBoneEdge({ parentId, childId });
  };

  // When joint OR bone-edge is selected, auto-select related mould and copy profiles into editing state.
  createEffect(() => {
    const jointId = selectedJointId();
    const edge = selectedBoneEdge();
    if ((!jointId && !edge) || !mouldManagerRef) {
      setSelectedMouldId(null);
      setEditingProfiles(null);
      return;
    }

    let mould = null as ReturnType<MouldManager["getMouldsByJoint"]>[number] | null;
    if (edge) {
      const all = mouldManagerRef.getMoulds();
      mould =
        all.find(m => m.parentJointId === edge.parentId && Array.isArray(m.radialProfiles) && m.radialProfiles.length > 0) ??
        all.find(m => m.parentJointId === edge.childId && Array.isArray(m.radialProfiles) && m.radialProfiles.length > 0) ??
        all.find(m => m.parentJointId === edge.parentId) ??
        all.find(m => m.parentJointId === edge.childId) ??
        null;
    } else if (jointId) {
      const jointMoulds = mouldManagerRef.getMouldsByJoint(jointId);
      mould = jointMoulds[0] ?? null;
    }

    if (mould?.radialProfiles) {
      const isMouldChanged = selectedMouldId() !== mould.id;
      setSelectedMouldId(mould.id);
      setEditingProfiles(mould.radialProfiles.map(r => [...r]));
      if (isMouldChanged) setActiveRingIndex(0);
    } else {
      setSelectedMouldId(null);
      setEditingProfiles(null);
    }
  });

  const handleMouldManagerReady = (manager: MouldManager) => {
    mouldManagerRef = manager;
  };

  const handleProfileChange = (newProfiles: number[][], mouldId: string) => {
    setEditingProfiles(newProfiles);
    const mould = mouldManagerRef?.getMould(mouldId);
    if (mould) mould.radialProfiles = newProfiles;
    setMouldProfilesVersion(v => v + 1);
  };

  // Handle joint selection - capture initial values for base offsets and mould radius
  const handleJointSelected = (
    jointId: string,
    offset: [number, number, number],
    _rotation: [number, number, number, number],
    mouldRadius: number
  ) => {
    // Ensure Properties panel switches to bone mode for viewport selections.
    selectJoint(jointId);

    // Reset sliders to zero (user sees centered sliders)
    setSliderRotX(0);
    setSliderRotY(0);
    setSliderRotZ(0);
    setSliderTransX(0);
    setSliderTransY(0);
    setSliderTransZ(0);

    // Store base offset (sliders will be relative to this)
    setBaseOffsetX(offset[0]);
    setBaseOffsetY(offset[1]);
    setBaseOffsetZ(offset[2]);

    // Set mould radius slider to the joint's current mould radius
    setMouldRadius(mouldRadius);
    setDebouncedMouldRadius(mouldRadius);
  };


  createEffect(() => {
    if (jointRotation()) {
      setTimeout(() => setJointRotation(null), 50);
    }
  });

  createEffect(() => {
    if (jointMovement()) {
      setTimeout(() => setJointMovement(null), 50);
    }
  });

  // Debounce mould radius updates for better performance
  let radiusDebounceTimer: number | undefined;
  const updateMouldRadius = (value: number) => {
    setMouldRadius(value);
    if (radiusDebounceTimer) clearTimeout(radiusDebounceTimer);
    radiusDebounceTimer = setTimeout(() => {
      setDebouncedMouldRadius(value);
    }, 150) as unknown as number;
  };

  const selectedHuman = () => humans().find((h) => h.id === selectedHumanId());

  const randomizeName = () => {
    const human = selectedHuman();
    if (!human) return;

    let namePool: string[];
    if (human.gender === "male") {
      namePool = maleNames;
    } else if (human.gender === "female") {
      namePool = femaleNames;
    } else {
      namePool = neutralNames;
    }

    const randomName = namePool[Math.floor(Math.random() * namePool.length)];
    updateSelectedHuman({ name: randomName });
  };

  const debounce = (func: Function, delay: number) => {
    let timeoutId: number;
    return (...args: any[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func(...args);
      }, delay);
    };
  };

  const debouncedGenerateHuman = debounce(() => generateHuman(selectedHuman()), 500);

  const updateSelectedHuman = (part: Partial<Human>) => {
    setHumans(
      humans().map((h) =>
        h.id === selectedHumanId() ? { ...h, ...part } : h
      )
    );
    debouncedGenerateHuman();
  };

  const generateHuman = async (human: Human | undefined) => {
    if (!human) return;
    try {
      await invoke("generate_base_mesh", {
        params: {
          gender: human.gender,
          age_group: human.ageGroup,
          height: human.height,
          weight: human.weight,
        },
      });
    } catch (error) {
      console.error("Failed to generate human:", error);
    }
  };

  const addHuman = () => {
    const newId = Date.now();
    const humanCount = humans().length + 1;
    setHumans([
      ...humans(),
      { id: newId, name: `Human.${humanCount}`, gender: "male", ageGroup: "adult", height: 1.75, weight: 70 },
    ]);
    setSelectedHumanId(newId);
  };

  // Expose exportGltf for File menu
  const exportGltf = async () => {
    const human = selectedHuman();
    if (!human) {
      console.warn("No human selected to export.");
      return;
    }

    try {
      const gltfData: string = await invoke("export_human", {
        params: {
          gender: human.gender,
          age_group: human.ageGroup,
          height: human.height,
          weight: human.weight,
        },
      });

      const filePath = await save({
        filters: [
          {
            name: "glTF 2.0 Binary",
            extensions: ["glb"],
          },
          {
            name: "glTF 2.0 JSON",
            extensions: ["gltf"],
          },
        ],
        defaultPath: `human-${human.id}.glb`,
      });

      if (filePath) {
        const encoder = new TextEncoder();
        const data = encoder.encode(gltfData);
        await writeFile(filePath, data);
        console.log(`GLTF exported successfully to: ${filePath}`);
      }
    } catch (error) {
      console.error("Failed to export GLTF:", error);
    }
  };

  // Expose exportGltf globally for File menu
  (window as any).exportGltf = exportGltf;

  // Set joint offset to absolute value (base + slider delta)
  const setJointOffsetAbsolute = (jointId: string, offsetX: number, offsetY: number, offsetZ: number) => {
    const offset: [number, number, number] = [offsetX, offsetY, offsetZ];
    // Signal uses 'absolute' flag to indicate this is not a delta
    setJointMovement({ jointId, offset, absolute: true } as any);
  };

  // Set joint rotation to absolute Euler angles (not delta)
  const setJointRotationAbsolute = (jointId: string, eulerX: number, eulerY: number, eulerZ: number) => {
    const euler: [number, number, number] = [
      eulerX * (Math.PI / 180),
      eulerY * (Math.PI / 180),
      eulerZ * (Math.PI / 180)
    ];
    // Signal uses 'absolute' flag to indicate this is not a delta
    setJointRotation({ jointId, euler, absolute: true } as any);
  };

  // Throttle updates during drag for better performance
  let rotationThrottleTimer: number | undefined;
  let translationThrottleTimer: number | undefined;

  // Handle rotation input (continuous during drag)
  const handleRotationInput = (e: Event, axis: 'x' | 'y' | 'z') => {
    const target = e.currentTarget as HTMLInputElement;
    const value = parseFloat(target.value);

    if (selectedJointId()) {
      // Throttle updates to every 50ms during drag for smoothness
      if (!rotationThrottleTimer) {
        // Update slider state immediately for smooth visual tracking
        if (axis === 'x') setSliderRotX(value);
        if (axis === 'y') setSliderRotY(value);
        if (axis === 'z') setSliderRotZ(value);

        // Set absolute rotation using all three slider values
        setJointRotationAbsolute(
          selectedJointId()!,
          axis === 'x' ? value : sliderRotX(),
          axis === 'y' ? value : sliderRotY(),
          axis === 'z' ? value : sliderRotZ()
        );

        rotationThrottleTimer = setTimeout(() => {
          rotationThrottleTimer = undefined;
        }, 50) as unknown as number;
      }
    }
  };

  // Handle rotation change (on release)
  const handleRotationChange = (e: Event, axis: 'x' | 'y' | 'z') => {
    const target = e.currentTarget as HTMLInputElement;
    const value = parseFloat(target.value);

    // Update slider signal and apply final rotation
    if (axis === 'x') setSliderRotX(value);
    if (axis === 'y') setSliderRotY(value);
    if (axis === 'z') setSliderRotZ(value);

    if (selectedJointId()) {
      setJointRotationAbsolute(
        selectedJointId()!,
        sliderRotX(),
        sliderRotY(),
        sliderRotZ()
      );
    }
  };

  // Handle translation input (continuous during drag)
  const handleTranslationInput = (e: Event, axis: 'x' | 'y' | 'z') => {
    const target = e.currentTarget as HTMLInputElement;
    const value = parseFloat(target.value);

    if (selectedJointId()) {
      // Throttle updates to every 50ms during drag for smoothness
      if (!translationThrottleTimer) {
        // Update slider state immediately for smooth visual tracking
        if (axis === 'x') setSliderTransX(value);
        if (axis === 'y') setSliderTransY(value);
        if (axis === 'z') setSliderTransZ(value);

        // Set absolute offset using base + slider values
        setJointOffsetAbsolute(
          selectedJointId()!,
          baseOffsetX() + (axis === 'x' ? value : sliderTransX()),
          baseOffsetY() + (axis === 'y' ? value : sliderTransY()),
          baseOffsetZ() + (axis === 'z' ? value : sliderTransZ())
        );

        translationThrottleTimer = setTimeout(() => {
          translationThrottleTimer = undefined;
        }, 50) as unknown as number;
      }
    }
  };

  // Handle translation change (on release)
  const handleTranslationChange = (e: Event, axis: 'x' | 'y' | 'z') => {
    const target = e.currentTarget as HTMLInputElement;
    const value = parseFloat(target.value);

    // Update slider signal and apply final offset
    if (axis === 'x') setSliderTransX(value);
    if (axis === 'y') setSliderTransY(value);
    if (axis === 'z') setSliderTransZ(value);

    if (selectedJointId()) {
      setJointOffsetAbsolute(
        selectedJointId()!,
        baseOffsetX() + sliderTransX(),
        baseOffsetY() + sliderTransY(),
        baseOffsetZ() + sliderTransZ()
      );
    }
  };

  const groupedRegions = () => {
    const regions = new Set<BodyRegion>();
    for (const j of skeletonJoints()) {
      regions.add(getBodyRegion(j.id));
    }
    // Fallback while skeleton is still loading
    if (regions.size === 0) {
      for (const m of moulds()) {
        regions.add(getBodyRegion(m.id));
      }
    }
    return BODY_REGIONS.filter(r => regions.has(r));
  };

  // Browser navigation: region → bones
  const [selectedBrowserRegion, setSelectedBrowserRegion] = createSignal<string | null>(null);

  const resolveEdgeMould = (parentId: string | null, childId: string) => {
    if (!mouldManagerRef) return null as ReturnType<MouldManager["getMoulds"]>[number] | null;
    const all = mouldManagerRef.getMoulds();
    const childJoint = skeletonJoints().find(j => j.id === childId);
    const childIsTerminal = !!childJoint && childJoint.children.length === 0;

    // Deterministic edge mapping:
    // - terminal edges (e.g. neck->head, wrist->hand) prefer child-side mould
    // - otherwise prefer parent-side mould
    const childProfiled = all.find(m => m.parentJointId === childId && Array.isArray(m.radialProfiles) && m.radialProfiles.length > 0);
    const childAny = all.find(m => m.parentJointId === childId);

    if (childIsTerminal) {
      if (childProfiled) return childProfiled;
      if (childAny) return childAny;
    }

    const parentProfiled = parentId
      ? all.find(m => m.parentJointId === parentId && Array.isArray(m.radialProfiles) && m.radialProfiles.length > 0)
      : undefined;
    if (parentProfiled) return parentProfiled;

    const parentAny = parentId ? all.find(m => m.parentJointId === parentId) : undefined;
    if (parentAny) return parentAny;

    if (childProfiled) return childProfiled;

    return childAny ?? null;
  };

  const getEdgeMouldId = (edge: { parentId: string; childId: string } | null): string | null => {
    if (!edge) return null;
    return resolveEdgeMould(edge.parentId, edge.childId)?.id ?? null;
  };

  const getPreferredEdgeForJoint = (jointId: string | null): { parentId: string; childId: string } | null => {
    if (!jointId) return null;
    const byId = new Map(skeletonJoints().map(j => [j.id, j]));
    const joint = byId.get(jointId);
    if (!joint) return null;

    const all = mouldManagerRef?.getMoulds() ?? [];
    // Prefer downstream edge that actually has a mould target (parent or child).
    const childWithMould =
      joint.children.find(childId =>
        byId.has(childId) &&
        (
          all.some(m => m.parentJointId === jointId) ||
          all.some(m => m.parentJointId === childId)
        )
      ) ??
      joint.children.find(childId => byId.has(childId));
    if (childWithMould) return { parentId: jointId, childId: childWithMould };

    if (joint.parentId && byId.has(joint.parentId)) {
      return { parentId: joint.parentId, childId: jointId };
    }
    return null;
  };

  const selectionHighlight = () => {
    const edge = selectedBoneEdge();
    if (edge) {
      const edgeMouldId = getEdgeMouldId(edge);
      if (edgeMouldId) {
        // Bone-edge selection should map to the concrete bone/shape, not whole region.
        return { mode: "shape" as const, value: edgeMouldId };
      }
      return { mode: "bone" as const, value: edge.childId };
    }
    if (selectedGraphType() === "joint" && selectedJointId()) {
      // Joint selection should remain a true joint highlight in 3D (blue joint dot).
      return { mode: "bone" as const, value: selectedJointId()! };
    }
    if (selectedMouldId()) {
      return { mode: "shape" as const, value: selectedMouldId()! };
    }
    if (selectedJointId()) {
      return { mode: "bone" as const, value: selectedJointId()! };
    }
    if (selectedBrowserRegion()) {
      return { mode: "region" as const, value: selectedBrowserRegion()! };
    }
    return null;
  };

  const navigateToRegion = (region: string) => {
    // Region focus should not inherit stale shape selection.
    setSelectedMouldId(null);
    // Auto-select first bone edge in region; fallback to first joint.
    const jointsInRegion = skeletonJoints().filter(j => getBodyRegion(j.id) === region);
    const firstEdge = jointsInRegion.find(j => !!j.parentId && jointsInRegion.some(p => p.id === j.parentId));
    if (firstEdge?.parentId) {
      selectBoneEdge(firstEdge.parentId, firstEdge.id);
    } else {
      selectJoint(jointsInRegion[0]?.id ?? null);
    }
    setSelectedBrowserRegion(region);
  };

  const navigateBack = () => {
    // Reset to root browser state and remove focus selection.
    setSelectedJointId(null);
    setSelectedBoneEdge(null);
    setSelectedGraphType(null);
    setSelectedMouldId(null);
    setSelectedBrowserRegion(null);
  };

  const [searchQuery, setSearchQuery] = createSignal("");

  const boneResults = () => {
    const q = searchQuery().toLowerCase().trim();
    if (!q) return [];
    return skeletonJoints().filter(j => j.id.toLowerCase().includes(q));
  };

  const regionResults = () => {
    const q = searchQuery().toLowerCase().trim();
    if (!q) return [];
    return groupedRegions().filter(region => region.toLowerCase().includes(q));
  };

  const regionBoneGraph = () => {
    const region = selectedBrowserRegion();
    if (!region) return [] as Array<{
      parentId: string;
      childId: string;
      terminalJointId?: string;
    }>;

    const all = skeletonJoints();
    const indexById = new Map(all.map((j, idx) => [j.id, idx]));
    const joints = all.filter(j => getBodyRegion(j.id) === region);
    const jointSet = new Set(joints.map(j => j.id));
    const byId = new Map(joints.map(j => [j.id, j]));

    const roots = joints
      .filter(j => !j.parentId || !jointSet.has(j.parentId))
      .sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0));

    const rows: Array<{ parentId: string; childId: string }> = [];
    const visit = (
      id: string,
      parentId: string | null
    ) => {
      if (parentId) rows.push({ parentId, childId: id });
      const node = byId.get(id);
      if (!node) return;
      const kids = node.children.filter(c => jointSet.has(c));
      for (const childId of kids) {
        visit(childId, id);
      }
    };

    for (const root of roots) {
      // For tiny chains (e.g. Head & Neck), include a root self-bone row
      // so both parent and child bones are addressable in the graph.
      if (joints.length <= 2) {
        rows.push({ parentId: root.id, childId: root.id });
      }
      visit(root.id, null);
    }
    const isLeafNoGeometryEdge = (parentId: string, childId: string): boolean => {
      const child = byId.get(childId);
      const inRegionChildren = child?.children.filter(c => jointSet.has(c)) ?? [];
      return inRegionChildren.length === 0 && !boneHasGeometryInfluence(parentId, childId);
    };

    // Collapse terminal, non-geometry edges into a terminal joint marker
    // so the graph ends on a joint card, not a full bone card.
    const terminalJointByCarrierChild = new Map<string, string>();
    for (const row of rows) {
      if (isLeafNoGeometryEdge(row.parentId, row.childId)) {
        terminalJointByCarrierChild.set(row.parentId, row.childId);
      }
    }

    return rows
      .filter(row => !isLeafNoGeometryEdge(row.parentId, row.childId))
      .map(row => ({
        ...row,
        terminalJointId: terminalJointByCarrierChild.get(row.childId),
      }));
  };

  const boneJokeLine = () => {
    const edge = selectedBoneEdge();
    if (edge) return `the ${edge.childId} bone's connected to the ${edge.parentId} bone`;
    const selected = selectedJointId();
    if (!selected) return "the hip bone's connected to the thigh bone";
    const parent = skeletonJoints().find(j => j.id === selected)?.parentId;
    if (!parent) return "the head bone's connected to the neck bone";
    return `the ${selected} bone's connected to the ${parent} bone`;
  };

  const getBoneProfileSegmentCount = (parentId: string | null, childId: string): number => {
    // Keep this reactive when profile edits change ring counts.
    void mouldProfilesVersion();
    const mouldWithProfiles = resolveEdgeMould(parentId, childId);
    return mouldWithProfiles?.radialProfiles?.length ?? 0;
  };

  const boneHasGeometryInfluence = (parentId: string | null, childId: string): boolean => {
    void mouldProfilesVersion();
    return !!resolveEdgeMould(parentId, childId);
  };

  const jointHasGeometryInfluence = (jointId: string): boolean => {
    const all = moulds();
    return all.some(m => m.parentJointId === jointId);
  };

  const getBoneLabel = (parentId: string, childId: string): string => {
    const mould = resolveEdgeMould(parentId, childId);
    return mould?.id ?? `${parentId} → ${childId}`;
  };

  const openShapeEditorForNode = (parentId: string | null, childId: string) => {
    if (parentId) {
      selectBoneEdge(parentId, childId);
    } else {
      selectJoint(childId);
    }
    setSceneTab("Properties");
  };

  const highlightMatch = (text: string, query: string) => {
    const lc = text.toLowerCase();
    const lcq = query.toLowerCase().trim();
    const idx = lcq ? lc.indexOf(lcq) : -1;
    if (idx === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <span class="search-highlight">{text.slice(idx, idx + lcq.length)}</span>
        {text.slice(idx + lcq.length)}
      </>
    );
  };

  return (
    <div class="three-d-editor">
      <ThreeDViewport
        onAddHuman={addHuman}
        mouldRadius={debouncedMouldRadius()}
        voxelResolution={voxelResolution()}
        jointMovement={jointMovement()}
        jointRotation={jointRotation()}
        showSkeleton={showSkeleton()}
        selectedJointId={selectedJointId()}
        selectionHighlight={selectionHighlight()}
        activeProfileSegmentIndex={selectedMouldId() ? activeRingIndex() : null}
        mouldProfilesVersion={mouldProfilesVersion()}
        onSkeletonReady={setSkeletonJoints}
        onMouldsReady={setMoulds}
        onMouldManagerReady={handleMouldManagerReady}
        onJointSelected={handleJointSelected}
        onJointClicked={(jointId) => selectJoint(jointId)}
      />

      <div class="inspector">
        <div class="inspector-header">
          <Tabs tabs={sceneTabs} activeTab={sceneTab()} onTabChange={setSceneTab} />
        </div>
        <div class="inspector-content">
          <Switch>
            <Match when={sceneTab() === "Scene"}>
              <div class="shape-browser">
                {/* Human tab bar */}
                <div class="human-tabs">
                  <For each={humans()}>
                    {(human) => (
                      <button
                        class={`human-tab ${selectedHumanId() === human.id ? 'active' : ''}`}
                        onClick={() => setSelectedHumanId(human.id)}
                      >
                        {human.name}
                      </button>
                    )}
                  </For>
                  <button class="human-tab human-tab-add" onClick={addHuman} title="Add human">+</button>
                </div>

                {/* Search */}
                <div class="browser-search">
                  <input
                    type="text"
                    class="browser-search-input"
                    placeholder="Search bones or regions…"
                    value={searchQuery()}
                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  />
                </div>

                {/* Search results or 2-level navigation: Regions → Bones */}
                <Show
                  when={searchQuery().trim().length > 0}
                  fallback={<Switch>
                  <Match when={selectedBrowserRegion()}>
                    {/* Level 2: bones in region */}
                    <div class="browser-list">
                      <div class="shape-breadcrumb">
                        <button class="breadcrumb-back" onClick={navigateBack}>
                          ‹ Regions
                        </button>
                        <span class="breadcrumb-sep">/</span>
                        <span class="breadcrumb-current">{formatRegionLabel(selectedBrowserRegion()!)}</span>
                      </div>

                      <div class="browser-section-header">Bone Graph</div>
                      <div class="bone-graph-timeline">
                        <For each={regionBoneGraph()}>
                          {(node, idx) => (
                            <>
                              <div class={`bone-timeline-row ${(selectedGraphType() === "bone" && selectedBoneEdge()?.parentId === node.parentId && selectedBoneEdge()?.childId === node.childId) ? "active" : ""}`}>
                                <div
                                  class="bone-timeline-card"
                                  role="button"
                                  tabindex={0}
                                  title={`${node.parentId} → ${node.childId}`}
                                  onClick={() => {
                                    selectBoneEdge(node.parentId, node.childId);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      selectBoneEdge(node.parentId, node.childId);
                                    }
                                  }}
                                >
                                  <span class="bone-timeline-card-title">
                                    {getBoneLabel(node.parentId, node.childId)}
                                    <Show when={!boneHasGeometryInfluence(node.parentId, node.childId)}>
                                      <span class="bone-node-badge bone-node-badge-dim">No Geometry</span>
                                    </Show>
                                  </span>
                                  <span class="bone-timeline-card-subtitle">
                                    {node.parentId === node.childId ? `${node.childId} root` : `${node.parentId} → ${node.childId}`}
                                  </span>
                                  <span class="bone-timeline-card-metrics">
                                    <Show
                                      when={boneHasGeometryInfluence(node.parentId, node.childId)}
                                      fallback={"skeleton only: no geometry influence"}
                                    >
                                      profile segments: {getBoneProfileSegmentCount(node.parentId, node.childId)}
                                    </Show>
                                  </span>
                                  <span class="bone-timeline-card-actions">
                                    <button
                                      type="button"
                                      class="bone-card-action"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openShapeEditorForNode(node.parentId, node.childId);
                                      }}
                                    >
                                      Edit Shape
                                    </button>
                                  </span>
                                </div>
                              </div>
                              <Show when={idx() < regionBoneGraph().length - 1 || !!node.terminalJointId}>
                                <div class="bone-timeline-connector">
                                  <span class="bone-timeline-connector-line" />
                                  <div
                                    class={`bone-timeline-joint-card ${selectedGraphType() === "joint" && selectedJointId() === (idx() < regionBoneGraph().length - 1 ? node.childId : node.terminalJointId) ? "active" : ""}`}
                                    role="button"
                                    tabindex={0}
                                    title={`Joint: ${idx() < regionBoneGraph().length - 1 ? node.childId : node.terminalJointId}`}
                                    onClick={() => {
                                      selectJoint(idx() < regionBoneGraph().length - 1 ? node.childId : node.terminalJointId!);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        selectJoint(idx() < regionBoneGraph().length - 1 ? node.childId : node.terminalJointId!);
                                      }
                                    }}
                                  >
                                    <span class="bone-timeline-joint-label">
                                      {idx() < regionBoneGraph().length - 1 ? node.childId : node.terminalJointId}
                                      <Show when={!jointHasGeometryInfluence(idx() < regionBoneGraph().length - 1 ? node.childId : node.terminalJointId!)}>
                                        <span class="bone-node-badge bone-node-badge-dim">No Geometry</span>
                                      </Show>
                                    </span>
                                    <button
                                      type="button"
                                      class="bone-timeline-joint-edit"
                                      title={`Edit joint: ${idx() < regionBoneGraph().length - 1 ? node.childId : node.terminalJointId}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        selectJoint(idx() < regionBoneGraph().length - 1 ? node.childId : node.terminalJointId!);
                                        setSceneTab("Properties");
                                      }}
                                    >
                                      Edit Joint
                                    </button>
                                  </div>
                                  <Show when={idx() < regionBoneGraph().length - 1}>
                                    <span class="bone-timeline-connector-arrow">▼</span>
                                  </Show>
                                </div>
                              </Show>
                            </>
                          )}
                        </For>
                        <div class="bone-timeline-joke">{boneJokeLine()}</div>
                      </div>
                    </div>
                  </Match>
                  <Match when={true}>
                    {/* Level 1: region list */}
                    <div class="browser-list">
                      <For each={groupedRegions()}>
                        {(region) => (
                          <div class="shape-row" onClick={() => navigateToRegion(region)}>
                            <span class="shape-row-label">{formatRegionLabel(region)}</span>
                            <span class="shape-row-arrow">›</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Match>
                </Switch>}
                >
                  {/* Search results */}
                  <div class="browser-list">
                    <Show
                      when={regionResults().length > 0 || boneResults().length > 0}
                      fallback={<div class="browser-empty">No bones or regions found</div>}
                    >
                      <Show when={regionResults().length > 0}>
                        <div class="browser-section-header">Regions</div>
                        <For each={regionResults()}>
                          {(region) => (
                            <div class="shape-row" onClick={() => { setSearchQuery(""); navigateToRegion(region); }}>
                              <span class="shape-row-label">{highlightMatch(formatRegionLabel(region), searchQuery())}</span>
                              <span class="shape-row-arrow">›</span>
                            </div>
                          )}
                        </For>
                      </Show>
                      <Show when={boneResults().length > 0}>
                        <div class="browser-section-header">Bones</div>
                        <For each={boneResults()}>
                          {(joint) => (
                            <div
                              class={`shape-row ${selectedJointId() === joint.id ? 'active' : ''}`}
                              onClick={() => {
                                setSearchQuery("");
                                navigateToRegion(getBodyRegion(joint.id));
                                selectJoint(joint.id);
                              }}
                            >
                              <span class="shape-row-icon">🦴</span>
                              <span class="shape-row-label">{highlightMatch(joint.id, searchQuery())}</span>
                              <span class="shape-row-region">{formatRegionLabel(getBodyRegion(joint.id))}</span>
                            </div>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                </Show>
              </div>
            </Match>
            <Match when={sceneTab() === "Properties"}>
              {selectedHuman() && (
                <>
                  <Show when={selectedMouldId() && editingProfiles()}>
                    <ProfileEditorPanel
                      mouldId={selectedMouldId()!}
                      mould={mouldManagerRef!.getMould(selectedMouldId()!)!}
                      profiles={editingProfiles()!}
                      activeRingIndex={activeRingIndex()}
                      showGhostAbove={showGhostAbove()}
                      onRingChange={(idx) => setActiveRingIndex(idx)}
                      onGhostToggle={(above) => setShowGhostAbove(above)}
                      onAddRing={(afterIdx) => {
                        const profiles = editingProfiles()!;
                        const source = profiles[afterIdx] ?? profiles[profiles.length - 1];
                        const newProfiles = [...profiles];
                        newProfiles.splice(afterIdx + 1, 0, [...source]);
                        handleProfileChange(newProfiles, selectedMouldId()!);
                      }}
                      onRemoveRing={(idx) => {
                        const profiles = editingProfiles()!;
                        if (profiles.length <= 1) return;
                        const newProfiles = profiles.filter((_, i) => i !== idx);
                        setActiveRingIndex(i => Math.min(i, newProfiles.length - 1));
                        handleProfileChange(newProfiles, selectedMouldId()!);
                      }}
                      onHandleChange={(segIdx, ptIdx, radius) => {
                        const profiles = editingProfiles()!;
                        const newProfiles = profiles.map((ring, si) =>
                          si === segIdx ? ring.map((r, pi) => pi === ptIdx ? Math.max(0.005, radius) : r) : ring
                        );
                        handleProfileChange(newProfiles, selectedMouldId()!);
                      }}
                      onAddHandle={(segIdx, afterPtIdx) => {
                        const profiles = editingProfiles()!;
                        const ring = [...profiles[segIdx]];
                        const nextIdx = (afterPtIdx + 1) % ring.length;
                        ring.splice(afterPtIdx + 1, 0, (ring[afterPtIdx] + ring[nextIdx]) / 2);
                        const newProfiles = profiles.map((r, si) => si === segIdx ? ring : r);
                        handleProfileChange(newProfiles, selectedMouldId()!);
                      }}
                      onRemoveHandle={(segIdx, ptIdx) => {
                        const profiles = editingProfiles()!;
                        if (profiles[segIdx].length <= 3) return;
                        const newRing = profiles[segIdx].filter((_, i) => i !== ptIdx);
                        const newProfiles = profiles.map((r, si) => si === segIdx ? newRing : r);
                        handleProfileChange(newProfiles, selectedMouldId()!);
                      }}
                    />
                  </Show>

                  <Show when={!selectedJointId() && !selectedBoneEdge()}>
                    <div class="property-section">
                      <h4>Object</h4>
                      <div class="property-group">
                        <label>Name</label>
                        <div class="input-with-button">
                          <input
                            type="text"
                            class="property-input"
                            value={selectedHuman()?.name}
                            onInput={(e) => updateSelectedHuman({ name: e.currentTarget.value })}
                          />
                          <button
                            class="input-button"
                            onClick={randomizeName}
                            title="Randomize name"
                          >
                            <Icon name="dice" size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <Show
                    when={selectedJointId() || selectedBoneEdge()}
                    fallback={
                      <div class="property-section">
                        <h4>Display & Mesh</h4>

                        <div class="property-group">
                          <label>
                            <input
                              type="checkbox"
                              checked={showSkeleton()}
                              onChange={(e) => setShowSkeleton(e.currentTarget.checked)}
                            />
                            Show Skeleton
                          </label>
                        </div>

                        <div class="property-group">
                          <label>Voxel Resolution</label>
                          <select
                            class="property-input"
                            value={voxelResolution()}
                            onChange={(e) => setVoxelResolution(parseInt(e.currentTarget.value) as 32 | 48 | 64 | 96 | 128 | 256)}
                          >
                            <option value="32">32</option>
                            <option value="48">48</option>
                            <option value="64">64 (Default)</option>
                            <option value="96">96</option>
                            <option value="128">128 (High)</option>
                            <option value="256">256 (Very High)</option>
                          </select>
                        </div>
                      </div>
                    }
                  >
                    <div class="property-section">
                      <h4>Bone Properties</h4>
                      <div class="property-group">
                        <div class="property-label-row">
                          <label>Selected {selectedGraphType() === "joint" ? "Joint" : "Bone"}</label>
                          <span class="property-value">
                            {selectedBoneEdge()
                              ? `${getBoneLabel(selectedBoneEdge()!.parentId, selectedBoneEdge()!.childId)} (${selectedBoneEdge()!.parentId} → ${selectedBoneEdge()!.childId})`
                              : selectedJointId()}
                          </span>
                        </div>
                        <button
                          class="input-button"
                          onClick={() => {
                            setSelectedJointId(null);
                            setSelectedBoneEdge(null);
                            setSelectedGraphType(null);
                          }}
                          title="Return to human properties"
                        >
                          Done
                        </button>
                      </div>
                    </div>

                    <div class="property-section">
                      <h4>Bone Shape</h4>
                      <div class="property-group">
                        <div class="property-label-row">
                          <label>Mould Size</label>
                          <span class="property-value">
                            {mouldRadius().toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.01"
                          value={mouldRadius()}
                          onInput={(e) => updateMouldRadius(parseFloat(e.currentTarget.value))}
                          class="property-slider"
                        />
                      </div>
                    </div>
                  </Show>

                  {selectedJointId() && (
                    <div class="property-section">
                      <h4>Joint: {selectedJointId()}</h4>

                      <div class="property-group">
                        <div class="property-label-row">
                          <label>Rotation X</label>
                          <span class="property-value">{sliderRotX().toFixed(1)}°</span>
                        </div>
                        <input
                          type="range"
                          min="-45"
                          max="45"
                          step="0.5"
                          value={sliderRotX()}
                          class="property-slider"
                          onInput={(e) => handleRotationInput(e, 'x')}
                          onChange={(e) => handleRotationChange(e, 'x')}
                        />
                      </div>
                      <div class="property-group">
                        <div class="property-label-row">
                          <label>Rotation Y</label>
                          <span class="property-value">{sliderRotY().toFixed(1)}°</span>
                        </div>
                        <input
                          type="range"
                          min="-45"
                          max="45"
                          step="0.5"
                          value={sliderRotY()}
                          class="property-slider"
                          onInput={(e) => handleRotationInput(e, 'y')}
                          onChange={(e) => handleRotationChange(e, 'y')}
                        />
                      </div>
                      <div class="property-group">
                        <div class="property-label-row">
                          <label>Rotation Z</label>
                          <span class="property-value">{sliderRotZ().toFixed(1)}°</span>
                        </div>
                        <input
                          type="range"
                          min="-45"
                          max="45"
                          step="0.5"
                          value={sliderRotZ()}
                          class="property-slider"
                          onInput={(e) => handleRotationInput(e, 'z')}
                          onChange={(e) => handleRotationChange(e, 'z')}
                        />
                      </div>

                      <div class="property-group">
                        <div class="property-label-row">
                          <label>Translation X</label>
                          <span class="property-value">{sliderTransX().toFixed(3)}m</span>
                        </div>
                        <input
                          type="range"
                          min="-0.2"
                          max="0.2"
                          step="0.005"
                          value={sliderTransX()}
                          class="property-slider"
                          onInput={(e) => handleTranslationInput(e, 'x')}
                          onChange={(e) => handleTranslationChange(e, 'x')}
                        />
                      </div>
                      <div class="property-group">
                        <div class="property-label-row">
                          <label>Translation Y</label>
                          <span class="property-value">{sliderTransY().toFixed(3)}m</span>
                        </div>
                        <input
                          type="range"
                          min="-0.2"
                          max="0.2"
                          step="0.005"
                          value={sliderTransY()}
                          class="property-slider"
                          onInput={(e) => handleTranslationInput(e, 'y')}
                          onChange={(e) => handleTranslationChange(e, 'y')}
                        />
                      </div>
                      <div class="property-group">
                        <div class="property-label-row">
                          <label>Translation Z</label>
                          <span class="property-value">{sliderTransZ().toFixed(3)}m</span>
                        </div>
                        <input
                          type="range"
                          min="-0.2"
                          max="0.2"
                          step="0.005"
                          value={sliderTransZ()}
                          class="property-slider"
                          onInput={(e) => handleTranslationInput(e, 'z')}
                          onChange={(e) => handleTranslationChange(e, 'z')}
                        />
                      </div>
                    </div>
                  )}

                  <Show when={!selectedJointId() && !selectedBoneEdge()}>
                    <div class="property-section">
                      <h4>Basic Parameters</h4>

                    <div class="property-group">
                      <label>Gender</label>
                      <div class="gender-slider-container">
                        <div class="gender-labels">
                          <span>Male</span>
                          <span>Neutral</span>
                          <span>Female</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.5"
                          value={
                            selectedHuman()?.gender === "male"
                              ? 0
                              : selectedHuman()?.gender === "neutral"
                              ? 0.5
                              : 1
                          }
                          onInput={(e) => {
                            const val = parseFloat(e.currentTarget.value);
                            const gender = val === 0 ? "male" : val === 0.5 ? "neutral" : "female";
                            updateSelectedHuman({ gender });
                          }}
                          class="property-slider"
                          list="gender-ticks"
                        />
                        <datalist id="gender-ticks">
                          <option value="0" label="Male"></option>
                          <option value="0.5" label="Neutral"></option>
                          <option value="1" label="Female"></option>
                        </datalist>
                      </div>
                    </div>

                    <div class="property-group">
                      <div class="property-label-row">
                        <label>Height</label>
                        <span class="property-value">
                          {selectedHuman()?.height.toFixed(2)}m
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.9"
                        max="2.2"
                        step="0.01"
                        value={selectedHuman()?.height}
                        onInput={(e) => {
                          setActiveChart("height");
                          updateSelectedHuman({
                            height: parseFloat(e.currentTarget.value),
                          });
                        }}
                        class="property-slider"
                      />
                    </div>

                    <div class="property-group">
                      <div class="property-label-row">
                        <label>Weight</label>
                        <span class="property-value">
                          {selectedHuman()?.weight.toFixed(0)} kg
                        </span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="200"
                        step="1"
                        value={selectedHuman()?.weight}
                        onInput={(e) => {
                          setActiveChart("weight");
                          updateSelectedHuman({
                            weight: parseFloat(e.currentTarget.value),
                          });
                        }}
                        class="property-slider"
                      />
                    </div>

                    {activeChart() === "height" ? (
                      <HeightForAgeChart
                        height={() => selectedHuman()?.height || 0}
                        setHeight={(h: number) => {
                          setActiveChart("height");
                          updateSelectedHuman({ height: h });
                        }}
                        weight={() => selectedHuman()?.weight || 0}
                        setWeight={(w: number) => updateSelectedHuman({ weight: w })}
                        ageGroup={() => selectedHuman()?.ageGroup || ''}
                        setAgeGroup={(ag: string) => updateSelectedHuman({ ageGroup: ag })}
                      />
                    ) : (
                      <WeightForAgeChart
                        height={() => selectedHuman()?.height || 0}
                        setHeight={(h: number) => updateSelectedHuman({ height: h })}
                        weight={() => selectedHuman()?.weight || 0}
                        setWeight={(w: number) => {
                          setActiveChart("weight");
                          updateSelectedHuman({ weight: w });
                        }}
                        ageGroup={() => selectedHuman()?.ageGroup || ''}
                        setAgeGroup={(ag: string) => updateSelectedHuman({ ageGroup: ag })}
                      />
                    )}
                    </div>
                  </Show>
                </>
              )}
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
};

export default Humans;
