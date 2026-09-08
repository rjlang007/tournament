import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="text-center text-white/60 mt-16">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/community/login" replace />;
  }
  return <>{children}</>;
}
