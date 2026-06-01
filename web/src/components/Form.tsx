import type { LucideIcon } from "lucide-react";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-[#294477]">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function PageHero({
  title,
  eyebrow,
  description,
  Icon,
  action
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  Icon?: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-hero">
      <div className="page-hero-art page-hero-art-one" />
      <div className="page-hero-art page-hero-art-two" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-2xl items-start gap-4">
          {Icon && (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3b7be8] to-[#0b4aa5] text-white shadow-lg shadow-blue-900/15">
              <Icon size={25} strokeWidth={1.9} />
            </span>
          )}
          <div>
            {eyebrow && <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</div>}
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#07183f]">{title}</h1>
            {description && <p className="mt-2 text-sm leading-6 text-[#63749b]">{description}</p>}
            <div className="mt-5 h-1 w-14 rounded-full bg-primary" />
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf2fb] pb-4">
        <h2 className="text-lg font-semibold tracking-tight text-[#07183f]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#cfdcf2] bg-[#f8fbff] px-4 py-6 text-center">
      <div className="text-sm font-semibold text-[#294477]">{title}</div>
      <div className="mt-1 text-sm text-[#63749b]">{description}</div>
    </div>
  );
}

export function ErrorText({ message }: { message?: string }) {
  return message ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div> : null;
}
