import { useEffect, useRef, useState } from "react";
import { ChevronDown, Home, KeyRound, LogOut } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[#e8eef9] bg-white/90 shadow-[0_8px_30px_rgba(8,36,107,0.05)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex shrink-0 items-center gap-3">
            <NavLink to="/" end aria-label="Home" title="Home" className={({ isActive }) => `grid h-11 w-11 place-items-center rounded-full bg-white text-sm text-primary shadow-lg shadow-primary/15 ring-1 ${isActive ? "ring-primary/45" : "ring-[#dfe7f7] hover:bg-[#f1f5ff]"}`}>
              <Home size={20} />
            </NavLink>
            <div>
              <div className="font-semibold tracking-wide text-[#07183f]">Sales Portal</div>
            </div>
          </div>

          <div className="flex-1" />

          <div className="relative flex shrink-0 items-center gap-3" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full bg-[#f1f5ff] px-3 py-1 text-sm text-[#132a5c] ring-1 ring-[#e1e9f8] hover:bg-[#e7eeff]"
            >
              <span>{user?.displayName} - {user?.role}</span>
              <ChevronDown size={15} className={`transition ${menuOpen ? "rotate-180" : ""}`} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-xl border border-[#e1e9f8] bg-white py-1 shadow-[0_18px_42px_rgba(8,36,107,0.12)]">
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#294477] hover:bg-[#f1f5ff]"
                  onClick={() => { setMenuOpen(false); navigate("/change-password"); }}
                >
                  <KeyRound size={16} />Change Password
                </button>
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#294477] hover:bg-[#f1f5ff]"
                  onClick={() => { setMenuOpen(false); logout(); }}
                >
                  <LogOut size={16} />Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8"><Outlet /></main>
    </div>
  );
}
