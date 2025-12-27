# BuildHuman Asset Service

FastAPI service for managing 3D human assets with LLM-powered quality control.

## Features

- 🔍 Asset library with search and filtering
- 📦 Upload/download models, textures, and morphs
- 🤖 LLM quality control (content moderation, validation)
- 🎨 Automatic thumbnail generation
- 📊 OpenAPI/Swagger docs at `/docs`
- 🆓 Deploy for free on Fly.io

## Quick Start

### Local Development

```bash
# Install dependencies
poetry install

# Initialize database
poetry poe init-db

# Run development server (with hot reload)
poetry poe dev

# API available at http://localhost:8000
# Docs at http://localhost:8000/docs
```

### Available Commands

```bash
poetry poe dev      # Run with hot reload
poetry poe serve    # Run production server
poetry poe test     # Run tests
poetry poe format   # Format code with black
poetry poe lint     # Lint with ruff
poetry poe init-db  # Initialize database
```

## Deploy to Fly.io (Free)

### 1. Install Fly CLI

```bash
# macOS
brew install flyctl

# Linux/WSL
curl -L https://fly.io/install.sh | sh

# Windows
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

### 2. Sign Up & Login

```bash
fly auth signup  # or fly auth login
```

### 3. Create App

```bash
# Launch app (will create fly.toml if not exists)
fly launch

# Create persistent volume for storage
fly volumes create buildhuman_data --size 1
```

### 4. Deploy

```bash
fly deploy
```

### 5. Check Status

```bash
fly status
fly logs
```

Your API will be live at `https://buildhuman-assets.fly.dev`

## API Endpoints

### Assets

- `GET /api/assets` - List/search assets
  - Query params: `category`, `search`, `sort` (recent|rating|name|downloads)
- `GET /api/assets/{id}` - Get asset metadata
- `GET /api/assets/{id}/download` - Download asset file
- `POST /api/assets` - Upload new asset
- `DELETE /api/assets/{id}` - Delete asset

### Categories

- `GET /api/categories` - List all categories

## Storage Structure

```
storage/
├── models/      # 3D mesh models (.glb, .gltf, .fbx)
├── textures/    # Texture maps (.png, .jpg)
└── morphs/      # Blend shapes and morphs
```

## LLM Quality Control

The service includes hooks for LLM-powered quality control:

- Content moderation (check names/descriptions for inappropriate content)
- Asset validation (verify mesh integrity, texture formats)
- Auto-tagging and categorization
- Quality scoring

Set your API key:

```bash
fly secrets set ANTHROPIC_API_KEY=your_key_here
```

## Free Tier Limits

Fly.io free tier includes:
- 3 shared VMs (256MB RAM each)
- 160GB outbound data transfer/month
- Persistent volumes (1GB free)

Perfect for getting started - no credit card required!

## Development

### Project Structure

```
asset-service/
├── main.py              # FastAPI app
├── pyproject.toml       # Poetry config
├── Dockerfile           # Container image
├── fly.toml            # Fly.io config
└── storage/            # Asset files
```

### Adding LLM Features

Example: Content moderation on upload

```python
from anthropic import Anthropic

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

def moderate_content(name: str, description: str) -> bool:
    prompt = f"Is this asset appropriate? Name: {name}, Description: {description}"
    response = client.messages.create(
        model="claude-3-haiku-20240307",
        max_tokens=10,
        messages=[{"role": "user", "content": prompt}]
    )
    return "yes" in response.content[0].text.lower()
```

## License

MIT
