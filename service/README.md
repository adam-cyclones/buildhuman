# BuildHuman Asset Service

FastAPI service for managing 3D human assets - body parts, clothing, accessories, morphs, and textures.

## Features

- 🔍 **Asset Library**: Browse and search human-related 3D assets
- 📦 **Asset Management**: Upload, download, and organize models
- 🎨 **Metadata**: Detailed asset information (author, license, version, ratings)
- 📊 **API Docs**: Interactive OpenAPI/Swagger docs at `/docs`
- 💾 **Local Storage**: File-based storage with efficient caching

## Asset Types

- **Body Parts**: Base human meshes, heads, hands, feet
- **Clothing**: Shirts, pants, shoes, accessories
- **Morphs**: Blend shapes for customization (facial features, body proportions)
- **Textures**: Skin textures, normal maps, roughness maps
- **Accessories**: Glasses, jewelry, hats, props

## Quick Start

### Local Development

```bash
# Install dependencies (using Poetry)
pip install poetry
poetry install

# Seed database with sample assets
poetry poe seed

# Run development server (with hot reload)
poetry poe dev

# API available at http://localhost:8000
# Docs at http://localhost:8000/docs
```

### Available Commands

```bash
poetry poe dev      # Run with hot reload
poetry poe start    # Run production server
poetry poe seed     # Populate with sample assets
poetry poe test     # Run tests (when implemented)
```

## API Endpoints

### Assets

- `GET /api/assets` - List/search assets
  - Query params: `type`, `category`, `search`, `sort` (recent|rating|name|downloads)
- `GET /api/assets/{id}` - Get asset metadata
- `GET /api/assets/{id}/download` - Download asset GLB file
- `POST /api/assets/upload` - Upload new asset
- `PUT /api/assets/{id}` - Update asset metadata
- `DELETE /api/assets/{id}` - Delete asset

### Categories

- `GET /api/categories` - List all categories
  - Returns categories organized by asset type

## Storage Structure

```
service/
├── cache/           # Downloaded/cached assets
│   ├── metadata.json
│   └── {asset_id}.glb
│
├── storage/         # Original uploaded assets (if using uploads)
│   └── {asset_id}/
│       ├── model.glb
│       └── metadata.json
│
└── main.py          # FastAPI application
```

## Configuration

The service uses local file-based storage by default. Asset metadata is stored in `cache/metadata.json`.

### Environment Variables

```bash
# Optional: Set custom cache directory
CACHE_DIR=/path/to/cache

# Optional: Enable CORS for specific origins
CORS_ORIGINS=http://localhost:5173,http://localhost:1420
```

**⚠️ Security Note**: Never commit API keys or secrets to version control. Use environment variables and add them to `.gitignore`.

## Asset Metadata Format

Each asset includes:

```json
{
  "id": "unique-asset-id",
  "name": "Asset Name",
  "type": "models|clothing|morphs|textures",
  "category": "Category within type",
  "author": "Creator name",
  "description": "Asset description",
  "license": "CC-BY|CC-BY-SA|CC-BY-ND|All Rights Reserved",
  "version": "1.0.0",
  "file_size": 1234567,
  "required": false,
  "rating": 4.5,
  "rating_count": 10,
  "downloads": 100,
  "publish_date": "2025-01-01T00:00:00Z"
}
```

## Development

### Project Structure

```
service/
├── main.py              # FastAPI app and routes
├── seed_assets.py       # Sample data generator
├── pyproject.toml       # Poetry dependencies
├── requirements.txt     # Pip dependencies
├── Dockerfile           # Container image (optional)
└── cache/              # Asset storage
```

### Adding New Endpoints

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api")

@router.get("/custom-endpoint")
async def custom_endpoint():
    return {"message": "Custom endpoint"}
```

### Testing

```bash
# Run tests (when implemented)
poetry poe test

# Manual testing via Swagger UI
open http://localhost:8000/docs
```

## Deployment

### Option 1: Local Server

```bash
poetry poe start
```

### Option 2: Docker (Optional)

```bash
docker build -t buildhuman-service .
docker run -p 8000:8000 -v $(pwd)/cache:/app/cache buildhuman-service
```

### Option 3: Cloud Platform

The service can be deployed to:
- **Fly.io**: Free tier with persistent volumes
- **Railway**: Simple Git-based deployment
- **DigitalOcean App Platform**: Managed hosting

**Note**: Deployment configuration not included in this repository. Configure based on your hosting provider's requirements.

## Integration with Desktop App

The desktop app connects to this service to:
1. Browse available assets
2. Download assets to local cache
3. Upload user-created assets (future feature)
4. Sync ratings and metadata

Default service URL: `http://localhost:8000`

## Future Features

- **User Authentication**: Per-user asset libraries
- **Cloud Storage**: S3/B2 integration for uploaded assets
- **Asset Validation**: Automatic GLB validation
- **Thumbnails**: Auto-generate preview images
- **Search**: Full-text search with filters
- **Collections**: Curated asset bundles

## License

GPL - See main repository README for details.
