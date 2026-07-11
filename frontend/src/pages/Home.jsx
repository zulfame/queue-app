import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Ticket, MonitorPlay, PhoneCall, LayoutDashboard, ArrowRight, Waves } from "lucide-react";
import { api } from "../lib/api";

const surfaces = [
  {
    to: "/kiosk",
    icon: Ticket,
    title: "Ambil Antrian",
    desc: "Kiosk layar sentuh untuk pengunjung mengambil nomor antrian",
    color: "bg-indigo-600",
    testId: "home-kiosk-link",
  },
  {
    to: "/monitor",
    icon: MonitorPlay,
    title: "Layar Monitor",
    desc: "Display TV dengan pemanggilan suara & daftar antrian real-time",
    color: "bg-slate-900",
    testId: "home-monitor-link",
  },
  {
    to: "/operator",
    icon: PhoneCall,
    title: "Panel Operator",
    desc: "Panggil, ulangi, lewati & selesaikan antrian dari loket Anda",
    color: "bg-amber-500",
    testId: "home-operator-link",
  },
  {
    to: "/admin",
    icon: LayoutDashboard,
    title: "Admin Dashboard",
    desc: "Kelola layanan, loket, pengaturan & pantau statistik harian",
    color: "bg-emerald-600",
    testId: "home-admin-link",
  },
];

export default function Home() {
  const [settings, setSettings] = useState({ org_name: "QueueFlow", tagline: "" });

  useEffect(() => {
    api.get("/settings").then(({ data }) => setSettings(data)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden" data-testid="home-page">
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-100 blur-3xl opacity-70" />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-amber-100 blur-3xl opacity-70" />

      <div className="relative max-w-6xl mx-auto px-6 py-16 sm:py-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center">
              <Waves className="w-6 h-6 text-white" />
            </div>
            <span className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">Sistem Antrian Digital</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 max-w-3xl">
            {settings.org_name}
          </h1>
          <p className="mt-4 text-base sm:text-lg font-medium text-slate-500 max-w-2xl">
            Satu platform antrian yang dapat digunakan untuk bank, klinik, rumah sakit, kantor pelayanan publik, dan lainnya.
          </p>
        </motion.div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-6">
          {surfaces.map((s, i) => (
            <motion.div
              key={s.to}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.1 + i * 0.08 }}
            >
              <Link
                to={s.to}
                data-testid={s.testId}
                className="group block bg-white border border-slate-200 rounded-3xl p-8 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-[transform,box-shadow] duration-300"
              >
                <div className={`w-14 h-14 rounded-2xl ${s.color} flex items-center justify-center mb-6`}>
                  <s.icon className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold text-slate-900 flex items-center gap-2">
                  {s.title}
                  <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-600 group-hover:translate-x-1 transition-[color,transform] duration-300" />
                </h2>
                <p className="mt-2 text-sm sm:text-base text-slate-500">{s.desc}</p>
              </Link>
            </motion.div>
          ))}
        </div>

        <p className="mt-16 text-xs text-slate-400 font-medium">
          Panel Operator & Admin memerlukan login • Kiosk & Monitor dapat diakses publik
        </p>
      </div>
    </div>
  );
}
