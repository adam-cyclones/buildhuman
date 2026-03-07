import { createSignal, For } from "solid-js";
import "./Tabs.css";

interface TabsProps {
  tabs: string[];
  onTabChange: (tab: string) => void;
  activeTab?: string;
}

const Tabs = (props: TabsProps) => {
  const [activeTab, setActiveTab] = createSignal(props.tabs[0]);
  const currentActiveTab = () => props.activeTab ?? activeTab();

  const handleTabClick = (tab: string) => {
    if (props.activeTab === undefined) {
      setActiveTab(tab);
    }
    props.onTabChange(tab);
  };

  return (
    <div class="tabs">
      <For each={props.tabs}>
        {(tab) => (
          <button
            class={`tab-btn ${currentActiveTab() === tab ? "active" : ""}`}
            onClick={() => handleTabClick(tab)}
          >
            {tab}
          </button>
        )}
      </For>
    </div>
  );
};

export default Tabs;
