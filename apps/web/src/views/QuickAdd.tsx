import { useMemo, useState } from 'react';
import { type Db, type FamilyRef, addFamily, addTask, displayName, getInteractionTypes, listFamilies, makeLog, updateFamily, getBuilding } from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useToast } from '../ui';
import { useNav } from '../nav';

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** כפתור הוספה מהירה מכל מסך: משפחה, משימה, תיעוד */
export function QuickAdd({ db }: { db: Db }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState<'task' | 'log' | null>(null);

  const newFamily = () => {
    setOpen(false);
    let ref: FamilyRef | null = null;
    mutate((d) => { ref = addFamily(d, ''); });
    if (ref) useNav.getState().openFamily(ref);
  };

  return (
    <>
      <div className={`qa${open ? ' open' : ''}`}>
        {open && (
          <div className="qa-menu" role="menu">
            <button role="menuitem" onClick={newFamily}><Icon name="users" size={16} />משפחה חדשה</button>
            <button role="menuitem" onClick={() => { setOpen(false); setDlg('task'); }}><Icon name="tasks" size={16} />משימה</button>
            <button role="menuitem" onClick={() => { setOpen(false); setDlg('log'); }}><Icon name="chat" size={16} />תיעוד קשר</button>
          </div>
        )}
        <button className="qa-btn" aria-label="הוספה מהירה" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? 'x' : 'plus'} size={24} /></button>
      </div>
      {dlg && <QuickDialog db={db} kind={dlg} onClose={() => setDlg(null)} onDone={(msg, undo) => { toast(msg, undo); setDlg(null); }} />}
    </>
  );
}

function QuickDialog({ db, kind, onClose, onDone }: { db: Db; kind: 'task' | 'log'; onClose: () => void; onDone: (msg: string, undo: () => void) => void }) {
  const mutate = useStore((s) => s.mutate);
  const fams = useMemo(() => listFamilies(db).map((r) => ({ ref: { bldg: r.bldg, idx: r.idx }, name: displayName(r.apt) })).filter((f) => f.name), [db]);
  const types = getInteractionTypes(db.__SETTINGS__);
  const [who, setWho] = useState('');
  const [text, setText] = useState('');
  const [date, setDate] = useState(kind === 'log' ? todayIso() : '');
  const [type, setType] = useState(types.find((t) => t.key === 'call')?.key ?? types[0]?.key ?? 'other');
  const fam = fams.find((f) => f.name === who.trim());
  const ok = text.trim() && (kind === 'task' || fam);

  const submit = () => {
    if (!ok) return;
    if (kind === 'task') {
      const undo = mutate((d) => addTask(d, text.trim(), date, fam?.ref));
      onDone(fam ? `נוספה משימה ל${fam.name}` : 'נוספה משימה', undo);
    } else {
      const undo = mutate((d) => {
        const apt = getBuilding(d, fam!.ref.bldg)?.apts[fam!.ref.idx];
        if (apt) updateFamily(d, fam!.ref, { interactions: [makeLog(d.__SETTINGS__, { date, typeKey: type, text: text.trim() }), ...(apt.interactions ?? [])] });
      });
      onDone(`התיעוד נשמר אצל ${fam!.name}`, undo);
    }
  };

  return (
    <Dialog title={kind === 'task' ? 'משימה חדשה' : 'תיעוד קשר'} onClose={onClose}>
      <form className="ev-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="fld"><span>{kind === 'task' ? 'משפחה (לא חובה)' : 'משפחה'}</span>
          <input list="qa-fams" value={who} onChange={(e) => setWho(e.target.value)} placeholder="הקלד שם משפחה" />
          <datalist id="qa-fams">{fams.map((f, i) => <option key={i} value={f.name} />)}</datalist>
        </label>
        {who.trim() && !fam && <p className="sheet-hint">{kind === 'task' ? 'לא נמצאה משפחה בשם הזה — המשימה תהיה כללית.' : 'צריך לבחור משפחה מהרשימה.'}</p>}
        {kind === 'log' && (
          <label className="fld"><span>סוג</span><select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
        )}
        <label className="fld"><span>{kind === 'task' ? 'מה לעשות' : 'מה היה'}</span>
          {kind === 'task' ? <input value={text} onChange={(e) => setText(e.target.value)} /> : <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
        </label>
        <label className="fld"><span>{kind === 'task' ? 'תאריך יעד (לא חובה)' : 'תאריך'}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="dialog-acts"><button type="button" className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" disabled={!ok}>שמירה</button></div>
      </form>
    </Dialog>
  );
}
