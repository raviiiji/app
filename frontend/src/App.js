import { useEffect, useMemo, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Link, useNavigate } from "react-router-dom";
import axios from "axios";

// Respect env rules
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Small UI helpers (we will still use shadcn primitives from src/components/ui when needed)
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
  };

  const onSubmit = async () => {
    const id = await createProject();
    if (!id) return;
    await uploadImages(id);
    await submitForAnalysis(id);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h2 className="text-3xl mb-4" data-testid="farmer-title">Submit a Blue Carbon Project</h2>
      <div className="grid-2">
        <div className="card p-5">
          <div className="section">
            <div className="mb-3">
              <div className="label">Farmer / Land Owner</div>
              <input data-testid="farmer-name" className="input" placeholder="Your name" value={farmerName} onChange={e=>setFarmerName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="label">Area size (hectares)</div>
                <input data-testid="area-size" className="input" type="number" value={area} onChange={e=>setArea(e.target.value)} placeholder="e.g., 120" />
              </div>
              <div>
                <div className="label">Number of plants</div>
                <input data-testid="num-plants" className="input" type="number" value={plants} onChange={e=>setPlants(e.target.value)} placeholder="e.g., 45000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="label">Plantation type</div>
                <select data-testid="plantation-type" className="select" value={ptype} onChange={e=>setPtype(e.target.value)}>
                  <option value="Mangrove">Mangrove</option>
                  <option value="Seagrass">Seagrass</option>
                  <option value="Saltmarsh">Saltmarsh</option>
                </select>
              </div>
              <div>
                <div className="label">Location</div>
                <input data-testid="location" className="input" placeholder="State, Country" value={location} onChange={e=>setLocation(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="label">Latitude (optional)</div>
                <input data-testid="lat" className="input" type="number" value={lat} onChange={e=>setLat(e.target.value)} />
              </div>
              <div>
                <div className="label">Longitude (optional)</div>
                <input data-testid="lng" className="input" type="number" value={lng} onChange={e=>setLng(e.target.value)} />
              </div>
            </div>
            <div className="mb-3">
              <div className="label">Upload drone/satellite images</div>
              <input data-testid="image-upload" className="input" type="file" multiple accept="image/png,image/jpeg" onChange={e=>setFiles(Array.from(e.target.files||[]))} />
              <div className="text-xs opacity-70 mt-1">JPG/PNG up to 25MB each.</div>
            </div>
            <button data-testid="submit-project" className="btn-primary" disabled={disabled || submitting} onClick={onSubmit}>{submitting ? 'Submitting...' : 'Submit for analysis'}</button>
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
        <table className="table" data-testid="verifier-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Farmer</th>
              <th>Status</th>
              <th>NDVI</th>
              <th>Growth%</th>
              <th>CO₂</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r)=> (
              <tr key={r.id}>
                <td className="font-mono text-xs">{r.id.slice(0,8)}...</td>
                <td>{r.farmer_name}</td>
                <td><Pill className={r.status}>{r.status}</Pill></td>
                <td>{r.ndvi_score ?? '-'}</td>
                <td>{r.growth_percent ?? '-'}</td>
                <td>{r.co2_tonnes ?? '-'}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <input data-testid={`verifier-comment-${r.id}`} className="input" placeholder="comment" value={comment} onChange={e=>setComment(e.target.value)} style={{maxWidth:200}} />
                    <button data-testid={`approve-${r.id}`} className="btn-primary" onClick={()=>act(r.id,'approve')}>Approve</button>
                    <button data-testid={`reject-${r.id}`} className="btn-primary" style={{background:'#d9534f'}} onClick={()=>act(r.id,'reject')}>Reject</button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan="7" className="opacity-70">No projects pending.</td></tr>
            )}
          </tbody>
        </table>
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
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <h2 className="text-3xl mb-4" data-testid="admin-title">Admin</h2>
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="label">Token price (USD)</div>
            <input data-testid="token-price" className="input" type="number" step="0.01" value={settings.token_price_usd} onChange={e=>setSettings(s=>({...s, token_price_usd: parseFloat(e.target.value)}))} />
          </div>
          <div>
            <div className="label">Marketplace enabled</div>
            <select data-testid="marketplace-enabled" className="select" value={String(settings.marketplace_enabled)} onChange={e=>setSettings(s=>({...s, marketplace_enabled: e.target.value === 'true'}))}>
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button className="btn-primary" onClick={save} data-testid="save-settings">Save</button>
        </div>
      </div>
    </div>
  );
}

function AppShell({children}){ return (
  <div className="app-shell">
    <Navbar />
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