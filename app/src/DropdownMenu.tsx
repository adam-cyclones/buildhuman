import { For, Accessor, Setter } from "solid-js";
import "./DropdownMenu.css";

interface MenuItem {
  label: string;
  onClick: () => void;
}

interface DropdownMenuProps {
  label: string;
  items: MenuItem[];
  activeMenu: Accessor<string | null>;
  setActiveMenu: Setter<string | null>;
  menuBarActive: Accessor<boolean>;
  setMenuBarActive: Setter<boolean>;
}

const DropdownMenu = (props: DropdownMenuProps) => {
  const isOpen = () => props.activeMenu() === props.label;

  const handleClick = () => {
    if (isOpen()) {
      props.setActiveMenu(null);
      props.setMenuBarActive(false);
    } else {
      props.setActiveMenu(props.label);
      props.setMenuBarActive(true);
    }
  };

  const handleMouseEnter = () => {
    if (props.menuBarActive()) {
      props.setActiveMenu(props.label);
    }
  };

  const handleItemClick = (item: MenuItem) => {
    item.onClick();
    props.setActiveMenu(null);
    props.setMenuBarActive(false);
  };

  return (
    <div class="dropdown">
      <button
        class="menu-btn"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
      >
        {props.label}
      </button>
      {isOpen() && (
        <div class="dropdown-content">
          <For each={props.items}>
            {(item) => (
              <div class="dropdown-item" onClick={() => handleItemClick(item)}>
                {item.label}
              </div>
            )}
          </For>
        </div>
      )}
    </div>
  );
};

export default DropdownMenu;
