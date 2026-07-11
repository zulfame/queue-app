import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Marquee from "react-fast-marquee";
import { Volume2, VolumeX, ArrowLeft, Clock } from "lucide-react";
import { api } from "../lib/api";
import { useQueueSocket } from "../hooks/useQueueSocket";

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Monitor() {
  const [state, setState] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const voiceOnRef = useRef(false);
  const speechQueue = useRef([]);
  const speaking = useRef(false);
  const now = useClock();

  const load = useCallback(() => {
    api.get("/queue/state").then(({ data }) => setState(data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const processQueue = useCallback(() => {
    if (speaking.current || speechQueue.current.length === 0) return;
    const text = speechQueue.current.shift();
    speaking.current = true;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "id-ID";
    u.rate = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const idVoice = voices.find((v) => v.lang.startsWith("id"));
    if (idVoice) u.voice = idVoice;
    u.onend = () => {
      speaking.current = false;
      processQueue();
    };
    u.onerror = () => {
      speaking.current = false;
      processQueue();
    };
    window.speechSynthesis.speak(u);
  }, []);

  const playChime = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.22);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.5);
        osc.start(ctx.currentTime + i * 0.22);
        osc.stop(ctx.currentTime + i * 0.22 + 0.5);
      });
    } catch {}
  }, []);

  const announce = useCallback((ticket) => {
    if (!voiceOnRef.current) return;
    playChime();
    const digits = String(ticket.number).split("").join(" ");
    const text = `Nomor antrian, ${ticket.prefix}, ${digits}, silakan menuju, ${ticket.counter_name}`;
    speechQueue.current.push(text);
    setTimeout(processQueue, 900);
  }, [playChime, processQueue]);

  useQueueSocket(useCallback((msg) => {
    if (msg.type === "call") {
      setLastCall(msg.ticket);
      load();
      announce(msg.ticket);
    } else if (msg.type === "update") {
      load();
    }
  }, [load, announce]));

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    voiceOnRef.current = next;
    if (next) {
      window.speechSynthesis.getVoices();
      const u = new SpeechSynthesisUtterance("Suara aktif");
      u.lang = "id-ID";
      window.speechSynthesis.speak(u);
    } else {
      window.speechSynthesis.cancel();
      speechQueue.current = [];
      speaking.current = false;
    }
  };

  const settings = state?.settings || {};
  const serving = state?.serving || [];
  const waiting = state?.waiting || [];
  const current = lastCall || serving[0] || null;
  const otherServing = serving.filter((t) => !current || t.id !== current.id);

  return (
    <div
      className="min-h-screen flex flex-col overflow-hidden relative bg-slate-950 text-white"
      style={{
        backgroundImage:
          "linear-gradient(rgba(2,6,23,0.75), rgba(2,6,23,0.85)), url(https://images.unsplash.com/photo-1620121692029-d088224ddc74?crop=entropy&cs=srgb&fm=jpg&q=85)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      data-testid="monitor-page"
    >
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-slate-500 hover:text-white transition-colors" data-testid="monitor-back-link">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{settings.org_name}</h1>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400 font-semibold">{settings.tagline || "Sistem Antrian Digital"}</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <button
            onClick={toggleVoice}
            data-testid="monitor-voice-toggle"
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold border transition-colors duration-200 ${
              voiceOn
                ? "bg-amber-500 border-amber-500 text-slate-950"
                : "bg-white/5 border-white/15 text-slate-300 hover:bg-white/10"
            }`}
          >
            {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {voiceOn ? "Suara Aktif" : "Aktifkan Suara"}
          </button>
          <div className="text-right hidden sm:block">
            <p className="text-2xl font-bold tabular-nums" data-testid="monitor-clock">
              {now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
            <p className="text-xs text-slate-400 font-medium">
              {now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 px-8 pb-6 min-h-0">
        <div className="md:col-span-8 flex flex-col gap-6 min-h-0">
          <div className="flex-1 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl flex flex-col items-center justify-center p-10 relative overflow-hidden">
            <p className="text-sm sm:text-base font-bold uppercase tracking-[0.4em] text-slate-400">Nomor Antrian</p>
            <AnimatePresence mode="wait">
              <motion.p
                key={current ? current.id : "none"}
                initial={{ opacity: 0, scale: 0.7, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.1, y: -30 }}
                transition={{ duration: 0.5, type: "spring", bounce: 0.35 }}
                className="text-[18vw] md:text-[11vw] font-black tracking-tighter leading-none tabular-nums text-amber-400 animate-pulse-glow my-4"
                data-testid="monitor-current-number"
              >
                {current ? current.code : "—"}
              </motion.p>
            </AnimatePresence>
            <div className="text-center">
              <p className="text-lg text-slate-300 font-medium">{current ? current.service_name : "Menunggu panggilan"}</p>
              <p className="mt-1 text-3xl sm:text-5xl font-bold text-white" data-testid="monitor-current-counter">
                {current ? current.counter_name : ""}
              </p>
            </div>
          </div>

          {otherServing.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {otherServing.slice(0, 4).map((t) => (
                <div key={t.id} className="bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl p-5 text-center">
                  <p className="text-3xl font-black tabular-nums text-white">{t.code}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-widest text-amber-400">{t.counter_name}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-4 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-7 flex flex-col min-h-0" data-testid="monitor-waiting-list">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-bold uppercase tracking-[0.3em] text-slate-400">Menunggu</h2>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400">
              <Clock className="w-3.5 h-3.5" /> {waiting.length}
            </span>
          </div>
          <div className="flex-1 overflow-hidden space-y-3">
            {waiting.length === 0 && (
              <p className="text-slate-500 text-sm">Tidak ada antrian menunggu</p>
            )}
            {waiting.slice(0, 8).map((t, i) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex items-center justify-between rounded-2xl px-5 py-3.5 border ${
                  i === 0 ? "bg-white/10 border-amber-400/40" : "bg-white/5 border-white/5"
                }`}
              >
                <span className="text-2xl font-black tabular-nums">{t.code}</span>
                <span className="text-xs font-semibold text-slate-400 text-right">{t.service_name}</span>
              </motion.div>
            ))}
            {waiting.length > 8 && (
              <p className="text-center text-xs text-slate-500 font-semibold">+{waiting.length - 8} antrian lainnya</p>
            )}
          </div>
        </div>
      </main>

      <footer className="bg-black/60 backdrop-blur-xl border-t border-white/10 py-3">
        <Marquee gradient={false} speed={45}>
          <span className="text-sm sm:text-base font-medium text-slate-300 tracking-wide px-8">
            {settings.ticker_text || "Selamat datang di sistem antrian digital."}
          </span>
        </Marquee>
      </footer>
    </div>
  );
}
