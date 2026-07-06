import { useEffect, useMemo, useRef, useState } from 'react';
import { type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';

interface Command {
  label: string;
  sub: string;
  icon: string;
  run: () => void;
}

interface Props {
  db: Db | null;
  onNavigate: (view: string) => void;
  onOpenFamily: (query: string) => void;
  onToggleDark: () => void;
  onSync: () => void;
  onClose: () => void;
}

/** Command Palette — ‏Ctrl+K, כמו palette.js במערכת הקיימת */
export function CommandPalette({ db, onNavigate, onOpenFamily, onToggleDark, onSync, onClose }: Props) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { label: 'מפה', sub: 'נווט לתצוגת מפה', icon: 'fa-map-marker-alt', run: () => onNavigate('map') },
      { label: 'רשימת משפחות', sub: 'אינדקס קהילה', icon: 'fa-users', run: () => onNavigate('table') },
      { label: 'מרכז פעילות', sub: 'משימות · אירועים · קנבן · מעגלים', icon: 'fa-bolt', run: () => onNavigate('activity') },
      { label: 'מרכז תקשורת', sub: 'WhatsApp · מייל', icon: 'fa-bullhorn', run: () => onNavigate('comm') },
      { label: 'תרומות', sub: 'כל התרומות', icon: 'fa-hand-holding-heart', run: () => onNavigate('donations') },
      { label: 'הגדרות', sub: 'תגיות, סגנונות, תבניות, גיבוי', icon: 'fa-cog', run: () => onNavigate('settings') },
      { label: 'סנכרן עם הענן', sub: 'משיכת נתונים עדכניים', icon: 'fa-sync-alt', run: onSync },
      { label: 'מצב כהה / בהיר', sub: 'החלף ערכת צבעים', icon: 'fa-moon', run: onToggleDark },
    ];
    // משפחות — חיפוש חי
    const fams: Command[] = [];
    if (db && q.trim()) {
      for (const key of buildingKeys(db)) {
        liveApts(getBuilding(db, key)?.apts).forEach((a) => {
          if ((a.name ?? '').includes(q.trim())) {
            fams.push({
              label: a.name ?? '',
              sub: key,
              icon: 'fa-user',
              run: () => onOpenFamily(a.name ?? ''),
            });
          }
        });
      }
    }
    const all = [...fams.slice(0, 6), ...base];
    return q.trim()
      ? all.filter((c) => c.label.includes(q.trim()) || c.sub.includes(q.trim()))
      : base;
  }, [db, q, onNavigate, onOpenFamily, onToggleDark, onSync]);

  useEffect(() => setIdx(0), [q]);

  const exec = (c: Command) => { c.run(); onClose(); };

  return (
    <div className="drawer-backdrop" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <i className="fas fa-search" />
          <input
            ref={inputRef}
            placeholder="חיפוש פעולה או משפחה…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, commands.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter' && commands[idx]) exec(commands[idx]);
              if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list">
          {commands.map((c, i) => (
            <li key={`${c.label}_${i}`}>
              <button className={i === idx ? 'active' : ''} onClick={() => exec(c)} onMouseEnter={() => setIdx(i)}>
                <i className={`fas ${c.icon}`} />
                <span className="p-label">{c.label}</span>
                <span className="p-sub">{c.sub}</span>
              </button>
            </li>
          ))}
          {commands.length === 0 && <li className="placeholder" style={{ padding: 14 }}>אין תוצאות</li>}
        </ul>
      </div>
    </div>
  );
}
