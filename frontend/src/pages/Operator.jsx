import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, PhoneCall, RotateCcw, SkipForward, CheckCircle2, LogOut, Star, Undo2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { api, formatApiErrorDetail } from "../lib/api";
import { useQueueSocket } from "../hooks/useQueueSocket";
import { useAuth } from "../context/AuthContext";

export default function Operator() {
  const { user, logout } = useAuth();
  const isLockedOperator = !!(user && user.role === "operator" && user.branch_id);
  const [state, setState] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(localStorage.getItem("op_branch") || "");
  const [counterId, setCounterId] = useState(localStorage.getItem("op_counter") || "");
  const [serviceId, setServiceId] = useState(localStorage.getItem("op_service") || "");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!branchId) return;
    api.get(`/queue/state?branch_id=${branchId}`).then(({ data }) => setState(data)).catch(() => {});
  }, [branchId]);

  useEffect(() => {
    api.get("/branches").then(({ data }) => {
      const active = data.filter((b) => b.active);
      setBranches(active);
      if (isLockedOperator) setBranchId(user.branch_id);
      else if (!localStorage.getItem("op_branch") && active[0]) setBranchId(active[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLockedOperator]);

  useEffect(() => { load(); }, [load]);
  useQueueSocket(useCallback((msg) => {
    if (msg.branch_id && msg.branch_id !== branchId) return;
    load();
  }, [load, branchId]));

  useEffect(() => { if (branchId) localStorage.setItem("op_branch", branchId); }, [branchId]);
  useEffect(() => { if (counterId) localStorage.setItem("op_counter", counterId); }, [counterId]);
  useEffect(() => { if (serviceId) localStorage.setItem("op_service", serviceId); }, [serviceId]);

  const changeBranch = (v) => {
    setBranchId(v);
    setCounterId("");
    setServiceId("");
    localStorage.removeItem("op_counter");
    localStorage.removeItem("op_service");
  };

  const myTicket = (state?.serving || []).find((t) => t.counter_id === counterId) || null;
  const service = (state?.services || []).find((s) => s.id === serviceId);
  const waitingForService = (state?.waiting || []).filter((t) => t.service_id === serviceId);

  const doAction = async (fn, successMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const callNext = () => {
    if (!counterId) return toast.error("Pilih loket terlebih dahulu");
    if (!serviceId) return toast.error("Pilih layanan terlebih dahulu");
    doAction(async () => {
      const { data } = await api.post("/queue/call-next", { counter_id: counterId, service_id: serviceId });
      toast.success(`Memanggil ${data.code}`);
    });
  };

  return (
    <div className="min-h-screen bg-slate-50" data-testid="operator-page">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-slate-400 hover:text-slate-700 transition-colors" data-testid="operator-back-link">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-slate-900">Panel Operator</h1>
          {user && (
            <span
              className="ml-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold"
              data-testid="operator-user-badge"
            >
              {user.name || user.email}
            </span>
          )}
        </div>
        <button onClick={logout} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-rose-600 transition-colors" data-testid="operator-logout-button">
          <LogOut className="w-4 h-4" /> Keluar
        </button>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Kantor Cabang</label>
            {isLockedOperator ? (
              <div className="h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center px-4 text-sm font-semibold text-slate-600" data-testid="operator-branch-locked">
                {branches.find((b) => b.id === branchId)?.name || "Cabang Anda"}
              </div>
            ) : (
              <Select value={branchId} onValueChange={changeBranch}>
                <SelectTrigger className="h-12 rounded-xl bg-white" data-testid="operator-branch-select">
                  <SelectValue placeholder="Pilih cabang" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id} data-testid={`operator-branch-option-${b.id}`}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Loket Saya</label>
            <Select value={counterId} onValueChange={setCounterId}>
              <SelectTrigger className="h-12 rounded-xl bg-white" data-testid="operator-counter-select">
                <SelectValue placeholder="Pilih loket" />
              </SelectTrigger>
              <SelectContent>
                {(state?.counters || []).map((c) => (
                  <SelectItem key={c.id} value={c.id} data-testid={`operator-counter-option-${c.name.replace(/\s/g, "-")}`}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Layanan</label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger className="h-12 rounded-xl bg-white" data-testid="operator-service-select">
                <SelectValue placeholder="Pilih layanan" />
              </SelectTrigger>
              <SelectContent>
                {(state?.services || []).map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`operator-service-option-${s.prefix}`}>
                    {s.name} ({s.waiting_count} menunggu)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-10 shadow-sm flex flex-col items-center justify-center text-center min-h-[320px]">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Sedang Dilayani</p>
            <p className="mt-4 text-7xl sm:text-8xl font-black tracking-tighter tabular-nums text-primary" data-testid="operator-current-ticket">
              {myTicket ? myTicket.code : "—"}
            </p>
            <p className="mt-3 text-base font-semibold text-slate-500">
              {myTicket ? myTicket.service_name : "Belum ada antrian dipanggil"}
            </p>
            {service && (
              <p className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 text-amber-700 text-sm font-bold" data-testid="operator-waiting-count">
                {waitingForService.length} menunggu di {service.name}
              </p>
            )}
          </div>

          <div className="space-y-4">
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                onClick={callNext}
                disabled={busy}
                className="w-full h-20 rounded-2xl bg-primary hover:bg-primary/90 text-white text-lg font-bold flex items-center justify-center gap-3"
                data-testid="operator-call-next-button"
              >
                <PhoneCall className="w-6 h-6" /> Panggil Berikutnya
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => myTicket && doAction(() => api.post("/queue/recall", { ticket_id: myTicket.id }), `Memanggil ulang ${myTicket.code}`)}
                disabled={busy || !myTicket}
                variant="outline"
                className="w-full h-14 rounded-2xl text-base font-semibold border-slate-300 flex items-center justify-center gap-3"
                data-testid="operator-recall-button"
              >
                <RotateCcw className="w-5 h-5" /> Panggil Ulang
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => myTicket && doAction(() => api.post("/queue/complete", { ticket_id: myTicket.id }), `${myTicket.code} selesai dilayani`)}
                disabled={busy || !myTicket}
                className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-base font-semibold flex items-center justify-center gap-3"
                data-testid="operator-complete-button"
              >
                <CheckCircle2 className="w-5 h-5" /> Selesai
              </Button>
            </motion.div>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                onClick={() => myTicket && doAction(() => api.post("/queue/skip", { ticket_id: myTicket.id }), `${myTicket.code} dilewati`)}
                disabled={busy || !myTicket}
                variant="outline"
                className="w-full h-14 rounded-2xl text-base font-semibold border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 flex items-center justify-center gap-3"
                data-testid="operator-skip-button"
              >
                <SkipForward className="w-5 h-5" /> Lewati
              </Button>
            </motion.div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-5">Antrian Menunggu {service ? `— ${service.name}` : ""}</h2>
          <div className="flex flex-wrap gap-3" data-testid="operator-waiting-list">
            {waitingForService.length === 0 && <p className="text-sm text-slate-400">Tidak ada antrian menunggu</p>}
            {waitingForService.slice(0, 15).map((t, i) => (
              <span
                key={t.id}
                className={`px-4 py-2 rounded-xl text-sm font-bold tabular-nums inline-flex items-center gap-1.5 ${
                  t.priority ? "bg-amber-500 text-white" : i === 0 ? "bg-primary text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {t.priority && <Star className="w-3.5 h-3.5 fill-current" />}
                {t.code}
              </span>
            ))}
          </div>
        </div>

        {(state?.skipped || []).length > 0 && (
          <div className="bg-white border border-rose-100 rounded-3xl p-8 shadow-sm" data-testid="operator-skipped-list">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-rose-500 mb-2">Antrian Terlewati</h2>
            <p className="text-xs text-slate-400 mb-5">Jika pengunjung kembali, prioritaskan agar dipanggil paling awal berikutnya.</p>
            <div className="space-y-3">
              {state.skipped.map((t) => (
                <div key={t.id} className="flex items-center gap-4 rounded-2xl bg-rose-50/50 px-5 py-3">
                  <span className="text-xl font-black tabular-nums text-slate-900">{t.code}</span>
                  <span className="flex-1 text-sm font-semibold text-slate-500">{t.service_name}</span>
                  <Button
                    size="sm"
                    onClick={() => doAction(async () => {
                      await api.post("/queue/restore", { ticket_id: t.id });
                      toast.success(`${t.code} diprioritaskan ke urutan terdepan`);
                    })}
                    disabled={busy}
                    className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                    data-testid={`operator-restore-${t.code}`}
                  >
                    <Undo2 className="w-4 h-4 mr-1.5" /> Prioritaskan
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
