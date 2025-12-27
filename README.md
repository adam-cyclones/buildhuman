# BuildHuman

A 3D asset management and editing platform built with Tauri, React, and Python.

## Project Structure

```
BuildHuman/
├── app/              # Tauri desktop application (React + TypeScript + Bevy)
│   ├── src/          # React frontend source
│   ├── src-tauri/    # Rust backend with Bevy integration
│   └── dist/         # Build output
│
├── service/          # Python FastAPI backend
│   ├── api/          # API routes
│   ├── models/       # Data models
│   └── cache/        # Asset cache storage
│
└── README.md         # This file
```

## Features

- **Asset Library**: Browse, download, and manage 3D assets (GLB/GLTF)
- **Asset Editing**: Edit assets in Blender with seamless workflow
- **Real-time Preview**: Babylon.js 3D preview in the app
- **Bevy Integration**: Rust-based 3D rendering backend
- **Local Cache**: Efficient asset caching system

## Getting Started

### Prerequisites

- Node.js 18+
- Rust (latest stable)
- Python 3.9+
- Blender (for asset editing)

### Running the App

```bash
cd app
npm install
npm run tauri dev
```

### Running the Service

```bash
cd service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
poetry poe start
```

## Development

This is a monorepo containing both the desktop application and the asset service backend.

## License

TBD
