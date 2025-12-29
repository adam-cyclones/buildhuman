import { createSignal, For, Accessor, Setter } from "solid-js";

interface Category {
  id: string;
  name: string;
  type_id: string;
}

interface AssetFiltersProps {
  searchQuery: Accessor<string>;
  setSearchQuery: Setter<string>;
  sortBy: Accessor<string>;
  setSortBy: Setter<string>;
  selectedType: Accessor<string>;
  setSelectedType: Setter<string>;
  selectedCategory: Accessor<string>;
  setSelectedCategory: Setter<string>;
  filteredCategories: Accessor<Category[]>;
  assetCount: number;
  onSearch: () => void;
  showModeratorOptions?: boolean;
  viewMode: Accessor<string>;
  setViewMode: Setter<string>;
}

/**
 * Asset Library Filters Component
 * Provides search, sort, type/category filtering
 */
const AssetFilters = (props: AssetFiltersProps) => {
  const [showFilters, setShowFilters] = createSignal(false);

  return (
    <>
      <div class="asset-library-header">
        <div class="search-bar">
          <div class="view-toggle">
            <button
              class={`view-btn ${props.viewMode() === "grid" ? "active" : ""}`}
              onClick={() => props.setViewMode("grid")}
              title="Grid view"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              class={`view-btn ${props.viewMode() === "list" ? "active" : ""}`}
              onClick={() => props.setViewMode("list")}
              title="List view"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>
          <input
            type="text"
            class="search-input"
            placeholder="Search assets..."
            value={props.searchQuery()}
            onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
            onKeyPress={(e) => e.key === "Enter" && props.onSearch()}
          />
          <button class="header-btn" onClick={props.onSearch}>
            Search
          </button>
          <button
            class={`filter-toggle-btn ${showFilters() ? "active" : ""}`}
            onClick={() => setShowFilters(!showFilters())}
            title="Toggle filters"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filters
          </button>
          <span class="page-info">
            {props.assetCount} assets
          </span>
        </div>
        {showFilters() && (
          <div class="filters-panel">
            <div class="control-group">
              <label>Sort:</label>
              <select
                class="select-input"
                value={props.sortBy()}
                onChange={(e) => props.setSortBy(e.currentTarget.value)}
              >
                <option value="recent">Recent</option>
                <option value="rating">Rating</option>
                <option value="name">Name</option>
                <option value="downloads">Downloads</option>
              </select>
            </div>
            <div class="control-group">
              <label>Type:</label>
              <select
                class="select-input"
                value={props.selectedType()}
                onChange={(e) => {
                  props.setSelectedType(e.currentTarget.value);
                  props.setSelectedCategory("all");
                }}
              >
                <option value="all">All</option>
                <option value="models">Models</option>
                <option value="environment">Environment</option>
                {props.showModeratorOptions && (
                  <option value="pending">Pending</option>
                )}
              </select>
            </div>
            <div class="control-group">
              <label>Category:</label>
              <select
                class="select-input"
                value={props.selectedCategory()}
                onChange={(e) => props.setSelectedCategory(e.currentTarget.value)}
              >
                <option value="all">All</option>
                <For each={props.filteredCategories()}>
                  {(cat) => <option value={cat.id}>{cat.name}</option>}
                </For>
              </select>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default AssetFilters;
