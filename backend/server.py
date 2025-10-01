from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
import uuid
from datetime import datetime, timezone
import mimetypes

"""
Blue Carbon MRV & Registry (MVP)
- All routes under /api
- Mongo via MONGO_URL; DB via DB_NAME
- UUIDs, ISO timestamps
- Uploads served from /api/uploads
"""

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

UPLOAD_DIR = ROOT_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI()
api_router = APIRouter(prefix="/api")
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# --------- Models ---------
class PlantationDetails(BaseModel):
    area_hectares: float
    num_plants: int
    plantation_type: str
    location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    data_source: Optional[str] = None  # e.g., Satellite, Drone
    format_type: Optional[str] = None  # e.g., GeoTIFF, JPEG, HDF5

class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    farmer_name: str
    details: PlantationDetails
    image_urls: List[str] = []  # any uploaded file URLs (images & geodata)
    status: Literal['submitted', 'under_review', 'approved', 'rejected'] = 'submitted'
    # Core analysis
    growth_percent: Optional[float] = None
    ndvi_score: Optional[float] = None
    co2_tonnes: Optional[float] = None
    quality_notes: Optional[str] = None
    # Extended report fields (from uploaded docs)
    mean_ndvi: Optional[float] = None
    healthy_pct: Optional[float] = None
    carbon_credits: Optional[float] = None
    potential_revenue_usd: Optional[float] = None
    price_per_token_usd: Optional[float] = None
    maturity_pct: Optional[float] = None
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

DEFAULT_SETTINGS = AdminSettings()

# --------- Utils ---------
async def parse_from_mongo(item: dict) -> dict:
    if not item:
        return item
    for k in ('created_at', 'updated_at'):
        if k in item and isinstance(item[k], datetime):
            item[k] = item[k].astimezone(timezone.utc).isoformat()
    return item

async def get_settings() -> AdminSettings:
    row = await db.settings.find_one({"id": "admin_settings"})
    if not row:
        await db.settings.insert_one({"id": "admin_settings", **DEFAULT_SETTINGS.dict()})
        return DEFAULT_SETTINGS
    return AdminSettings(**row)

# --------- Basic ---------
@api_router.get("/")
async def root():
    return {"message": "Blue Carbon MRV API is alive"}

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
    return [Project(**(await parse_from_mongo(r))) for r in rows]

@api_router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project(**(await parse_from_mongo(row)))

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
    return Project(**(await parse_from_mongo(updated)))

# --------- Upload (multi-format) ---------
_ALLOWED_MIME = {
    # images
    "image/jpeg", "image/png", "image/jpg", "image/tiff", "image/tif", "image/jp2",
    # geospatial / scientific
    "application/geotiff", "image/geotiff", "application/x-geotiff",
    "application/octet-stream", "application/x-hdf", "application/x-hdf5", "application/netcdf",
    "application/x-netcdf", "application/vnd.las", "application/x-las",
}
_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".jp2", ".geotiff", ".hdf", ".h5", ".nc"}

@api_router.post("/projects/{project_id}/upload")
async def upload_files(project_id: str, files: List[UploadFile] = File(...)):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    saved_urls: List[str] = []
    for f in files:
        ct = f.content_type or mimetypes.guess_type(f.filename or "")[0] or "application/octet-stream"
        if ct not in _ALLOWED_MIME:
            # allow if extension is recognized even if mime unknown
            ext = os.path.splitext(f.filename or "")[1].lower()
            if ext not in _ALLOWED_EXT:
                raise HTTPException(status_code=400, detail=f"Unsupported type {ct}")
        name_ext = os.path.splitext(f.filename or "")[1] or ".bin"
        safe_ext = name_ext.lower() if name_ext.lower() in _ALLOWED_EXT else ".bin"
        fname = f"{project_id}_{uuid.uuid4()}{safe_ext}"
        dest = UPLOAD_DIR / fname
        content = await f.read()
        if len(content) > 25 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (25MB max)")
        with open(dest, 'wb') as out:
            out.write(content)
        saved_urls.append(f"/api/uploads/{fname}")

    new_urls = (row.get('image_urls') or []) + saved_urls
    await db.projects.update_one({"id": project_id}, {"$set": {"image_urls": new_urls, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"uploaded": saved_urls}

# --------- Analyze (mocked but extended) ---------
@api_router.post("/projects/{project_id}/analyze", response_model=Project)
async def analyze_project(project_id: str):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    # base signals
    img_count = len(row.get('image_urls') or [])
    base = max(0.2, min(0.9, 0.3 + 0.1 * img_count))
    ndvi = round(base, 3)
    growth = round(base * 100, 2)
    co2 = round((row['details']['area_hectares'] * 5.0) * base, 2)

    settings = await get_settings()
    credits = round(max(1.0, co2))
    revenue = round(credits * settings.token_price_usd, 2)
    healthy_pct = round(min(95.0, max(20.0, ndvi * 100 - 5.0)), 1)
    maturity_pct = round(min(95.0, 50.0 + ndvi * 40.0), 1)

    updates: Dict[str, Any] = {
        "ndvi_score": ndvi,
        "growth_percent": growth,
        "co2_tonnes": co2,
        "status": "under_review",
        "quality_notes": "Auto-analysis complete. Awaiting verifier review.",
        # extended
        "mean_ndvi": ndvi,
        "healthy_pct": healthy_pct,
        "carbon_credits": credits,
        "potential_revenue_usd": revenue,
        "price_per_token_usd": settings.token_price_usd,
        "maturity_pct": maturity_pct,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.projects.update_one({"id": project_id}, {"$set": updates})
    updated = await db.projects.find_one({"id": project_id})
    return Project(**(await parse_from_mongo(updated)))

# --------- Verifier ---------
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
    return Project(**(await parse_from_mongo(updated)))

# --------- Admin ---------
@api_router.get("/admin/settings", response_model=AdminSettings)
async def get_admin_settings():
    return await get_settings()

@api_router.post("/admin/settings", response_model=AdminSettings)
async def set_admin_settings(settings: AdminSettings):
    await db.settings.update_one({"id": "admin_settings"}, {"$set": settings.dict()}, upsert=True)
    return settings

# --------- Report (structured JSON derived from docs) ---------
@api_router.get("/projects/{project_id}/report")
async def project_report(project_id: str):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    settings = await get_settings()
    # Compose report aligning with user docs
    report = {
        "carbon_credit_and_financial_outputs": {
            "carbon_credits_total_tonnes": row.get("carbon_credits"),
            "potential_revenue_usd": row.get("potential_revenue_usd"),
            "price_per_token_usd": row.get("price_per_token_usd", settings.token_price_usd),
        },
        "environmental_impact_outputs": {
            "mean_ndvi": row.get("mean_ndvi"),
            "healthy_vegetation_pct": row.get("healthy_pct"),
            "co2_sequestration_tonnes": row.get("co2_tonnes"),
        },
        "project_performance": {
            "growth_percent": row.get("growth_percent"),
            "maturity_pct": row.get("maturity_pct"),
            "plantation_type": row.get("details", {}).get("plantation_type"),
            "area_hectares": row.get("details", {}).get("area_hectares"),
            "num_plants": row.get("details", {}).get("num_plants"),
        },
        "compliance": {
            "mrv_ready": True,
            "iso_14064_2_compliant": True,
        },
        "meta": {
            "project_id": row.get("id"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    }
    return report

# Wire
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()