export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm font-medium text-slate-700"><span>{label}</span>{children}</label>;
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="card space-y-4"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2>{action}</div>{children}</section>;
}

export function ErrorText({ message }: { message?: string }) {
  return message ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div> : null;
}
