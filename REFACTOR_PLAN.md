# VoxelMorphScene Refactoring Plan

## Current State
- **File**: `app/src/views/Humans/components/VoxelMorphScene.tsx`
- **Lines**: 1374 lines
- **Issues**: Too many concerns in one file, hard to navigate

## Proposed Structure

```
views/Humans/components/VoxelMorphScene/
├── VoxelMorphScene.tsx          # Main component (composition only, ~150 lines)
├── types.ts                     # TypeScript types
├── hooks/
│   └── useVoxelMorphState.ts    # State management hook
├── visualization/
│   ├── skeleton.ts              # createSkeletonVisualization
│   ├── profileRings.ts          # createProfileRingsVisualization
│   └── wireframe.ts             # updateWireframe
├── mesh/
│   ├── generation.ts            # regenerateMeshFromRust, updateMesh
│   └── rustSync.ts              # syncToRustBackend, scheduleSyncToRustBackend
├── initialization/
│   └── skeletonAndMoulds.ts     # initializeSkeletonAndMoulds (huge function)
├── snapshots/
│   ├── automation.ts            # setupSnapshotAutomation, captureAndEmitSnapshot
│   └── utils.ts                 # saveSnapshot, ensureSnapshotDir, etc.
└── handlers/
    └── events.ts                # handleSceneReady, handleCanvasClick
```

## Benefits
- Each file has single responsibility
- Easier to test individual pieces
- Better code navigation
- Follows CLAUDE.md view module pattern
- Reduces cognitive load

## Migration Strategy
1. Create folder structure
2. Extract types.ts first
3. Extract pure utility functions (snapshots/utils.ts)
4. Extract visualization functions
5. Extract mesh generation
6. Extract initialization
7. Refactor main component to use extracted modules
8. Test thoroughly

## Files to Create
1. `types.ts` - All TypeScript interfaces/types
2. `hooks/useVoxelMorphState.ts` - State management
3. `visualization/skeleton.ts` - Skeleton rendering
4. `visualization/profileRings.ts` - Ring visualization
5. `visualization/wireframe.ts` - Wireframe rendering
6. `mesh/generation.ts` - Mesh generation logic
7. `mesh/rustSync.ts` - Rust backend synchronization
8. `initialization/skeletonAndMoulds.ts` - Setup logic
9. `snapshots/automation.ts` - Snapshot automation
10. `snapshots/utils.ts` - Snapshot utilities
11. `handlers/events.ts` - Event handlers
12. `VoxelMorphScene.tsx` - Main composition component
