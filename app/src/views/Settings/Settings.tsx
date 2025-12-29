import { createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { config } from "../../config";
import Icon from "../../components/Icon";
import "./Settings.css";

interface LocalAsset {
  metadata: {
    id: string;
    name: string;
    type: string;
    file_size?: number;
    required: boolean;
  };
  file_path: string;
  downloaded_at: string;
  cached: boolean;
  is_edited: boolean;
  original_id?: string;
}

interface SettingsProps {
  onClose: () => void;
}

interface AppSettings {
  author_name: string;
  default_editor: string;
  default_editor_type: string;
  custom_assets_folder: string;
  moderator_api_key: string;
  moderator_mode: boolean;
}

const Settings = (_props: SettingsProps) => {
  const [cachedAssets, setCachedAssets] = createSignal<LocalAsset[]>([]);
  const [clearing, setClearing] = createSignal(false);
  const [activeCategory, setActiveCategory] = createSignal("general");
  const [settings, setSettings] = createSignal<AppSettings>({
    author_name: "",
    default_editor: "",
    default_editor_type: "",
    custom_assets_folder: "",
    moderator_api_key: "",
    moderator_mode: false,
  });
  const [showToast, setShowToast] = createSignal(false);
  const [toastMessage, setToastMessage] = createSignal("");
  const [toastType, setToastType] = createSignal<"success" | "error">("success");

  const loadCachedAssets = async () => {
    try {
      const assets = await invoke<LocalAsset[]>("list_cached_assets");
      setCachedAssets(assets);
    } catch (error) {
      console.error("Failed to load cached assets:", error);
    }
  };

  const loadSettings = async () => {
    try {
      const loadedSettings = await invoke<AppSettings>("get_app_settings");
      setSettings(loadedSettings);
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  };

  const showSaveToast = (message: string, type: "success" | "error" = "success") => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const saveSettings = async () => {
    try {
      await invoke("save_app_settings", { settings: settings() });
      showSaveToast("Settings saved");
    } catch (error) {
      console.error("Failed to save settings:", error);
      showSaveToast("Failed to save settings");
    }
  };

  // Debounced auto-save
  let saveTimeout: number | undefined;
  const autoSaveSettings = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveSettings();
    }, 500);
  };

  const handleBrowseEditor = async () => {
    try {
      const selected = await open({
        title: "Select Default Editor",
        multiple: false,
        directory: false,
        filters: [{
          name: "Applications",
          extensions: ["app", "exe"]
        }]
      });
      if (selected) {
        setSettings({ ...settings(), default_editor: selected });
        autoSaveSettings();
      }
    } catch (error) {
      console.error("Failed to browse for editor:", error);
    }
  };

  const handleBrowseAssetsFolder = async () => {
    try {
      const selected = await open({
        title: "Select Created Asset Folder",
        multiple: false,
        directory: true,
      });
      if (selected) {
        setSettings({ ...settings(), custom_assets_folder: selected });
        autoSaveSettings();
      }
    } catch (error) {
      console.error("Failed to browse for folder:", error);
    }
  };

  const handleResetAssetsFolder = async () => {
    try {
      const appDataPath = await invoke<string>("get_app_data_path");
      const defaultPath = `${appDataPath}/created-assets`;
      setSettings({ ...settings(), custom_assets_folder: defaultPath });
      autoSaveSettings();
    } catch (error) {
      console.error("Failed to reset folder:", error);
    }
  };

  const handleOpenCacheFolder = async () => {
    try {
      const appDataPath = await invoke<string>("get_app_data_path");
      const cachePath = `${appDataPath}/cache`;
      await invoke("open_folder", { path: cachePath });
    } catch (error) {
      console.error("Failed to open cache folder:", error);
    }
  };

  const handleClearCache = async () => {
    if (!confirm("Clear all non-essential cached assets?")) {
      return;
    }

    try {
      setClearing(true);
      await invoke("clear_cache");
      await loadCachedAssets();
    } catch (error) {
      console.error("Failed to clear cache:", error);
      alert(`Failed to clear cache: ${error}`);
    } finally {
      setClearing(false);
    }
  };

  const getTotalCacheSize = () => {
    return cachedAssets().reduce((total, asset) => {
      return total + (asset.metadata.file_size || 0);
    }, 0);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  onMount(() => {
    loadCachedAssets();
    loadSettings();
  });

  return (
    <div class="settings-container">
      <div class="settings-sidebar">
        <div class="settings-sidebar-header">
          <h3>Settings</h3>
        </div>
        <div class="settings-tree">
          <div
            class={`tree-item ${activeCategory() === "general" ? "active" : ""}`}
            onClick={() => setActiveCategory("general")}
          >
            <span class="tree-icon">•</span>
            <Icon name="settings" size={16} class="tree-icon-svg" />
            <span class="tree-label">General</span>
          </div>
          <div
            class={`tree-item ${activeCategory() === "cache" ? "active" : ""}`}
            onClick={() => setActiveCategory("cache")}
          >
            <span class="tree-icon">•</span>
            <Icon name="folder" size={16} class="tree-icon-svg" />
            <span class="tree-label">Cache</span>
          </div>
          <div
            class={`tree-item ${activeCategory() === "moderation" ? "active" : ""}`}
            onClick={() => setActiveCategory("moderation")}
          >
            <span class="tree-icon">•</span>
            <Icon name="shield" size={16} class="tree-icon-svg" />
            <span class="tree-label">Moderation</span>
          </div>
        </div>
      </div>

      <div class="settings-content">
            {activeCategory() === "cache" && (
              <div class="settings-section">
                <h3>Cache Management</h3>

                <div class="cache-stats">
              <div class="cache-stat">
                <span class="cache-stat-label">Cached Assets:</span>
                <span class="cache-stat-value">{cachedAssets().length}</span>
              </div>
              <div class="cache-stat">
                <span class="cache-stat-label">Total Size:</span>
                <span class="cache-stat-value">{formatBytes(getTotalCacheSize())}</span>
              </div>
            </div>

            <div class="cache-actions">
              <button
                class="settings-btn"
                onClick={handleOpenCacheFolder}
                title="Open cache folder"
              >
                <Icon name="folder" size={16} />
                Open Cache Folder
              </button>
              <button
                class="settings-btn danger"
                onClick={handleClearCache}
                disabled={clearing() || cachedAssets().length === 0}
              >
                {clearing() ? "Clearing..." : "Clear Cache"}
              </button>
            </div>

            <p class="cache-note">
              Delete individual cached assets from the Asset Library detail panel.
            </p>
              </div>
            )}

            {activeCategory() === "general" && (
              <div class="settings-section">
                <h3>General Settings</h3>

                <div class="setting-group">
                  <label class="setting-label">Author Name</label>
                  <p class="setting-description">Your name for metadata and asset attribution</p>
                  <input
                    type="text"
                    class="setting-input"
                    value={settings().author_name}
                    onInput={(e) => {
                      setSettings({ ...settings(), author_name: e.currentTarget.value });
                      autoSaveSettings();
                    }}
                    placeholder="Enter your name"
                  />
                  <p class="setting-note">We don't collect or store your personal details. All settings are saved locally on your device.</p>
                </div>

                <div class="setting-group">
                  <label class="setting-label">3D Editor</label>
                  <p class="setting-description">Choose your preferred 3D modeling software</p>

                  <div class="editor-options">
                    <label class={`editor-option ${settings().default_editor_type === "blender" ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="editor"
                        value="blender"
                        checked={settings().default_editor_type === "blender"}
                        onChange={(e) => {
                          setSettings({ ...settings(), default_editor_type: e.currentTarget.value });
                          autoSaveSettings();
                        }}
                      />
                      <div class="editor-info">
                        <span class="editor-name">Blender</span>
                        <span class="editor-status">Supported</span>
                      </div>
                    </label>

                    <label class="editor-option disabled">
                      <input type="radio" name="editor" value="maya" disabled />
                      <div class="editor-info">
                        <span class="editor-name">Maya</span>
                        <span class="editor-status coming-soon">Coming Soon</span>
                      </div>
                    </label>

                    <label class="editor-option disabled">
                      <input type="radio" name="editor" value="max" disabled />
                      <div class="editor-info">
                        <span class="editor-name">3ds Max</span>
                        <span class="editor-status coming-soon">Coming Soon</span>
                      </div>
                    </label>

                    <label class="editor-option disabled">
                      <input type="radio" name="editor" value="houdini" disabled />
                      <div class="editor-info">
                        <span class="editor-name">Houdini</span>
                        <span class="editor-status coming-soon">Coming Soon</span>
                      </div>
                    </label>
                  </div>

                  <p class="setting-note" style="margin-top: 0.75rem;">
                    Want support for another editor? <a href="https://github.com/yourusername/repo/issues" target="_blank" style="color: var(--accent); text-decoration: none;">Request it here</a>
                  </p>

                  {settings().default_editor_type === "blender" && (
                    <div class="setting-input-with-button" style="margin-top: 1rem;">
                      <input
                        type="text"
                        class="setting-input"
                        value={settings().default_editor}
                        onInput={(e) => {
                          setSettings({ ...settings(), default_editor: e.currentTarget.value });
                          autoSaveSettings();
                        }}
                        placeholder="Path to Blender executable"
                      />
                      <button class="settings-btn" onClick={handleBrowseEditor}>
                        Browse
                      </button>
                    </div>
                  )}
                </div>

                <div class="setting-group">
                  <label class="setting-label">Created Asset Folder</label>
                  <p class="setting-description">Directory for storing your created assets (defaults to ~/.buildhuman/created-assets)</p>
                  <div class="setting-input-with-button">
                    <input
                      type="text"
                      class="setting-input"
                      value={settings().custom_assets_folder}
                      onInput={(e) => {
                        setSettings({ ...settings(), custom_assets_folder: e.currentTarget.value });
                        autoSaveSettings();
                      }}
                      placeholder="Path to created assets folder"
                    />
                    <button class="settings-btn" onClick={handleBrowseAssetsFolder}>
                      Browse
                    </button>
                    <button class="settings-btn" onClick={handleResetAssetsFolder} title="Reset to default">
                      <Icon name="rotate-ccw" size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeCategory() === "moderation" && (
              <div class="settings-section">
                <h3>Moderation Settings</h3>

                <div class="setting-group">
                  <label class="setting-label">Moderator Mode</label>
                  <p class="setting-description">Enable moderation features to review submitted assets</p>
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings().moderator_mode}
                      onChange={(e) => {
                        setSettings({ ...settings(), moderator_mode: e.currentTarget.checked });
                        autoSaveSettings();
                      }}
                    />
                    <span class="slider"></span>
                  </label>
                </div>

                {settings().moderator_mode && (
                  <>
                    <div class="setting-group">
                      <label class="setting-label">API Key</label>
                      <p class="setting-description">Enter your moderator API key to access moderation features</p>
                      <input
                        type="password"
                        class="setting-input"
                        value={settings().moderator_api_key}
                        onInput={(e) => {
                          setSettings({ ...settings(), moderator_api_key: e.currentTarget.value });
                          autoSaveSettings();
                        }}
                        placeholder="Enter API key"
                      />
                    </div>

                    <div class="setting-group">
                      <button
                        class="settings-btn"
                        onClick={async () => {
                          try {
                            const response = await fetch(`${config.apiUrl}/api/auth/verify`, {
                              method: "POST",
                              headers: {
                                "X-API-Key": settings().moderator_api_key
                              }
                            });
                            if (response.ok) {
                              const data = await response.json();
                              showSaveToast(`Verified as ${data.name} (${data.role})`, "success");
                            } else {
                              showSaveToast("Invalid API key", "error");
                            }
                          } catch (error) {
                            showSaveToast("Failed to verify - service offline?", "error");
                          }
                        }}
                        disabled={!settings().moderator_api_key}
                      >
                        Verify API Key
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
      </div>

      {showToast() && (
        <div class={`settings-toast ${toastType()}`}>
          {toastType() === "success" ? (
            <Icon name="check" size={16} />
          ) : (
            <Icon name="x-circle" size={16} />
          )}
          <span>{toastMessage()}</span>
        </div>
      )}
    </div>
  );
};

export default Settings;
