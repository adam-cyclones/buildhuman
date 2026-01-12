import { createSignal, createEffect, For, Switch, Match } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import ThreeDViewport from "./components/3DViewport";
import WeightForAgeChart from "./components/WeightForAgeChart";
import HeightForAgeChart from "./components/HeightForAgeChart";
import Tabs from "../../components/Tabs";
import Icon from "../../components/Icon";
import type { Human } from "./types";
import "./Humans.css";

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
  const [renamingId, setRenamingId] = createSignal<number | null>(null);
  const [expandedNodes, setExpandedNodes] = createSignal<Set<string>>(new Set(["scene", "humans"]));
  const [activeChart, setActiveChart] = createSignal<"height" | "weight">("weight");
  const [sceneTab, setSceneTab] = createSignal("Scene");
  const sceneTabs = ["Scene", "Properties"];
  const [mouldRadius, setMouldRadius] = createSignal(0.5);
  const [debouncedMouldRadius, setDebouncedMouldRadius] = createSignal(0.5);
  const [voxelResolution, setVoxelResolution] = createSignal<32 | 48 | 64 | 96 | 128 | 256>(64);
  const [jointMovement, setJointMovement] = createSignal<{ jointId: string; offset: [number, number, number] } | null>(null);
  const [jointRotation, setJointRotation] = createSignal<{ jointId: string; euler: [number, number, number] } | null>(null);
  const [showSkeleton, setShowSkeleton] = createSignal(true);
  const [selectedJointId, setSelectedJointId] = createSignal<string | null>(null);
  const [skeletonJoints, setSkeletonJoints] = createSignal<Array<{ id: string; parentId?: string; children: string[] }>>([]);
  const [moulds, setMoulds] = createSignal<Array<{ id: string; shape: "sphere" | "capsule"; parentJointId?: string }>>([]);

  // Track slider values for joint transforms (reset when joint selection changes)
  const [sliderRotX, setSliderRotX] = createSignal(0);
  const [sliderRotY, setSliderRotY] = createSignal(0);
  const [sliderRotZ, setSliderRotZ] = createSignal(0);
  const [sliderTransX, setSliderTransX] = createSignal(0);
  const [sliderTransY, setSliderTransY] = createSignal(0);
  const [sliderTransZ, setSliderTransZ] = createSignal(0);

  // Reset sliders when joint selection changes
  createEffect(() => {
    selectedJointId();
    setSliderRotX(0);
    setSliderRotY(0);
    setSliderRotZ(0);
    setSliderTransX(0);
    setSliderTransY(0);
    setSliderTransZ(0);
  });

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

  // Auto-expand skeleton nodes when skeleton loads
  createEffect(() => {
    const joints = skeletonJoints();
    if (joints.length > 0) {
      setExpandedNodes(prev => {
        const newSet = new Set(prev);
        newSet.add('human-1'); // Expand first human
        newSet.add('skeleton-1'); // Expand skeleton
        // Auto-expand all joint nodes with children
        joints.forEach(j => {
          if (j.children.length > 0) {
            newSet.add(`joint-${j.id}`);
          }
        });
        return newSet;
      });
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

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
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

  const moveJoint = (jointId: string, axis: 'x' | 'y' | 'z', amount: number) => {
    const offset: [number, number, number] = [0, 0, 0];
    if (axis === 'x') offset[0] = amount;
    if (axis === 'y') offset[1] = amount;
    if (axis === 'z') offset[2] = amount;
    setJointMovement({ jointId, offset });
  };

  const rotateJoint = (jointId: string, axis: 'x' | 'y' | 'z', degrees: number) => {
    const radians = degrees * (Math.PI / 180);
    const euler: [number, number, number] = [0, 0, 0];
    if (axis === 'x') euler[0] = radians;
    if (axis === 'y') euler[1] = radians;
    if (axis === 'z') euler[2] = radians;
    setJointRotation({ jointId, euler });
  };

  // Throttle updates during drag for better performance
  let rotationThrottleTimer: number | undefined;
  let translationThrottleTimer: number | undefined;

  // Handle rotation input (continuous during drag)
  const handleRotationInput = (e: Event, axis: 'x' | 'y' | 'z') => {
    const target = e.currentTarget as HTMLInputElement;
    const value = parseFloat(target.value);

    // Calculate delta from current slider position
    const currentValue = axis === 'x' ? sliderRotX() : axis === 'y' ? sliderRotY() : sliderRotZ();
    const delta = value - currentValue;

    if (Math.abs(delta) > 0.1 && selectedJointId()) {
      // Throttle updates to every 50ms during drag for smoothness
      if (!rotationThrottleTimer) {
        rotateJoint(selectedJointId()!, axis, delta);
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

    // Update the corresponding slider signal
    if (axis === 'x') setSliderRotX(value);
    if (axis === 'y') setSliderRotY(value);
    if (axis === 'z') setSliderRotZ(value);
  };

  // Handle translation input (continuous during drag)
  const handleTranslationInput = (e: Event, axis: 'x' | 'y' | 'z') => {
    const target = e.currentTarget as HTMLInputElement;
    const value = parseFloat(target.value);

    // Calculate delta from current slider position
    const currentValue = axis === 'x' ? sliderTransX() : axis === 'y' ? sliderTransY() : sliderTransZ();
    const delta = value - currentValue;

    if (Math.abs(delta) > 0.001 && selectedJointId()) {
      // Throttle updates to every 50ms during drag for smoothness
      if (!translationThrottleTimer) {
        moveJoint(selectedJointId()!, axis, delta);
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

    // Update the corresponding slider signal
    if (axis === 'x') setSliderTransX(value);
    if (axis === 'y') setSliderTransY(value);
    if (axis === 'z') setSliderTransZ(value);
  };

  // Recursive component to render joint hierarchy
  const JointTreeNode = (props: { joint: { id: string; parentId?: string; children: string[] }; indent: number }) => {
    const nodeId = `joint-${props.joint.id}`;
    const hasChildren = props.joint.children.length > 0;

    return (
      <>
        <div
          class={`tree-item tree-indent-${props.indent} ${selectedJointId() === props.joint.id ? 'active' : ''}`}
          onClick={() => setSelectedJointId(props.joint.id)}
        >
          {hasChildren && (
            <span
              class={`tree-icon tree-arrow ${expandedNodes().has(nodeId) ? "expanded" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(nodeId);
              }}
            >
              ▶
            </span>
          )}
          {!hasChildren && <span class="tree-icon" style="width: 12px; display: inline-block;"></span>}
          <span class="tree-icon">🦴</span>
          <span class="tree-label">{props.joint.id}</span>
        </div>
        {hasChildren && expandedNodes().has(nodeId) && (
          <For each={props.joint.children}>
            {(childId) => {
              const childJoint = skeletonJoints().find(j => j.id === childId);
              return childJoint ? <JointTreeNode joint={childJoint} indent={props.indent + 1} /> : null;
            }}
          </For>
        )}
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
        onSkeletonReady={setSkeletonJoints}
        onMouldsReady={setMoulds}
      />

      <div class="inspector">
        <div class="inspector-header">
          <Tabs tabs={sceneTabs} onTabChange={setSceneTab} />
        </div>
        <div class="inspector-content">
          <Switch>
            <Match when={sceneTab() === "Scene"}>
              <div class="scene-tree">
                <div class="tree-item tree-category">
                  <span
                    class={`tree-icon tree-arrow ${expandedNodes().has("scene") ? "expanded" : ""}`}
                    onClick={() => toggleNode("scene")}
                  >
                    ▶
                  </span>
                  <span class="tree-label">Scene</span>
                </div>
                {expandedNodes().has("scene") && (
                  <>
                    <div class="tree-item tree-category tree-indent-1">
                      <span
                        class={`tree-icon tree-arrow ${expandedNodes().has("humans") ? "expanded" : ""}`}
                        onClick={() => toggleNode("humans")}
                      >
                        ▶
                      </span>
                      <Icon name="user" size={16} class="tree-icon-svg" />
                      <span class="tree-label">Humans</span>
                    </div>
                    {expandedNodes().has("humans") && (
                      <For each={humans()}>
                        {(human) => {
                          const humanNodeId = `human-${human.id}`;
                          const skeletonNodeId = `skeleton-${human.id}`;
                          const mouldsNodeId = `moulds-${human.id}`;

                          const [tempName, setTempName] = createSignal(human.name);

                          const startRename = () => {
                            setTempName(human.name);
                            setRenamingId(human.id);
                          };

                          const finishRename = () => {
                            if (tempName() !== human.name) {
                              setHumans(
                                humans().map((h) =>
                                  h.id === human.id ? { ...h, name: tempName() } : h
                                )
                              );
                            }
                            setRenamingId(null);
                          };

                          return (
                            <>
                              <div
                                class={`tree-item tree-indent-2 ${
                                  selectedHumanId() === human.id ? "active" : ""
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedHumanId(human.id);
                                }}
                                onDblClick={startRename}
                              >
                                <span
                                  class={`tree-icon tree-arrow ${expandedNodes().has(humanNodeId) ? "expanded" : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleNode(humanNodeId);
                                  }}
                                >
                                  ▶
                                </span>
                                <Icon name="user" size={16} class="tree-icon-svg" />
                                {renamingId() === human.id ? (
                                  <input
                                    type="text"
                                    class="tree-rename-input"
                                    value={tempName()}
                                    onInput={(e) => setTempName(e.currentTarget.value)}
                                    onBlur={finishRename}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        finishRename();
                                      } else if (e.key === "Escape") {
                                        setRenamingId(null);
                                      }
                                    }}
                                    autofocus
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <span class="tree-label">{human.name}</span>
                                )}
                              </div>

                              {expandedNodes().has(humanNodeId) && (
                                <>
                                  {/* Skeleton hierarchy */}
                                  <div class="tree-item tree-category tree-indent-3">
                                    <span
                                      class={`tree-icon tree-arrow ${expandedNodes().has(skeletonNodeId) ? "expanded" : ""}`}
                                      onClick={() => toggleNode(skeletonNodeId)}
                                    >
                                      ▶
                                    </span>
                                    <span class="tree-label">Skeleton</span>
                                  </div>
                                  {expandedNodes().has(skeletonNodeId) && (
                                    <For each={skeletonJoints().filter(j => !j.parentId)}>
                                      {(rootJoint) => <JointTreeNode joint={rootJoint} indent={4} />}
                                    </For>
                                  )}

                                  {/* Moulds hierarchy */}
                                  <div class="tree-item tree-category tree-indent-3">
                                    <span
                                      class={`tree-icon tree-arrow ${expandedNodes().has(mouldsNodeId) ? "expanded" : ""}`}
                                      onClick={() => toggleNode(mouldsNodeId)}
                                    >
                                      ▶
                                    </span>
                                    <span class="tree-label">Moulds</span>
                                  </div>
                                  {expandedNodes().has(mouldsNodeId) && (
                                    <For each={moulds()}>
                                      {(mould) => (
                                        <div class="tree-item tree-indent-4">
                                          <span class="tree-icon">{mould.shape === 'sphere' ? '●' : '⬭'}</span>
                                          <span class="tree-label">{mould.id} ({mould.shape})</span>
                                        </div>
                                      )}
                                    </For>
                                  )}
                                </>
                              )}
                            </>
                          );
                        }}
                      </For>
                    )}
                  </>
                )}
              </div>
            </Match>
            <Match when={sceneTab() === "Properties"}>
              {selectedHuman() && (
                <>
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
                  <div class="property-section">
                    <h4>Mould System</h4>

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
