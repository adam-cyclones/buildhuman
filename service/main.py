from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import sqlite3
import os
import shutil
import uuid

app = FastAPI(
    title="BuildHuman Asset Service",
    description="Asset library service for BuildHuman - 3D human mesh models, textures, and morphs",
    version="0.1.0"
)

# CORS for local Tauri app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "tauri://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database setup
DB_PATH = "assets.db"
STORAGE_PATH = "storage"

os.makedirs(STORAGE_PATH, exist_ok=True)
os.makedirs(f"{STORAGE_PATH}/models", exist_ok=True)
os.makedirs(f"{STORAGE_PATH}/environment", exist_ok=True)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT NOT NULL,
            category TEXT NOT NULL,
            author TEXT NOT NULL,
            publish_date TEXT NOT NULL,
            license TEXT NOT NULL,
            rating REAL DEFAULT 0.0,
            rating_count INTEGER DEFAULT 0,
            downloads INTEGER DEFAULT 0,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            file_format TEXT,
            thumbnail_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            tags TEXT,
            version TEXT DEFAULT '1.0.0',
            required INTEGER DEFAULT 0
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS types (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type_id TEXT NOT NULL,
            description TEXT,
            FOREIGN KEY (type_id) REFERENCES types(id)
        )
    """)

    # Insert default types
    types = [
        ("models", "Models", "3D character and prop models"),
        ("environment", "Environment", "Environment assets and scenes")
    ]
    c.executemany("INSERT OR IGNORE INTO types VALUES (?, ?, ?)", types)

    # Insert default categories
    categories = [
        ("human-base", "Human Base Mesh", "models", "Base human mesh models"),
        ("character", "Characters", "models", "Fully rigged characters"),
        ("clothing", "Clothing", "models", "Clothing and accessories"),
        ("hair", "Hair", "models", "Hair models and styles"),
        ("props", "Props", "models", "Props and objects"),
        ("indoor", "Indoor", "environment", "Indoor environments"),
        ("outdoor", "Outdoor", "environment", "Outdoor environments"),
        ("nature", "Nature", "environment", "Natural environments")
    ]
    c.executemany("INSERT OR IGNORE INTO categories VALUES (?, ?, ?, ?)", categories)

    conn.commit()
    conn.close()

init_db()

# Models
class Asset(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    type: str
    category: str
    author: str
    publish_date: str
    license: str
    rating: float = 0.0
    rating_count: int = 0
    downloads: int = 0
    file_size: Optional[int] = None
    file_format: Optional[str] = None
    thumbnail_path: Optional[str] = None
    created_at: str
    updated_at: str
    tags: Optional[str] = None
    version: str = "1.0.0"
    required: bool = False

class AssetMetadata(BaseModel):
    """Lightweight metadata for asset library display"""
    id: str
    name: str
    author: str
    publish_date: str
    rating: float
    rating_count: int
    license: str
    type: str
    category: str
    downloads: int
    file_size: Optional[int] = None
    thumbnail_url: Optional[str] = None

class AssetCreate(BaseModel):
    name: str
    description: Optional[str] = None
    type: str
    category: str
    author: str
    license: str = "CC0"
    tags: Optional[str] = None
    file_format: Optional[str] = None
    version: str = "1.0.0"

class Type(BaseModel):
    id: str
    name: str
    description: Optional[str] = None

class Category(BaseModel):
    id: str
    name: str
    type_id: str
    description: Optional[str] = None

# Routes
@app.get("/")
async def root():
    return {
        "service": "BuildHuman Asset Service",
        "version": "0.1.0",
        "docs": "/docs",
        "openapi": "/openapi.json"
    }

@app.get("/api/types", response_model=List[Type])
async def list_types():
    """List all asset types"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, name, description FROM types")
    types = [Type(id=row[0], name=row[1], description=row[2]) for row in c.fetchall()]
    conn.close()
    return types

@app.get("/api/categories", response_model=List[Category])
async def list_categories(type: Optional[str] = Query(None, description="Filter by type")):
    """List all asset categories, optionally filtered by type"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if type:
        c.execute("SELECT id, name, type_id, description FROM categories WHERE type_id = ?", (type,))
    else:
        c.execute("SELECT id, name, type_id, description FROM categories")

    categories = [Category(id=row[0], name=row[1], type_id=row[2], description=row[3]) for row in c.fetchall()]
    conn.close()
    return categories

@app.get("/api/assets", response_model=List[Asset])
async def list_assets(
    category: Optional[str] = Query(None, description="Filter by category"),
    search: Optional[str] = Query(None, description="Search in name and description"),
    sort: str = Query("recent", description="Sort by: recent, rating, name, downloads")
):
    """List and search assets"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    query = """
        SELECT id, name, description, type, category, author, publish_date, license,
               rating, rating_count, downloads, file_size, file_format, thumbnail_path,
               created_at, updated_at, tags, version, required
        FROM assets WHERE 1=1
    """
    params = []

    if category:
        query += " AND category = ?"
        params.append(category)

    if search:
        query += " AND (name LIKE ? OR description LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])

    # Sorting
    if sort == "rating":
        query += " ORDER BY rating DESC"
    elif sort == "name":
        query += " ORDER BY name ASC"
    elif sort == "downloads":
        query += " ORDER BY downloads DESC"
    else:  # recent
        query += " ORDER BY created_at DESC"

    c.execute(query, params)
    assets = []
    for row in c.fetchall():
        assets.append(Asset(
            id=row[0],
            name=row[1],
            description=row[2],
            type=row[3],
            category=row[4],
            author=row[5],
            publish_date=row[6],
            license=row[7],
            rating=row[8],
            rating_count=row[9],
            downloads=row[10],
            file_size=row[11],
            file_format=row[12],
            thumbnail_path=row[13],
            created_at=row[14],
            updated_at=row[15],
            tags=row[16],
            version=row[17],
            required=bool(row[18])
        ))

    conn.close()
    return assets

@app.get("/api/assets/required/list", response_model=List[Asset])
async def list_required_assets():
    """List all required assets"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    query = """
        SELECT id, name, description, type, category, author, publish_date, license,
               rating, rating_count, downloads, file_size, file_format, thumbnail_path,
               created_at, updated_at, tags, version, required
        FROM assets WHERE required = 1
        ORDER BY name ASC
    """

    c.execute(query)
    assets = []
    for row in c.fetchall():
        assets.append(Asset(
            id=row[0],
            name=row[1],
            description=row[2],
            type=row[3],
            category=row[4],
            author=row[5],
            publish_date=row[6],
            license=row[7],
            rating=row[8],
            rating_count=row[9],
            downloads=row[10],
            file_size=row[11],
            file_format=row[12],
            thumbnail_path=row[13],
            created_at=row[14],
            updated_at=row[15],
            tags=row[16],
            version=row[17],
            required=bool(row[18])
        ))

    conn.close()
    return assets

@app.get("/api/assets/{asset_id}", response_model=Asset)
async def get_asset(asset_id: str):
    """Get specific asset metadata"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT id, name, description, type, category, author, publish_date, license,
               rating, rating_count, downloads, file_size, file_format, thumbnail_path,
               created_at, updated_at, tags, version, required
        FROM assets WHERE id = ?
    """, (asset_id,))
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Asset not found")

    return Asset(
        id=row[0],
        name=row[1],
        description=row[2],
        type=row[3],
        category=row[4],
        author=row[5],
        publish_date=row[6],
        license=row[7],
        rating=row[8],
        rating_count=row[9],
        downloads=row[10],
        file_size=row[11],
        file_format=row[12],
        thumbnail_path=row[13],
        created_at=row[14],
        updated_at=row[15],
        tags=row[16],
        version=row[17],
        required=bool(row[18])
    )

@app.get("/api/assets/{asset_id}/download")
async def download_asset(asset_id: str):
    """Download asset file"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT file_path, name FROM assets WHERE id = ?", (asset_id,))
    row = c.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Asset not found")

    file_path, name = row

    # Increment download counter
    c.execute("UPDATE assets SET downloads = downloads + 1 WHERE id = ?", (asset_id,))
    conn.commit()
    conn.close()

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Asset file not found")

    return FileResponse(
        path=file_path,
        filename=name,
        media_type="application/octet-stream"
    )

@app.post("/api/assets", response_model=Asset)
async def upload_asset(
    metadata: AssetCreate,
    file: UploadFile = File(...),
    thumbnail: Optional[UploadFile] = File(None)
):
    """Upload a new asset"""
    asset_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat()

    # Determine storage path based on category
    category_path = f"{STORAGE_PATH}/{metadata.category}"
    if not os.path.exists(category_path):
        os.makedirs(category_path)

    # Save file
    file_ext = os.path.splitext(file.filename)[1]
    file_path = f"{category_path}/{asset_id}{file_ext}"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    file_size = os.path.getsize(file_path)

    # Save thumbnail if provided
    thumbnail_path = None
    if thumbnail:
        thumb_ext = os.path.splitext(thumbnail.filename)[1]
        thumbnail_path = f"{category_path}/{asset_id}_thumb{thumb_ext}"
        with open(thumbnail_path, "wb") as buffer:
            shutil.copyfileobj(thumbnail.file, buffer)

    # Save to database
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO assets
        (id, name, description, category, type, author, license, file_path, file_size, thumbnail_path, created_at, updated_at, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        asset_id,
        metadata.name,
        metadata.description,
        metadata.category,
        metadata.type,
        metadata.author,
        metadata.license,
        file_path,
        file_size,
        thumbnail_path,
        timestamp,
        timestamp,
        metadata.tags
    ))
    conn.commit()

    # Fetch the created asset
    c.execute("SELECT * FROM assets WHERE id = ?", (asset_id,))
    row = c.fetchone()
    conn.close()

    return Asset(
        id=row[0],
        name=row[1],
        description=row[2],
        category=row[3],
        type=row[4],
        author=row[5],
        license=row[6],
        rating=row[7],
        downloads=row[8],
        file_size=row[10],
        thumbnail_path=row[11],
        created_at=row[12],
        updated_at=row[13],
        tags=row[14]
    )

@app.delete("/api/assets/{asset_id}")
async def delete_asset(asset_id: str):
    """Delete an asset"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT file_path, thumbnail_path, required FROM assets WHERE id = ?", (asset_id,))
    row = c.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Asset not found")

    # Prevent deletion of required assets
    if row[2]:  # required field
        conn.close()
        raise HTTPException(status_code=403, detail="Cannot delete required asset")

    file_path, thumbnail_path = row

    # Delete files
    if os.path.exists(file_path):
        os.remove(file_path)
    if thumbnail_path and os.path.exists(thumbnail_path):
        os.remove(thumbnail_path)

    # Delete from database
    c.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
    conn.commit()
    conn.close()

    return {"status": "deleted", "id": asset_id}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
