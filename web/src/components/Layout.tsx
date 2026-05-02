import { Home, LogOut } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[#e8eef9] bg-white/90 shadow-[0_8px_30px_rgba(8,36,107,0.05)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex shrink-0 items-center gap-3">
            <NavLink to="/" end aria-label="Home" title="Home" className={({ isActive }) => `grid h-11 w-11 place-items-center rounded-full text-sm shadow-lg shadow-primary/15 ${isActive ? "bg-primary text-white" : "bg-white text-primary ring-1 ring-[#dfe7f7] hover:bg-[#f1f5ff]"}`}>
              <Home size={20} />
            </NavLink>
            <div>
              <div className="font-semibold tracking-wide text-[#07183f]">Sales Portal</div>
              <div className="text-xs text-[#63749b]">Proforma Invoice Workspace</div>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex shrink-0 items-center gap-3">
            <span className="rounded-full bg-[#f1f5ff] px-3 py-1 text-sm text-[#132a5c] ring-1 ring-[#e1e9f8]">{user?.displayName} - {user?.role}</span>
            <button className="btn-secondary flex items-center gap-2" onClick={logout}><LogOut size={16} />Sign Out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8"><Outlet /></main>
    </div>
  );
}
