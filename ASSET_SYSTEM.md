# BuildHuman Asset System

## Overview

The asset system consists of two parts:
1. **Asset Service** (FastAPI) - Hosts and serves assets
2. **Local Caching** (Tauri) - Downloads and caches assets locally

## Asset Metadata Format

```json
{
  "id": "uuid-v4",
  "name": "Female Base Mesh",
  "author": "community",
  "publish_date": "2024-12-26T00:00:00Z",
  "rating": 4.5,
  "rating_count": 42,
  "license": "CC0",
  "type": "models",
  "category": "human-base",
  "downloads": 156,
  "file_size": 2048576,
  "file_format": "glb",
  "version": "1.0.0",
  "description": "Optimized female base mesh for character creation",
  "tags": "female,base,rigged"
}
```

## Types & Categories

### Types
- `models` - 3D character and prop models
- `environment` - Environment assets and scenes

### Categories (Models)
- `human-base` - Base human mesh models
- `character` - Fully rigged characters
- `clothing` - Clothing and accessories
- `hair` - Hair models and styles
- `props` - Props and objects

### Categories (Environment)
- `indoor` - Indoor environments
- `outdoor` - Outdoor environments
- `nature` - Natural environments

## Asset Service API

### Base URL
- **Development**: `http://localhost:8000`
- **Production**: `https://your-app.fly.dev`

### Endpoints

#### List Types
```
GET /api/types
```
Returns all asset types.

#### List Categories
```
GET /api/categories?type=models
```
Returns categories, optionally filtered by type.

#### List Assets
```
GET /api/assets?category=human-base&search=female&sort=rating
```
Query params:
- `category` - Filter by category
- `type` - Filter by type
- `search` - Search in name/description
- `sort` - Sort by: `recent`, `rating`, `name`, `downloads`

#### Get Asset
```
GET /api/assets/{id}
```
Returns full asset metadata.

#### Download Asset
```
GET /api/assets/{id}/download
```
Downloads the asset file.

#### Upload Asset
```
POST /api/assets
```
Form data:
- `file` - Asset file (required)
- `thumbnail` - Thumbnail image (optional)
- `name` - Asset name (required)
- `description` - Description
- `type` - Asset type (required)
- `category` - Category (required)
- `author` - Author name (required)
- `license` - License (default: CC0)
- `file_format` - File format (e.g., glb, fbx)
- `version` - Version (default: 1.0.0)
- `tags` - Comma-separated tags

## Local Storage Structure

```
~/.buildhuman/
├── cache/
│   ├── models/
│   │   ├── {asset_id}_{name}.glb
│   │   └── {asset_id}_metadata.json
│   └── environment/
│       ├── {asset_id}_{name}.glb
│       └── {asset_id}_metadata.json
└── library/
    └── (user's custom assets)
```

## Tauri Commands

### Download Asset
```typescript
import { invoke } from '@tauri-apps/api/core'

const asset = await invoke('download_asset', {
  assetId: 'uuid-here',
  apiUrl: 'http://localhost:8000'
})
```

Returns:
```typescript
{
  metadata: AssetMetadata,
  file_path: "/Users/you/.buildhuman/cache/models/uuid_Female_Base.glb",
  downloaded_at: "2024-12-26T12:00:00Z",
  cached: true
}
```

### List Cached Assets
```typescript
const assets = await invoke('list_cached_assets')
```

Returns array of cached assets.

### Get Cached Asset
```typescript
const asset = await invoke('get_cached_asset', {
  assetId: 'uuid-here'
})
```

Returns asset if cached, null otherwise.

### Delete Cached Asset
```typescript
await invoke('delete_cached_asset', {
  assetId: 'uuid-here'
})
```

### Get App Data Path
```typescript
const path = await invoke('get_app_data_path')
// Returns: "/Users/you/.buildhuman"
```

## Development Workflow

### 1. Start Asset Service

```bash
cd asset-service
poetry install
poetry poe dev
```

API available at http://localhost:8000
Docs at http://localhost:8000/docs

### 2. Start Tauri App

```bash
cd BevyTauriExample
npm install
npm run tauri dev
```

### 3. Test Asset Download

In your SolidJS app:
```typescript
import { invoke } from '@tauri-apps/api/core'

async function downloadAsset(assetId: string) {
  try {
    const asset = await invoke('download_asset', {
      assetId,
      apiUrl: 'http://localhost:8000'
    })
    console.log('Downloaded:', asset.file_path)
  } catch (error) {
    console.error('Download failed:', error)
  }
}
```

## Deployment

### Deploy Asset Service to Fly.io

```bash
cd asset-service
fly launch
fly volumes create buildhuman_data --size 1
fly deploy
```

Update API URL in your Tauri app to use the production URL.

## Next Steps

1. ✅ Asset metadata format defined
2. ✅ API endpoints implemented
3. ✅ Local caching in ~/.buildhuman
4. ✅ Tauri commands for download/cache management
5. 🔄 Integrate with Asset Library UI
6. 🔄 Add thumbnail support
7. 🔄 Add progress tracking for downloads
8. 🔄 Add LLM quality control on uploads
