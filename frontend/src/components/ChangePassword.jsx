import { useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { api, formatApiErrorDetail } from "../lib/api";

export const ChangePasswordForm = ({ onSuccess }) => {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (newPw.length < 6) return toast.error("Kata sandi baru minimal 6 karakter");
    if (newPw !== confirm) return toast.error("Konfirmasi kata sandi tidak cocok");
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: newPw });
      toast.success("Kata sandi berhasil diubah");
      setCurrent(""); setNewPw(""); setConfirm("");
      if (onSuccess) onSuccess();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="change-password-form">
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Kata Sandi Saat Ini</Label>
        <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="h-12 rounded-xl" data-testid="current-password-input" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Kata Sandi Baru</Label>
        <Input type="password" required value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="min. 6 karakter" className="h-12 rounded-xl" data-testid="new-password-input" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Konfirmasi Kata Sandi Baru</Label>
        <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12 rounded-xl" data-testid="confirm-password-input" />
      </div>
      <Button type="submit" disabled={busy} className="rounded-xl bg-primary hover:bg-primary/90 font-semibold h-12 px-8" data-testid="change-password-submit">
        <KeyRound className="w-4 h-4 mr-2" /> {busy ? "Menyimpan..." : "Ubah Kata Sandi"}
      </Button>
    </form>
  );
};
