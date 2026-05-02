import { ChevronRight, Clock3, FileCheck2, FileText, Folder, LayoutGrid, Package, ShieldCheck, UsersRound, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type HomeModule = {
  to: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
  tone: ModuleTone;
  art: "document" | "temple" | "folder" | "stamp" | "blocks" | "people" | "grid" | "shield";
};

type ModuleTone = "blue" | "green" | "cyan" | "violet" | "orange" | "indigo" | "teal" | "emerald";

export function HomePage() {
  const { user } = useAuth();
  const adminModules: HomeModule[] = [
    { to: "/reviews", title: "Pending Reviews", desc: "Approve Chinese PIs", Icon: Clock3, tone: "orange", art: "stamp" },
    { to: "/products", title: "Product Management", desc: "Products, fields and sub-templates", Icon: Package, tone: "indigo", art: "blocks" },
    { to: "/permissions", title: "Permission Management", desc: "Users and admin roles", Icon: UsersRound, tone: "teal", art: "people" },
    { to: "/excel-templates", title: "Excel Template Settings", desc: "Header templates by language", Icon: LayoutGrid, tone: "emerald", art: "grid" }
  ];
  const modules: HomeModule[] = [
    { to: "/pi/en", title: "English PI", desc: "Create English proforma invoices", Icon: FileText, tone: "blue", art: "document" },
    { to: "/pi/zh", title: "Chinese PI", desc: "Create Chinese PIs for admin approval", Icon: FileCheck2, tone: "green", art: "temple" },
    { to: "/pi/confirmed-received", title: "Confirmed Received PIs", desc: "View approved received Chinese PIs", Icon: ShieldCheck, tone: "cyan", art: "shield" },
    { to: "/contracts", title: "Contract Templates", desc: "Download shared contract files", Icon: Folder, tone: "violet", art: "folder" },
    ...(user?.role === "ADMIN" ? adminModules : [])
  ];

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-lg border border-[#dbe6fb] bg-gradient-to-br from-white via-[#f9fbff] to-[#dbe7ff] px-8 py-12 shadow-[0_24px_70px_rgba(8,36,107,0.09)]">
        <div className="absolute -right-10 -top-20 h-72 w-72 rounded-full bg-[#adc4fb]/45 blur-sm" />
        <div className="absolute right-10 top-8 hidden h-48 w-36 rotate-6 rounded-[2rem] border border-white/70 bg-white/60 shadow-2xl shadow-[#6f8fd9]/25 backdrop-blur-md md:block" />
        <div className="absolute right-24 top-16 hidden h-40 w-32 rotate-6 rounded-[1.6rem] border border-white/80 bg-white/80 shadow-xl shadow-[#6f8fd9]/20 md:block" />
        <div className="absolute right-32 top-24 hidden h-20 w-20 rounded-full bg-[#6f8fd9]/20 md:block" />
        <div className="absolute right-40 top-20 hidden h-3 w-3 rotate-45 bg-white md:block" />
        <div className="absolute right-16 bottom-10 hidden h-2 w-2 rotate-45 bg-white md:block" />
        <div className="absolute right-28 top-28 hidden h-16 w-16 rounded-2xl bg-primary/80 text-center text-3xl font-semibold leading-[4rem] text-white shadow-xl shadow-primary/20 md:block">$</div>
        <div className="relative max-w-xl">
          <h1 className="text-4xl font-semibold tracking-tight text-[#07183f]">Hello, {user?.displayName}</h1>
          <p className="mt-3 text-base text-[#617295]">Choose a module to continue your workflow.</p>
          <div className="mt-6 h-1 w-14 rounded-full bg-primary" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {modules.map(({ to, title, desc, Icon, tone, art }) => {
          const theme = moduleThemes[tone];
          return (
          <Link key={title} to={to} className={`group relative min-h-36 overflow-hidden rounded-lg border bg-gradient-to-br p-5 shadow-[0_18px_42px_rgba(8,36,107,0.07)] transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(8,36,107,0.13)] ${theme.card}`}>
            <div className="relative z-10 flex max-w-[68%] items-start gap-4">
              <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white shadow-lg ${theme.icon}`}>
                <Icon size={24} strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-[#07183f]">{title}</span>
                <span className="mt-1 block text-sm leading-5 text-[#63749b]">{desc}</span>
              </span>
            </div>
            <DecorativeArt art={art} className={theme.art} />
            <span className="absolute bottom-4 right-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/75 text-[#294477] shadow-[0_8px_20px_rgba(8,36,107,0.09)] ring-1 ring-white/80 transition group-hover:translate-x-1 group-hover:text-primary">
              <ChevronRight size={18} />
            </span>
          </Link>
        );
        })}
      </div>
    </div>
  );
}

const moduleThemes: Record<ModuleTone, { card: string; icon: string; art: string }> = {
  blue: {
    card: "border-[#dbe7fb] from-white via-white to-[#e9f0ff]",
    icon: "bg-gradient-to-br from-[#3b7be8] to-[#0b4aa5] shadow-blue-900/15",
    art: "text-[#8eb1f1]"
  },
  green: {
    card: "border-[#d9efe7] from-white via-white to-[#e8f8f1]",
    icon: "bg-gradient-to-br from-[#25b577] to-[#078754] shadow-emerald-900/15",
    art: "text-[#99d7bf]"
  },
  cyan: {
    card: "border-[#d8eef4] from-white via-white to-[#e7f8fb]",
    icon: "bg-gradient-to-br from-[#20a6c5] to-[#147b91] shadow-cyan-900/15",
    art: "text-[#91d4df]"
  },
  violet: {
    card: "border-[#e4dcfb] from-white via-white to-[#f0ebff]",
    icon: "bg-gradient-to-br from-[#8b5cf6] to-[#6330c8] shadow-violet-900/15",
    art: "text-[#bba7f2]"
  },
  orange: {
    card: "border-[#f5e4d4] from-white via-white to-[#fff1e4]",
    icon: "bg-gradient-to-br from-[#fb923c] to-[#d95b0b] shadow-orange-900/15",
    art: "text-[#efbf98]"
  },
  indigo: {
    card: "border-[#dfe4fb] from-white via-white to-[#eef2ff]",
    icon: "bg-gradient-to-br from-[#6276ea] to-[#3044b6] shadow-indigo-900/15",
    art: "text-[#a6b2f3]"
  },
  teal: {
    card: "border-[#d8eeec] from-white via-white to-[#e9f8f7]",
    icon: "bg-gradient-to-br from-[#21b2b0] to-[#0f7f80] shadow-teal-900/15",
    art: "text-[#9bd9d6]"
  },
  emerald: {
    card: "border-[#d9efe1] from-white via-white to-[#e9f9ee]",
    icon: "bg-gradient-to-br from-[#2fb36c] to-[#158044] shadow-green-900/15",
    art: "text-[#9cd7b3]"
  }
};

function DecorativeArt({ art, className }: { art: HomeModule["art"]; className: string }) {
  const baseClass = `pointer-events-none absolute bottom-0 right-0 h-32 w-40 opacity-55 transition group-hover:scale-105 ${className}`;

  if (art === "document") {
    return (
      <svg className={baseClass} viewBox="0 0 160 128" fill="none" aria-hidden="true">
        <path d="M63 28h58c9 0 16 7 16 16v66H51V40c0-7 5-12 12-12Z" fill="currentColor" opacity=".24" />
        <path d="M50 40c16 7 41 7 58 0v68c-16 9-41 9-58 0V40Z" fill="white" stroke="currentColor" strokeWidth="5" />
        <path d="M69 58h41M69 73h34M69 88h25" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity=".55" />
      </svg>
    );
  }

  if (art === "temple") {
    return (
      <svg className={baseClass} viewBox="0 0 160 128" fill="none" aria-hidden="true">
        <path d="M45 70h76v42H45V70Z" fill="currentColor" opacity=".2" />
        <path d="M35 65c18-6 29-17 34-33 11 18 28 28 56 33-29 10-59 10-90 0Z" fill="white" stroke="currentColor" strokeWidth="5" />
        <path d="M54 74v35M76 74v35M98 74v35M38 111h88" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity=".55" />
      </svg>
    );
  }

  if (art === "folder") {
    return (
      <svg className={baseClass} viewBox="0 0 160 128" fill="none" aria-hidden="true">
        <path d="M24 45h43l12 14h58v47c0 8-6 14-14 14H38c-8 0-14-6-14-14V45Z" fill="white" stroke="currentColor" strokeWidth="5" />
        <path d="M39 31h39l13 14H24c0-8 7-14 15-14Z" fill="currentColor" opacity=".32" />
        <path d="M45 78h70" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity=".45" />
      </svg>
    );
  }

  if (art === "stamp") {
    return (
      <svg className={baseClass} viewBox="0 0 160 128" fill="none" aria-hidden="true">
        <path d="M67 23c14-10 35 0 35 17 0 9-5 16-12 20l23 24H57l23-24c-9-5-16-20-13-37Z" fill="currentColor" opacity=".38" />
        <path d="M43 82h82l10 35H33l10-35Z" fill="white" stroke="currentColor" strokeWidth="5" />
        <path d="M52 100h65" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity=".5" />
      </svg>
    );
  }

  if (art === "blocks") {
    return (
      <svg className={baseClass} viewBox="0 0 160 128" fill="none" aria-hidden="true">
        <path d="M75 21 105 36 75 51 45 36 75 21ZM42 55l30 15v34L42 89V55ZM79 70l30-15v34l-30 15V70ZM109 44l27 14-27 14-27-14 27-14Z" fill="white" stroke="currentColor" strokeWidth="5" />
        <path d="M75 51v20M109 72v20" stroke="currentColor" strokeWidth="5" opacity=".45" />
      </svg>
    );
  }

  if (art === "people") {
    return (
      <svg className={baseClass} viewBox="0 0 160 128" fill="none" aria-hidden="true">
        <rect x="42" y="30" width="82" height="86" rx="18" fill="white" stroke="currentColor" strokeWidth="5" />
        <circle cx="83" cy="61" r="15" fill="currentColor" opacity=".35" />
        <path d="M57 98c7-15 45-15 52 0" stroke="currentColor" strokeWidth="7" strokeLinecap="round" opacity=".55" />
        <rect x="92" y="43" width="43" height="58" rx="14" fill="currentColor" opacity=".18" />
      </svg>
    );
  }

  if (art === "grid") {
    return (
      <svg className={baseClass} viewBox="0 0 160 128" fill="none" aria-hidden="true">
        <rect x="34" y="31" width="108" height="78" rx="14" fill="white" stroke="currentColor" strokeWidth="5" />
        <path d="M34 54h108M62 54v55M92 54v55M122 54v55M50 77h76M50 95h76" stroke="currentColor" strokeWidth="4" opacity=".5" />
        <rect x="34" y="31" width="108" height="23" rx="12" fill="currentColor" opacity=".28" />
      </svg>
    );
  }

  return (
    <svg className={baseClass} viewBox="0 0 160 128" fill="none" aria-hidden="true">
      <path d="M80 24 123 41v30c0 27-18 43-43 53-25-10-43-26-43-53V41l43-17Z" fill="white" stroke="currentColor" strokeWidth="5" />
      <path d="m62 70 13 13 27-31" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
    </svg>
  );
}
