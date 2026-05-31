import { Navigate, Outlet } from "react-router-dom";
import type { Role } from "../types";
import { useAuth } from "./AuthContext";

export function ProtectedRoute() {
  const { user } = useAuth();
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export function AdminRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return user.role === "ADMIN" ? <Outlet /> : <Navigate to="/" replace />;
}

// Gate a branch of routes to specific roles. SERVICE agents, for example, are
// limited to the after-sales ticket module and bounced from PI/contract pages.
export function RoleRoute({ allow }: { allow: Role[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return allow.includes(user.role) ? <Outlet /> : <Navigate to="/" replace />;
}
