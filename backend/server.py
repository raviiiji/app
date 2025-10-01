from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone

"""
Backend for Blue Carbon MRV & Registry (MVP)
Rules adhered:
- All routes are prefixed with /api
- MongoDB URL only from env MONGO_URL, DB name from DB_NAME
- UUIDs instead of ObjectId
- Datetime stored as ISO strings (UTC)
- CORS uses env CORS_ORIGINS
- Server binds to 0.0.0.0:8001 via supervisor (not modified here)
"""

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Directories for uploads
UPLOAD_DIR = ROOT_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Mount static for uploaded files (served under /api/uploads)
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# --------- Models ---------
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class StatusCheckCreate(BaseModel):
    client_name: str

class PlantationDetails(BaseModel):
    area_hectares: float
    num_plants: int
    plantation_type: str
    location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    farmer_name: str
    details: PlantationDetails
    image_urls: List[str] = []
    status: Literal['submitted', 'under_review', 'approved', 'rejected'] = 'submitted'
    growth_percent: Optional[float] = None
    ndvi_score: Optional[float] = None
    co2_tonnes: Optional[float] = None
    quality_notes: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class ProjectCreate(BaseModel):
    farmer_name: str
    details: PlantationDetails

class ProjectUpdate(BaseModel):
    details: Optional[PlantationDetails] = None

class ReviewAction(BaseModel):
    project_id: str
    action: Literal['approve', 'reject']
    comments: Optional[str] = None

class AdminSettings(BaseModel):
    token_price_usd: float = 10.0
    marketplace_enabled: bool = True

# In-memory cache for admin settings (persist in DB too)
DEFAULT_SETTINGS = AdminSettings()

# --------- Utility helpers ---------
async def parse_from_mongo(item: dict) -> dict:
    if not item:
        return item
    # Ensure string dates
    for k in ('created_at', 'updated_at', 'timestamp'):
        if k in item and isinstance(item[k], datetime):
            item[k] = item[k].astimezone(timezone.utc).isoformat()
    return item

# --------- Basic routes ---------
@api_router.get("/")
async def root():
    return {"message": "Blue Carbon MRV API is alive"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(**input.dict())
    await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**(await parse_from_mongo(s))) for s in status_checks]

# --------- Project CRUD ---------
@api_router.post("/projects", response_model=Project)
async def create_project(payload: ProjectCreate):
    project = Project(farmer_name=payload.farmer_name, details=payload.details)
    await db.projects.insert_one(project.dict())
    return project

@api_router.get("/projects", response_model=List[Project])
async def list_projects(status: Optional[str] = None):
    query = {"status": status} if status else {}
    rows = await db.projects.find(query).sort("created_at", -1).to_list(1000)
    result = []
    for r in rows:
        r = await parse_from_mongo(r)
        result.append(Project(**r))
    return result

@api_router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    row = await parse_from_mongo(row)
    return Project(**row)

@api_router.patch("/projects/{project_id}", response_model=Project)
async def update_project(project_id: str, payload: ProjectUpdate):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    update_fields = {}
    if payload.details is not None:
        update_fields["details"] = payload.details.dict()
    if update_fields:
        update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.projects.update_one({"id": project_id}, {"$set": update_fields})
    updated = await db.projects.find_one({"id": project_id})
    updated = await parse_from_mongo(updated)
    return Project(**updated)

# --------- Upload images ---------
@api_router.post("/projects/{project_id}/upload")
async def upload_images(project_id: str, files: List[UploadFile] = File(...)):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    allowed = {"image/jpeg", "image/png", "image/jpg"}
    saved_urls: List[str] = []
    for f in files:
        if f.content_type not in allowed:
            raise HTTPException(status_code=400, detail=f"Unsupported type {f.content_type}")
        name = f"{project_id}_{uuid.uuid4()}.{ 'png' if 'png' in f.content_type else 'jpg'}"
        dest = UPLOAD_DIR / name
        content = await f.read()
        if len(content) &gt; 25 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (25MB max)")
        with open(dest, 'wb') as out:
            out.write(content)
        saved_urls.append(f"/api/uploads/{name}")
    # update project
    new_urls = (row.get('image_urls') or []) + saved_urls
    await db.projects.update_one({"id": project_id}, {"$set": {"image_urls": new_urls, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"uploaded": saved_urls}

# --------- Submit for analysis (mocked computations) ---------
@api_router.post("/projects/{project_id}/analyze", response_model=Project)
async def analyze_project(project_id: str):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    # Basic mock computations to create aha experience
    img_count = len(row.get('image_urls') or [])
    base = max(0.2, min(0.9, 0.3 + 0.1 * img_count))
    ndvi = round(base, 3)
    growth = round(base * 100, 2)
    co2 = round((row['details']['area_hectares'] * 5.0) * base, 2)  # tonnes estimate
    updates = {
        "ndvi_score": ndvi,
        "growth_percent": growth,
        "co2_tonnes": co2,
        "status": "under_review",
        "quality_notes": "Auto-analysis complete. Awaiting verifier review.",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.projects.update_one({"id": project_id}, {"$set": updates})
    updated = await db.projects.find_one({"id": project_id})
    updated = await parse_from_mongo(updated)
    return Project(**updated)

# --------- Verifier actions ---------
@api_router.get("/verifier/projects", response_model=List[Project])
async def list_pending_for_verifier():
    rows = await db.projects.find({"status": {"$in": ["submitted", "under_review"]}}).sort("updated_at", -1).to_list(1000)
    return [Project(**(await parse_from_mongo(r))) for r in rows]

@api_router.post("/verifier/review", response_model=Project)
async def verifier_review(action: ReviewAction):
    row = await db.projects.find_one({"id": action.project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    new_status = "approved" if action.action == "approve" else "rejected"
    updates = {
        "status": new_status,
        "quality_notes": action.comments or ("Verified and approved" if new_status == "approved" else "Rejected by verifier"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.projects.update_one({"id": action.project_id}, {"$set": updates})
    updated = await db.projects.find_one({"id": action.project_id})
    updated = await parse_from_mongo(updated)
    return Project(**updated)

# --------- Admin interface ---------
@api_router.get("/admin/settings", response_model=AdminSettings)
async def get_admin_settings():
    row = await db.settings.find_one({"id": "admin_settings"})
    if not row:
        await db.settings.insert_one({"id": "admin_settings", **DEFAULT_SETTINGS.dict()})
        return DEFAULT_SETTINGS
    return AdminSettings(**row)

@api_router.post("/admin/settings", response_model=AdminSettings)
async def set_admin_settings(settings: AdminSettings):
    await db.settings.update_one({"id": "admin_settings"}, {"$set": settings.dict()}, upsert=True)
    return settings

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()