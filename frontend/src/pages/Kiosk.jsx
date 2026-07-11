import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Printer, Clock } from "lucide-react";
import { api } from "../lib/api";
import { useQueueSocket } from "../hooks/useQueueSocket";
import { getServiceIcon } from "../lib/icons";
import { BranchPicker } from "../components/BranchPicker";

export default function Kiosk() {
  const [state, setState] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [busy, setBusy] = useState(false);
  const [branchId, setBranchId] = useState(localStorage.getItem("kiosk_branch") || "");
  const timerRef = useRef(null);

  const load = useCallback(() => {
    if (!branchId) return;
    api.get(`/queue/state?branch_id=${branchId}`).then(({ data }) => setState(data)).catch(() => {});
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  useQueueSocket(useCallback((msg) => {
    if (msg.branch_id && msg.branch_id !== branchId) return;
    if (msg.type === "update" || msg.type === "call") load();
  }, [load, branchId]));

  const takeTicket = async (serviceId) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/tickets", { service_id: serviceId });
      setTicket(data);
      load();
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setTicket(null), 12000);
    } catch {} finally {
      setBusy(false);
    }
  };

  const settings = state?.settings || {};

  if (!branchId) {
    return (
      <BranchPicker
        subtitle="Pilih kantor cabang untuk perangkat kiosk ini"
        onSelect={(b) => {
          localStorage.setItem("kiosk_branch", b.id);
          setBranchId(b.id);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" data-testid="kiosk-page">
      <header className="px-8 py-6 flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-700 transition-colors" data-testid="kiosk-back-link">
          <ArrowLeft className="w-4 h-4" /> Beranda
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">{settings.org_name}</span>
          {settings.branch_name && (
            <button
              onClick={() => { localStorage.removeItem("kiosk_branch"); setBranchId(""); setState(null); }}
              className="text-xs font-bold px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
              data-testid="kiosk-branch-badge"
              title="Klik untuk ganti cabang"
            >
              {settings.branch_name}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <AnimatePresence mode="wait">
          {!ticket ? (
            <motion.div
              key="select"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35 }}
              className="w-full max-w-4xl"
            >
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 text-center">
                Selamat Datang
              </h1>
              <p className="mt-3 text-base sm:text-lg text-slate-500 text-center font-medium">
                Silakan pilih layanan untuk mengambil nomor antrian
              </p>

              <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                {(state?.services || []).map((s) => {
                  const Icon = getServiceIcon(s.icon);
                  return (
                    <button
                      key={s.id}
                      onClick={() => takeTicket(s.id)}
                      disabled={busy}
                      data-testid={`kiosk-service-${s.prefix}`}
                      className="group text-left bg-white border-2 border-slate-200 rounded-3xl p-8 min-h-[140px] shadow-sm hover:border-indigo-600 hover:shadow-xl hover:-translate-y-1 active:scale-[0.98] transition-[transform,border-color,box-shadow] duration-200"
                    >
                      <div className="flex items-start justify-between">
                        <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center">
                          <Icon className="w-7 h-7 text-white" />
                        </div>
                        <span className="text-4xl font-black text-slate-100 group-hover:text-indigo-100 transition-colors tabular-nums">{s.prefix}</span>
                      </div>
                      <h2 className="mt-5 text-2xl font-bold text-slate-900">{s.name}</h2>
                      <p className="mt-1 text-sm text-slate-500">{s.description}</p>
                      <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-600">
                        <Clock className="w-4 h-4" /> {s.waiting_count} menunggu
                      </p>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="ticket"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.35 }}
              className="w-full max-w-md"
              data-testid="kiosk-ticket-result"
            >
              <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
                <div className="bg-indigo-600 px-8 py-6 text-center">
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-indigo-200">Nomor Antrian Anda</p>
                </div>
                <div className="px-8 py-10 text-center border-b-2 border-dashed border-slate-200">
                  <p className="text-7xl sm:text-8xl font-black tracking-tighter text-slate-900 tabular-nums" data-testid="kiosk-ticket-code">
                    {ticket.code}
                  </p>
                  <p className="mt-4 text-lg font-semibold text-indigo-600">{ticket.service_name}</p>
                </div>
                <div className="px-8 py-6 flex items-center justify-between text-sm text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    {ticket.waiting_ahead} antrian di depan Anda
                  </span>
                  <Printer className="w-5 h-5 text-slate-300" />
                </div>
              </div>
              <button
                onClick={() => setTicket(null)}
                className="mt-8 w-full py-4 rounded-2xl bg-slate-900 text-white font-semibold hover:bg-slate-800 active:scale-[0.98] transition-[background-color,transform] duration-200"
                data-testid="kiosk-done-button"
              >
                Selesai
              </button>
              <p className="mt-4 text-center text-xs text-slate-400">Kembali otomatis dalam beberapa detik...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
