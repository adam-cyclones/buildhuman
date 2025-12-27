#!/usr/bin/env python3
"""Seed the asset database with demo assets"""

import json
import base64
from datetime import datetime
import sqlite3
import os

# Simple cube GLTF (1x1x1 cube centered at origin)
CUBE_GLTF = {
    "asset": {"version": "2.0"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0}],
    "meshes": [
        {
            "primitives": [
                {
                    "attributes": {"POSITION": 0, "NORMAL": 1},
                    "indices": 2,
                }
            ]
        }
    ],
    "accessors": [
        {
            "bufferView": 0,
            "componentType": 5126,
            "count": 24,
            "type": "VEC3",
            "max": [0.5, 0.5, 0.5],
            "min": [-0.5, -0.5, -0.5],
        },
        {
            "bufferView": 1,
            "componentType": 5126,
            "count": 24,
            "type": "VEC3",
        },
        {
            "bufferView": 2,
            "componentType": 5123,
            "count": 36,
            "type": "SCALAR",
        },
    ],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": 288},
        {"buffer": 0, "byteOffset": 288, "byteLength": 288},
        {"buffer": 0, "byteOffset": 576, "byteLength": 72},
    ],
    "buffers": [{"byteLength": 648}],
}

# Cube vertex data (positions, normals, indices)
def create_cube_data():
    positions = [
        # Front
        -0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
        # Back
        -0.5, -0.5, -0.5, -0.5,  0.5, -0.5,  0.5,  0.5, -0.5,  0.5, -0.5, -0.5,
        # Top
        -0.5,  0.5, -0.5, -0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5, -0.5,
        # Bottom
        -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5,  0.5, -0.5, -0.5,  0.5,
        # Right
         0.5, -0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,  0.5,  0.5, -0.5,  0.5,
        # Left
        -0.5, -0.5, -0.5, -0.5, -0.5,  0.5, -0.5,  0.5,  0.5, -0.5,  0.5, -0.5,
    ]

    normals = [
        # Front
         0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
        # Back
         0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
        # Top
         0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
        # Bottom
         0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
        # Right
         1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,
        # Left
        -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0,
    ]

    indices = [
        0,  1,  2,  0,  2,  3,   # Front
        4,  5,  6,  4,  6,  7,   # Back
        8,  9, 10,  8, 10, 11,   # Top
        12, 13, 14, 12, 14, 15,  # Bottom
        16, 17, 18, 16, 18, 19,  # Right
        20, 21, 22, 20, 22, 23,  # Left
    ]

    import struct

    # Pack positions as floats
    pos_bytes = struct.pack(f'{len(positions)}f', *positions)
    # Pack normals as floats
    norm_bytes = struct.pack(f'{len(normals)}f', *normals)
    # Pack indices as unsigned shorts
    idx_bytes = struct.pack(f'{len(indices)}H', *indices)

    return pos_bytes + norm_bytes + idx_bytes

def create_cube_gltf():
    """Create a GLB file with a simple cube"""
    data = create_cube_data()

    # Update buffer length in GLTF
    gltf = CUBE_GLTF.copy()
    gltf["buffers"][0]["byteLength"] = len(data)

    # Create GLB
    json_chunk = json.dumps(gltf, separators=(',', ':')).encode('utf-8')

    # Pad to 4-byte boundary
    while len(json_chunk) % 4 != 0:
        json_chunk += b' '

    # GLB header
    glb = bytearray()
    glb.extend(b'glTF')  # magic
    glb.extend((2).to_bytes(4, 'little'))  # version

    # Total length (will update)
    total_length_offset = len(glb)
    glb.extend((0).to_bytes(4, 'little'))  # placeholder

    # JSON chunk
    glb.extend(len(json_chunk).to_bytes(4, 'little'))
    glb.extend(b'JSON')
    glb.extend(json_chunk)

    # Binary chunk
    glb.extend(len(data).to_bytes(4, 'little'))
    glb.extend(b'BIN\x00')
    glb.extend(data)

    # Update total length
    total_length = len(glb)
    glb[total_length_offset:total_length_offset+4] = total_length.to_bytes(4, 'little')

    return bytes(glb)

# Demo assets
DEMO_ASSETS = [
    {
        "name": "Female Base Mesh",
        "description": "Optimized female base mesh for character creation",
        "type": "models",
        "category": "human-base",
        "author": "BuildHuman Team",
        "license": "CC0",
        "tags": "female,base,rigged",
        "version": "1.0.0",
        "required": True,
    },
    {
        "name": "Male Base Mesh",
        "description": "Optimized male base mesh for character creation",
        "type": "models",
        "category": "human-base",
        "author": "BuildHuman Team",
        "license": "CC0",
        "tags": "male,base,rigged",
        "version": "1.0.0",
        "required": True,
    },
    {
        "name": "Casual T-Shirt",
        "description": "Simple casual t-shirt for base characters",
        "type": "models",
        "category": "clothing",
        "author": "Community",
        "license": "CC-BY",
        "tags": "clothing,casual,shirt",
        "version": "1.0.0",
        "required": False,
    },
    {
        "name": "Short Hair Style",
        "description": "Low-poly short hair for game characters",
        "type": "models",
        "category": "hair",
        "author": "Community",
        "license": "CC0",
        "tags": "hair,short,simple",
        "version": "1.0.0",
        "required": False,
    },
    {
        "name": "Office Interior",
        "description": "Modern office environment",
        "type": "environment",
        "category": "indoor",
        "author": "BuildHuman Team",
        "license": "CC-BY",
        "tags": "office,indoor,modern",
        "version": "1.0.0",
        "required": False,
    },
    {
        "name": "Park Scene",
        "description": "Outdoor park with trees and benches",
        "type": "environment",
        "category": "outdoor",
        "author": "Community",
        "license": "CC0",
        "tags": "park,outdoor,nature",
        "version": "1.0.0",
        "required": False,
    },
]

def seed_database():
    """Seed the database with demo assets"""
    import uuid
    from main import init_db

    # Initialize database schema
    init_db()

    # Ensure storage directories exist
    os.makedirs("storage/models", exist_ok=True)
    os.makedirs("storage/environment", exist_ok=True)

    # Create cube GLB
    cube_glb = create_cube_gltf()

    # Connect to database
    conn = sqlite3.connect("assets.db")
    c = conn.cursor()

    timestamp = datetime.utcnow().isoformat()

    for asset in DEMO_ASSETS:
        asset_id = str(uuid.uuid4())

        # Save GLB file
        file_path = f"storage/{asset['type']}/{asset_id}_{asset['name'].replace(' ', '_')}.glb"
        with open(file_path, 'wb') as f:
            f.write(cube_glb)

        file_size = len(cube_glb)

        # Insert into database
        c.execute("""
            INSERT INTO assets
            (id, name, description, type, category, author, publish_date, license,
             file_path, file_size, file_format, created_at, updated_at, tags, version, required)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            asset_id,
            asset["name"],
            asset["description"],
            asset["type"],
            asset["category"],
            asset["author"],
            timestamp,
            asset["license"],
            file_path,
            file_size,
            "glb",
            timestamp,
            timestamp,
            asset["tags"],
            asset["version"],
            1 if asset["required"] else 0,
        ))

        print(f"✓ Created: {asset['name']}")

    conn.commit()
    conn.close()

    print(f"\n✅ Seeded {len(DEMO_ASSETS)} demo assets!")

if __name__ == "__main__":
    seed_database()
