import { create } from 'zustand';

/** מערכת דיאלוגים מעוצבת — מחליפה את prompt/confirm/alert של הדפדפן,
    כמו showCustomDialog במערכת הישנה. */

export interface DialogField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'checkbox' | 'number';
  options?: { value: string; label: string }[];
  value?: string | boolean;
  placeholder?: string;
}

interface DialogSpec {
  title: string;
  message?: string;
  fields?: DialogField[];
  confirmLabel?: string;
  showCancel?: boolean;
  danger?: boolean;
}

interface DialogState {
  spec: DialogSpec | null;
  values: Record<string, string | boolean>;
  resolve: ((v: Record<string, string | boolean> | null) => void) | null;
  open: (spec: DialogSpec) => Promise<Record<string, string | boolean> | null>;
  setValue: (k: string, v: string | boolean) => void;
  close: (ok: boolean) => void;
}

export const useDialog = create<DialogState>((set, get) => ({
  spec: null,
  values: {},
  resolve: null,
  open: (spec) =>
    new Promise((resolve) => {
      const values: Record<string, string | boolean> = {};
      (spec.fields ?? []).forEach((f) => { values[f.key] = f.value ?? (f.type === 'checkbox' ? false : ''); });
      set({ spec, values, resolve });
    }),
  setValue: (k, v) => set((s) => ({ values: { ...s.values, [k]: v } })),
  close: (ok) => {
    const { resolve, values } = get();
    set({ spec: null, resolve: null });
    resolve?.(ok ? values : null);
  },
}));

/** ‏API נוח: אישור (מחזיר true/false) */
export async function confirmDialog(title: string, message?: string, danger = false): Promise<boolean> {
  const r = await useDialog.getState().open({ title, message, showCancel: true, danger, confirmLabel: danger ? 'מחיקה' : 'אישור' });
  return r !== null;
}

/** ‏API נוח: קלט טקסט יחיד (מחזיר מחרוזת או null) */
export async function promptDialog(title: string, label: string, value = ''): Promise<string | null> {
  const r = await useDialog.getState().open({
    title, showCancel: true,
    fields: [{ key: 'v', label, type: 'text', value }],
  });
  const v = r?.v;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** ‏API נוח: הודעה בלבד */
export function alertDialog(title: string, message?: string): Promise<unknown> {
  return useDialog.getState().open({ title, message });
}

/** טופס מלא */
export function formDialog(spec: DialogSpec): Promise<Record<string, string | boolean> | null> {
  return useDialog.getState().open({ ...spec, showCancel: true });
}

/** המארח — מרונדר פעם אחת ב-App */
export function DialogHost() {
  const { spec, values, setValue, close } = useDialog();
  if (!spec) return null;
  return (
    <div className="drawer-backdrop" style={{ zIndex: 200 }} onClick={() => close(false)}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3 className="dlg-title">{spec.title}</h3>
        {spec.message && <p className="dlg-msg">{spec.message}</p>}
        {(spec.fields ?? []).map((f) => (
          <label className="edit-field" key={f.key}>
            {f.type !== 'checkbox' && <span>{f.label}</span>}
            {f.type === 'select' ? (
              <select className="board-select" value={String(values[f.key] ?? '')} onChange={(e) => setValue(f.key, e.target.value)}>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!values[f.key]} onChange={(e) => setValue(f.key, e.target.checked)} />
                {f.label}
              </span>
            ) : (
              <input
                type={f.type} autoFocus={f === (spec.fields ?? [])[0]}
                value={String(values[f.key] ?? '')} placeholder={f.placeholder}
                onChange={(e) => setValue(f.key, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') close(true); }}
              />
            )}
          </label>
        ))}
        <div className="edit-actions" style={{ marginTop: 14 }}>
          <button
            className="save-btn"
            style={spec.danger ? { background: 'var(--danger)' } : undefined}
            onClick={() => close(true)}
          >
            {spec.confirmLabel ?? 'אישור'}
          </button>
          {spec.showCancel && <button className="cancel-btn" onClick={() => close(false)}>ביטול</button>}
        </div>
      </div>
    </div>
  );
}
