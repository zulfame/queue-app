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
              className="text-xs font-bold px-3 py-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
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
                      className="group text-left bg-white border-2 border-slate-200 rounded-3xl p-8 min-h-[140px] shadow-sm hover:border-primary hover:shadow-xl hover:-translate-y-1 active:scale-[0.98] transition-[transform,border-color,box-shadow] duration-200"
                    >
                      <div className="flex items-start justify-between">
                        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
                          <Icon className="w-7 h-7 text-white" />
                        </div>
                        <span className="text-4xl font-black text-slate-100 group-hover:text-primary/40 transition-colors tabular-nums">{s.prefix}</span>
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
              <div id="print-area" className="bg-white rounded-2xl shadow-2xl border border-slate-200 px-7 py-8 text-center font-sans" data-testid="kiosk-receipt">
                {settings.print_header ? (
                  <p className="text-sm font-bold text-slate-900 whitespace-pre-line">{settings.print_header}</p>
                ) : (
                  <p className="text-sm font-bold text-slate-900">{settings.org_name}</p>
                )}
                {settings.branch_name && <p className="text-xs text-slate-500 mt-0.5">{settings.branch_name}</p>}
                <div className="my-4 border-t-2 border-dashed border-slate-300" />
                <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">Nomor Antrian</p>
                <p className="text-6xl font-black tracking-tighter text-slate-900 tabular-nums my-2" data-testid="kiosk-ticket-code">
                  {ticket.code}
                </p>
                <p className="text-base font-semibold text-slate-700">{ticket.service_name}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {new Date(ticket.created_at).toLocaleString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
                <p className="mt-1 text-xs text-slate-500 inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-500" /> {ticket.waiting_ahead} antrian di depan Anda
                </p>
                <div className="my-4 border-t-2 border-dashed border-slate-300" />
                <p className="text-xs text-slate-500 whitespace-pre-line">
                  {settings.print_footer || "Mohon menunggu hingga nomor Anda dipanggil. Terima kasih."}
                </p>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={() => window.print()}
                  className="py-4 rounded-2xl bg-primary text-white font-semibold hover:bg-primary/90 active:scale-[0.98] transition-[background-color,transform] duration-200 inline-flex items-center justify-center gap-2"
                  data-testid="kiosk-print-button"
                >
                  <Printer className="w-5 h-5" /> Cetak Tiket
                </button>
                <button
                  onClick={() => setTicket(null)}
                  className="py-4 rounded-2xl bg-slate-900 text-white font-semibold hover:bg-slate-800 active:scale-[0.98] transition-[background-color,transform] duration-200"
                  data-testid="kiosk-done-button"
                >
                  Selesai
                </button>
              </div>
              <p className="mt-4 text-center text-xs text-slate-400">Kembali otomatis dalam beberapa detik...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      {settings.footer_text && (
        <footer className="px-8 py-5 text-center text-xs text-slate-400 font-medium" data-testid="kiosk-footer-text">
          {settings.footer_text}
        </footer>
      )}
    </div>
  );
}
