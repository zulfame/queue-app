import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, LogOut, LayoutDashboard, ListTree, DoorOpen, Settings2,
  Users, Clock, CheckCircle2, SkipForward, Trash2, Pencil, Plus, RefreshCw,
  Building2, MapPin,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useQueueSocket } from "../hooks/useQueueSocket";

const ICON_OPTIONS = ["users", "banknote", "star", "pill", "heart-pulse", "file-text", "stethoscope", "credit-card", "clipboard-list", "building"];

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "branches", label: "Cabang", icon: Building2 },
  { id: "services", label: "Layanan", icon: ListTree },
  { id: "counters", label: "Loket", icon: DoorOpen },
  { id: "settings", label: "Pengaturan", icon: Settings2 },
];

const emptyService = { name: "", prefix: "", description: "", icon: "users", active: true };
const emptyCounter = { name: "", service_ids: [], active: true };
const emptyBranch = { name: "", address: "", active: true };

export default function Admin() {
  const { logout } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [stats, setStats] = useState(null);
  const [overview, setOverview] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(localStorage.getItem("admin_branch") || "");
  const [services, setServices] = useState([]);
  const [counters, setCounters] = useState([]);
  const [settings, setSettings] = useState({ org_name: "", tagline: "", ticker_text: "", promo_media: [] });
  const [branchCfg, setBranchCfg] = useState({ ticker_text: "", promo_media: [] });
  const [svcForm, setSvcForm] = useState(null);
  const [ctrForm, setCtrForm] = useState(null);
  const [brForm, setBrForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: brs } = await api.get("/branches");
      setBranches(brs);
      let bid = branchId;
      if (!bid || !brs.find((b) => b.id === bid)) bid = brs[0]?.id || "";
      if (bid !== branchId) { setBranchId(bid); return; }
      if (!bid) return;
      const [st, sv, ct, se, ov] = await Promise.all([
        api.get(`/stats?branch_id=${bid}`),
        api.get(`/services?branch_id=${bid}`),
        api.get(`/counters?branch_id=${bid}`),
        api.get("/settings"),
        api.get("/stats/overview"),
      ]);
      setStats(st.data);
      setServices(sv.data);
      setCounters(ct.data);
      setSettings(se.data);
      setOverview(ov.data.branches);
    } catch {}
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (branchId) localStorage.setItem("admin_branch", branchId); }, [branchId]);
  useEffect(() => {
    const b = branches.find((x) => x.id === branchId);
    if (b) setBranchCfg({ ticker_text: b.ticker_text || "", promo_media: b.promo_media || [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, branches.length]);
  useQueueSocket(useCallback(() => load(), [load]));

  const handleErr = (err) => toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
  const currentBranch = branches.find((b) => b.id === branchId);

  const saveService = async () => {
    try {
      const body = { ...svcForm, branch_id: svcForm.branch_id || branchId };
      if (svcForm.id) await api.put(`/services/${svcForm.id}`, body);
      else await api.post("/services", body);
      toast.success("Layanan disimpan");
      setSvcForm(null);
      load();
    } catch (err) { handleErr(err); }
  };

  const saveCounter = async () => {
    try {
      const body = { ...ctrForm, branch_id: ctrForm.branch_id || branchId };
      if (ctrForm.id) await api.put(`/counters/${ctrForm.id}`, body);
      else await api.post("/counters", body);
      toast.success("Loket disimpan");
      setCtrForm(null);
      load();
    } catch (err) { handleErr(err); }
  };

  const saveBranch = async () => {
    try {
      if (brForm.id) {
        const orig = branches.find((x) => x.id === brForm.id) || {};
        await api.put(`/branches/${brForm.id}`, { ticker_text: orig.ticker_text || "", promo_media: orig.promo_media || [], ...brForm });
      } else {
        await api.post("/branches", brForm);
      }
      toast.success("Cabang disimpan");
      setBrForm(null);
      load();
    } catch (err) { handleErr(err); }
  };

  const saveSettings = async () => {
    try {
      await api.put("/settings", settings);
      toast.success("Pengaturan umum disimpan");
    } catch (err) { handleErr(err); }
  };

  const saveBranchCfg = async () => {
    if (!currentBranch) return;
    try {
      await api.put(`/branches/${branchId}`, {
        name: currentBranch.name,
        address: currentBranch.address || "",
        active: currentBranch.active,
        ticker_text: branchCfg.ticker_text,
        promo_media: (branchCfg.promo_media || []).filter((m) => m.url.trim()),
      });
      toast.success("Pengaturan cabang disimpan");
      load();
    } catch (err) { handleErr(err); }
  };

  const resetQueue = async () => {
    if (!window.confirm(`Hapus semua antrian hari ini di ${currentBranch?.name || "cabang ini"} dan mulai dari nomor 1?`)) return;
    try {
      await api.post(`/queue/reset?branch_id=${branchId}`);
      toast.success("Antrian hari ini direset");
      load();
    } catch (err) { handleErr(err); }
  };

  const branchSelect = (
    <Select value={branchId} onValueChange={setBranchId}>
      <SelectTrigger className="w-52 h-10 rounded-xl bg-white" data-testid="admin-branch-select">
        <SelectValue placeholder="Pilih cabang" />
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id} data-testid={`admin-branch-option-${b.id}`}>{b.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const statCards = stats ? [
    { label: "Total Hari Ini", value: stats.total, icon: Users, color: "text-indigo-600 bg-indigo-50" },
    { label: "Menunggu", value: stats.waiting, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: "Selesai", value: stats.done, icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
    { label: "Dilewati", value: stats.skipped, icon: SkipForward, color: "text-rose-600 bg-rose-50" },
  ] : [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row" data-testid="admin-page">
      <aside className="lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-6 flex lg:flex-col gap-2 lg:gap-1 overflow-x-auto">
        <Link to="/" className="hidden lg:inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-700 mb-6 transition-colors" data-testid="admin-back-link">
          <ArrowLeft className="w-4 h-4" /> Beranda
        </Link>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`admin-tab-${t.id}`}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
              tab === t.id ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
        <button onClick={logout} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600 lg:mt-auto whitespace-nowrap transition-colors duration-200" data-testid="admin-logout-button">
          <LogOut className="w-4 h-4" /> Keluar
        </button>
      </aside>

      <main className="flex-1 p-6 lg:p-10 max-w-6xl">
        {tab === "dashboard" && (
          <div data-testid="admin-dashboard">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Dashboard</h1>
              <div className="flex items-center gap-3">
                {branchSelect}
                <Button onClick={resetQueue} variant="outline" className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-semibold" data-testid="admin-reset-queue-button">
                  <RefreshCw className="w-4 h-4 mr-2" /> Reset Antrian
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              {statCards.map((c) => (
                <div key={c.label} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.color}`}>
                    <c.icon className="w-5 h-5" />
                  </div>
                  <p className="mt-4 text-3xl font-black tabular-nums text-slate-900">{c.value}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">{c.label}</p>
                </div>
              ))}
            </div>
            {stats && (
              <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">Per Layanan</h2>
                  <span className="text-sm font-semibold text-slate-500">Rata-rata tunggu: <span className="text-indigo-600 font-bold">{stats.avg_wait_min} menit</span></span>
                </div>
                <div className="space-y-4">
                  {stats.per_service.map((s) => (
                    <div key={s.prefix} className="flex items-center gap-4">
                      <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white text-sm font-black flex items-center justify-center">{s.prefix}</span>
                      <span className="flex-1 font-semibold text-slate-700">{s.name}</span>
                      <span className="text-sm text-slate-500 tabular-nums">{s.waiting} menunggu</span>
                      <span className="text-sm text-emerald-600 font-semibold tabular-nums">{s.done} selesai</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">{s.total} total</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {overview.length > 1 && (
              <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm" data-testid="admin-branch-overview">
                <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500 mb-6">Ringkasan Semua Cabang — Hari Ini</h2>
                <div className="space-y-4">
                  {overview.map((b) => (
                    <div key={b.id} className={`flex items-center gap-4 rounded-xl px-4 py-3 ${b.id === branchId ? "bg-indigo-50" : ""}`}>
                      <span className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center"><Building2 className="w-4 h-4" /></span>
                      <span className="flex-1 font-semibold text-slate-700">{b.name}</span>
                      <span className="text-sm text-amber-600 font-semibold tabular-nums">{b.waiting} menunggu</span>
                      <span className="text-sm text-emerald-600 font-semibold tabular-nums">{b.done} selesai</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">{b.total} total</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "branches" && (
          <div data-testid="admin-branches">
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Kantor Cabang</h1>
              <Button onClick={() => setBrForm({ ...emptyBranch })} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 font-semibold" data-testid="admin-add-branch-button">
                <Plus className="w-4 h-4 mr-2" /> Tambah Cabang
              </Button>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-4 px-6 py-4">
                  <span className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center"><Building2 className="w-5 h-5" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{b.name}</p>
                    {b.address && (
                      <p className="text-xs text-slate-400 truncate inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {b.address}</p>
                    )}
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${b.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {b.active ? "Aktif" : "Nonaktif"}
                  </span>
                  <button onClick={() => setBrForm({ id: b.id, name: b.name, address: b.address || "", active: b.active })} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors" data-testid={`admin-edit-branch-${b.id}`}>
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (window.confirm(`Hapus cabang ${b.name}? Semua layanan & loket cabang ini ikut terhapus.`)) {
                        try { await api.delete(`/branches/${b.id}`); toast.success("Cabang dihapus"); load(); } catch (err) { handleErr(err); }
                      }
                    }}
                    className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                    data-testid={`admin-delete-branch-${b.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "services" && (
          <div data-testid="admin-services">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Layanan</h1>
              <div className="flex items-center gap-3">
                {branchSelect}
                <Button onClick={() => setSvcForm({ ...emptyService })} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 font-semibold" data-testid="admin-add-service-button">
                  <Plus className="w-4 h-4 mr-2" /> Tambah Layanan
                </Button>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
              {services.map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-6 py-4">
                  <span className="w-10 h-10 rounded-xl bg-indigo-600 text-white font-black flex items-center justify-center">{s.prefix}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-400 truncate">{s.description}</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${s.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {s.active ? "Aktif" : "Nonaktif"}
                  </span>
                  <button onClick={() => setSvcForm({ ...s })} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors" data-testid={`admin-edit-service-${s.prefix}`}>
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => { if (window.confirm(`Hapus layanan ${s.name}?`)) { await api.delete(`/services/${s.id}`); toast.success("Layanan dihapus"); load(); } }}
                    className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                    data-testid={`admin-delete-service-${s.prefix}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "counters" && (
          <div data-testid="admin-counters">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Loket</h1>
              <div className="flex items-center gap-3">
                {branchSelect}
                <Button onClick={() => setCtrForm({ ...emptyCounter })} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 font-semibold" data-testid="admin-add-counter-button">
                  <Plus className="w-4 h-4 mr-2" /> Tambah Loket
                </Button>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
              {counters.map((c) => (
                <div key={c.id} className="flex items-center gap-4 px-6 py-4">
                  <span className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center"><DoorOpen className="w-5 h-5" /></span>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-400">
                      {c.service_ids.length === 0 ? "Semua layanan" : `${c.service_ids.length} layanan tertentu`}
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${c.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {c.active ? "Aktif" : "Nonaktif"}
                  </span>
                  <button onClick={() => setCtrForm({ ...c })} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors" data-testid={`admin-edit-counter-${c.name.replace(/\s/g, "-")}`}>
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => { if (window.confirm(`Hapus ${c.name}?`)) { await api.delete(`/counters/${c.id}`); toast.success("Loket dihapus"); load(); } }}
                    className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                    data-testid={`admin-delete-counter-${c.name.replace(/\s/g, "-")}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div data-testid="admin-settings" className="max-w-2xl">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8">Pengaturan</h1>
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-6">
              <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">Umum (Semua Cabang)</h2>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Nama Instansi</Label>
                <Input value={settings.org_name} onChange={(e) => setSettings({ ...settings, org_name: e.target.value })} className="h-12 rounded-xl" data-testid="admin-settings-org-name" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Tagline</Label>
                <Input value={settings.tagline} onChange={(e) => setSettings({ ...settings, tagline: e.target.value })} className="h-12 rounded-xl" data-testid="admin-settings-tagline" />
              </div>
              <Button onClick={saveSettings} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 font-semibold h-12 px-8" data-testid="admin-settings-save-button">
                Simpan Pengaturan
              </Button>
            </div>

            <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">Pengaturan Cabang</h2>
                {branchSelect}
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Teks Berjalan (Monitor)</Label>
                <Input value={branchCfg.ticker_text} onChange={(e) => setBranchCfg({ ...branchCfg, ticker_text: e.target.value })} className="h-12 rounded-xl" data-testid="admin-settings-ticker" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Media Promosi (Monitor)</h3>
                <p className="mt-1 text-xs text-slate-400">Gambar, video (mp4) atau link YouTube yang tampil bergantian di layar monitor cabang ini</p>
              </div>
              <div className="space-y-3" data-testid="admin-promo-list">
                {(branchCfg.promo_media || []).map((m, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <Select
                      value={m.type}
                      onValueChange={(v) => {
                        const list = [...branchCfg.promo_media];
                        list[idx] = { ...list[idx], type: v };
                        setBranchCfg({ ...branchCfg, promo_media: list });
                      }}
                    >
                      <SelectTrigger className="w-32 rounded-xl" data-testid={`admin-promo-type-${idx}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="image">Gambar</SelectItem>
                        <SelectItem value="video">Video</SelectItem>
                        <SelectItem value="youtube">YouTube</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={m.url}
                      onChange={(e) => {
                        const list = [...branchCfg.promo_media];
                        list[idx] = { ...list[idx], url: e.target.value };
                        setBranchCfg({ ...branchCfg, promo_media: list });
                      }}
                      placeholder="https://..."
                      className="flex-1 rounded-xl"
                      data-testid={`admin-promo-url-${idx}`}
                    />
                    <button
                      onClick={() => setBranchCfg({ ...branchCfg, promo_media: branchCfg.promo_media.filter((_, i) => i !== idx) })}
                      className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                      data-testid={`admin-promo-delete-${idx}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {(branchCfg.promo_media || []).length === 0 && (
                  <p className="text-sm text-slate-400">Belum ada media promosi</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => setBranchCfg({ ...branchCfg, promo_media: [...(branchCfg.promo_media || []), { type: "image", url: "" }] })}
                  className="rounded-xl font-semibold"
                  data-testid="admin-promo-add-button"
                >
                  <Plus className="w-4 h-4 mr-2" /> Tambah Media
                </Button>
                <Button
                  onClick={saveBranchCfg}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 font-semibold"
                  data-testid="admin-branch-settings-save-button"
                >
                  Simpan Pengaturan Cabang
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      <Dialog open={!!brForm} onOpenChange={(o) => !o && setBrForm(null)}>
        <DialogContent className="rounded-2xl" data-testid="admin-branch-dialog">
          <DialogHeader>
            <DialogTitle>{brForm?.id ? "Edit Cabang" : "Tambah Cabang"}</DialogTitle>
          </DialogHeader>
          {brForm && (
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Nama Cabang</Label>
                <Input value={brForm.name} onChange={(e) => setBrForm({ ...brForm, name: e.target.value })} placeholder="cth: Cabang Jakarta Pusat" data-testid="admin-branch-name-input" />
              </div>
              <div className="space-y-2">
                <Label>Alamat</Label>
                <Input value={brForm.address} onChange={(e) => setBrForm({ ...brForm, address: e.target.value })} placeholder="cth: Jl. Sudirman No. 1" data-testid="admin-branch-address-input" />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={brForm.active} onCheckedChange={(v) => setBrForm({ ...brForm, active: v })} data-testid="admin-branch-active-switch" />
                <Label>Aktif</Label>
              </div>
              <Button onClick={saveBranch} disabled={!brForm.name} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 h-11 font-semibold" data-testid="admin-branch-save-button">
                Simpan
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!svcForm} onOpenChange={(o) => !o && setSvcForm(null)}>
        <DialogContent className="rounded-2xl" data-testid="admin-service-dialog">
          <DialogHeader>
            <DialogTitle>{svcForm?.id ? "Edit Layanan" : "Tambah Layanan"}</DialogTitle>
          </DialogHeader>
          {svcForm && (
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Nama Layanan</Label>
                <Input value={svcForm.name} onChange={(e) => setSvcForm({ ...svcForm, name: e.target.value })} placeholder="cth: Teller, Poli Umum, Farmasi" data-testid="admin-service-name-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Kode Awalan</Label>
                  <Input value={svcForm.prefix} maxLength={2} onChange={(e) => setSvcForm({ ...svcForm, prefix: e.target.value.toUpperCase() })} placeholder="A" data-testid="admin-service-prefix-input" />
                </div>
                <div className="space-y-2">
                  <Label>Ikon</Label>
                  <Select value={svcForm.icon} onValueChange={(v) => setSvcForm({ ...svcForm, icon: v })}>
                    <SelectTrigger data-testid="admin-service-icon-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ICON_OPTIONS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Deskripsi</Label>
                <Input value={svcForm.description} onChange={(e) => setSvcForm({ ...svcForm, description: e.target.value })} data-testid="admin-service-description-input" />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={svcForm.active} onCheckedChange={(v) => setSvcForm({ ...svcForm, active: v })} data-testid="admin-service-active-switch" />
                <Label>Aktif</Label>
              </div>
              <Button onClick={saveService} disabled={!svcForm.name || !svcForm.prefix} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 h-11 font-semibold" data-testid="admin-service-save-button">
                Simpan
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!ctrForm} onOpenChange={(o) => !o && setCtrForm(null)}>
        <DialogContent className="rounded-2xl" data-testid="admin-counter-dialog">
          <DialogHeader>
            <DialogTitle>{ctrForm?.id ? "Edit Loket" : "Tambah Loket"}</DialogTitle>
          </DialogHeader>
          {ctrForm && (
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Nama Loket</Label>
                <Input value={ctrForm.name} onChange={(e) => setCtrForm({ ...ctrForm, name: e.target.value })} placeholder="cth: Loket 1, Kasir 2" data-testid="admin-counter-name-input" />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={ctrForm.active} onCheckedChange={(v) => setCtrForm({ ...ctrForm, active: v })} data-testid="admin-counter-active-switch" />
                <Label>Aktif</Label>
              </div>
              <Button onClick={saveCounter} disabled={!ctrForm.name} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 h-11 font-semibold" data-testid="admin-counter-save-button">
                Simpan
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
