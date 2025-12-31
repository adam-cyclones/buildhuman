import { createSignal, onMount, onCleanup, Switch, Match } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import Tabs from "./components/Tabs";
import AssetLibrary from "./views/AssetLibrary/AssetLibrary";
import Settings from "./views/Settings/Settings";
import Humans from "./views/Humans/Humans";
import ReleaseManager from "./views/ReleaseManager/ReleaseManager";
import DropdownMenu from "./components/DropdownMenu";
import NotificationsCenter from "./components/NotificationsCenter";
import { IconSymbols } from "./components/Icon";
import { config } from "./config";

interface AppSettings {
  author_name: string;
  default_editor: string;
  default_editor_type: string;
  custom_assets_folder: string;
  moderator_api_key: string;
  moderator_mode: boolean;
}

function App() {
  const [activeMenu, setActiveMenu] = createSignal<string | null>(null);
  const [menuBarActive, setMenuBarActive] = createSignal(false);
  const [appSettings, setAppSettings] = createSignal<AppSettings | null>(null);

  const handleMenuClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.dropdown')) {
      setActiveMenu(null);
      setMenuBarActive(false);
    }
  };

  onMount(async () => {
    document.addEventListener("mousedown", handleMenuClickOutside);

    // Load app settings
    try {
      const settings = await invoke<AppSettings>("get_app_settings");
      setAppSettings(settings);
    } catch (error) {
      console.error("Failed to load app settings:", error);
    }

    // Check and download required assets on startup
    try {
      const result = await invoke("check_required_assets", {
        apiUrl: config.apiUrl,
      });
      console.log("Required assets check:", result);
    } catch (error) {
      console.error("Failed to check required assets:", error);
    }
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleMenuClickOutside);
  });

  const [activeTab, setActiveTab] = createSignal("Humans");
  const [previousTab, setPreviousTab] = createSignal("Humans");
  const [pendingSubmissionId, setPendingSubmissionId] = createSignal<string | null>(null);

  const exportGltf = () => {
    // Call the exportGltf function from 3DEditor view
    if ((window as any).exportGltf) {
      (window as any).exportGltf();
    }
  };

  const openSettings = () => {
    setPreviousTab(activeTab());
    setActiveTab("Settings");
  };

  const handleNotificationClick = (submissionId: string) => {
    // Switch to Asset Library tab
    setActiveTab("Asset Library");
    // Signal to AssetLibrary to open this submission
    setPendingSubmissionId(submissionId);
  };

  const fileMenuItems = [{ label: "Export GLTF", onClick: exportGltf }];
  const editMenuItems = [
    { label: "Undo", onClick: () => {} },
    { label: "Redo", onClick: () => {} },
    { label: "Settings", onClick: openSettings }
  ];
  const viewMenuItems = [{ label: "Toggle Fullscreen", onClick: () => {} }];
  const helpMenuItems = [{ label: "About", onClick: () => {} }];

  const tabs = ["Humans", "Asset Library"];

  return (
    <>
      <IconSymbols />
      <div class="app">
        <div class="menu-bar">
        <div class="menu-items">
          <DropdownMenu
            label="File"
            items={fileMenuItems}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            menuBarActive={menuBarActive}
            setMenuBarActive={setMenuBarActive}
          />
          <DropdownMenu
            label="Edit"
            items={editMenuItems}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            menuBarActive={menuBarActive}
            setMenuBarActive={setMenuBarActive}
          />
          <DropdownMenu
            label="View"
            items={viewMenuItems}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            menuBarActive={menuBarActive}
            setMenuBarActive={setMenuBarActive}
          />
          <DropdownMenu
            label="Help"
            items={helpMenuItems}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            menuBarActive={menuBarActive}
            setMenuBarActive={setMenuBarActive}
          />
        </div>
        <div class="app-title">
          <Tabs tabs={tabs} onTabChange={setActiveTab} />
        </div>
        <div class="menu-right">
          <NotificationsCenter onNotificationClick={handleNotificationClick} />
        </div>
      </div>

      <div class={`main-container full-width`}>
        <Switch>
          <Match when={activeTab() === "Humans"}>
            <Humans />
          </Match>
          <Match when={activeTab() === "Asset Library"}>
            <AssetLibrary
              appSettings={appSettings()}
              onTabChange={setActiveTab}
              pendingSubmissionId={pendingSubmissionId()}
              onSubmissionOpened={() => setPendingSubmissionId(null)}
            />
          </Match>
          <Match when={activeTab() === "Settings"}>
            <Settings onClose={async () => {
              // Reload settings to pick up changes (especially moderator mode)
              try {
                const settings = await invoke<AppSettings>("get_app_settings");
                setAppSettings(settings);
              } catch (error) {
                console.error("Failed to reload settings:", error);
              }
              setActiveTab(previousTab());
            }} />
          </Match>
          <Match when={activeTab() === "Releases"}>
            <ReleaseManager
              appSettings={appSettings()}
              onBack={() => setActiveTab("Asset Library")}
            />
          </Match>
        </Switch>
      </div>
    </div>
    </>
  );
}

export default App;
