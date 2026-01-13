# BuildHuman Desktop App

The desktop application for BuildHuman - a 3D human generator and character creation tool.

![BuildHuman Preview](./doc/present.png)

## Features

### Character Generation
- Create customizable 3D human characters
- Adjust height, weight, proportions, and body shapes
- Fine-tune facial features with morphs and blend shapes
- Generate diverse ages, genders, and body types

### Asset Management
- Browse and download clothing, accessories, and body parts
- Local caching for fast access
- Edit assets in Blender with seamless integration
- Import/export GLB and GLTF formats

### Real-time Rendering
- **Three.js Renderer**: Fast web-based 3D preview

### Scene & Posing
- Position and pose characters
- Lighting controls
- Camera management
- Export scenes for external use

## Tech Stack

- **Frontend**: SolidJS + TypeScript. The frontend is a modern web-based UI that requires a Node.js environment for the build process and development server.
- **Window Manager**: Tauri (Rust)
- **3D Rendering**:
  - Three.js (web renderer)
  - WGPU for GPU acceleration

## Development

### Prerequisites
- **Node.js 18+**: Required for the SolidJS frontend build process and development server.
- **Rust (latest stable)**: Required for the Tauri backend.
- **Cargo**: The Rust package manager, used for building the backend.

### Run Development Server

```bash
npm install
npm run tauri dev
```

### Build for Production

```bash
npm run tauri build
```

The build will create platform-specific installers in `src-tauri/target/release/bundle/`

### Project Structure

```
app/
├── src/                    # SolidJS frontend source
│   ├── AssetLibrary.tsx   # Asset browser & management
│   ├── Settings.tsx       # App configuration
│   ├── ThreeScene.tsx     # 3D preview component
│   └── ...
│
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── asset_manager.rs  # Asset download & caching
│   │   ├── settings.rs       # App settings
│   │   ├── mesh/            # Mesh generation
│   │   └── main.rs
│   └── Cargo.toml
│
└── package.json
```

## Renderer Modes

### Three.js (Default)
Web-based 3D renderer integrated into the UI. Best for:
- Quick previews
- Asset browsing
- General workflow

### WGPU (Experimental)
Direct GPU rendering for maximum performance.

Run with WGPU after building release:
```bash
./src-tauri/target/release/buildhuman --use-wgpu
```

## Configuration

Settings are stored locally:
- **macOS**: `~/Library/Application Support/com.buildhuman.app/`
- **Linux**: `~/.config/buildhuman/`
- **Windows**: `%APPDATA%\buildhuman\`

### Key Settings
- **Author Name**: Your name for created assets
- **Default Editor**: Path to Blender executable
- **Cache Location**: Where downloaded assets are stored
- **Created Assets Folder**: Where your edited assets are saved

## Asset Editing Workflow

1. Browse assets in the Asset Library
2. Download and cache assets locally
3. Click "Edit" to create an editable copy
4. Asset opens in Blender automatically
5. Edit in Blender, hit Ctrl+S to save
6. Changes auto-export to GLB
7. Asset Library detects changes and updates

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Troubleshooting

### Blender Integration Issues
- Ensure Blender is installed and path is set in Settings
- Check that Blender version is 2.93 or later
- Verify export path has write permissions

### Rendering Issues
- Check GPU drivers are up to date
- For WGPU issues, fall back to default renderer

## Contributing

See the main [BuildHuman README](../README.md) for contribution guidelines.
