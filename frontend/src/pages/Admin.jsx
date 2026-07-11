import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, LogOut, LayoutDashboard, ListTree, DoorOpen, Settings2,
  Users, Clock, CheckCircle2, SkipForward, Trash2, Pencil, Plus, RefreshCw,
  Building2, MapPin, UserCog, History, Database, Printer, Download, Upload,
  FileSpreadsheet, Star, Camera, X, Waves, ExternalLink,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, formatApiErrorDetail } from "../lib/api";
import { applyBranding } from "../lib/branding";
import { fileToDataUrl } from "../lib/image";
import { usePagedSearch, SearchBox, Pager } from "../components/paged";
import { useAuth } from "../context/AuthContext";
import { useQueueSocket } from "../hooks/useQueueSocket";

const ICON_OPTIONS = ["users", "banknote", "star", "pill", "heart-pulse", "file-text", "stethoscope", "credit-card", "clipboard-list", "building"];

const MENU = [
  { type: "item", id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    type: "group", label: "Antrian", items: [
      { id: "branches", label: "Kantor", icon: Building2 },
      { id: "services", label: "Layanan", icon: ListTree },
      { id: "counters", label: "Loket", icon: DoorOpen },
    ],
  },
  { type: "item", id: "recap", label: "Laporan", icon: History },
  {
    type: "group", label: "Pengaturan", items: [
      { id: "settings", label: "Aplikasi", icon: Settings2 },
      { id: "users", label: "Pengguna", icon: UserCog },
      { id: "database", label: "Database", icon: Database },
      { id: "printers", label: "Printers", icon: Printer },
    ],
  },
];

const emptyService = { name: "", prefix: "", description: "", icon: "users", active: true };
const emptyCounter = { name: "", service_ids: [], active: true };
const emptyBranch = { name: "", address: "", active: true };
const emptyUser = { name: "", email: "", password: "", role: "operator", branch_id: "" };

const ACTION_LABELS = {
  call: { label: "Panggil", cls: "bg-primary/10 text-primary" },
  recall: { label: "Panggil Ulang", cls: "bg-sky-50 text-sky-600" },
  skip: { label: "Lewati", cls: "bg-rose-50 text-rose-600" },
  complete: { label: "Selesai", cls: "bg-emerald-50 text-emerald-600" },
  restore: { label: "Prioritaskan", cls: "bg-amber-50 text-amber-600" },
};

const todayInput = () => new Date().toISOString().slice(0, 10);

const TabButton = ({ t, tab, setTab }) => (
  <button
    onClick={() => setTab(t.id)}
    data-testid={`admin-tab-${t.id}`}
    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap lg:w-full transition-colors duration-200 ${
      tab === t.id ? "bg-primary text-white shadow-lg shadow-primary/30" : "text-slate-300 hover:bg-white/10 hover:text-white"
    }`}
  >
    <t.icon className="w-4 h-4 shrink-0" /> {t.label}
  </button>
);

export default function Admin() {
  const { user, logout } = useAuth();
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
  const [usrForm, setUsrForm] = useState(null);
  const [users, setUsers] = useState([]);
  const [recapLogs, setRecapLogs] = useState([]);
  const [recapDate, setRecapDate] = useState(todayInput());
  const [printerCfg, setPrinterCfg] = useState({ printer_name: "", print_header: "", print_footer: "" });
  const [surveyForm, setSurveyForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: brs } = await api.get("/branches");
      setBranches(brs);
      let bid = branchId;
      if (!bid || !brs.find((b) => b.id === bid)) bid = brs[0]?.id || "";
      if (bid !== branchId) { setBranchId(bid); return; }
      if (!bid) return;
      const [st, sv, ct, se, ov, us, rc] = await Promise.all([
        api.get(`/stats?branch_id=${bid}`),
        api.get(`/services?branch_id=${bid}`),
        api.get(`/counters?branch_id=${bid}`),
        api.get("/settings"),
        api.get("/stats/overview"),
        api.get("/users"),
        api.get(`/recap?branch_id=${bid}&date=${recapDate}`),
      ]);
      setStats(st.data);
      setServices(sv.data);
      setCounters(ct.data);
      setSettings(se.data);
      setOverview(ov.data.branches);
      setUsers(us.data);
      setRecapLogs(rc.data.logs);
    } catch {}
  }, [branchId, recapDate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (branchId) localStorage.setItem("admin_branch", branchId); }, [branchId]);
  useEffect(() => {
    const b = branches.find((x) => x.id === branchId);
    if (b) {
      setBranchCfg({ ticker_text: b.ticker_text || "", promo_media: b.promo_media || [] });
      setPrinterCfg({ printer_name: b.printer_name || "", print_header: b.print_header || "", print_footer: b.print_footer || "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, branches.length]);
  useQueueSocket(useCallback(() => load(), [load]));

  const handleErr = (err) => toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
  const currentBranch = branches.find((b) => b.id === branchId);
  const brPaged = usePagedSearch(branches, ["name", "address"]);
  const svPaged = usePagedSearch(services, ["name", "prefix", "description"]);
  const ctPaged = usePagedSearch(counters, ["name"]);
  const usPaged = usePagedSearch(users, ["name", "email", "role"]);

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
        await api.put(`/branches/${brForm.id}`, { ...branchPayload(orig), name: brForm.name, address: brForm.address, active: brForm.active });
      } else {
        await api.post("/branches", brForm);
      }
      toast.success("Cabang disimpan");
      setBrForm(null);
      load();
    } catch (err) { handleErr(err); }
  };

  const saveUser = async () => {
    try {
      const body = { ...usrForm, branch_id: usrForm.role === "operator" ? (usrForm.branch_id || branchId) : null };
      if (usrForm.id) await api.put(`/users/${usrForm.id}`, body);
      else await api.post("/users", body);
      toast.success("Pengguna disimpan");
      setUsrForm(null);
      load();
    } catch (err) { handleErr(err); }
  };

  const saveSettings = async () => {
    try {
      await api.put("/settings", settings);
      applyBranding(settings);
      toast.success("Pengaturan umum disimpan");
    } catch (err) { handleErr(err); }
  };

  const branchPayload = (orig) => ({
    name: orig.name,
    address: orig.address || "",
    active: orig.active,
    ticker_text: orig.ticker_text || "",
    promo_media: orig.promo_media || [],
    printer_name: orig.printer_name || "",
    print_header: orig.print_header || "",
    print_footer: orig.print_footer || "",
  });

  const patchBranch = async (patch, msg) => {
    if (!currentBranch) return;
    try {
      await api.put(`/branches/${branchId}`, { ...branchPayload(currentBranch), ...patch });
      toast.success(msg);
      load();
    } catch (err) { handleErr(err); }
  };

  const saveBranchCfg = () => patchBranch({
    ticker_text: branchCfg.ticker_text,
    promo_media: (branchCfg.promo_media || []).filter((m) => m.url.trim()),
  }, "Pengaturan cabang disimpan");

  const savePrinterCfg = () => patchBranch({ ...printerCfg }, "Pengaturan printer disimpan");

  const exportRecap = async () => {
    try {
      const res = await api.get(`/recap/export?branch_id=${branchId}&date=${recapDate}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rekap_${recapDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { handleErr(err); }
  };

  const downloadBackup = async () => {
    try {
      const res = await api.get("/db/backup", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_${todayInput()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup diunduh");
    } catch (err) { handleErr(err); }
  };

  const restoreDb = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("Restore akan MENGGANTI seluruh data saat ini dengan isi file backup. Lanjutkan?")) return;
    try {
      const parsed = JSON.parse(await file.text());
      const { data } = await api.post("/db/restore", { data: parsed.data || parsed });
      toast.success(`Restore berhasil: ${Object.values(data.restored).reduce((a, b) => a + b, 0)} dokumen`);
      load();
    } catch (err) { handleErr(err); }
  };

  const saveSurveyEdit = async () => {
    try {
      await api.post("/surveys", { ticket_id: surveyForm.ticket_id, rating: surveyForm.rating, feedback: surveyForm.feedback, photo: surveyForm.photo });
      toast.success("Survey diperbarui");
      setSurveyForm(null);
      load();
    } catch (err) { handleErr(err); }
  };

  const onSurveyEditPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setSurveyForm((s) => ({ ...s, photo: dataUrl }));
    } catch { toast.error("Gagal memproses foto"); }
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
    { label: "Total Hari Ini", value: stats.total, icon: Users, color: "text-primary bg-primary/10" },
    { label: "Menunggu", value: stats.waiting, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: "Selesai", value: stats.done, icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
    { label: "Dilewati", value: stats.skipped, icon: SkipForward, color: "text-rose-600 bg-rose-50" },
  ] : [];

  const crumb = (() => {
    for (const e of MENU) {
      if (e.type === "item" && e.id === tab) return { group: "Menu", label: e.label };
      if (e.type === "group") {
        const f = e.items.find((i) => i.id === tab);
        if (f) return { group: e.label, label: f.label };
      }
    }
    return { group: "Menu", label: "" };
  })();

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row" data-testid="admin-page">
      <aside className="lg:w-64 lg:shrink-0 bg-slate-900 flex lg:flex-col gap-2 lg:gap-0 items-center lg:items-stretch overflow-x-auto lg:overflow-visible px-4 py-3 lg:p-0 lg:sticky lg:top-0 lg:h-screen">
        <div className="hidden lg:flex items-center gap-3 px-6 py-6 border-b border-white/10">
          {settings.logo_url ? (
            <img src={settings.logo_url} alt="Logo" className="w-10 h-10 rounded-xl object-contain bg-white p-0.5" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Waves className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight truncate">{settings.org_name || "Admin"}</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold">Admin Panel</p>
          </div>
        </div>
        <nav className="flex lg:flex-col gap-2 lg:gap-0.5 lg:px-3 lg:py-4 lg:flex-1 lg:overflow-y-auto items-center lg:items-stretch">
          {MENU.map((entry, gi) =>
            entry.type === "item" ? (
              <TabButton key={entry.id} t={entry} tab={tab} setTab={setTab} />
            ) : (
              <div key={gi} className="flex lg:flex-col gap-2 lg:gap-0.5 lg:mt-5 items-center lg:items-stretch">
                <span className="hidden lg:block px-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">{entry.label}</span>
                {entry.items.map((t) => (
                  <TabButton key={t.id} t={t} tab={tab} setTab={setTab} />
                ))}
              </div>
            )
          )}
        </nav>
        <div className="hidden lg:block px-3 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-3 pb-3">
            <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm uppercase" data-testid="admin-user-avatar">
              {(user?.name || user?.email || "A").charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate" data-testid="admin-user-name">{user?.name || user?.email}</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{user?.role === "admin" ? "Administrator" : "Operator"}</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:bg-rose-500/15 hover:text-rose-400 w-full transition-colors duration-200" data-testid="admin-logout-button">
            <LogOut className="w-4 h-4" /> Keluar
          </button>
        </div>
        <button onClick={logout} className="lg:hidden flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:text-rose-400 whitespace-nowrap" data-testid="admin-logout-button-mobile">
          <LogOut className="w-4 h-4" /> Keluar
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 lg:px-10 py-4 flex items-center justify-between sticky top-0 z-20" data-testid="admin-topbar">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">{crumb.group}</p>
            <h2 className="text-base font-bold text-slate-900">{crumb.label}</h2>
          </div>
          <div className="flex items-center gap-5">
            <span className="hidden sm:block text-xs font-medium text-slate-400">
              {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </span>
            <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-primary transition-colors" data-testid="admin-back-link">
              <ExternalLink className="w-3.5 h-3.5" /> Lihat Situs
            </Link>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-10 max-w-6xl w-full">
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
                  <span className="text-sm font-semibold text-slate-500">Rata-rata tunggu: <span className="text-primary font-bold">{stats.avg_wait_min} menit</span></span>
                </div>
                <div className="space-y-4">
                  {stats.per_service.map((s) => (
                    <div key={s.prefix} className="flex items-center gap-4">
                      <span className="w-8 h-8 rounded-lg bg-primary text-white text-sm font-black flex items-center justify-center">{s.prefix}</span>
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
                    <div key={b.id} className={`flex items-center gap-4 rounded-xl px-4 py-3 ${b.id === branchId ? "bg-primary/10" : ""}`}>
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
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Kantor</h1>
              <div className="flex items-center gap-3">
                <SearchBox value={brPaged.query} onChange={brPaged.setQuery} placeholder="Cari kantor..." testId="admin-branches-search" />
                <Button onClick={() => setBrForm({ ...emptyBranch })} className="rounded-xl bg-primary hover:bg-primary/90 font-semibold" data-testid="admin-add-branch-button">
                  <Plus className="w-4 h-4 mr-2" /> Tambah Kantor
                </Button>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
              {brPaged.pageItems.map((b) => (
                <div key={b.id} className="flex items-center gap-4 px-6 py-4">
                  <span className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center"><Building2 className="w-5 h-5" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{b.name}</p>
                    {b.address && (
                      <p className="text-xs text-slate-400 truncate inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {b.address}</p>
                    )}
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${b.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {b.active ? "Aktif" : "Nonaktif"}
                  </span>
                  <button onClick={() => setBrForm({ id: b.id, name: b.name, address: b.address || "", active: b.active })} className="p-2 text-slate-400 hover:text-primary transition-colors" data-testid={`admin-edit-branch-${b.id}`}>
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
              <Pager {...brPaged} testId="admin-branches-pager" />
            </div>
          </div>
        )}

        {tab === "services" && (
          <div data-testid="admin-services">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Layanan</h1>
              <div className="flex items-center gap-3">
                <SearchBox value={svPaged.query} onChange={svPaged.setQuery} placeholder="Cari layanan..." testId="admin-services-search" />
                {branchSelect}
                <Button onClick={() => setSvcForm({ ...emptyService })} className="rounded-xl bg-primary hover:bg-primary/90 font-semibold" data-testid="admin-add-service-button">
                  <Plus className="w-4 h-4 mr-2" /> Tambah Layanan
                </Button>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
              {svPaged.pageItems.map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-6 py-4">
                  <span className="w-10 h-10 rounded-xl bg-primary text-white font-black flex items-center justify-center">{s.prefix}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-400 truncate">{s.description}</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${s.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {s.active ? "Aktif" : "Nonaktif"}
                  </span>
                  <button onClick={() => setSvcForm({ ...s })} className="p-2 text-slate-400 hover:text-primary transition-colors" data-testid={`admin-edit-service-${s.prefix}`}>
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
              <Pager {...svPaged} testId="admin-services-pager" />
            </div>
          </div>
        )}

        {tab === "counters" && (
          <div data-testid="admin-counters">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Loket</h1>
              <div className="flex items-center gap-3">
                <SearchBox value={ctPaged.query} onChange={ctPaged.setQuery} placeholder="Cari loket..." testId="admin-counters-search" />
                {branchSelect}
                <Button onClick={() => setCtrForm({ ...emptyCounter })} className="rounded-xl bg-primary hover:bg-primary/90 font-semibold" data-testid="admin-add-counter-button">
                  <Plus className="w-4 h-4 mr-2" /> Tambah Loket
                </Button>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
              {ctPaged.pageItems.map((c) => (
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
                  <button onClick={() => setCtrForm({ ...c })} className="p-2 text-slate-400 hover:text-primary transition-colors" data-testid={`admin-edit-counter-${c.name.replace(/\s/g, "-")}`}>
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
              <Pager {...ctPaged} testId="admin-counters-pager" />
            </div>
          </div>
        )}

        {tab === "users" && (
          <div data-testid="admin-users">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Kelola Pengguna</h1>
              <div className="flex items-center gap-3">
                <SearchBox value={usPaged.query} onChange={usPaged.setQuery} placeholder="Cari pengguna..." testId="admin-users-search" />
                <Button onClick={() => setUsrForm({ ...emptyUser })} className="rounded-xl bg-primary hover:bg-primary/90 font-semibold" data-testid="admin-add-user-button">
                  <Plus className="w-4 h-4 mr-2" /> Tambah Pengguna
                </Button>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
              {usPaged.pageItems.map((u) => (
                <div key={u.id} className="flex items-center gap-4 px-6 py-4">
                  <span className={`w-10 h-10 rounded-xl text-white flex items-center justify-center ${u.role === "admin" ? "bg-slate-900" : "bg-primary"}`}>
                    <UserCog className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{u.name || u.email}</p>
                    <p className="text-xs text-slate-400 truncate">{u.email}</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${u.role === "admin" ? "bg-slate-900 text-white" : "bg-primary/10 text-primary"}`}>
                    {u.role === "admin" ? "Admin" : "Operator"}
                  </span>
                  {u.role === "operator" && (
                    <span className="text-xs font-semibold text-slate-500 hidden sm:inline-flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" />
                      {branches.find((b) => b.id === u.branch_id)?.name || "Tanpa cabang"}
                    </span>
                  )}
                  <button onClick={() => setUsrForm({ id: u.id, name: u.name || "", email: u.email, password: "", role: u.role, branch_id: u.branch_id || "" })} className="p-2 text-slate-400 hover:text-primary transition-colors" data-testid={`admin-edit-user-${u.email}`}>
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (window.confirm(`Hapus pengguna ${u.name || u.email}?`)) {
                        try { await api.delete(`/users/${u.id}`); toast.success("Pengguna dihapus"); load(); } catch (err) { handleErr(err); }
                      }
                    }}
                    className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                    data-testid={`admin-delete-user-${u.email}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <Pager {...usPaged} testId="admin-users-pager" />
            </div>
          </div>
        )}

        {tab === "recap" && (
          <div data-testid="admin-recap">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Laporan Pemanggilan</h1>
              <div className="flex items-center gap-3">
                {branchSelect}
                <Input
                  type="date"
                  value={recapDate}
                  onChange={(e) => setRecapDate(e.target.value)}
                  className="w-44 h-10 rounded-xl bg-white"
                  data-testid="admin-recap-date"
                />
                <Button onClick={exportRecap} variant="outline" className="rounded-xl font-semibold border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" data-testid="admin-recap-export-button">
                  <FileSpreadsheet className="w-4 h-4 mr-2" /> Export XLSX
                </Button>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="grid grid-cols-[70px_85px_1fr_1fr_1fr_110px_120px] gap-3 px-6 py-3 bg-slate-50 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                <span>Waktu</span><span>Tiket</span><span>Layanan</span><span>Loket</span><span>Petugas</span><span>Aksi</span><span>Survey</span>
              </div>
              <div className="divide-y divide-slate-100" data-testid="admin-recap-list">
                {recapLogs.length === 0 && (
                  <p className="px-6 py-8 text-sm text-slate-400">Belum ada pemanggilan pada tanggal ini</p>
                )}
                {recapLogs.map((l) => {
                  const a = ACTION_LABELS[l.action] || { label: l.action, cls: "bg-slate-100 text-slate-500" };
                  const sv = l.survey;
                  return (
                    <div key={l.id} className="grid grid-cols-[70px_85px_1fr_1fr_1fr_110px_120px] gap-3 px-6 py-3.5 items-center text-sm">
                      <span className="tabular-nums text-slate-500 font-medium">
                        {new Date(l.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="font-black tabular-nums text-slate-900">{l.ticket_code}</span>
                      <span className="text-slate-600 font-medium truncate">{l.service_name}</span>
                      <span className="text-slate-600 font-medium truncate">{l.counter_name || "—"}</span>
                      <span className="text-slate-900 font-semibold truncate">{l.operator_name}</span>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full text-center ${a.cls}`}>{a.label}</span>
                      {l.action === "complete" ? (
                        <button
                          onClick={() => setSurveyForm({ ticket_id: l.ticket_id, ticket_code: l.ticket_code, rating: sv?.rating || 0, feedback: sv?.feedback || "", photo: sv?.photo || "" })}
                          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-primary transition-colors"
                          data-testid={`admin-recap-survey-${l.ticket_code}-${l.id}`}
                        >
                          {sv?.rating ? (
                            <span className="inline-flex items-center gap-1 text-amber-500">
                              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {sv.rating}/5
                            </span>
                          ) : (
                            <span className="text-slate-400">Isi survey</span>
                          )}
                          {sv?.photo && <Camera className="w-3.5 h-3.5 text-slate-400" />}
                          <Pencil className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab === "database" && (
          <div data-testid="admin-database" className="max-w-3xl">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8">Database</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                  <Download className="w-6 h-6" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Backup</h2>
                <p className="mt-1 text-sm text-slate-500">Unduh seluruh data (kantor, layanan, loket, antrian, pengguna, pengaturan, laporan) sebagai file JSON.</p>
                <Button onClick={downloadBackup} className="mt-6 rounded-xl bg-primary hover:bg-primary/90 font-semibold h-11" data-testid="admin-db-backup-button">
                  <Download className="w-4 h-4 mr-2" /> Unduh Backup
                </Button>
              </div>
              <div className="bg-white border border-rose-100 rounded-2xl p-8 shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-5">
                  <Upload className="w-6 h-6" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Restore</h2>
                <p className="mt-1 text-sm text-slate-500">Pulihkan data dari file backup JSON. <span className="font-semibold text-rose-600">Seluruh data saat ini akan diganti.</span></p>
                <label className="mt-6 inline-flex items-center gap-2 px-5 h-11 rounded-xl border-2 border-rose-200 text-rose-600 text-sm font-semibold cursor-pointer hover:bg-rose-50 transition-colors">
                  <Upload className="w-4 h-4" /> Pilih File Backup
                  <input type="file" accept="application/json,.json" className="hidden" onChange={restoreDb} data-testid="admin-db-restore-input" />
                </label>
              </div>
            </div>
          </div>
        )}

        {tab === "printers" && (
          <div data-testid="admin-printers" className="max-w-5xl">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Printers</h1>
              {branchSelect}
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
              <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-6">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">Printer Thermal 80mm — {currentBranch?.name}</h2>
                  <p className="mt-1 text-xs text-slate-400">Konfigurasi printer & teks struk untuk kantor ini. Pencetakan menggunakan dialog print browser (kertas 80mm).</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Nama Printer</Label>
                  <Input value={printerCfg.printer_name} onChange={(e) => setPrinterCfg({ ...printerCfg, printer_name: e.target.value })} placeholder="cth: EPSON TM-T82 (80mm)" className="h-12 rounded-xl" data-testid="admin-printer-name" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Teks Header Struk</Label>
                  <Textarea value={printerCfg.print_header} onChange={(e) => setPrinterCfg({ ...printerCfg, print_header: e.target.value })} placeholder={"cth:\nBANK SEJAHTERA\nKantor Pusat - Jl. Sudirman No. 1"} className="rounded-xl min-h-[80px]" data-testid="admin-printer-header" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Teks Footer Struk</Label>
                  <Textarea value={printerCfg.print_footer} onChange={(e) => setPrinterCfg({ ...printerCfg, print_footer: e.target.value })} placeholder="cth: Mohon menunggu hingga nomor Anda dipanggil. Terima kasih." className="rounded-xl min-h-[80px]" data-testid="admin-printer-footer" />
                </div>
                <Button onClick={savePrinterCfg} className="rounded-xl bg-primary hover:bg-primary/90 font-semibold h-12 px-8" data-testid="admin-printer-save-button">
                  Simpan Pengaturan Printer
                </Button>
              </div>
              <div className="bg-slate-100 rounded-2xl p-8 flex flex-col items-center">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-5">Preview Struk 80mm</p>
                <div className="bg-white w-[280px] px-5 py-6 text-center shadow-lg" style={{ fontFamily: "Poppins" }} data-testid="admin-printer-preview">
                  <p className="text-sm font-bold text-slate-900 whitespace-pre-line">{printerCfg.print_header || settings.org_name}</p>
                  <div className="my-3 border-t-2 border-dashed border-slate-300" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Nomor Antrian</p>
                  <p className="text-5xl font-black tracking-tighter text-slate-900 my-1">A-001</p>
                  <p className="text-sm font-semibold text-slate-700">Teller</p>
                  <p className="mt-1 text-[11px] text-slate-500">{new Date().toLocaleString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                  <div className="my-3 border-t-2 border-dashed border-slate-300" />
                  <p className="text-[11px] text-slate-500 whitespace-pre-line">{printerCfg.print_footer || "Mohon menunggu hingga nomor Anda dipanggil. Terima kasih."}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div data-testid="admin-settings" className="max-w-6xl">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8">Pengaturan Aplikasi</h1>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
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
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Warna Primary</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={settings.primary_color || "#4f46e5"}
                    onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                    className="w-12 h-12 rounded-xl border border-slate-200 cursor-pointer bg-white p-1"
                    data-testid="admin-settings-primary-color"
                  />
                  <Input
                    value={settings.primary_color || ""}
                    onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                    placeholder="#4f46e5"
                    className="h-12 rounded-xl w-36 font-mono"
                    data-testid="admin-settings-primary-color-text"
                  />
                  <span className="text-xs text-slate-400">Warna utama tombol & aksen di semua halaman</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">URL Logo</Label>
                <div className="flex items-center gap-3">
                  {settings.logo_url && <img src={settings.logo_url} alt="Logo" className="w-12 h-12 rounded-xl object-contain border border-slate-200 bg-white p-1" />}
                  <Input value={settings.logo_url || ""} onChange={(e) => setSettings({ ...settings, logo_url: e.target.value })} placeholder="https://... (kosongkan untuk ikon default)" className="h-12 rounded-xl flex-1" data-testid="admin-settings-logo-url" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Teks Footer (Frontend)</Label>
                <Input value={settings.footer_text || ""} onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })} placeholder="cth: © 2026 Bank Sejahtera. Melayani dengan sepenuh hati." className="h-12 rounded-xl" data-testid="admin-settings-footer-text" />
              </div>
              <Button onClick={saveSettings} className="rounded-xl bg-primary hover:bg-primary/90 font-semibold h-12 px-8" data-testid="admin-settings-save-button">
                Simpan Pengaturan
              </Button>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-6">
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
                  className="rounded-xl bg-primary hover:bg-primary/90 font-semibold"
                  data-testid="admin-branch-settings-save-button"
                >
                  Simpan Pengaturan Cabang
                </Button>
              </div>
            </div>
            </div>
          </div>
        )}
      </main>
      </div>

      <Dialog open={!!surveyForm} onOpenChange={(o) => !o && setSurveyForm(null)}>
        <DialogContent className="rounded-2xl" data-testid="admin-survey-dialog">
          <DialogHeader>
            <DialogTitle>Survey Kepuasan — {surveyForm?.ticket_code}</DialogTitle>
          </DialogHeader>
          {surveyForm && (
            <div className="space-y-5 mt-2">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Tingkat Kepuasan</Label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setSurveyForm({ ...surveyForm, rating: n })} className="p-1 transition-transform hover:scale-110" data-testid={`admin-survey-star-${n}`}>
                      <Star className={`w-8 h-8 ${n <= surveyForm.rating ? "text-amber-400 fill-amber-400" : "text-slate-300"}`} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Saran / Masukan</Label>
                <Textarea value={surveyForm.feedback} onChange={(e) => setSurveyForm({ ...surveyForm, feedback: e.target.value })} className="rounded-xl min-h-[90px]" data-testid="admin-survey-feedback" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Lampiran Foto</Label>
                {surveyForm.photo ? (
                  <div className="relative inline-block">
                    <img src={surveyForm.photo} alt="Lampiran" className="h-28 rounded-xl border border-slate-200 object-cover" data-testid="admin-survey-photo-preview" />
                    <button onClick={() => setSurveyForm({ ...surveyForm, photo: "" })} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center" data-testid="admin-survey-photo-remove">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-500 cursor-pointer hover:border-primary hover:text-primary transition-colors w-fit">
                    <Camera className="w-4 h-4" /> Pilih Foto
                    <input type="file" accept="image/*" className="hidden" onChange={onSurveyEditPhoto} data-testid="admin-survey-photo-input" />
                  </label>
                )}
              </div>
              <Button onClick={saveSurveyEdit} className="w-full rounded-xl bg-primary hover:bg-primary/90 h-11 font-semibold" data-testid="admin-survey-save-button">
                Simpan Survey
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!usrForm} onOpenChange={(o) => !o && setUsrForm(null)}>
        <DialogContent className="rounded-2xl" data-testid="admin-user-dialog">
          <DialogHeader>
            <DialogTitle>{usrForm?.id ? "Edit Pengguna" : "Tambah Pengguna"}</DialogTitle>
          </DialogHeader>
          {usrForm && (
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Nama</Label>
                <Input value={usrForm.name} onChange={(e) => setUsrForm({ ...usrForm, name: e.target.value })} placeholder="cth: Budi Santoso" data-testid="admin-user-name-input" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={usrForm.email} onChange={(e) => setUsrForm({ ...usrForm, email: e.target.value })} placeholder="operator@antrian.id" data-testid="admin-user-email-input" />
              </div>
              <div className="space-y-2">
                <Label>{usrForm.id ? "Password Baru (kosongkan jika tidak diubah)" : "Password"}</Label>
                <Input type="password" value={usrForm.password} onChange={(e) => setUsrForm({ ...usrForm, password: e.target.value })} placeholder="min. 6 karakter" data-testid="admin-user-password-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Peran</Label>
                  <Select value={usrForm.role} onValueChange={(v) => setUsrForm({ ...usrForm, role: v })}>
                    <SelectTrigger data-testid="admin-user-role-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operator">Operator</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {usrForm.role === "operator" && (
                  <div className="space-y-2">
                    <Label>Penempatan Antrian</Label>
                    <Select value={usrForm.branch_id || ""} onValueChange={(v) => setUsrForm({ ...usrForm, branch_id: v })}>
                      <SelectTrigger data-testid="admin-user-branch-select"><SelectValue placeholder="Pilih cabang" /></SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <Button onClick={saveUser} disabled={!usrForm.name || !usrForm.email || (!usrForm.id && !usrForm.password)} className="w-full rounded-xl bg-primary hover:bg-primary/90 h-11 font-semibold" data-testid="admin-user-save-button">
                Simpan
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
              <Button onClick={saveBranch} disabled={!brForm.name} className="w-full rounded-xl bg-primary hover:bg-primary/90 h-11 font-semibold" data-testid="admin-branch-save-button">
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
              <Button onClick={saveService} disabled={!svcForm.name || !svcForm.prefix} className="w-full rounded-xl bg-primary hover:bg-primary/90 h-11 font-semibold" data-testid="admin-service-save-button">
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
              <Button onClick={saveCounter} disabled={!ctrForm.name} className="w-full rounded-xl bg-primary hover:bg-primary/90 h-11 font-semibold" data-testid="admin-counter-save-button">
                Simpan
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
