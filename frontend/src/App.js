import { useEffect, useMemo, useRef, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import axios from "axios";

// shadcn components
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Toaster, toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

// Respect env rules
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Pill = ({ children, className = "" }) => (
  <span className={`badge ${className}`}>{children}</span>
);

function Navbar() {
  return (
    <div className="navbar">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-5 py-4">
        <Link to="/" className="flex items-center gap-2 no-underline" data-testid="nav-home">
          <div className="w-8 h-8 rounded-full" style={{background: "linear-gradient(135deg, #34b3a0, #6dd5c8)"}} />
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
  useEffect(() => {
    axios.get(`${API}/`).catch(()=>{});
  }, []);
  return (
    <div className="hero">
      <div className="mx-auto max-w-6xl px-5 py-16 grid-2 items-center">
        <div>
          <h1 className="text-5xl leading-tight mb-4" data-testid="hero-title">Measure. Verify. Register blue carbon.</h1>
          <p className="text-lg opacity-80 mb-6">Upload imagery, run automated NDVI and sequestration models, and move to a verifiable, tokenized registry.</p>
          <div className="flex gap-3">
            <Link to="/farmer" className="btn-primary" data-testid="get-started-btn">Get started</Link>
            <Link to="/verifier" className="btn-primary" style={{background:"#34b3a0"}} data-testid="verify-btn">Verifier</Link>
          </div>
        </div>
        <div className="card p-6" data-testid="hero-stats">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-3xl font-semibold">NDVI</div>
              <div className="opacity-80 text-sm">Normalized Difference Vegetation Index</div>
            </div>
            <div>
              <div className="text-3xl font-semibold">CO₂</div>
              <div className="opacity-80 text-sm">Tonnes estimated post analysis</div>
            </div>
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
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [project, setProject] = useState(null);

  // Camera states
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const disabled = useMemo(()=> !farmerName || !area || !plants || !location, [farmerName, area, plants, location]);

  const createProject = async () => {
    setSubmitting(true);
    try {
      const payload = {
        farmer_name: farmerName,
        details: {
          area_hectares: parseFloat(area),
          num_plants: parseInt(plants,10),
          plantation_type: ptype,
          location,
          latitude: lat ? parseFloat(lat) : null,
          longitude: lng ? parseFloat(lng) : null,
        }
      };
      const { data } = await axios.post(`${API}/projects`, payload);
      setProject(data);
      return data.id;
    } finally {
      setSubmitting(false);
    }
  };

  const uploadImages = async (projectId) => {
    if (!files || files.length === 0) return;
    const form = new FormData();
    for (const f of files) form.append("files", f);
    await axios.post(`${API}/projects/${projectId}/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' }});
  };

  const submitForAnalysis = async (projectId) => {
    const { data } = await axios.post(`${API}/projects/${projectId}/analyze`);
    setProject(data);
    toast.success("Analysis complete. Awaiting verification");
  };

  const onSubmit = async () => {
    const id = await createProject();
    if (!id) return;
    await uploadImages(id);
    await submitForAnalysis(id);
  };

  // Camera helpers
  const openCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Camera not supported on this device");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e) {
      toast.error("Unable to access camera. Please allow permissions.");
    }
  };

  const stopCamera = () => {
    try {
      const tracks = streamRef.current?.getTracks?.() || [];
      tracks.forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    } catch {}
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    const blob = await new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92));
    if (!blob) return;
    const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
    setFiles(prev => [...prev, file]);
    toast.success("Photo added to uploads");
  };

  useEffect(()=>{
    if (cameraOpen) {
      openCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [cameraOpen]);

  const removeFileAt = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h2 className="text-3xl mb-4" data-testid="farmer-title">Submit a Blue Carbon Project</h2>
      <div className="grid-2">
        <div className="card p-5">
          <div className="section">
            <div className="mb-3">
              <div className="label">Farmer / Land Owner</div>
              <Input data-testid="farmer-name" placeholder="Your name" value={farmerName} onChange={e=>setFarmerName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="label">Area size (hectares)</div>
                <Input data-testid="area-size" type="number" value={area} onChange={e=>setArea(e.target.value)} placeholder="e.g., 120" />
              </div>
              <div>
                <div className="label">Number of plants</div>
                <Input data-testid="num-plants" type="number" value={plants} onChange={e=>setPlants(e.target.value)} placeholder="e.g., 45000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="label">Plantation type</div>
                <Select value={ptype} onValueChange={setPtype}>
                  <SelectTrigger data-testid="plantation-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Mangrove">Mangrove</SelectItem>
                    <SelectItem value="Seagrass">Seagrass</SelectItem>
                    <SelectItem value="Saltmarsh">Saltmarsh</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="label">Location</div>
                <Input data-testid="location" placeholder="State, Country" value={location} onChange={e=>setLocation(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="label">Latitude (optional)</div>
                <Input data-testid="lat" type="number" value={lat} onChange={e=>setLat(e.target.value)} />
              </div>
              <div>
                <div className="label">Longitude (optional)</div>
                <Input data-testid="lng" type="number" value={lng} onChange={e=>setLng(e.target.value)} />
              </div>
            </div>
            <div className="mb-3">
              <div className="label">Upload drone/satellite images</div>
              <div className="flex items-center gap-2 mb-2">
                <Input data-testid="image-upload" type="file" multiple accept="image/png,image/jpeg" capture="environment" onChange={e=>setFiles(Array.from(e.target.files||[]))} />
                <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
                  <DialogTrigger asChild>
                    <Button variant="secondary" data-testid="open-camera-btn">Open camera</Button>
                  </DialogTrigger>
                  <DialogContent data-testid="camera-dialog">
                    <DialogHeader>
                      <DialogTitle>Capture photo</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <video ref={videoRef} playsInline autoPlay muted className="w-full rounded" data-testid="camera-video" />
                      <canvas ref={canvasRef} className="hidden" />
                      <div className="flex gap-2">
                        <Button onClick={capturePhoto} data-testid="capture-photo-btn">Capture &amp; add</Button>
                        <Button variant="outline" onClick={()=>setCameraOpen(false)} data-testid="close-camera-btn">Done</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              {files.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-2" data-testid="upload-previews">
                  {files.map((f, idx) => (
                    <div key={idx} className="relative">
                      <img alt="preview" src={URL.createObjectURL(f)} className="rounded" data-testid={`preview-${idx}`} />
                      <button className="btn-primary" style={{position:'absolute', top:6, right:6, background:'#d9534f'}} onClick={()=>removeFileAt(idx)} data-testid={`remove-preview-${idx}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs opacity-70 mt-1">Use your camera or choose files. JPG/PNG up to 25MB each.</div>
            </div>
            <Button data-testid="submit-project" disabled={disabled || submitting} onClick={onSubmit}>{submitting ? 'Submitting...' : 'Submit for analysis'}</Button>
          </div>
        </div>
        <div className="card p-5">
          <div className="section">
            <h3 className="text-xl mb-2" data-testid="analysis-title">Analysis</h3>
            {!project && <div data-testid="analysis-empty" className="opacity-70">Your analysis will appear here after submission.</div>}
            {project && (
              <div data-testid="analysis-panel">
                <div className="mb-2">Project ID: <span className="font-mono">{project.id}</span></div>
                <div className="mb-2">Status: <Pill className={project.status}>{project.status}</Pill></div>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div className="card p-3">
                    <div className="text-sm opacity-70">NDVI</div>
                    <div className="text-2xl font-semibold">{project.ndvi_score ?? '-'}</div>
                  </div>
                  <div className="card p-3">
                    <div className="text-sm opacity-70">Growth %</div>
                    <div className="text-2xl font-semibold">{project.growth_percent ?? '-'}</div>
                  </div>
                </div>
                <div className="card p-3 mb-2">
                  <div className="text-sm opacity-70">CO₂ sequestration (tonnes)</div>
                  <div className="text-2xl font-semibold">{project.co2_tonnes ?? '-'}</div>
                </div>
                <div className="text-sm opacity-80">{project.quality_notes}</div>
                {project.image_urls?.length ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {project.image_urls.map((u, idx) => (
                      <img key={idx} src={u} alt="upload" className="rounded" data-testid={`analysis-image-${idx}`} />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VerifierPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/verifier/projects`);
      setRows(data);
    } finally { setLoading(false); }
  };

  useEffect(()=>{ load(); },[]);

  const act = async (project_id, action) => {
    await axios.post(`${API}/verifier/review`, { project_id, action, comments: comment });
    setComment("");
    await load();
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h2 className="text-3xl mb-4" data-testid="verifier-title">Verifier dashboard</h2>
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
            {rows.map((r)=> (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.id.slice(0,8)}...</TableCell>
                <TableCell>{r.farmer_name}</TableCell>
                <TableCell><Pill className={r.status}>{r.status}</Pill></TableCell>
                <TableCell>{r.ndvi_score ?? '-'}</TableCell>
                <TableCell>{r.growth_percent ?? '-'}</TableCell>
                <TableCell>{r.co2_tonnes ?? '-'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Input data-testid={`verifier-comment-${r.id}`} placeholder="comment" value={comment} onChange={e=>setComment(e.target.value)} style={{maxWidth:200}} />
                    <Button data-testid={`approve-${r.id}`} onClick={()=>act(r.id,'approve')}>Approve</Button>
                    <Button data-testid={`reject-${r.id}`} variant="destructive" onClick={()=>act(r.id,'reject')}>Reject</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && !loading && (
              <TableRow><TableCell colSpan={7} className="opacity-70">No projects pending.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AdminPage() {
  const [settings, setSettings] = useState({ token_price_usd: 10.0, marketplace_enabled: true });
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/settings`);
      setSettings(data);
    } finally { setLoading(false); }
  };
  useEffect(()=>{ load(); },[]);

  const save = async () => {
    await axios.post(`${API}/admin/settings`, settings);
    toast.success("Settings saved");
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h2 className="text-3xl mb-4" data-testid="admin-title">Admin</h2>
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="label">Token price (USD)</div>
            <Input data-testid="token-price" type="number" step="0.01" value={settings.token_price_usd} onChange={e=>setSettings(s=>({...s, token_price_usd: parseFloat(e.target.value)}))} />
          </div>
          <div>
            <div className="label">Marketplace enabled</div>
            <Select value={String(settings.marketplace_enabled)} onValueChange={(v)=>setSettings(s=>({...s, marketplace_enabled: v==='true'}))}>
              <SelectTrigger data-testid="marketplace-enabled">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">True</SelectItem>
                <SelectItem value="false">False</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={save} data-testid="save-settings">Save</Button>
        </div>
      </div>
    </div>
  );
}

function AppShell({children}){ return (
  <div className="app-shell">
    <Navbar />
    <Toaster />
    {children}
  </div>
)}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/farmer" element={<FarmerPage />} />
            <Route path="/verifier" element={<VerifierPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </div>
  );
}

export default App;