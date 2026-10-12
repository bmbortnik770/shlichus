import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Icon } from './icons';

/* ---------- toast עם ביטול ---------- */
interface ToastState {
  text: string | null;
  undo: (() => void) | null;
  show: (text: string, undo?: () => void) => void;
  hide: () => void;
}
let timer: ReturnType<typeof setTimeout> | undefined;
export const useToast = create<ToastState>((set) => ({
  text: null,
  undo: null,
  show: (text, undo) => {
    clearTimeout(timer);
    set({ text, undo: undo ?? null });
    // עם ביטול — יותר זמן להתחרט
    timer = setTimeout(() => set({ text: null, undo: null }), undo ? 10000 : 5000);
  },
  hide: () => set({ text: null, undo: null }),
}));

export function ToastHost() {
  const { text, undo, hide } = useToast();
  if (!text) return null;
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      {undo && <button onClick={() => { undo(); hide(); }}>ביטול</button>}
    </div>
  );
}

/* ---------- דיאלוג ---------- */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('textarea, input, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="ib" onClick={onClose} aria-label="סגירה"><Icon name="x" size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- העתקה ללוח ---------- */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return { copied, copy };
}

/* ---------- אישור פעולה (במקום confirm של הדפדפן) ---------- */
interface ConfirmState {
  req: { title: string; message: string; confirm: string; danger: boolean; resolve: (ok: boolean) => void } | null;
  ask: (opts: { title: string; message: string; confirm?: string; danger?: boolean }) => Promise<boolean>;
}
export const useConfirm = create<ConfirmState>((set) => ({
  req: null,
  ask: ({ title, message, confirm = 'אישור', danger = false }) =>
    new Promise<boolean>((resolve) => set({ req: { title, message, confirm, danger, resolve } })),
}));

export function ConfirmHost() {
  const req = useConfirm((s) => s.req);
  if (!req) return null;
  const done = (ok: boolean) => { req.resolve(ok); useConfirm.setState({ req: null }); };
  return (
    <Dialog title={req.title} onClose={() => done(false)}>
      <p style={{ margin: 0 }}>{req.message}</p>
      <div className="dialog-acts">
        <button className="btn" onClick={() => done(false)}>ביטול</button>
        <button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)}>{req.confirm}</button>
      </div>
    </Dialog>
  );
}
