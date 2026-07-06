import { useMemo, useState } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';
import { useCrm } from './store';

interface TaskRow {
  text: string;
  due: string;
  done: boolean;
  source: string; // שם משפחה או "כללית"
  toggle: () => void;
}

export function TasksView({ db, onOpenFamily }: { db: Db; onOpenFamily?: (q: string) => void }) {
  const updateApt = useCrm((s) => s.updateApt);
  const updateGeneralTask = useCrm((s) => s.updateGeneralTask);
  const addGeneralTask = useCrm((s) => s.addGeneralTask);
  const [newText, setNewText] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));

  const add = async () => {
    if (!newText.trim()) return;
    await addGeneralTask(newText.trim(), newDate);
    setNewText('');
  };

  const rows = useMemo(() => {
    const out: TaskRow[] = [];
    // משימות כלליות (כולל כאלה שהגיעו מאפליקציית השטח)
    const general = (db.meta?.generalTasks ?? []) as { text?: string; date?: string; done?: boolean }[];
    general.forEach((t, i) => {
      out.push({
        text: String(t.text ?? ''),
        due: String(t.date ?? ''),
        done: !!t.done,
        source: 'כללית',
        toggle: () => void updateGeneralTask(i, !t.done),
      });
    });
    // משימות פר-משפחה
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        const idx = entry.apts.indexOf(a);
        (a.tasks ?? []).forEach((t, ti) => {
          out.push({
            text: String(t.text ?? ''),
            due: String(t.due ?? t.date ?? ''),
            done: !!t.done,
            source: a.name || key,
            toggle: () => {
              const tasks = (a.tasks ?? []).map((x, xi) => (xi === ti ? { ...x, done: !t.done } : x));
              void updateApt(key, idx, { tasks });
            },
          });
        });
      });
    }
    // פתוחות קודם, אחר כך לפי תאריך
    return out.sort((a, b) => Number(a.done) - Number(b.done) || a.due.localeCompare(b.due));
  }, [db, updateApt, updateGeneralTask]);

  const open = rows.filter((r) => !r.done).length;

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title"><i className="fas fa-check-double" /> מרכז משימות חכם</h2>
        <span className="count">{open} פתוחות מתוך {rows.length}</span>
      </div>
      <div className="quick-add" style={{ marginBottom: 14 }}>
        <div className="quick-add-row">
          <input
            placeholder="הקלד משימה חדשה…"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          />
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ maxWidth: 155 }} />
          <button className="edit-btn" disabled={!newText.trim()} onClick={() => void add()}>
            <i className="fas fa-plus" /> הוסף משימה
          </button>
        </div>
      </div>
      <h3 className="section-title"><i className="fas fa-inbox" /> כל המשימות הפתוחות במערכת</h3>
      {rows.length === 0 ? (
        <p className="placeholder">אין משימות עדיין.</p>
      ) : (
        <ul className="task-list">
          {rows.map((r, i) => (
            <li key={i} className={r.done ? 'task done' : 'task'}>
              <label>
                <input type="checkbox" checked={r.done} onChange={r.toggle} />
                <span className="task-text">{r.text}</span>
              </label>
              <span className="task-meta">
                {r.source === 'כללית' ? (
                  'כללית'
                ) : (
                  <button className="fam-chip" onClick={() => onOpenFamily?.(r.source)}>
                    <i className="fas fa-user" /> {r.source}
                  </button>
                )}
                {r.due ? ` · ${r.due}` : ' · ללא תאריך יעד'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
