import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Marquee from "react-fast-marquee";
import { Volume2, VolumeX, ArrowLeft, Clock, Waves, Megaphone } from "lucide-react";
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

const ytId = (url) => {
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : url;
};

function PromoMedia({ item }) {
  if (!item) return null;
  if (item.type === "youtube") {
    const id = ytId(item.url);
    return (
      <iframe
        title="promo-video"
        src={`https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&rel=0&modestbranding=1`}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media"
        frameBorder="0"
      />
    );
  }
  if (item.type === "video") {
    return <video src={item.url} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />;
  }
  return <img src={item.url} alt="Promosi" className="absolute inset-0 w-full h-full object-cover" />;
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
  const promos = settings.promo_media || [];

  const [promoIdx, setPromoIdx] = useState(0);
  useEffect(() => {
    if (promos.length < 2) return;
    const t = setInterval(() => setPromoIdx((i) => (i + 1) % promos.length), 10000);
    return () => clearInterval(t);
  }, [promos.length]);

  return (
    <div className="min-h-screen h-screen flex flex-col overflow-hidden bg-slate-100" data-testid="monitor-page">
      <header className="bg-white border-b border-slate-200 flex items-center justify-between px-8 py-4 shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-slate-300 hover:text-slate-600 transition-colors" data-testid="monitor-back-link">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-11 h-11 rounded-2xl bg-indigo-600 flex items-center justify-center">
            <Waves className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">{settings.org_name}</h1>
            <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400 font-bold">{settings.tagline || "Sistem Antrian Digital"}</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <button
            onClick={toggleVoice}
            data-testid="monitor-voice-toggle"
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold border transition-colors duration-200 ${
              voiceOn
                ? "bg-amber-500 border-amber-500 text-white"
                : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
            }`}
          >
            {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {voiceOn ? "Suara Aktif" : "Aktifkan Suara"}
          </button>
          <div className="text-right hidden sm:block">
            <p className="text-2xl font-bold tabular-nums text-slate-900" data-testid="monitor-clock">
              {now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
            <p className="text-xs text-slate-400 font-medium">
              {now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 p-6 min-h-0">
        <div className="md:col-span-7 relative rounded-3xl overflow-hidden bg-white border border-slate-200 shadow-sm min-h-[280px]" data-testid="monitor-promo-panel">
          {promos.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
              <Megaphone className="w-14 h-14 text-indigo-300 mb-4" />
              <p className="text-2xl font-bold">{settings.org_name}</p>
              <p className="text-sm text-indigo-200 mt-1">Tambahkan media promosi melalui Admin Dashboard</p>
            </div>
          ) : (
            <>
              <AnimatePresence mode="wait">
                <motion.div
                  key={promoIdx}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8 }}
                  className="absolute inset-0"
                >
                  <PromoMedia item={promos[promoIdx]} />
                </motion.div>
              </AnimatePresence>
              <div className="absolute top-5 left-5 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 backdrop-blur-md text-white text-xs font-bold uppercase tracking-[0.2em]">
                <Megaphone className="w-3.5 h-3.5" /> Informasi & Promosi
              </div>
              {promos.length > 1 && (
                <div className="absolute bottom-5 left-0 right-0 flex justify-center gap-2">
                  {promos.map((_, i) => (
                    <span key={i} className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${i === promoIdx ? "w-8 bg-white" : "w-3 bg-white/40"}`} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="md:col-span-5 flex flex-col gap-6 min-h-0">
          <div className="bg-indigo-600 rounded-3xl px-8 py-8 text-center shadow-lg shadow-indigo-600/20 relative overflow-hidden shrink-0">
            <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10" />
            <div className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full bg-white/5" />
            <p className="text-xs font-bold uppercase tracking-[0.4em] text-indigo-200">Nomor Antrian</p>
            <AnimatePresence mode="wait">
              <motion.p
                key={current ? current.id : "none"}
                initial={{ opacity: 0, scale: 0.7, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.1, y: -20 }}
                transition={{ duration: 0.5, type: "spring", bounce: 0.35 }}
                className="text-7xl lg:text-8xl font-black tracking-tighter leading-none tabular-nums text-amber-300 my-4 drop-shadow-lg"
                data-testid="monitor-current-number"
              >
                {current ? current.code : "—"}
              </motion.p>
            </AnimatePresence>
            <p className="text-sm text-indigo-200 font-medium">{current ? current.service_name : "Menunggu panggilan"}</p>
            <p className="mt-1 text-3xl lg:text-4xl font-bold text-white" data-testid="monitor-current-counter">
              {current ? current.counter_name : ""}
            </p>
          </div>

          {otherServing.length > 0 && (
            <div className="grid grid-cols-2 gap-3 shrink-0">
              {otherServing.slice(0, 2).map((t) => (
                <div key={t.id} className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-center shadow-sm">
                  <p className="text-2xl font-black tabular-nums text-slate-900">{t.code}</p>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-600">{t.counter_name}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col min-h-0" data-testid="monitor-waiting-list">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Menunggu</h2>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                <Clock className="w-3.5 h-3.5" /> {waiting.length}
              </span>
            </div>
            <div className="flex-1 overflow-hidden space-y-2.5">
              {waiting.length === 0 && <p className="text-slate-400 text-sm">Tidak ada antrian menunggu</p>}
              {waiting.slice(0, 6).map((t, i) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`flex items-center justify-between rounded-xl px-4 py-2.5 border ${
                    i === 0 ? "bg-indigo-50 border-indigo-200" : "bg-slate-50 border-slate-100"
                  }`}
                >
                  <span className={`text-xl font-black tabular-nums ${i === 0 ? "text-indigo-700" : "text-slate-700"}`}>{t.code}</span>
                  <span className="text-xs font-semibold text-slate-400 text-right">{t.service_name}</span>
                </motion.div>
              ))}
              {waiting.length > 6 && (
                <p className="text-center text-xs text-slate-400 font-semibold">+{waiting.length - 6} antrian lainnya</p>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-indigo-600 py-3 shrink-0">
        <Marquee gradient={false} speed={45}>
          <span className="text-sm sm:text-base font-medium text-white tracking-wide px-8">
            {settings.ticker_text || "Selamat datang di sistem antrian digital."}
          </span>
        </Marquee>
      </footer>
    </div>
  );
}
