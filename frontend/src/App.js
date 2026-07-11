import "@/App.css";
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { api } from "./lib/api";
import { applyBranding } from "./lib/branding";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Kiosk from "./pages/Kiosk";
import Monitor from "./pages/Monitor";
import Operator from "./pages/Operator";
import Admin from "./pages/Admin";

const Branding = () => {
  useEffect(() => {
    api.get("/settings").then(({ data }) => applyBranding(data)).catch(() => {});
  }, []);
  return null;
};

const Protected = ({ children }) => {
  const { user } = useAuth();
  if (user === null)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  if (user === false) return <Navigate to="/login" replace />;
  return children;
};

function App() {
  return (
    <AuthProvider>
      <Branding />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/operator" element={<Protected><Operator /></Protected>} />
          <Route path="/admin" element={<Protected><Admin /></Protected>} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;
