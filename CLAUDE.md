# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BuildHuman is a desktop application for creating customizable 3D human characters. It's built as a monorepo with:
- **Desktop app**: Tauri 2.0 (Rust backend) + SolidJS frontend + Babylon.js 3D rendering
- **Asset service**: Python FastAPI server for managing 3D assets (models, clothing, accessories)

## Essential Commands

### Desktop App (app/)

```bash
cd app

# Development (runs both Vite dev server + Tauri)
npm run tauri dev

# Build for production
npm run build              # Build frontend (TypeScript check + Vite)
npm run tauri build        # Build complete Tauri application

# Frontend only (without Tauri)
npm run dev                # Vite dev server on localhost:1420
npm run preview            # Preview production build
```

### Asset Service (service/)

```bash
cd service

# Setup
poetry install

# Development
poetry poe dev             # Run with hot reload (localhost:8000)
poetry poe seed            # Populate database with sample assets

# Production & utilities
poetry poe serve           # Production server
poetry poe format          # Format with Black
poetry poe lint            # Lint with Ruff
poetry poe test            # Run tests
```

### Working with Tauri

```bash
cd app

# Tauri-specific commands (via npm script)
npm run tauri dev          # Dev mode (hot reload enabled)
npm run tauri build        # Production build
npm run tauri -- --help    # Access Tauri CLI directly
```

## Architecture

### Three-Tier Structure

```
┌─────────────────────────┐
│  SolidJS Frontend       │  TypeScript, Babylon.js 3D rendering
│  (app/src/*.tsx)        │  Reactive UI with createSignal/createResource
└──────────┬──────────────┘
           │ Tauri IPC (invoke/listen)
┌──────────▼──────────────┐
│  Rust Backend           │  Tauri 2.0, file I/O, Blender integration
│  (app/src-tauri/src/)   │  
└──────────┬──────────────┘
           │ HTTP REST
┌──────────▼──────────────┐
│  Python Asset Service   │  FastAPI, SQLite metadata storage
│  (service/main.py)      │  http://localhost:8000 set from .env
└─────────────────────────┘
```

### Key Architectural Patterns

**Tauri IPC Communication**:
- Frontend → Backend: `invoke("command_name", {args})`
- Backend → Frontend: `app.emit("event-name", payload)`
- Commands defined as `#[tauri::command]` in Rust

**Asset Management Flow**:
1. API service hosts assets (metadata in SQLite, files in storage/)
2. Tauri downloads assets to local cache (`~/.buildhuman/cache/`)
3. Frontend displays cached + API assets, merges edited versions
4. Edited assets stored in `~/.buildhuman/created-assets/`

**File Watching**:
- Rust uses `notify` crate to watch asset files during Blender editing
- Changes emit `asset-file-changed` events to frontend
- Frontend refreshes UI automatically

### Local Storage Structure

Assets stored at `~/.buildhuman/`:
```
cache/
  models/{asset_id}_{name}.glb          # Downloaded from API
  models/{asset_id}_metadata.json       # Asset metadata
  environment/                          # Environment assets
created-assets/                         # User-edited assets
  {original_id}_edited_{timestamp}.glb
library/                                # Custom user assets
settings.json                           # App settings
```

### Frontend Structure

**View-Based Architecture** (`app/src/views/`):
Each view follows a consistent pattern with dedicated folders:

```
views/
├── AssetLibrary/
│   ├── AssetLibrary.tsx       418 lines  (main component)
│   ├── client.ts              144 lines  (API calls)
│   ├── handlers.ts            678 lines  (event handlers)
│   ├── utils.ts               194 lines  (utilities)
│   ├── hooks/
│   │   └── useAssetState.ts   136 lines  (state management)
│   ├── components/            (view-specific components)
│   │   ├── AssetCard.tsx
│   │   ├── AssetGrid.tsx
│   │   ├── AssetFilters.tsx
│   │   └── AssetDetailPanel.tsx
│   ├── types.ts               (TypeScript types) !never use interfaces, use types!
│   └── AssetLibrary.css       (styles)
├── Humans/
│   ├── Humans.tsx             410 lines  (main component)
│   ├── components/
│   │   ├── 3DViewport.tsx     (viewport with toolbar and 3D scene)
│   │   ├── BabylonScene.tsx
│   │   ├── HeightForAgeChart.tsx
│   │   └── WeightForAgeChart.tsx
│   ├── types.ts
│   └── Humans.css
├── Settings/
│   ├── Settings.tsx           461 lines
│   ├── Settings.css
│   └── types.ts
└── Moderation/
    ├── Moderation.tsx         252 lines
    └── Moderation.css
```

**Shared Components** (`app/src/components/`):
- `Icon.tsx` - SVG icon system (31 icons via symbols)
- `Tabs.tsx` - Reusable tab component
- `DropdownMenu.tsx` - Menu bar dropdowns
- `NotificationsCenter.tsx` - Notification bell

**Main App** (`app/src/`):
- `App.tsx` - Application shell, routing, menu bar
- `App.css` - Global styles

**Backend (app/src-tauri/src/)**:
- `main.rs` - Entry point, Tauri setup, command registration
- `asset_manager.rs` - Core backend (1108 lines): download, cache, Blender integration
- `settings.rs` - Settings persistence
- `mesh/` - 3D mesh utilities

**Service (service/)**:
- `main.py` - FastAPI app with all asset API endpoints (900 lines)
- `seed_assets.py` - Sample data generator
- `assets.db` - SQLite database

## Important Conventions

### View Module Pattern

**Feature-Based Architecture**: Each view represents a distinct feature domain with complete encapsulation of its logic, state, and UI. This provides clear domain separation and prevents cross-feature coupling.

**Structure**:
```
views/ViewName/
├── ViewName.tsx          # Main component (composition only)
├── client.ts             # API calls and data fetching
├── handlers.ts           # Event handlers (factory functions)
├── utils.ts              # Pure utility functions
├── hooks/                # Custom hooks
│   └── useViewState.ts   # State management
├── machines/             # XState state machines (if needed)
│   ├── useFeatureMachine.ts       # SolidJS hook wrapper
│   └── featureMachine.ts          # XState machine definition
├── components/           # View-specific components
├── types.ts              # TypeScript type definitions
└── ViewName.css          # Styles
```

**Domain Separation Principles** (for Developer Experience):
- Each view owns its complete feature domain (data, logic, state, UI)
- View-specific code stays within the view folder for easier navigation
- Only truly shared components live in `app/src/components/`
- Global state/processes that span multiple views use XState machines
- Domain separation is about organization and maintainability, not strict isolation

**Separation of Concerns**:
- **client.ts**: All external API calls, no side effects
- **utils.ts**: Pure functions, no state, deterministic
- **handlers.ts**: Event handlers as factory functions receiving dependencies
- **hooks/**: State management using SolidJS createSignal
- **machines/**: Complex state logic using XState (when simple signals aren't enough)
- **ViewName.tsx**: Composition layer, wires everything together

**Benefits**:
- **Domain isolation**: Each feature is self-contained and independent
- **Testable modules**: Each file can be tested independently
- **Clear ownership**: All code for a feature lives in one place
- **Easier maintenance**: Find and fix issues within a single domain
- **Scalable architecture**: Add new features without affecting existing ones
- **Reusable patterns**: Consistent structure across all features

### Icon System

Centralized SVG icon management via `components/Icon.tsx`:

**Usage**:
```tsx
import Icon from "../../components/Icon";

<Icon name="plus" size={24} />
<Icon name="download" size={16} class="custom-class" />
```

**Available Icons** (31 total):
`close`, `grid`, `list`, `filter`, `edit`, `image`, `trash`, `save`, `upload`,
`star`, `check`, `download`, `fork`, `settings`, `search`, `arrow-down`, `bell`,
`eye`, `folder`, `link`, `blender`, `reload`, `x-circle`, `shield`, `rotate-ccw`,
`rotate-cw`, `plus`, `move`, `user`, `dice`

**Implementation**: Uses SVG `<symbol>` definitions with `<use>` references for optimal performance and DRY code.

### Coding Standards

**Type Definitions**:
- **ALWAYS** define interfaces and types in `types.ts` within each view folder
- **NEVER** define interfaces inline in component files
- Use `import type { TypeName } from "./types"` for type imports
- Export all types/interfaces that may be used by other files in the view

**Example violations to avoid**:
```tsx
// ❌ BAD: Interface defined inline in component
const MyComponent = () => {
  interface MyData { id: string; name: string; }
  // ...
}

// ✅ GOOD: Types in types.ts
// types.ts
export interface MyData { id: string; name: string; }

// MyComponent.tsx
import type { MyData } from "./types";
```

**Testing Over Examples**:
- **NEVER** create example files (e.g., `example.ts`, `sample.tsx`, `demo.tsx`)
- **ALWAYS** write tests instead (e.g., `feature.test.ts`)
- If you feel the urge to create an example to demonstrate usage, write a test
- Tests serve as living documentation and ensure code actually works

**Complex State Management**:
- For complex state logic with multiple states/transitions, **use XState**
- **Test the state machine first** before integrating with UI
- Write tests for all state transitions and edge cases
- State machines should be in `machines/` folder within the view
- Structure:
  - `machines/featureMachine.ts` - XState machine definition
  - `machines/featureMachine.test.ts` - Machine tests
  - `machines/useFeature.ts` - SolidJS hook wrapper

**Benefits of this approach**:
- Type safety: Centralized type definitions prevent inconsistencies
- Testability: Tests replace throwaway example code
- Maintainability: State machines make complex logic explicit and testable
- Documentation: Tests and state machines document behavior better than examples

### Testing

**Test Framework**: Vitest (installed, minimal config for fast iteration)

**What to Test** (priority order for solo alpha development):
1. **State Machines** ⭐ - Highest value, pure logic, easy to test
2. **Utility Functions** - Pure functions in `utils.ts` files
3. **Client Functions** - API calls (with mocking when needed)
4. **Handlers** - Event handlers (when complexity warrants it)
5. **UI Components** - Only when stable (alpha = UI changes frequently)

**Running Tests**:
```bash
npm test              # Watch mode (interactive)
npm run test:ui       # Vitest UI (visual test runner)
npm run test:run      # Run once (CI mode)
```

**Test File Naming**:
- Place test files next to the code: `featureMachine.test.ts` next to `featureMachine.ts`
- Use `.test.ts` suffix (not `.spec.ts`)

**Example State Machine Test** (see `assetEditingMachine.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { myMachine } from './myMachine';

describe('MyMachine', () => {
  it('transitions to next state on EVENT', () => {
    const actor = createActor(myMachine).start();

    actor.send({ type: 'EVENT' });

    expect(actor.getSnapshot().value).toBe('nextState');
  });
});
```

**Why This Approach**:
- **State machines**: Pure logic, deterministic, high value
- **No UI tests yet**: UI changes too frequently in alpha
- **Fast feedback**: Vitest is fast, tests run in milliseconds
- **Low overhead**: Only test what matters for stability

**Coverage Philosophy** (for solo alpha):
- Don't aim for % coverage
- Test **critical flows** (editing, saving, publishing state transitions)
- Test **edge cases** (what happens on failure, cancel, etc.)
- Skip **obvious code** (getters, simple utilities)

### Asset ID Schemes
- **Original assets**: UUID from API (e.g., `abc123-def456`)
- **Edited assets**: `{original_uuid}_edited_{timestamp}`
- UI groups edited copies with their originals

### Error Handling
- Rust commands return `Result<T, String>` for Tauri
- Frontend uses try-catch around `invoke()` calls
- Display errors to user via console.error or UI alerts

### Async Patterns
- **Rust**: `async fn` with `reqwest` for HTTP downloads
- **Frontend**: `createResource()` for async data fetching
- **Debouncing**: Settings saves (500ms), file watches (500ms)

### Blender Integration
- Assets opened via `invoke("open_in_blender", {file_path, asset_id})`
- Spawns Blender process, monitors file for changes
- Auto-captures thumbnails by generating Python script for Blender
- Cleanup removes orphaned .blend files on app startup

## Startup Sequence

1. Tauri window initializes (1400x900, configured in tauri.conf.json)
2. Vite dev server or built frontend loads
3. SolidJS renders App component
4. `App.tsx` onMount() executes:
   - Cleans up orphaned .blend files
   - Checks required assets via `check_required_assets()`
   - Downloads missing/outdated required assets from API
   - Loads user settings from settings.json
5. AssetLibrary mounts:
   - Fetches cached assets via `list_cached_assets()`
   - Fetches API assets via `GET /api/assets`
   - Merges and displays in UI
6. BabylonScene initializes 3D preview

## Development Notes

### Running Full Stack
1. Start asset service: `cd service && poetry poe dev`
2. Start desktop app: `cd app && npm run tauri dev`
3. API available at http://localhost:8000 (docs at /docs)
4. Desktop app launches in development window

### Tauri Configuration
- Dev server: http://localhost:1420 (Vite)
- Window: 1400x900, non-transparent
- Security: CSP disabled (csp: null)
- macOS private API enabled for extended features

### Asset Service API Endpoints
- `GET /api/assets` - List/search (params: type, category, search, sort)
- `GET /api/assets/{id}` - Asset metadata
- `GET /api/assets/{id}/download` - Download GLB file
- `POST /api/assets/upload` - Upload new asset
- Categories: models, clothing, morphs, textures, accessories

### Technology Stack
| Component | Technology | Version |
|-----------|-----------|---------|
| Desktop shell | Tauri | 2.0.0 |
| Frontend framework | SolidJS | 1.9.10 |
| Frontend language | TypeScript | 5.6.2 |
| 3D web rendering | Babylon.js | 7.38.0 |
| Backend language | Rust | 2021 edition |
| Asset service | Python FastAPI | - |
| Python dependencies | Poetry | - |
| Build tool | Vite | 6.0.3 |
| GPU abstraction | WGPU | 23.0.1 |

**IMPORTANT**: This is a **desktop application only** (Tauri). It will **never run in a browser**.
- No need for browser compatibility prefixes (-webkit-, -moz-, etc.)
- No need for polyfills or cross-browser workarounds
- Target modern Chromium engine only (bundled with Tauri)
- Can use latest web APIs without fallbacks

### File Formats
- 3D models: GLB/GLTF (standard)
- Settings: JSON
- Asset metadata: JSON
- Database: SQLite (service only)

## Common Workflows

### Adding a New Tauri Command
1. Define function in Rust with `#[tauri::command]`
2. Return `Result<T, String>` where T is serializable
3. Register in `main.rs` via `.invoke_handler(tauri::generate_handler![...])`
4. Call from frontend: `invoke("command_name", {params})`

### Working with Assets
- Assets in cache are read-only (downloaded from API)
- To edit: create copy in `created-assets/` with `_edited_` suffix
- File watcher monitors for Blender saves
- Frontend receives `asset-file-changed` event on modification
- UI automatically refreshes to show updated asset

### Modifying Frontend UI
- SolidJS uses fine-grained reactivity (no virtual DOM)
- State: `createSignal()` for local, `createResource()` for async
- Effects: `createEffect()` for side effects, `onMount()` for initialization
- Styling: CSS modules (*.css files imported per component)

### Testing Changes
- Frontend: Make changes, Vite hot reloads automatically
- Backend: Restart `npm run tauri dev` (Rust changes require rebuild)
- Service: Poetry runs with `--reload`, changes apply automatically
- Full rebuild: `npm run build && npm run tauri build`
