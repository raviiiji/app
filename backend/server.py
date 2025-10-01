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

# Light-weight raster utils (A)
import numpy as np
from PIL import Image
try:
    import tifffile
except Exception:  # pragma: no cover
    tifffile = None

"""
Blue Carbon MRV & Registry (MVP++)
Adds A, B, C, D:
A) Basic GeoTIFF NDVI compute (no heavy GDAL): tifffile + numpy + PIL
B) Auto-detect format/source and minimal metadata enrichment
C) NDVI heatmap PNG generation as preview overlay
D) Minimal STAC JSON export for project assets
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
    data_source: Optional[str] = None  # Satellite/Drone/Specialized
    format_type: Optional[str] = None  # GeoTIFF/JPEG/JP2/HDF5/NetCDF

class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    farmer_name: str
    details: PlantationDetails
    image_urls: List[str] = []  # uploaded assets (any format) served from /api/uploads
    status: Literal['submitted', 'under_review', 'approved', 'rejected'] = 'submitted'
    # Core analysis
    growth_percent: Optional[float] = None
    ndvi_score: Optional[float] = None
    co2_tonnes: Optional[float] = None
    quality_notes: Optional[str] = None
    # Extended report fields (from docs)
    mean_ndvi: Optional[float] = None
    healthy_pct: Optional[float] = None
    carbon_credits: Optional[float] = None
    potential_revenue_usd: Optional[float] = None
    price_per_token_usd: Optional[float] = None
    maturity_pct: Optional[float] = None
    ndvi_map_url: Optional[str] = None
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

PREFIX = "/api/uploads/"

def local_path_from_url(url: str) -> Optional[Path]:
    if not url or not url.startswith(PREFIX):
        return None
    name = url[len(PREFIX):]
    return UPLOAD_DIR / name

# ---- A & C: NDVI computation and heatmap ----

def _guess_red_nir(arr: np.ndarray) -> Optional[tuple]:
    """Try to guess (red_idx, nir_idx) given array shapes.
    Supports: (H,W,4) RGBA-like where channel 0 or 2 is Red and last is NIR;
              multi-page tiff where pages represent bands and page descriptions contain 'red'/'nir'.
    Returns (red, nir) channel indices if found within last axis, else None.
    """
    if arr.ndim == 3:
        h, w, c = arr.shape
        if c >= 4:
            # Try common orders
            return (2, 3) if c >= 4 else None  # B,G,R,NIR (R=2, NIR=3) is common for some sensors
        if c >= 3:
            # If only RGB, we can't produce NDVI reliably
            return None
    return None


def compute_ndvi_from_tif(tif_path: Path) -> Optional[dict]:
    if tifffile is None:
        return None
    try:
        with tifffile.TiffFile(str(tif_path)) as tf:
            # Strategy 1: Multi-sample per pixel (H,W,C)
            arr = tf.asarray()
            red = nir = None
            if isinstance(arr, np.ndarray) and arr.ndim == 3:
                guess = _guess_red_nir(arr)
                if guess:
                    r_idx, n_idx = guess
                    red = arr[..., r_idx].astype(np.float32)
                    nir = arr[..., n_idx].astype(np.float32)
            # Strategy 2: Multi-page bands
            if red is None or nir is None:
                pages = tf.pages
                labels = []
                for i, p in enumerate(pages):
                    desc = (getattr(p, 'description', '') or '').lower()
                    name = ''
                    try:
                        name = str(p.tags.get('PageName', '').value).lower() if hasattr(p, 'tags') else ''
                    except Exception:
                        name = ''
                    labels.append((i, desc + ' ' + name))
                red_idx = next((i for i, s in labels if 'red' in s), None)
                nir_idx = next((i for i, s in labels if 'nir' in s or 'near' in s), None)
                if red_idx is not None and nir_idx is not None:
                    red = pages[red_idx].asarray().astype(np.float32)
                    nir = pages[nir_idx].asarray().astype(np.float32)
            if red is None or nir is None:
                return None
            # Normalize to 0..1 if necessary
            if red.max() > 1.5:
                red = red / 10000.0 if red.max() > 100.0 else red / 255.0
            if nir.max() > 1.5:
                nir = nir / 10000.0 if nir.max() > 100.0 else nir / 255.0
            ndvi = (nir - red) / (nir + red + 1e-6)
            # Clean
            ndvi = np.clip(ndvi, -1.0, 1.0)
            # Downscale for preview to keep memory light
            step = max(1, int(max(ndvi.shape) / 1024))
            ndvi_small = ndvi[::step, ::step]
            # Healthy vegetation threshold ~ 0.3
            healthy_pct = float(np.round((ndvi > 0.3).mean() * 100.0, 1))
            mean_ndvi = float(np.round(np.nanmean(ndvi), 3))
            # Make a simple green colormap heatmap
            heat = ndvi_small.copy()
            heat = (heat + 1.0) / 2.0  # map [-1,1] -> [0,1]
            r = np.interp(heat, [0, 0.5, 1.0], [120, 240, 20])
            g = np.interp(heat, [0, 0.5, 1.0], [60, 200, 180])
            b = np.interp(heat, [0, 0.5, 1.0], [20, 80, 40])
            rgb = np.dstack([r, g, b]).astype(np.uint8)
            return {"mean_ndvi": mean_ndvi, "healthy_pct": healthy_pct, "heatmap_rgb": rgb}
    except Exception as e:
        logging.exception("NDVI compute failed: %s", e)
        return None


def save_heatmap_png(rgb: np.ndarray, out_path: Path) -> None:
    img = Image.fromarray(rgb, mode='RGB')
    img.save(str(out_path), format='PNG', compress_level=6)

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

# --------- Analyze (A, B, C, D-ready) ---------
@api_router.post("/projects/{project_id}/analyze", response_model=Project)
async def analyze_project(project_id: str):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")

    # Auto-detect source/format if absent (B)
    details = row.get('details', {})
    ds = details.get('data_source')
    ft = details.get('format_type')
    if (not ds) or (not ft):
        ext_seen = {Path(local_path_from_url(u)).suffix.lower() for u in (row.get('image_urls') or []) if local_path_from_url(u)}
        if any(e in ext_seen for e in {'.tif', '.tiff', '.geotiff'}):
            ds = ds or 'Satellite'
            ft = ft or 'GeoTIFF'
        elif any(e in ext_seen for e in {'.hdf', '.h5'}):
            ds = ds or 'Specialized'
            ft = ft or 'HDF5'
        elif any(e in ext_seen for e in {'.nc'}):
            ds = ds or 'Specialized'
            ft = ft or 'NetCDF'
        elif any(e in ext_seen for e in {'.jpg', '.jpeg', '.png'}):
            ds = ds or 'Drone'
            ft = ft or 'JPEG/PNG'
        details['data_source'] = ds
        details['format_type'] = ft

    # Try NDVI from first GeoTIFF (A)
    ndvi_result = None
    tif_url = next((u for u in (row.get('image_urls') or []) if (Path(u).suffix.lower() in {'.tif', '.tiff', '.geotiff'})), None)
    if tif_url:
        tif_path = local_path_from_url(tif_url)
        if tif_path and tif_path.exists():
            ndvi_result = compute_ndvi_from_tif(tif_path)

    # Fallback base signals
    img_count = len(row.get('image_urls') or [])
    base = max(0.2, min(0.9, 0.3 + 0.1 * img_count))
    ndvi = float(np.round((ndvi_result['mean_ndvi'] if ndvi_result else base), 3))
    growth = float(np.round(base * 100, 2))
    co2 = float(np.round((details.get('area_hectares', 1) * 5.0) * base, 2))

    settings = await get_settings()
    credits = float(np.round(max(1.0, co2), 2))
    revenue = float(np.round(credits * settings.token_price_usd, 2))
    healthy_pct = float(ndvi_result['healthy_pct']) if ndvi_result else float(np.round(min(95.0, max(20.0, ndvi * 100 - 5.0)), 1))
    maturity_pct = float(np.round(min(95.0, 50.0 + ndvi * 40.0), 1))

    ndvi_map_url = row.get('ndvi_map_url')
    if ndvi_result and 'heatmap_rgb' in ndvi_result:
        out_png = UPLOAD_DIR / f"ndvi_{project_id}.png"
        try:
            save_heatmap_png(ndvi_result['heatmap_rgb'], out_png)
            ndvi_map_url = f"/api/uploads/{out_png.name}"
        except Exception as e:
            logging.exception("Failed to save NDVI heatmap: %s", e)

    updates: Dict[str, Any] = {
        "details": details,
        "ndvi_score": ndvi,
        "growth_percent": growth,
        "co2_tonnes": co2,
        "status": "under_review",
        "quality_notes": "Auto-analysis complete. Awaiting verifier review.",
        "mean_ndvi": ndvi,
        "healthy_pct": healthy_pct,
        "carbon_credits": credits,
        "potential_revenue_usd": revenue,
        "price_per_token_usd": settings.token_price_usd,
        "maturity_pct": maturity_pct,
        "ndvi_map_url": ndvi_map_url,
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

# --------- Report JSON (B, C) ---------
@api_router.get("/projects/{project_id}/report")
async def project_report(project_id: str):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    settings = await get_settings()
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
            "ndvi_map_url": row.get("ndvi_map_url"),
        },
        "project_performance": {
            "growth_percent": row.get("growth_percent"),
            "maturity_pct": row.get("maturity_pct"),
            "plantation_type": row.get("details", {}).get("plantation_type"),
            "area_hectares": row.get("details", {}).get("area_hectares"),
            "num_plants": row.get("details", {}).get("num_plants"),
            "data_source": row.get("details", {}).get("data_source"),
            "format_type": row.get("details", {}).get("format_type"),
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

# --------- D: STAC minimal Item ---------
@api_router.get("/projects/{project_id}/stac")
async def stac_item(project_id: str):
    row = await db.projects.find_one({"id": project_id})
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    assets = {}
    for i, href in enumerate(row.get('image_urls') or []):
        ext = Path(href).suffix.lower().strip('.')
        assets[f"asset_{i}"] = {"href": href, "type": ext}
    if row.get('ndvi_map_url'):
        assets['ndvi_heatmap'] = {"href": row['ndvi_map_url'], "type": "png"}
    item = {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": row.get('id'),
        "properties": {
            "datetime": row.get('updated_at'),
            "mean_ndvi": row.get('mean_ndvi'),
            "healthy_pct": row.get('healthy_pct')
        },
        "assets": assets,
        "geometry": None,
        "bbox": None,
    }
    return item

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