import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Building2, MapPin, ChevronRight } from "lucide-react";
import { api } from "../lib/api";

export const BranchPicker = ({ title = "Pilih Kantor Cabang", subtitle, onSelect }) => {
  const [branches, setBranches] = useState(null);

  useEffect(() => {
    api.get("/branches").then(({ data }) => {
      const active = data.filter((b) => b.active);
      setBranches(active);
      if (active.length === 1) onSelect(active[0]);
    }).catch(() => setBranches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" data-testid="branch-picker">
      <header className="px-8 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-700 transition-colors" data-testid="branch-picker-back-link">
          <ArrowLeft className="w-4 h-4" /> Beranda
        </Link>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-3xl">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-center">{title}</h1>
          {subtitle && <p className="mt-3 text-base text-slate-500 text-center font-medium">{subtitle}</p>}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {branches === null && (
              <div className="col-span-full flex justify-center py-10">
                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {branches && branches.length === 0 && (
              <p className="col-span-full text-center text-slate-400">Belum ada cabang aktif. Tambahkan melalui Admin Dashboard.</p>
            )}
            {(branches || []).map((b) => (
              <button
                key={b.id}
                onClick={() => onSelect(b)}
                data-testid={`branch-pick-${b.id}`}
                className="group text-left bg-white border-2 border-slate-200 rounded-3xl p-7 shadow-sm hover:border-indigo-600 hover:shadow-xl hover:-translate-y-1 active:scale-[0.98] transition-[transform,border-color,box-shadow] duration-200"
              >
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-white" />
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-600 group-hover:translate-x-1 transition-[color,transform] duration-200" />
                </div>
                <h2 className="mt-4 text-xl font-bold text-slate-900">{b.name}</h2>
                {b.address && (
                  <p className="mt-1 text-sm text-slate-500 inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" /> {b.address}
                  </p>
                )}
              </button>
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  );
};
