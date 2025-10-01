import { useEffect, useMemo, useRef, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import axios from "axios";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Toaster, toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Pill = ({ children, className = "" }) => (<span className={`badge ${className}`}>{children}</span>);

function Navbar() {
  return (
    <div className="navbar">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-5 py-4">
        <Link to="/" className="flex items-center gap-2 no-underline" data-testid="nav-home">
          <img src="/vayu-logo.png" alt="Vayu" className="w-8 h-8 rounded-full" />
          <span className="font-semibold">Blue Carbon MRV</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/farmer" className="text-sm" data-testid="nav-farmer">Farmer</Link>
          <Link to="/verifier" className="text-sm" data-testid="nav-verifier">Verifier</Link>
          <Link to="/admin" className="text-sm" data-testid="nav-admin">Admin</Link>
        </div>
      </div>
    </div>
  );
}

function Landing() {
  useEffect(() => { axios.get(`${API}/`).catch(()=>{}); }, []);
  return (
    <div className="hero">
      <div className="mx-auto max-w-6xl px-5 py-16 grid-2 items-center">
        <div>
          <h1 className="text-5xl leading-tight mb-4" data-testid="hero-title">Measure. Verify. Register blue carbon.</h1>
          <p className="text-lg opacity-80 mb-6">Upload imagery (GeoTIFF/COG, JP2, HDF5, NetCDF, JPEG/PNG), run NDVI & sequestration models, and move to a verifiable registry.</p>
          <div className="flex gap-3">
            <Link to="/farmer" className="btn-primary" data-testid="get-started-btn">Get started</Link>
            <Link to="/verifier" className="btn-primary" style={{background:"#34b3a0"}} data-testid="verify-btn">Verifier</Link>
          </div>
        </div>
        <div className="card p-6" data-testid="hero-stats">
          <div className="grid grid-cols-2 gap-4">
            <div><div className="text-3xl font-semibold">NDVI</div><div className="opacity-80 text-sm">Vegetation Index</div></div>
            <div><div className="text-3xl font-semibold">CO₂</div><div className="opacity-80 text-sm">Tonnes estimated</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FarmerPage() {
  const [farmerName, setFarmerName] = useState("");
  const [area, setArea] = useState("");
  const [plants, setPlants] = useState("");
  const [ptype, setPtype] = useState("Mangrove");
  const [location, setLocation] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [dataSource, setDataSource] = useState("Satellite");
  const [formatType, setFormatType] = useState("GeoTIFF");
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [project, setProject] = useState(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef(null); const canvasRef = useRef(null); const streamRef = useRef(null);

  const disabled = useMemo(()=> !farmerName || !area || !plants || !location, [farmerName, area, plants, location]);

  const createProject = async () => {
    setSubmitting(true);
    try {
      const payload = { farmer_name: farmerName, details: { area_hectares: parseFloat(area), num_plants: parseInt(plants,10), plantation_type: ptype, location, latitude: lat ? parseFloat(lat) : null, longitude: lng ? parseFloat(lng) : null, data_source: dataSource, format_type: formatType } };
      const { data } = await axios.post(`${API}/projects`, payload); setProject(data); return data.id;
    } finally { setSubmitting(false); }
  };

  const uploadFiles = async (projectId) => { if (!files || files.length === 0) return; const form = new FormData(); for (const f of files) form.append("files", f); await axios.post(`${API}/projects/${projectId}/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' }}); };

  const submitForAnalysis = async (projectId) => { const { data } = await axios.post(`${API}/projects/${projectId}/analyze`); setProject(data); toast.success("Analysis complete. Awaiting verification"); };

  const onSubmit = async () => { const id = await createProject(); if (!id) return; await uploadFiles(id); await submitForAnalysis(id); };

  const openCamera = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); streamRef.current = stream; if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); } } catch { toast.error("Unable to access camera. Please allow permissions."); } };
  const stopCamera = () => { try { streamRef.current?.getTracks?.().forEach(t=>t.stop()); if (videoRef.current) videoRef.current.srcObject = null; } catch {} };
  const capturePhoto = async () => { const v=videoRef.current,c=canvasRef.current; if(!v||!c) return; const w=v.videoWidth||1280,h=v.videoHeight||720; c.width=w;c.height=h; const ctx=c.getContext('2d'); ctx.drawImage(v,0,0,w,h); const blob = await new Promise(res=>c.toBlob(b=>res(b),'image/jpeg',0.92)); if(!blob) return; const file = new File([blob], `capture_${Date.now()}.jpg`, { type:'image/jpeg' }); setFiles(prev=>[...prev,file]); toast.success("Photo added to uploads"); };
  useEffect(()=>{ if (cameraOpen) openCamera(); else stopCamera(); return ()=>stopCamera(); }, [cameraOpen]);

  const removeFileAt = (idx) => setFiles(prev=>prev.filter((_,i)=>i!==idx));

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h2 className="text-3xl mb-4" data-testid="farmer-title">Submit a Blue Carbon Project</h2>
      <div className="grid-2">
        <div className="card p-5">
          <div className="section">
            <div className="mb-3"><div className="label">Farmer / Land Owner</div><Input data-testid="farmer-name" placeholder="Your name" value={farmerName} onChange={e=>setFarmerName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><div className="label">Area size (hectares)</div><Input data-testid="area-size" type="number" value={area} onChange={e=>setArea(e.target.value)} placeholder="e.g., 120" /></div>
              <div><div className="label">Number of plants</div><Input data-testid="num-plants" type="number" value={plants} onChange={e=>setPlants(e.target.value)} placeholder="e.g., 45000" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="label">Plantation type</div>
                <Select value={ptype} onValueChange={setPtype}><SelectTrigger data-testid="plantation-type"><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent><SelectItem value="Mangrove">Mangrove</SelectItem><SelectItem value="Seagrass">Seagrass</SelectItem><SelectItem value="Saltmarsh">Saltmarsh</SelectItem></SelectContent></Select>
              </div>
              <div>
                <div className="label">Data source</div>
                <Select value={dataSource} onValueChange={setDataSource}><SelectTrigger data-testid="data-source"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Satellite">Satellite (Sentinel/Landsat/Planet)</SelectItem><SelectItem value="Drone">Drone (RGB/Multispectral/Thermal)</SelectItem><SelectItem value="Specialized">Specialized (GeoTIFF/NetCDF/HDF)</SelectItem></SelectContent></Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="label">Format type</div>
                <Select value={formatType} onValueChange={setFormatType}><SelectTrigger data-testid="format-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GeoTIFF">GeoTIFF/COG (.tif/.tiff)</SelectItem><SelectItem value="JPEG/PNG">JPEG/PNG</SelectItem><SelectItem value="JP2">JPEG2000 (.jp2)</SelectItem><SelectItem value="HDF5">HDF/HDF5 (.hdf/.h5)</SelectItem><SelectItem value="NetCDF">NetCDF (.nc)</SelectItem></SelectContent></Select>
              </div>
              <div><div className="label">Location</div><Input data-testid="location" placeholder="State, Country" value={location} onChange={e=>setLocation(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><div className="label">Latitude (optional)</div><Input data-testid="lat" type="number" value={lat} onChange={e=>setLat(e.target.value)} /></div>
              <div><div className="label">Longitude (optional)</div><Input data-testid="lng" type="number" value={lng} onChange={e=>setLng(e.target.value)} /></div>
            </div>
            <div className="mb-3">
              <div className="label">Upload imagery / data</div>
              <div className="flex items-center gap-2 mb-2">
                <Input data-testid="image-upload" type="file" multiple accept="image/png,image/jpeg,image/tiff,image/jp2,.tif,.tiff,.jp2,.geotiff,.hdf,.h5,.nc" capture="environment" onChange={e=>setFiles(Array.from(e.target.files||[]))} />
                <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
                  <DialogTrigger asChild><Button variant="secondary" data-testid="open-camera-btn">Open camera</Button></DialogTrigger>
                  <DialogContent data-testid="camera-dialog"><DialogHeader><DialogTitle>Capture photo</DialogTitle></DialogHeader><div className="space-y-3"><video ref={videoRef} playsInline autoPlay muted className="w-full rounded" data-testid="camera-video" /><canvas ref={canvasRef} className="hidden" /><div className="flex gap-2"><Button onClick={capturePhoto} data-testid="capture-photo-btn">Capture &amp; add</Button><Button variant="outline" onClick={()=>setCameraOpen(false)} data-testid="close-camera-btn">Done</Button></div></div></DialogContent>
                </Dialog>
              </div>
              {files.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-2" data-testid="upload-previews">
                  {files.map((f, idx) => (
                    <div key={idx} className="relative">
                      {String(f.type).startsWith('image/') ? (<img alt="preview" src={URL.createObjectURL(f)} className="rounded" data-testid={`preview-${idx}`} />) : (<div className="p-3 bg-white rounded border text-sm" data-testid={`preview-${idx}`}>{f.name}</div>)}
                      <button className="btn-primary" style={{position:'absolute', top:6, right:6, background:'#d9534f'}} onClick={()=>removeFileAt(idx)} data-testid={`remove-preview-${idx}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs opacity-70 mt-1">Supports GeoTIFF/COG, JP2, HDF5, NetCDF and standard images. Max 25MB/file.</div>
            </div>
            <Button data-testid="submit-project" disabled={disabled || submitting} onClick={onSubmit}>{submitting ? 'Submitting...' : 'Submit for analysis'}</Button>
          </div>
        </div>
        <div className="card p-5">
          <div className="section">
            <Tabs defaultValue="overview" data-testid="analysis-tabs">
              <TabsList>
                <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
                <TabsTrigger value="report" data-testid="tab-report">Detailed report</TabsTrigger>
              </TabsList>
              <TabsContent value="overview">
                <h3 className="text-xl mb-2" data-testid="analysis-title">Analysis</h3>
                {!project && <div data-testid="analysis-empty" className="opacity-70">Your analysis will appear here after submission.</div>}
                {project && (
                  <div data-testid="analysis-panel">
                    <div className="mb-2">Project ID: <span className="font-mono">{project.id}</span></div>
                    <div className="mb-2">Status: <Pill className={project.status}>{project.status}</Pill></div>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                      <div className="card p-3"><div className="text-sm opacity-70">NDVI</div><div className="text-2xl font-semibold">{project.ndvi_score ?? '-'}</div></div>
                      <div className="card p-3"><div className="text-sm opacity-70">Growth %</div><div className="text-2xl font-semibold">{project.growth_percent ?? '-'}</div></div>
                    </div>
                    <div className="card p-3 mb-2"><div className="text-sm opacity-70">CO₂ sequestration (tonnes)</div><div className="text-2xl font-semibold">{project.co2_tonnes ?? '-'}</div></div>
                    {project?.ndvi_map_url && (
                      <div className="mt-3">
                        <div className="text-sm opacity-70 mb-1">NDVI heatmap</div>
                        <img src={project.ndvi_map_url} alt="NDVI heatmap" className="rounded" data-testid="ndvi-heatmap" />
                      </div>
                    )}
                    <div className="text-sm opacity-80 mt-2">{project.quality_notes}</div>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="report">
                {!project && <div className="opacity-70" data-testid="report-empty">Report appears after analysis.</div>}
                {project && (
                  <div className="space-y-3" data-testid="report-panel">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="card p-3"><div className="text-sm opacity-70">Mean NDVI</div><div className="text-2xl font-semibold">{project.mean_ndvi ?? '-'}</div></div>
                      <div className="card p-3"><div className="text-sm opacity-70">Healthy vegetation %</div><div className="text-2xl font-semibold">{project.healthy_pct ?? '-'}</div></div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="card p-3"><div className="text-sm opacity-70">Carbon credits (tCO₂)</div><div className="text-2xl font-semibold">{project.carbon_credits ?? '-'}</div></div>
                      <div className="card p-3"><div className="text-sm opacity-70">Price per token (USD)</div><div className="text-2xl font-semibold">{project.price_per_token_usd ?? '-'}</div></div>
                      <div className="card p-3"><div className="text-sm opacity-70">Potential revenue (USD)</div><div className="text-2xl font-semibold">{project.potential_revenue_usd ?? '-'}</div></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="card p-3"><div className="text-sm opacity-70">Maturity %</div><div className="text-2xl font-semibold">{project.maturity_pct ?? '-'}</div></div>
                      <div className="card p-3"><div className="text-sm opacity-70">Area / Plants</div><div className="text-2xl font-semibold">{project?.details?.area_hectares} ha • {project?.details?.num_plants} plants</div></div>
                    </div>
                    <div className="flex gap-2">
                      <Button data-testid="export-report" onClick={async()=>{ if(!project) return; const { data } = await axios.get(`${API}/projects/${project.id}/report`); const blob = new Blob([JSON.stringify(data,null,2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `project_${project.id}_report.json`; a.click(); URL.revokeObjectURL(url); }}>Export JSON</Button>
                      <Button data-testid="export-stac" variant="secondary" onClick={async()=>{ if(!project) return; const { data } = await axios.get(`${API}/projects/${project.id}/stac`); const blob = new Blob([JSON.stringify(data,null,2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `project_${project.id}_stac.json`; a.click(); URL.revokeObjectURL(url); }}>Export STAC</Button>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}

function VerifierPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [comments, setComments] = useState({}); // per-row comment
  const [active, setActive] = useState(null); // project for dialog

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/verifier/projects`);
      setRows(data);
    } finally { setLoading(false); }
  };
  useEffect(()=>{ load(); },[]);

  const filtered = useMemo(()=>
    rows.filter(r => (statusFilter === "all" || r.status === statusFilter) &&
      (r.farmer_name?.toLowerCase().includes(query.toLowerCase()) || r.id?.includes(query)))
  ,[rows, statusFilter, query]);

  const kpi = useMemo(()=>{
    const total = rows.length;
    const under = rows.filter(r=>r.status==='under_review').length;
    const submitted = rows.filter(r=>r.status==='submitted').length;
    const avgNdvi = rows.length ? (rows.reduce((a,b)=>a+(b.ndvi_score||0),0)/rows.length).toFixed(2) : '-';
    const avgCo2 = rows.length ? (rows.reduce((a,b)=>a+(b.co2_tonnes||0),0)/rows.length).toFixed(1) : '-';
    return { total, under, submitted, avgNdvi, avgCo2 };
  },[rows]);

  const act = async (project_id, action) => {
    const comment = comments[project_id] || "";
    await axios.post(`${API}/verifier/review`, { project_id, action, comments: comment });
    setComments(c=>({ ...c, [project_id]: "" }));
    setActive(null);
    await load();
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h2 className="text-3xl mb-4" data-testid="verifier-title">Verifier dashboard</h2>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="card p-4" data-testid="verifier-kpi-total"><div className="text-xs opacity-70">Pending total</div><div className="text-2xl font-semibold">{kpi.total}</div></div>
        <div className="card p-4" data-testid="verifier-kpi-submitted"><div className="text-xs opacity-70">Submitted</div><div className="text-2xl font-semibold">{kpi.submitted}</div></div>
        <div className="card p-4" data-testid="verifier-kpi-under"><div className="text-xs opacity-70">Under review</div><div className="text-2xl font-semibold">{kpi.under}</div></div>
        <div className="card p-4" data-testid="verifier-kpi-averages"><div className="text-xs opacity-70">Avg NDVI / CO₂</div><div className="text-2xl font-semibold">{kpi.avgNdvi} / {kpi.avgCo2}</div></div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-testid="verifier-filter-status" className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="under_review">Under review</SelectItem>
          </SelectContent>
        </Select>
        <Input data-testid="verifier-search-input" placeholder="Search by farmer or ID" value={query} onChange={e=>setQuery(e.target.value)} className="max-w-xs" />
      </div>

      <div className="card p-5">
        <Table data-testid="verifier-table">
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Farmer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>NDVI</TableHead>
              <TableHead>Growth%</TableHead>
              <TableHead>CO₂</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r)=> (
              <TableRow key={r.id} data-testid={`verifier-row-${r.id}`}>
                <TableCell className="font-mono text-xs">{r.id.slice(0,8)}...</TableCell>
                <TableCell>{r.farmer_name}</TableCell>
                <TableCell><Pill className={r.status}>{r.status}</Pill></TableCell>
                <TableCell>{r.ndvi_score ?? '-'}</TableCell>
                <TableCell>{r.growth_percent ?? '-'}</TableCell>
                <TableCell>{r.co2_tonnes ?? '-'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Input data-testid={`verifier-comment-${r.id}`} placeholder="comment" value={comments[r.id]||""} onChange={e=>setComments(c=>({...c,[r.id]:e.target.value}))} style={{maxWidth:200}} />
                    <Button data-testid={`open-review-${r.id}`} variant="outline" onClick={()=>setActive(r)}>Review</Button>
                    <Button data-testid={`approve-${r.id}`} onClick={()=>act(r.id,'approve')}>Approve</Button>
                    <Button data-testid={`reject-${r.id}`} variant="destructive" onClick={()=>act(r.id,'reject')}>Reject</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && !loading && (
              <TableRow><TableCell colSpan={7} className="opacity-70">No projects found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Review dialog */}
      <Dialog open={!!active} onOpenChange={(v)=>{ if(!v) setActive(null); }}>
        <DialogContent data-testid="verifier-review-dialog">
          <DialogHeader><DialogTitle>Project review</DialogTitle></DialogHeader>
          {active && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-3"><div className="text-xs opacity-70">ID</div><div className="font-mono text-sm">{active.id}</div></div>
                <div className="card p-3"><div className="text-xs opacity-70">Farmer</div><div>{active.farmer_name}</div></div>
                <div className="card p-3"><div className="text-xs opacity-70">Status</div><div><Pill className={active.status}>{active.status}</Pill></div></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-3"><div className="text-xs opacity-70">NDVI</div><div className="text-xl font-semibold">{active.ndvi_score ?? '-'}</div></div>
                <div className="card p-3"><div className="text-xs opacity-70">Growth%</div><div className="text-xl font-semibold">{active.growth_percent ?? '-'}</div></div>
                <div className="card p-3"><div className="text-xs opacity-70">CO₂ (t)</div><div className="text-xl font-semibold">{active.co2_tonnes ?? '-'}</div></div>
              </div>
              {active.image_urls?.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {active.image_urls.map((u, idx)=> (<img key={idx} src={u} alt="upload" className="rounded" data-testid={`review-image-${idx}`} />))}
                </div>
              ) : <div className="opacity-70 text-sm">No images.</div>}
              <div className="flex items-center gap-2">
                <Input data-testid={`dialog-comment-${active.id}`} placeholder="comment" value={comments[active.id]||""} onChange={e=>setComments(c=>({...c,[active.id]:e.target.value}))} />
                <Button data-testid="verifier-approve" onClick={()=>act(active.id,'approve')}>Approve</Button>
                <Button data-testid="verifier-reject" variant="destructive" onClick={()=>act(active.id,'reject')}>Reject</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminPage() {
  const [settings, setSettings] = useState({ token_price_usd: 10.0, marketplace_enabled: true });
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const s = await axios.get(`${API}/admin/settings`);
      const p = await axios.get(`${API}/projects`);
      setSettings(s.data);
      setProjects(p.data || []);
    } finally { setLoading(false); }
  };
  useEffect(()=>{ load(); },[]);

  const save = async () => { await axios.post(`${API}/admin/settings`, settings); toast.success("Settings saved"); await load(); };

  const kpi = useMemo(()=>{
    const total = projects.length;
    const approved = projects.filter(p=>p.status==='approved').length;
    const rejected = projects.filter(p=>p.status==='rejected').length;
    const pending = projects.filter(p=>p.status==='submitted' || p.status==='under_review').length;
    const credits = projects.reduce((a,b)=>a + (b.carbon_credits||0), 0);
    const revenue = projects.reduce((a,b)=> a + (b.potential_revenue_usd || ((b.carbon_credits||0)*settings.token_price_usd)), 0);
    const approvalRate = total ? Math.round((approved/total)*100) : 0;
    return { total, approved, rejected, pending, credits, revenue: Math.round(revenue), approvalRate };
  }, [projects, settings.token_price_usd]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h2 className="text-3xl mb-4" data-testid="admin-title">Admin</h2>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="card p-4" data-testid="admin-metrics-total-projects"><div className="text-xs opacity-70">Total projects</div><div className="text-2xl font-semibold">{kpi.total}</div></div>
        <div className="card p-4" data-testid="admin-metrics-approved"><div className="text-xs opacity-70">Approved</div><div className="text-2xl font-semibold">{kpi.approved}</div></div>
        <div className="card p-4" data-testid="admin-metrics-rejected"><div className="text-xs opacity-70">Rejected</div><div className="text-2xl font-semibold">{kpi.rejected}</div></div>
        <div className="card p-4" data-testid="admin-metrics-pending"><div className="text-xs opacity-70">Pending</div><div className="text-2xl font-semibold">{kpi.pending}</div></div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card p-4" data-testid="admin-total-credits">
          <div className="text-xs opacity-70">Total credits (tCO₂)</div>
          <div className="text-2xl font-semibold">{kpi.credits}</div>
        </div>
        <div className="card p-4" data-testid="admin-total-revenue">
          <div className="text-xs opacity-70">Potential revenue (USD)</div>
          <div className="text-2xl font-semibold">{kpi.revenue}</div>
        </div>
        <div className="card p-4" data-testid="admin-approval-rate">
          <div className="text-xs opacity-70 mb-2">Approval rate</div>
          <Progress value={kpi.approvalRate} />
          <div className="text-sm mt-1">{kpi.approvalRate}%</div>
        </div>
      </div>

      {/* Settings */}
      <div className="card p-5 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="label">Token price (USD)</div>
            <Input data-testid="token-price" type="number" step="0.01" value={settings.token_price_usd} onChange={e=>setSettings(s=>({...s, token_price_usd: parseFloat(e.target.value || '0')}))} />
          </div>
          <div>
            <div className="label">Marketplace enabled</div>
            <Select value={String(settings.marketplace_enabled)} onValueChange={(v)=>setSettings(s=>({...s, marketplace_enabled: v==='true'}))}>
              <SelectTrigger data-testid="marketplace-enabled"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="true">True</SelectItem><SelectItem value="false">False</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={save} data-testid="save-settings">Save</Button>
          <Button variant="outline" data-testid="refresh-admin" onClick={load}>Refresh</Button>
        </div>
      </div>

      {/* Recent projects table */}
      <div className="card p-5">
        <div className="text-lg font-semibold mb-2">Recent projects</div>
        <Table data-testid="admin-projects-table">
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Farmer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Credits</TableHead>
              <TableHead>Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.slice(0,10).map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.id.slice(0,8)}...</TableCell>
                <TableCell>{p.farmer_name}</TableCell>
                <TableCell><Pill className={p.status}>{p.status}</Pill></TableCell>
                <TableCell>{p.carbon_credits ?? '-'}</TableCell>
                <TableCell>{p.potential_revenue_usd ?? '-'}</TableCell>
              </TableRow>
            ))}
            {!projects.length && (
              <TableRow><TableCell colSpan={5} className="opacity-70">No data</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AppShell({children}){ return (<div className="app-shell"><Navbar /><Toaster />{children}</div>); }

function App() { return (<div className="App"><BrowserRouter><AppShell><Routes><Route path="/" element={<Landing />} /><Route path="/farmer" element={<FarmerPage />} /><Route path="/verifier" element={<VerifierPage />} /><Route path="/admin" element={<AdminPage />} /></Routes></AppShell></BrowserRouter></div>); }

export default App;