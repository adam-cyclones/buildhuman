from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Header, Depends
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import sqlite3
import os
import shutil
import uuid
import json
import secrets

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

    # API Keys table for moderator authentication
    c.execute("""
        CREATE TABLE IF NOT EXISTS api_keys (
            key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used TEXT,
            active INTEGER DEFAULT 1
        )
    """)

    # Submissions table for asset review workflow
    c.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id TEXT PRIMARY KEY,
            asset_name TEXT NOT NULL,
            asset_description TEXT,
            asset_type TEXT NOT NULL,
            asset_category TEXT NOT NULL,
            author TEXT NOT NULL,
            submitter_id TEXT,
            file_path TEXT NOT NULL,
            thumbnail_path TEXT,
            file_size INTEGER,
            license TEXT NOT NULL,
            version TEXT DEFAULT '1.0.0',
            status TEXT NOT NULL,
            submitted_at TEXT NOT NULL,
            reviewed_at TEXT,
            reviewed_by TEXT,
            rejection_reason TEXT,
            moderation_notes TEXT,
            ai_moderation_result TEXT,
            FOREIGN KEY (reviewed_by) REFERENCES api_keys(name)
        )
    """)

    # Notifications table for user feedback
    c.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            submission_id TEXT NOT NULL,
            recipient_id TEXT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            read INTEGER DEFAULT 0,
            FOREIGN KEY (submission_id) REFERENCES submissions(id)
        )
    """)

    # Create indexes for performance
    c.execute("CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, read)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active)")

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

# Moderation and Submission Models
class SubmissionCreate(BaseModel):
    asset_name: str
    asset_description: Optional[str] = None
    asset_type: str
    asset_category: str
    author: str
    submitter_id: Optional[str] = None
    license: str = "CC-BY-4.0"
    version: str = "1.0.0"

class Submission(BaseModel):
    id: str
    asset_name: str
    asset_description: Optional[str]
    asset_type: str
    asset_category: str
    author: str
    submitter_id: Optional[str]
    file_path: str
    thumbnail_path: Optional[str]
    file_size: Optional[int]
    license: str
    version: str
    status: str
    submitted_at: str
    reviewed_at: Optional[str]
    reviewed_by: Optional[str]
    rejection_reason: Optional[str]
    moderation_notes: Optional[str]
    ai_moderation_result: Optional[str]

class ModerationReview(BaseModel):
    action: str  # 'approve' or 'reject'
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None

class Notification(BaseModel):
    id: str
    submission_id: str
    recipient_id: Optional[str]
    type: str
    title: str
    message: str
    created_at: str
    read: bool

class ApiKeyCreate(BaseModel):
    name: str
    role: str = "moderator"

# Authentication Middleware
async def verify_api_key(x_api_key: Optional[str] = Header(None)) -> dict:
    """Verify API key for moderation endpoints"""
    if not x_api_key:
        raise HTTPException(status_code=401, detail="API key required")

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT name, role, active FROM api_keys WHERE key = ?", (x_api_key,))
    row = c.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not row[2]:  # active check
        conn.close()
        raise HTTPException(status_code=403, detail="API key deactivated")

    # Update last_used timestamp
    c.execute("UPDATE api_keys SET last_used = ? WHERE key = ?",
              (datetime.utcnow().isoformat(), x_api_key))
    conn.commit()
    conn.close()

    return {"name": row[0], "role": row[1]}

# Helper Functions
def build_submission_from_row(row) -> Submission:
    """Convert database row to Submission model"""
    return Submission(
        id=row[0], asset_name=row[1], asset_description=row[2],
        asset_type=row[3], asset_category=row[4], author=row[5],
        submitter_id=row[6], file_path=row[7], thumbnail_path=row[8],
        file_size=row[9], license=row[10], version=row[11],
        status=row[12], submitted_at=row[13], reviewed_at=row[14],
        reviewed_by=row[15], rejection_reason=row[16],
        moderation_notes=row[17], ai_moderation_result=row[18]
    )

def build_notification_from_row(row) -> Notification:
    """Convert database row to Notification model"""
    return Notification(
        id=row[0], submission_id=row[1], recipient_id=row[2],
        type=row[3], title=row[4], message=row[5],
        created_at=row[6], read=bool(row[7])
    )

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

# Submission Endpoints
@app.post("/api/submissions", response_model=Submission)
async def create_submission(
    file: UploadFile = File(...),
    thumbnail: Optional[UploadFile] = File(None),
    metadata: str = Form(...)
):
    """Submit asset for moderation"""
    # Parse metadata from form data
    metadata_dict = json.loads(metadata)
    metadata_obj = SubmissionCreate(**metadata_dict)

    submission_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat()

    # Create submissions storage directory
    submissions_path = f"{STORAGE_PATH}/submissions"
    os.makedirs(submissions_path, exist_ok=True)

    # Save asset file
    file_ext = os.path.splitext(file.filename)[1] if file.filename else ".glb"
    file_path = f"{submissions_path}/{submission_id}{file_ext}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    file_size = os.path.getsize(file_path)

    # Save thumbnail if provided
    thumbnail_path = None
    if thumbnail:
        thumb_ext = os.path.splitext(thumbnail.filename)[1] if thumbnail.filename else ".png"
        thumbnail_path = f"{submissions_path}/{submission_id}_thumb{thumb_ext}"
        with open(thumbnail_path, "wb") as buffer:
            shutil.copyfileobj(thumbnail.file, buffer)

    # Save to database
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO submissions
        (id, asset_name, asset_description, asset_type, asset_category, author,
         submitter_id, file_path, thumbnail_path, file_size, license, version,
         status, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        submission_id, metadata_obj.asset_name, metadata_obj.asset_description,
        metadata_obj.asset_type, metadata_obj.asset_category, metadata_obj.author,
        metadata_obj.submitter_id, file_path, thumbnail_path, file_size,
        metadata_obj.license, metadata_obj.version, "pending", timestamp
    ))
    conn.commit()

    # Create notification for moderators
    notification_id = str(uuid.uuid4())
    c.execute("""
        INSERT INTO notifications
        (id, submission_id, recipient_id, type, title, message, created_at, read)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        notification_id,
        submission_id,
        None,  # NULL recipient_id means it's for all moderators
        "submission",
        f"New submission: {metadata_obj.asset_name}",
        f"{metadata_obj.author} submitted '{metadata_obj.asset_name}' for review",
        timestamp,
        0  # unread
    ))
    conn.commit()

    # Fetch created submission
    c.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,))
    row = c.fetchone()
    conn.close()

    return build_submission_from_row(row)

@app.get("/api/submissions/pending", response_model=List[Submission])
async def list_pending_submissions(auth: dict = Depends(verify_api_key)):
    """List all pending submissions (moderators only)"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT * FROM submissions
        WHERE status = 'pending'
        ORDER BY submitted_at DESC
    """)
    submissions = [build_submission_from_row(row) for row in c.fetchall()]
    conn.close()
    return submissions

@app.get("/api/submissions/{submission_id}", response_model=Submission)
async def get_submission(submission_id: str, auth: dict = Depends(verify_api_key)):
    """Get specific submission details"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,))
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    return build_submission_from_row(row)

@app.post("/api/submissions/{submission_id}/review")
async def review_submission(
    submission_id: str,
    review: ModerationReview,
    auth: dict = Depends(verify_api_key)
):
    """Approve or reject a submission"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Get submission
    c.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Submission not found")

    submission = build_submission_from_row(row)

    if submission.status != "pending":
        conn.close()
        raise HTTPException(status_code=400, detail="Submission already reviewed")

    timestamp = datetime.utcnow().isoformat()

    if review.action == "approve":
        # Move to main assets table
        asset_id = str(uuid.uuid4())
        asset_path = f"{STORAGE_PATH}/{submission.asset_category}/{asset_id}.glb"
        os.makedirs(os.path.dirname(asset_path), exist_ok=True)
        shutil.copy(submission.file_path, asset_path)

        # Copy thumbnail
        thumb_path = None
        if submission.thumbnail_path:
            thumb_ext = os.path.splitext(submission.thumbnail_path)[1]
            thumb_path = f"{STORAGE_PATH}/{submission.asset_category}/{asset_id}_thumb{thumb_ext}"
            shutil.copy(submission.thumbnail_path, thumb_path)

        # Create asset record
        c.execute("""
            INSERT INTO assets
            (id, name, description, type, category, author, publish_date, license,
             file_path, file_size, thumbnail_path, created_at, updated_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            asset_id, submission.asset_name, submission.asset_description,
            submission.asset_type, submission.asset_category, submission.author,
            timestamp, submission.license, asset_path, submission.file_size,
            thumb_path, timestamp, timestamp, submission.version
        ))

        # Update submission status
        c.execute("""
            UPDATE submissions
            SET status = 'approved', reviewed_at = ?, reviewed_by = ?, moderation_notes = ?
            WHERE id = ?
        """, (timestamp, auth["name"], review.notes, submission_id))

        # Create notification
        notif_id = str(uuid.uuid4())
        c.execute("""
            INSERT INTO notifications
            (id, submission_id, recipient_id, type, title, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            notif_id, submission_id, submission.submitter_id, "approved",
            "Asset Approved",
            f"Your asset '{submission.asset_name}' has been approved and added to the library!",
            timestamp
        ))

    elif review.action == "reject":
        # Update submission status
        c.execute("""
            UPDATE submissions
            SET status = 'rejected', reviewed_at = ?, reviewed_by = ?,
                rejection_reason = ?, moderation_notes = ?
            WHERE id = ?
        """, (timestamp, auth["name"], review.rejection_reason, review.notes, submission_id))

        # Create notification
        notif_id = str(uuid.uuid4())
        reason_text = f"\n\nReason: {review.rejection_reason}" if review.rejection_reason else ""
        c.execute("""
            INSERT INTO notifications
            (id, submission_id, recipient_id, type, title, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            notif_id, submission_id, submission.submitter_id, "rejected",
            "Asset Rejected",
            f"Your asset '{submission.asset_name}' was not approved.{reason_text}",
            timestamp
        ))
    else:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid action")

    conn.commit()
    conn.close()

    return {"status": "success", "action": review.action}

# Notification Endpoints
@app.get("/api/notifications", response_model=List[Notification])
async def get_notifications(
    recipient_id: Optional[str] = Query(None),
    unread_only: bool = Query(False)
):
    """Get notifications for user (polling endpoint)"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    query = "SELECT * FROM notifications WHERE 1=1"
    params = []

    if recipient_id:
        query += " AND (recipient_id = ? OR recipient_id IS NULL)"
        params.append(recipient_id)

    if unread_only:
        query += " AND read = 0"

    query += " ORDER BY created_at DESC LIMIT 50"

    c.execute(query, params)
    notifications = [build_notification_from_row(row) for row in c.fetchall()]
    conn.close()

    return notifications

@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str):
    """Mark notification as read"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE notifications SET read = 1 WHERE id = ?", (notification_id,))
    conn.commit()
    conn.close()
    return {"status": "success"}

# API Key Management
@app.post("/api/admin/api-keys")
async def create_api_key(
    key_data: ApiKeyCreate,
    auth: dict = Depends(verify_api_key)
):
    """Create new API key (admin only)"""
    if auth["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    api_key = secrets.token_urlsafe(32)
    timestamp = datetime.utcnow().isoformat()

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO api_keys (key, name, role, created_at, active)
        VALUES (?, ?, ?, ?, 1)
    """, (api_key, key_data.name, key_data.role, timestamp))
    conn.commit()
    conn.close()

    return {"api_key": api_key, "name": key_data.name, "role": key_data.role}

@app.post("/api/auth/verify")
async def verify_key(auth: dict = Depends(verify_api_key)):
    """Verify API key is valid"""
    return {"valid": True, "role": auth["role"], "name": auth["name"]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
