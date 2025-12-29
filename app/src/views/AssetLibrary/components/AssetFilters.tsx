import { createSignal, For } from "solid-js";
import type { AssetFiltersProps } from "../types";
import Icon from "../../../components/Icon";

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
              <Icon name="grid" size={16} />
            </button>
            <button
              class={`view-btn ${props.viewMode() === "list" ? "active" : ""}`}
              onClick={() => props.setViewMode("list")}
              title="List view"
            >
              <Icon name="list" size={16} />
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
            <Icon name="filter" size={16} />
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
