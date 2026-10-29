import { Activity, Archive, BadgeCheck, BellRing, ChevronRight, ClipboardList, Clock3, FileCheck2, FileSearch, FileText, Folder, LayoutGrid, LifeBuoy, Lightbulb, Package, ShieldCheck, UsersRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { getCachedCount, setCachedCount, unseenCount, type BadgeCategory } from "../pi/notifications";
import { prefetchPiList } from "../pi/piListCache";
import type { Role } from "../types";

// The home page is a workbench, not a menu of equal cards:
//   1. "Needs your attention" — the queues this role works, each with how many
//      items wait and how many of them are new since the user last looked.
//   2. One compact panel per area the role uses (Sales, After-sales, Commerce,
//      Administration), each a short list of the pages in that area.
// Each role sees only its own areas. SALES has no after-sales area: the tickets
// in their name show up as an attention item only while one is still open.

type Tone = "blue" | "green" | "cyan" | "violet" | "orange" | "indigo" | "teal" | "emerald";

// Solid gradient tiles with a white icon, the same style as the page headers
// (PageHero in components/Form.tsx), so an entry looks like the page it opens.
const toneClass: Record<Tone, string> = {
  blue: "bg-gradient-to-br from-[#3b7be8] to-[#0b4aa5] text-white shadow-md shadow-blue-900/15",
  green: "bg-gradient-to-br from-[#25b577] to-[#078754] text-white shadow-md shadow-emerald-900/15",
  cyan: "bg-gradient-to-br from-[#20a6c5] to-[#147b91] text-white shadow-md shadow-cyan-900/15",
  violet: "bg-gradient-to-br from-[#8b5cf6] to-[#6330c8] text-white shadow-md shadow-violet-900/15",
  orange: "bg-gradient-to-br from-[#fb923c] to-[#d95b0b] text-white shadow-md shadow-orange-900/15",
  indigo: "bg-gradient-to-br from-[#6276ea] to-[#3044b6] text-white shadow-md shadow-indigo-900/15",
  teal: "bg-gradient-to-br from-[#21b2b0] to-[#0f7f80] text-white shadow-md shadow-teal-900/15",
  emerald: "bg-gradient-to-br from-[#2fb36c] to-[#158044] text-white shadow-md shadow-green-900/15"
};

type Attention = {
  to: string;
  title: string;
  Icon: LucideIcon;
  tone: Tone;
  // Items waiting, and how many of them the user has not opened yet. A queue
  // shows the total; a feed (newly approved PIs) only has the new ones.
  total?: number;
  fresh: number;
  // What the number counts, e.g. "waiting".
  unit: string;
};

type Entry = { to: string; title: string; desc: string; Icon: LucideIcon; tone: Tone };
type Area = { id: string; title: string; entries: Entry[] };

// Totals are cached next to the unseen counts so the attention row paints at
// once from storage, then revalidates.
type Totals = Partial<Record<"reviews" | "commerce" | "newTickets" | "myOpenTickets", number>>;
const totalsKey = (userId: string | undefined) => `home-totals:${userId ?? "anon"}`;
function readTotals(userId: string | undefined): Totals {
  try {
    return JSON.parse(localStorage.getItem(totalsKey(userId)) ?? "{}") as Totals;
  } catch {
    return {};
  }
}
function writeTotals(userId: string | undefined, totals: Totals) {
  try {
    localStorage.setItem(totalsKey(userId), JSON.stringify(totals));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

const idsOf = (rows: unknown) => (Array.isArray(rows) ? (rows as { id: string }[]).map((r) => r.id) : []);

export function HomePage() {
  const { user } = useAuth();
  const role = user?.role;
  const userId = user?.id;
  const [totals, setTotals] = useState<Totals>(() => readTotals(userId));
  const [fresh, setFresh] = useState<Record<BadgeCategory, number>>(() => ({
    pendingReviews: getCachedCount("pendingReviews", userId),
    pendingCommerce: getCachedCount("pendingCommerce", userId),
    newTickets: getCachedCount("newTickets", userId),
    confirmedReceived: getCachedCount("confirmedReceived", userId)
  }));

  useEffect(() => {
    if (!role) return;
    let cancelled = false;
    const nextTotals: Totals = {};
    const nextFresh: Partial<Record<BadgeCategory, number>> = {};
    // A queue: its total, and how many the user has not opened (the badge).
    const queue = (url: string, params: Record<string, string> | undefined, total: keyof Totals, category: BadgeCategory) =>
      api
        .get(url, params ? { params } : undefined)
        .then((res) => {
          const ids = idsOf(res.data);
          nextTotals[total] = ids.length;
          nextFresh[category] = unseenCount(category, userId, ids);
        })
        .catch(() => {
          nextTotals[total] = 0;
          nextFresh[category] = 0;
        });

    const jobs: Promise<unknown>[] = [];
    if (role === "ADMIN" || role === "PRESALES") jobs.push(queue("/pi/review-queue", undefined, "reviews", "pendingReviews"));
    if (role === "ADMIN" || role === "COMMERCE") jobs.push(queue("/pi/commerce-queue", undefined, "commerce", "pendingCommerce"));
    // NEW tickets are the ones nobody has started on yet.
    if (role === "ADMIN" || role === "SERVICE") jobs.push(queue("/tickets", { status: "NEW" }, "newTickets", "newTickets"));
    if (role === "SALES") {
      // Sales read the tickets in their name; only the open ones matter here.
      jobs.push(
        api
          .get("/tickets/stats")
          .then((res) => {
            const byStatus = (res.data?.byStatus ?? []) as { status: string; n: number }[];
            nextTotals.myOpenTickets = byStatus.filter((s) => s.status === "NEW" || s.status === "IN_PROGRESS").reduce((a, s) => a + s.n, 0);
          })
          .catch(() => {
            nextTotals.myOpenTickets = 0;
          })
      );
    }
    if (role === "ADMIN" || role === "SALES") {
      jobs.push(
        api
          .get("/pi/approved", { params: { scope: "mine" } })
          .then((res) => {
            nextFresh.confirmedReceived = unseenCount("confirmedReceived", userId, idsOf(res.data?.items));
          })
          .catch(() => {
            nextFresh.confirmedReceived = 0;
          })
      );
      // Warm both PI workspace lists so the first jump from home paints instantly.
      void prefetchPiList(userId, "EN");
      void prefetchPiList(userId, "ZH");
    }

    void Promise.all(jobs).then(() => {
      if (cancelled) return;
      setTotals(nextTotals);
      writeTotals(userId, nextTotals);
      setFresh((prev) => ({ ...prev, ...nextFresh }));
      for (const [category, n] of Object.entries(nextFresh)) setCachedCount(category as BadgeCategory, userId, n);
    });
    return () => {
      cancelled = true;
    };
  }, [role, userId]);

  const attention = attentionFor(role, totals, fresh);
  const areas = areasFor(role);
  const waiting = attention.reduce((acc, a) => acc + (a.total ?? a.fresh), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#07183f]">Hello, {user?.displayName}</h1>
          <p className="mt-1 text-sm text-[#617295]">
            {attention.length === 0 ? "Pick where to continue." : waiting > 0 ? "Here is what is waiting for you." : "Nothing is waiting for you right now."}
          </p>
        </div>
        <div className="text-sm text-[#8193b8]">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
      </div>

      {attention.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Needs your attention</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {attention.map((a) => (
              <AttentionTile key={a.to} item={a} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionTitle>Workspaces</SectionTitle>
        <div className={`grid grid-cols-1 gap-4 ${areas.length >= 3 ? "lg:grid-cols-3" : areas.length === 2 ? "md:grid-cols-2" : ""}`}>
          {areas.map((area) => (
            <AreaPanel key={area.id} area={area} wide={areas.length === 1} />
          ))}
        </div>
      </section>
    </div>
  );
}

function attentionFor(role: Role | undefined, totals: Totals, fresh: Record<BadgeCategory, number>): Attention[] {
  const reviews: Attention = { to: "/reviews", title: "Pending Reviews", Icon: Clock3, tone: "orange", total: totals.reviews, fresh: fresh.pendingReviews, unit: "waiting" };
  const commerce: Attention = { to: "/commerce", title: role === "COMMERCE" ? "Commerce Approval" : "Commerce Queue", Icon: BadgeCheck, tone: "violet", total: totals.commerce, fresh: fresh.pendingCommerce, unit: "waiting" };
  const tickets: Attention = { to: "/tickets", title: "New Tickets", Icon: LifeBuoy, tone: "teal", total: totals.newTickets, fresh: fresh.newTickets, unit: "not started" };
  const approved: Attention = { to: "/pi/confirmed-received", title: "Newly Approved PIs", Icon: ShieldCheck, tone: "cyan", fresh: fresh.confirmedReceived, unit: "new" };
  switch (role) {
    case "ADMIN":
      return [reviews, commerce, tickets, approved];
    case "SALES": {
      const items = [approved];
      // Only while a customer of theirs has an open ticket; otherwise sales have no after-sales entry at all.
      if (totals.myOpenTickets) {
        items.push({ to: "/tickets", title: "Customer Tickets", Icon: LifeBuoy, tone: "teal", total: totals.myOpenTickets, fresh: 0, unit: "open" });
      }
      return items;
    }
    case "PRESALES":
      return [reviews];
    case "COMMERCE":
      return [commerce];
    case "SERVICE":
      return [tickets];
    default:
      return [];
  }
}

function areasFor(role: Role | undefined): Area[] {
  const sales: Area = {
    id: "sales",
    title: "Sales",
    entries: [
      { to: "/pi/en", title: "English PI", desc: "Create English proforma invoices", Icon: FileText, tone: "blue" },
      { to: "/pi/zh", title: "Chinese PI", desc: "Create Chinese PIs for presales and commerce approval", Icon: FileCheck2, tone: "green" },
      { to: "/pi/confirmed-received", title: "Confirmed Received PIs", desc: "Approved Chinese PIs you created or received", Icon: ShieldCheck, tone: "cyan" },
      { to: "/contracts", title: "Contract Templates", desc: "Download shared contract files", Icon: Folder, tone: "violet" }
    ]
  };
  const lookup: Entry = { to: "/pi/approved", title: "Approved PI Lookup", desc: "Find the approved Chinese PI for a customer, order or SN", Icon: FileSearch, tone: "cyan" };
  const afterSales: Area = {
    id: "after-sales",
    title: "After-Sales",
    entries: [
      { to: "/tickets", title: "Tickets", desc: "Service requests from Feishu and the team", Icon: LifeBuoy, tone: "teal" },
      { to: "/fault-analytics", title: "Fault Analytics", desc: "Repeat faults by product, fault types and alerts", Icon: Activity, tone: "orange" },
      lookup,
      // After-sales settings live with after-sales, but the pages are admin-only.
      ...(role === "ADMIN"
        ? [
            { to: "/ticket-fields-config", title: "Ticket Questionnaire", desc: "Questions on the New ticket form", Icon: ClipboardList, tone: "blue" } as Entry,
            { to: "/ticket-notifications", title: "Ticket Notifications", desc: "After-sales group and update reminders", Icon: BellRing, tone: "violet" } as Entry
          ]
        : [])
    ]
  };
  const admin: Area = {
    id: "admin",
    title: "Administration",
    entries: [
      { to: "/products", title: "Products", desc: "Catalog, pricing and field mapping", Icon: Package, tone: "indigo" },
      { to: "/permissions", title: "Users & Permissions", desc: "Accounts, roles and Feishu links", Icon: UsersRound, tone: "teal" },
      { to: "/excel-templates", title: "Excel Templates", desc: "PI header templates by language", Icon: LayoutGrid, tone: "emerald" },
      { to: "/requirement-pool", title: "Requirement Pool", desc: "Product requests to the Feishu table", Icon: Lightbulb, tone: "orange" }
    ]
  };
  switch (role) {
    case "ADMIN":
      return [sales, afterSales, admin];
    case "SALES":
      return [sales];
    case "SERVICE":
      return [afterSales];
    case "PRESALES":
      return [{ id: "presales", title: "Presales", entries: [lookup] }];
    case "COMMERCE":
      return [
        {
          id: "commerce",
          title: "Commerce",
          entries: [
            { to: "/pi/approved", title: "Approved PIs", desc: "Search approved PIs and download Chinese and English Excel", Icon: Archive, tone: "cyan" },
            { to: "/contracts", title: "Contract Templates", desc: "Download shared contract files", Icon: Folder, tone: "violet" }
          ]
        }
      ];
    default:
      return [];
  }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7184ab]">{children}</h2>;
}

function AttentionTile({ item }: { item: Attention }) {
  const { to, title, Icon, tone, total, fresh, unit } = item;
  const count = total ?? fresh;
  const idle = count === 0;
  return (
    <Link
      to={to}
      className={`group flex items-center gap-4 rounded-lg border bg-white p-4 shadow-[0_10px_30px_rgba(8,36,107,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(8,36,107,0.11)] ${idle ? "border-[#e6ecf7]" : "border-[#d5e1f8]"}`}
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${idle ? "bg-[#f2f5fb] text-[#9aa8c4]" : toneClass[tone]}`}>
        <Icon size={21} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[#294477]">{title}</span>
        <span className="mt-0.5 flex items-baseline gap-2">
          {idle ? (
            <span className="text-sm text-[#9aa8c4]">All clear</span>
          ) : (
            <>
              <span className="text-2xl font-semibold leading-none text-[#07183f]">{count > 99 ? "99+" : count}</span>
              <span className="text-xs text-[#7184ab]">{unit}</span>
              {total !== undefined && fresh > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{fresh} new</span>
              )}
            </>
          )}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-[#a3b2cf] transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

function AreaPanel({ area, wide }: { area: Area; wide: boolean }) {
  return (
    <div className="rounded-lg border border-[#e1e9f8] bg-white p-2 shadow-[0_10px_30px_rgba(8,36,107,0.05)]">
      <div className="px-3 pb-1 pt-2 text-sm font-semibold text-[#07183f]">{area.title}</div>
      <div className={wide ? "grid grid-cols-1 md:grid-cols-2" : ""}>
        {area.entries.map(({ to, title, desc, Icon, tone }) => (
          <Link key={to + title} to={to} className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition hover:bg-[#f3f7ff]">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${toneClass[tone]}`}>
              <Icon size={18} strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[#07183f]">{title}</span>
              <span className="block truncate text-xs text-[#7184ab]">{desc}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-[#b3c0da] transition group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </div>
  );
}
