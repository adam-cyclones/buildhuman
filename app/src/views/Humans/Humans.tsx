import { createSignal, For, Switch, Match } from "solid-js";
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

  return (
    <div class="three-d-editor">
      <ThreeDViewport onAddHuman={addHuman} mouldRadius={mouldRadius()} />

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
                            <div
                              class={`tree-item tree-indent-2 ${
                                selectedHumanId() === human.id ? "active" : ""
                              }`}
                              onClick={() => setSelectedHumanId(human.id)}
                              onDblClick={startRename}
                            >
                              <span class="tree-icon">•</span>
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
                    <h4>Mould System (Phase 1)</h4>

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
                        onInput={(e) => setMouldRadius(parseFloat(e.currentTarget.value))}
                        class="property-slider"
                      />
                    </div>
                  </div>

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
