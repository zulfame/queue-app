import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Waves, ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useAuth } from "../context/AuthContext";
import { api, formatApiErrorDetail } from "../lib/api";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    api.get("/settings").then(({ data }) => setLogoUrl(data.logo_url || "")).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const u = await login(email, password);
      navigate(u.role === "admin" ? "/admin" : "/operator");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 bg-slate-950 relative"
      style={{
        backgroundImage:
          "linear-gradient(rgba(2,6,23,0.85), rgba(2,6,23,0.85)), url(https://images.unsplash.com/photo-1614850523011-8f49ffc73908?crop=entropy&cs=srgb&fm=jpg&q=85)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      data-testid="login-page"
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-10"
      >
        <Link to="/" className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white mb-8 transition-colors" data-testid="login-back-link">
          <ArrowLeft className="w-4 h-4" /> Kembali ke Beranda
        </Link>
        {logoUrl ? (
          <img src={logoUrl} alt="Logo" className="w-14 h-14 rounded-2xl object-contain bg-white p-1 mb-6" data-testid="login-logo" />
        ) : (
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-6">
            <Waves className="w-7 h-7 text-white" />
          </div>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Masuk Petugas</h1>
        <p className="mt-2 text-sm text-slate-400">Akses panel operator & admin dashboard</p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-300 text-xs font-bold uppercase tracking-widest">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@antrian.id"
              className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 h-12 rounded-xl"
              data-testid="login-email-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-slate-300 text-xs font-bold uppercase tracking-widest">Password</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 h-12 rounded-xl"
              data-testid="login-password-input"
            />
          </div>
          {error && (
            <p className="text-sm text-rose-400 font-medium" data-testid="login-error-message">{error}</p>
          )}
          <Button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-base"
            data-testid="login-submit-button"
          >
            {loading ? "Memproses..." : "Masuk"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
