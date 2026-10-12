import { useMemo, useState } from 'react';
import {
  type Board, type Db, type FamilyRef, type TaskGroup, type TaskRow, addTask, displayName, getBuilding,
  listFamilies, listTasks, setTaskDone, taskGroup, updateFamily,
} from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useConfirm, useToast } from '../ui';
import { FamilyCard } from './FamilyCard';
import '../community.css';
import '../tasks.css';

const GROUPS: { key: TaskGroup; label: string }[] = [
  { key: 'overdue', label: 'באיחור' }, { key: 'today', label: 'היום' }, { key: 'week', label: 'השבוע' },
  { key: 'later', label: 'בהמשך' }, { key: 'nodate', label: 'בלי תאריך' }, { key: 'done', label: 'בוצעו' },
];
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : '');

export function Tasks({ db }: { db: Db }) {
  const [tab, setTab] = useState<'list' | 'boards'>('list');
  const [open, setOpen] = useState<FamilyRef | null>(null);
  const boards = (db.__BOARDS__ ?? []).filter((b) => !b.archived);
  return (
    <>
      <section className="hello">
        <div>
          <h1>משימות</h1>
          <p className="lede">משימות כלליות ומשימות של משפחות במקום אחד, ולוחות לפרויקטים.</p>
        </div>
        <div className="seg" role="tablist" aria-label="תצוגה">
          <button role="tab" aria-pressed={tab === 'list'} onClick={() => setTab('list')}>רשימה</button>
          <button role="tab" aria-pressed={tab === 'boards'} onClick={() => setTab('boards')}>לוחות פרויקטים{boards.length ? ` · ${boards.length}` : ''}</button>
        </div>
      </section>
      {tab === 'list' ? <TaskList db={db} onOpen={setOpen} /> : <Boards db={db} onOpen={setOpen} />}
      {open && getBuilding(db, open.bldg)?.apts[open.idx] && <FamilyCard db={db} fref={open} onClose={() => setOpen(null)} onMoved={setOpen} />}
    </>
  );
}

/* ───────── רשימת משימות ───────── */

function TaskList({ db, onOpen }: { db: Db; onOpen: (r: FamilyRef) => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const [text, setText] = useState('');
  const [due, setDue] = useState(todayIso());
  const [fam, setFam] = useState('');
  const [showDone, setShowDone] = useState(false);

  const tasks = useMemo(() => listTasks(db), [db]);
  const families = useMemo(() => listFamilies(db).map((r) => ({ ref: { bldg: r.bldg, idx: r.idx }, name: displayName(r.apt) })).filter((f) => f.name), [db]);
  const byGroup = useMemo(() => {
    const m = new Map<TaskGroup, TaskRow[]>();
    for (const t of tasks) { const g = taskGroup(t); m.set(g, [...(m.get(g) ?? []), t]); }
    for (const list of m.values()) list.sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
    return m;
  }, [tasks]);
  const openCount = tasks.filter((t) => !t.done).length;

  const famRef = families.find((f) => f.name === fam.trim())?.ref;
  const add = () => {
    if (!text.trim()) return;
    const undo = mutate((d) => addTask(d, text.trim(), due, famRef));
    toast(famRef ? `המשימה נוספה ל${fam}` : 'המשימה נוספה', undo);
    setText(''); setFam('');
  };
  const toggle = (t: TaskRow) => {
    const undo = mutate((d) => setTaskDone(d, t, !t.done));
    if (!t.done) toast('כל הכבוד! המשימה סומנה כבוצעה', undo);
  };

  return (
    <>
      <form className="panel task-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="משימה חדשה" aria-label="משימה חדשה" />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="תאריך יעד" />
        <input list="fam-list" value={fam} onChange={(e) => setFam(e.target.value)} placeholder="משפחה (לא חובה)" aria-label="משפחה" />
        <datalist id="fam-list">{families.map((f, i) => <option key={i} value={f.name} />)}</datalist>
        <button className="btn btn-primary" disabled={!text.trim()}><Icon name="plus" size={16} />הוספה</button>
        {fam.trim() && !famRef && <span className="err">לא נמצאה משפחה בשם הזה. המשימה תישמר ככללית.</span>}
      </form>

      {openCount === 0 && <section className="panel empty-state">אין משימות פתוחות. יום רגוע!</section>}

      {GROUPS.map((g) => {
        const list = byGroup.get(g.key) ?? [];
        if (!list.length || (g.key === 'done' && !showDone)) return null;
        return (
          <section key={g.key} className={`panel task-group tg-${g.key}`}>
            <h2>{g.label} <span className="num">{list.length}</span></h2>
            <ul>
              {list.map((t) => (
                <li key={t.id} className={t.done ? 'done' : ''}>
                  <button className="check" aria-pressed={t.done} aria-label={t.done ? 'סמן כלא בוצעה' : 'סמן כבוצעה'} onClick={() => toggle(t)}><Icon name="done" size={14} /></button>
                  <span className="tx">{t.text}</span>
                  {t.family && <button className="chip-f" onClick={() => onOpen(t.family!)}>{t.family.name}</button>}
                  {t.due && <span className="meta">{fmt(t.due)}</span>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {(byGroup.get('done') ?? []).length > 0 && (
        <button className="link" onClick={() => setShowDone(!showDone)}>{showDone ? 'הסתרת משימות שבוצעו' : `הצגת ${byGroup.get('done')!.length} משימות שבוצעו`}</button>
      )}
    </>
  );
}

/* ───────── לוחות פרויקטים ───────── */

function Boards({ db, onOpen }: { db: Db; onOpen: (r: FamilyRef) => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const ask = useConfirm((s) => s.ask);
  const boards = (db.__BOARDS__ ?? []).filter((b) => !b.archived);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const [dlg, setDlg] = useState<'new' | 'cols' | null>(null);
  const [adding, setAdding] = useState('');
  const board: Board | undefined = boards.find((b) => b.id === boardId) ?? boards[0];

  const families = useMemo(() => listFamilies(db).filter((r) => displayName(r.apt)), [db]);
  const cards = useMemo(() => (board ? families.filter((r) => ((r.apt.boards ?? {}) as Record<string, string>)[board.id]) : []), [families, board]);

  const setBoards = (fn: (all: Board[]) => Board[]) => mutate((d) => { d.__BOARDS__ = fn(d.__BOARDS__ ?? []); });
  const move = (ref: FamilyRef, stage: string) => mutate((d) => {
    const a = getBuilding(d, ref.bldg)?.apts[ref.idx];
    if (a && board) updateFamily(d, ref, { boards: { ...((a.boards ?? {}) as Record<string, string>), [board.id]: stage } });
  });
  const removeCard = (ref: FamilyRef, name: string) => {
    const undo = mutate((d) => {
      const a = getBuilding(d, ref.bldg)?.apts[ref.idx];
      if (!a || !board) return;
      const b = { ...((a.boards ?? {}) as Record<string, string>) };
      delete b[board.id];
      updateFamily(d, ref, { boards: b });
    });
    toast(`${name} הוסרה מהלוח`, undo);
  };
  const addCard = () => {
    const r = families.find((f) => displayName(f.apt) === adding.trim());
    if (!r || !board) return;
    move({ bldg: r.bldg, idx: r.idx }, board.columns[0] ?? '');
    setAdding('');
  };

  return (
    <>
      <div className="com-bar">
        {boards.length > 0 && (
          <select className="sel" value={board?.id ?? ''} onChange={(e) => setBoardId(e.target.value)} aria-label="לוח">
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <button className="btn btn-primary" onClick={() => setDlg('new')}><Icon name="plus" size={16} />לוח חדש</button>
        {board && <button className="btn" onClick={() => setDlg('cols')}>עריכת שלבים</button>}
        {board && (
          <button className="btn" onClick={() => void (async () => {
            if (!(await ask({ title: 'העברה לארכיון', message: `להעביר את הלוח "${board.name}" לארכיון? המשפחות לא נמחקות.`, confirm: 'לארכיון' }))) return;
            const undo = setBoards((all) => all.map((b) => (b.id === board.id ? { ...b, archived: true, updatedAt: Date.now() } : b)));
            toast('הלוח הועבר לארכיון', undo);
          })()}>ארכיון</button>
        )}
      </div>

      {!board ? <section className="panel empty-state">עוד אין לוחות. לוח עוזר לעקוב אחרי פרויקט, למשל "הנחת תפילין" או "חלוקת משלוחי מנות".</section> : (
        <>
          <form className="board-add" onSubmit={(e) => { e.preventDefault(); addCard(); }}>
            <input list="board-fams" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="הוספת משפחה ללוח" aria-label="הוספת משפחה ללוח" />
            <datalist id="board-fams">{families.filter((f) => !cards.includes(f)).map((f, i) => <option key={i} value={displayName(f.apt)} />)}</datalist>
            <button className="btn" disabled={!adding.trim()}>הוספה</button>
          </form>
          <div className="kanban">
            {board.columns.map((col) => {
              const inCol = cards.filter((c) => ((c.apt.boards ?? {}) as Record<string, string>)[board.id] === col);
              return (
                <section key={col} className="kcol" onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); const i = k.lastIndexOf('|'); if (i > 0) move({ bldg: k.slice(0, i), idx: Number(k.slice(i + 1)) }, col); }}>
                  <h3>{col} <span className="num">{inCol.length}</span></h3>
                  {inCol.map((c) => (
                    <article key={`${c.bldg}|${c.idx}`} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', `${c.bldg}|${c.idx}`)}>
                      <button className="link" onClick={() => onOpen(c)}>{displayName(c.apt)}</button>
                      <div className="kcard-acts">
                        <select value={col} onChange={(e) => move(c, e.target.value)} aria-label={`שלב של ${displayName(c.apt)}`}>
                          {board.columns.map((s) => <option key={s}>{s}</option>)}
                        </select>
                        <button className="ib" onClick={() => removeCard(c, displayName(c.apt))} aria-label="הסרה מהלוח"><Icon name="x" size={13} /></button>
                      </div>
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        </>
      )}

      {dlg === 'new' && (
        <BoardDialog title="לוח חדש" initialName="" initialCols={['מתעניין חדש', 'בטיפול', 'פעיל קבוע', 'לא רלוונטי']} onClose={() => setDlg(null)}
          onSave={(name, columns) => {
            const b: Board = { id: `b_${Date.now()}`, name, columns, archived: false, updatedAt: Date.now() };
            setBoards((all) => [...all, b]);
            setBoardId(b.id); setDlg(null);
          }} />
      )}
      {dlg === 'cols' && board && (
        <BoardDialog title="עריכת לוח" initialName={board.name} initialCols={board.columns} onClose={() => setDlg(null)}
          onSave={(name, columns) => {
            const undo = setBoards((all) => all.map((b) => (b.id === board.id ? { ...b, name, columns, updatedAt: Date.now() } : b)));
            toast('הלוח עודכן', undo); setDlg(null);
          }} />
      )}
    </>
  );
}

function BoardDialog({ title, initialName, initialCols, onClose, onSave }: { title: string; initialName: string; initialCols: string[]; onClose: () => void; onSave: (name: string, cols: string[]) => void }) {
  const [name, setName] = useState(initialName);
  const [cols, setCols] = useState<string[]>(initialCols);
  const clean = cols.map((c) => c.trim()).filter(Boolean);
  return (
    <Dialog title={title} onClose={onClose}>
      <label className="fld"><span>שם הלוח</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="fld"><span>שלבים</span>
        {cols.map((c, i) => (
          <div className="fc-row" key={i} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
            <input value={c} onChange={(e) => setCols((a) => a.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`שלב ${i + 1}`} />
            <button className="ib" type="button" onClick={() => setCols((a) => a.filter((_, j) => j !== i))} aria-label="הסרת שלב"><Icon name="x" size={13} /></button>
          </div>
        ))}
        <button className="btn" type="button" onClick={() => setCols((a) => [...a, ''])}><Icon name="plus" size={15} />שלב</button>
      </div>
      <div className="dialog-acts"><button className="btn" onClick={onClose}>ביטול</button><button className="btn btn-primary" disabled={!name.trim() || !clean.length} onClick={() => onSave(name.trim(), clean)}>שמירה</button></div>
    </Dialog>
  );
}
