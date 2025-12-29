# Asset State Machine Rules

## Asset States

### 1. NOT_DOWNLOADED
**Criteria**: Asset exists in API but not in local cache
- Asset from `/api/assets` endpoint
- NOT in `cachedAssets()` map
- No local files exist

**Available Actions**:
- ✅ Download asset
- ✅ View metadata/details

**UI Elements**:
- Download button (full width)
- Asset info panel (read-only)

---

### 2. DOWNLOADING
**Criteria**: Asset download in progress
- `downloading()` signal equals asset ID
- HTTP request to `/api/assets/{id}/download` active

**Available Actions**:
- ⏳ Wait for download to complete
- ❌ Cannot edit, delete, or re-download

**UI Elements**:
- Download button shows "Downloading..." (disabled)

**Transitions**:
- ✅ Success → CACHED
- ❌ Error → NOT_DOWNLOADED

---

### 3. CACHED
**Criteria**: Asset downloaded and stored locally
- In `cachedAssets()` map
- Files exist at `~/.buildhuman/cache/models/{id}_{name}.glb`
- Metadata exists at `~/.buildhuman/cache/models/{id}_metadata.json`
- NOT editing (`!isEditingAsset(id)`)
- NOT required (`required: false`)

**Available Actions**:
- ✅ Edit (if license allows)
- ✅ Delete from cache
- ✅ View metadata
- ✅ Open file location

**UI Elements**:
- Edit button in footer
- Danger zone: "Delete from downloads"

**Guards**:
- Can edit IF `isLicenseEditable(license)` returns true
  - Blocked if license contains "ND" or "NO DERIV"
  - Allowed: CC-BY, CC-BY-SA, Public Domain

**Transitions**:
- Edit (with license check) → EDITING_UNSAVED
- Delete → NOT_DOWNLOADED

---

### 4. CACHED_REQUIRED
**Criteria**: Essential asset that cannot be deleted
- In `cachedAssets()` map
- `required: true` (marked as essential)
- Auto-downloaded on app startup
- May be out of date (version check)

**Available Actions**:
- ✅ Edit (if license allows)
- ❌ Cannot delete from cache
- ✅ View metadata

**UI Elements**:
- "Essential" badge
- Edit button (if license allows)
- NO "Delete from downloads" option

**Transitions**:
- Edit → EDITING_UNSAVED

---

### 5. EDITING_UNSAVED
**Criteria**: User clicked "Edit" but files not created yet
- Asset ID becomes `{original_id}_editing` (temporary)
- In `editedAssets()` map
- NO physical files created yet
- Metadata is editable in UI
- Asset in `originalEditedMetadata` map

**Available Actions**:
- ✅ Edit metadata (name, author, description, etc.)
- ✅ Save metadata (creates files)
- ✅ Edit in Blender (creates files first)
- ✅ Cancel/Revert (goes back to CACHED)

**UI Elements**:
- Editable metadata form
- Danger zone: "Delete this asset" (reverts without file deletion)
- Footer button:
  - "Cancel" if no metadata changes
  - "Save Metadata" if metadata changed

**Transitions**:
- Save OR Open in Blender → EDITING_SAVED (creates physical files)
- Cancel/Revert → CACHED

**Special Behavior**:
- Clicking "Edit in Blender" triggers `create_editable_copy()` which:
  1. Creates files: `{original_id}_edited_{timestamp}.glb`
  2. Generates thumbnail screenshot
  3. Updates asset ID from `_editing` to `_edited_{timestamp}`
  4. Starts file watcher

---

### 6. EDITING_SAVED
**Criteria**: Edited asset with physical files created
- Asset ID contains `_edited_` (e.g., `abc123_edited_1706123456`)
- Files exist at `~/.buildhuman/created-assets/{id}.glb`
- In `editedAssets()` map
- Has `original_id` metadata field
- `is_edited: true` flag
- File watcher active (monitoring for Blender saves)

**Available Actions**:
- ✅ Edit metadata
- ✅ Open in Blender (edits existing files)
- ✅ Delete edited version
- ✅ View metadata
- ✅ Save metadata changes

**UI Elements**:
- Version badge (if different from original)
- Editable metadata form
- Thumbnail (auto-generated or custom)
- Danger zone:
  - "Delete this asset" (deletes edited files)
  - "Delete original from downloads" (if original is cached)
- Footer button:
  - "Save Metadata" if changes exist
  - "Delete Edited Version" if no changes

**Context**:
- `original_id`: Link to parent asset
- `downloads: 0` (reset for unpublished edits)
- Custom author (from settings)
- Modified timestamp

**Transitions**:
- Delete → CACHED (if original exists) OR NOT_DOWNLOADED
- Metadata save → EDITING_SAVED (stays in state, updates metadata)

**File Watching**:
- Uses `notify` crate to watch `.glb` file
- Emits `asset-file-changed` event on Blender save
- Frontend refreshes asset automatically
- Debounced 500ms

---

## State Properties (Context)

Each asset has these properties that affect behavior:

```typescript
interface AssetContext {
  // Identity
  id: string                    // Current ID (may include _editing or _edited_)
  original_id?: string          // Parent asset ID (for edited assets)

  // Metadata
  name: string
  author: string
  description: string
  type: string                  // "models" | "environment"
  category: string
  version: string

  // Status flags
  required: boolean             // Essential asset
  is_edited: boolean            // This is an edited fork
  cached: boolean               // Exists in local cache

  // Permissions
  license: string               // CC-BY, CC-BY-SA, CC-BY-ND, etc.

  // Stats
  rating: number
  rating_count: number
  downloads: number
  file_size?: number

  // File paths (when cached/edited)
  file_path?: string            // Local .glb path
  thumbnail_url?: string

  // Timestamps
  publish_date: string
  downloaded_at?: string
}
```

---

## Guards (Conditions)

### `isLicenseEditable(license: string): boolean`
- Returns `false` if license contains "ND" or "NO DERIV"
- Returns `true` for CC-BY, CC-BY-SA, Public Domain
- Controls whether "Edit" button is enabled

### `isRequired(asset): boolean`
- Returns `asset.required === true`
- Prevents deletion of essential assets

### `isCached(assetId): boolean`
- Returns `cachedAssets().has(assetId)`
- Determines if asset files exist locally

### `isEditing(assetId): boolean`
- Returns `true` if:
  - ID ends with `_editing`, OR
  - ID contains `_edited_`, OR
  - Asset in `editedAssets()` map

### `hasMetadataChanges(assetId): boolean`
- Compares current metadata with `originalEditedMetadata` map
- Checks: name, author, description, category
- Determines "Save" vs "Cancel" button text

---

## Transition Actions

### `DOWNLOAD`
**Trigger**: User clicks "Download Asset" button
1. Set `downloading()` signal to asset ID
2. Call `invoke("download_asset", {assetId, apiUrl})`
3. Rust downloads from `/api/assets/{id}/download`
4. Save to `~/.buildhuman/cache/models/`
5. Update `cachedAssets()` map
6. Clear `downloading()` signal
7. Transition: NOT_DOWNLOADED → CACHED

### `EDIT`
**Trigger**: User clicks "Edit" button
**Guard**: `isLicenseEditable(license)`
1. Create temporary asset with ID `{id}_editing`
2. Add to `editedAssets()` map
3. Store original in `originalEditedMetadata` map
4. Switch UI to edit mode
5. Transition: CACHED → EDITING_UNSAVED

### `SAVE_METADATA` (Unsaved → Saved)
**Trigger**: User clicks "Save Metadata" or "Edit in Blender" from EDITING_UNSAVED
1. Call `invoke("create_editable_copy", {assetId})`
2. Rust creates files with ID `{id}_edited_{timestamp}`
3. Copies .glb from cache to created-assets/
4. Generates thumbnail via Blender screenshot
5. Creates metadata.json
6. Starts file watcher
7. Update `editedAssets()` map with new ID
8. Transition: EDITING_UNSAVED → EDITING_SAVED

### `SAVE_METADATA` (Saved)
**Trigger**: User clicks "Save Metadata" in EDITING_SAVED
1. Update in-memory metadata
2. Call `invoke("save_asset_metadata", {assetId, metadata})`
3. Rust writes to metadata.json
4. Show toast "Metadata saved"
5. Transition: EDITING_SAVED → EDITING_SAVED (stay in state)

### `DELETE_EDITED`
**Trigger**: User clicks "Delete Asset" in danger zone (EDITING_SAVED)
1. Confirm with user
2. Call `invoke("delete_cached_asset", {assetId})`
3. Rust deletes files from created-assets/
4. Remove from `editedAssets()` map
5. Close detail panel
6. Check if original exists:
   - If yes → transition to CACHED (viewing original)
   - If no → transition to NOT_DOWNLOADED

### `CANCEL_EDIT`
**Trigger**: User clicks "Cancel" in EDITING_UNSAVED OR "Delete" with confirmation
1. Remove `{id}_editing` from display
2. Remove from `editedAssets()` map
3. Clear from `originalEditedMetadata` map
4. Switch back to original asset view
5. Transition: EDITING_UNSAVED → CACHED

### `DELETE_FROM_CACHE`
**Trigger**: User clicks "Delete from downloads" (CACHED, not required)
1. Confirm with user
2. Call `invoke("delete_cached_asset", {assetId})`
3. Rust deletes from cache/
4. Remove from `cachedAssets()` map
5. Close detail panel
6. Transition: CACHED → NOT_DOWNLOADED

### `OPEN_IN_BLENDER`
**Trigger**: User clicks "Edit in Blender"
**From EDITING_UNSAVED**: First creates files (same as SAVE_METADATA), then opens
**From EDITING_SAVED**: Directly opens existing files
1. If unsaved: create files first
2. Call `invoke("open_in_blender", {filePath, assetId})`
3. Rust spawns Blender process
4. File watcher monitors for changes
5. On save: emit `asset-file-changed` event
6. Frontend refreshes asset display

---

## UI Decision Matrix

| State | Download | Edit | Delete Cache | Delete Edited | Save Meta | Open Blender | Danger Zone |
|-------|----------|------|--------------|---------------|-----------|--------------|-------------|
| NOT_DOWNLOADED | ✅ Show | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide |
| DOWNLOADING | 🔒 Disabled | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide |
| CACHED | ❌ Hide | ✅ Show* | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide | ✅ "Delete download" |
| CACHED_REQUIRED | ❌ Hide | ✅ Show* | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide |
| EDITING_UNSAVED | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide | ✅ Show | ✅ Show | ✅ "Delete asset" |
| EDITING_SAVED | ❌ Hide | ❌ Hide | ❌ Hide | ❌ Hide | ✅ Show** | ✅ Show | ✅ "Delete asset" + "Delete original"*** |

\* Disabled if `!isLicenseEditable(license)`
\*\* Only if `hasMetadataChanges()`
\*\*\* "Delete original" only if original is cached

---

## Edge Cases

### 1. Edited asset with original deleted
- User has `abc_edited_123` but deleted original `abc` from cache
- Viewing edited asset shows only "Delete this asset"
- No "Delete original from downloads" option

### 2. Edited asset viewed alongside original
- Asset list shows both `abc` and `abc_edited_123`
- Sorted so edited appears right after original
- Each has independent detail panel
- Viewing `abc`: shows "Delete from downloads"
- Viewing `abc_edited_123`: shows "Delete this asset"

### 3. Required asset edited
- Original `abc` has `required: true`
- Edited `abc_edited_123` has `required: false`
- Original cannot be deleted
- Edited version CAN be deleted

### 4. Multiple edits of same asset
- Currently allows only ONE edit per asset
- Creating second edit would need new ID: `abc_edited_{timestamp2}`
- Not currently prevented by UI

### 5. License changes
- User could manually edit metadata to change license
- Frontend respects current license value
- Could change ND to BY, then edit again (honor system)

### 6. File watcher conflicts
- Only watches ONE asset at a time (current implementation)
- Opening second asset in Blender stops watching first
- Could be extended to watch multiple

### 7. Startup state recovery
- App scans `created-assets/` on startup
- Populates `editedAssets()` map from disk
- Links to originals via `original_id` field
- If original missing from cache, edited asset still shows

---

## Current Implementation Gaps

1. **No explicit state machine** - state inferred from multiple signals
2. **ID-based state encoding** - `_editing` and `_edited_` suffixes feel hacky
3. **Scattered transition logic** - handlers spread across file
4. **No transition guards validation** - can call wrong actions from wrong states
5. **Race conditions possible** - concurrent downloads or edits not prevented
6. **State recovery on app restart** - relies on file scanning
7. **No rollback mechanism** - failed transitions leave partial state

---

## Proposed XState Benefits

With XState, we can:
1. ✅ Explicitly model all 6 states
2. ✅ Define allowed transitions (prevents invalid actions)
3. ✅ Guards enforce conditions (license, required, cached)
4. ✅ Actions are side effects (invoke Tauri commands)
5. ✅ Context holds asset data (no ID munging)
6. ✅ Persist/restore state explicitly
7. ✅ Type-safe transitions
8. ✅ Visual state diagram
9. ✅ Test state machine independently
10. ✅ Handle concurrent operations with actors
