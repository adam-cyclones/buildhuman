import { createSignal, For } from "solid-js";
import "./Tabs.css";

interface TabsProps {
  tabs: string[];
  onTabChange: (tab: string) => void;
}

const Tabs = (props: TabsProps) => {
  const [activeTab, setActiveTab] = createSignal(props.tabs[0]);

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    props.onTabChange(tab);
  };

  return (
    <div class="tabs">
      <For each={props.tabs}>
        {(tab) => (
          <button
            class={`tab-btn ${activeTab() === tab ? "active" : ""}`}
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
