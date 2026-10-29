import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

// On-page replacement for the browser confirm dialog: the in-app browsers the portal is
// used in (Claude desktop, Feishu) block browser dialogs, so confirm() silently
// returns false there. `await confirm(...)` resolves true on Confirm, false on
// Cancel / Esc / clicking the backdrop.
export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    const opts = typeof options === "string" ? { message: options } : options;
    // Only one dialog at a time; a newer request cancels the older one.
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...opts, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/30 px-4" onClick={() => close(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title ?? "Confirm"}
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {pending.title && <h3 className="mb-2 text-lg font-semibold text-[#07183f]">{pending.title}</h3>}
            <p className="whitespace-pre-line text-sm text-[#405079]">{pending.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => close(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button type="button" autoFocus className={pending.danger ? "btn-danger" : "btn-primary"} onClick={() => close(true)}>
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}
