import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { type Db, NO_ADDRESS_KEY, addFamily, displayName, familyAddress, familyPhones, listFamilies } from '@shlichus/core';
import { Icon, type IconName } from '../icons';
import { useStore } from '../store';
import { type CommunityTab, type View, go, useNav } from '../nav';
import { getThemeMode, setThemeMode } from '../themeMode';
import { applyAccent } from '../accent';

interface Cmd { label: string; hint?: string; icon: IconName; run: () => void; hay: string }

/**
 * לוח פקודות (Ctrl+K): חיפוש משפחה (שם, כתובת, טלפון) שפותח את הכרטיס,
 * מעבר מסכים, ופעולות — סנכרון, משפחה חדשה, מצב כהה/בהיר.
 */
export function Palette({ db }: { db: Db }) {
  const { paletteOpen, setPalette, openFamily } = useNav();
  const syncNow = useStore((s) => s.syncNow);
  const mutate = useStore((s) => s.mutate);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [setPalette]);
  useEffect(() => { if (paletteOpen) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [paletteOpen]);

  const families = useMemo(() => listFamilies(db).filter((r) => displayName(r.apt) || r.apt.num).map((r) => ({
    r, name: displayName(r.apt) || 'ללא שם', addr: familyAddress(r.bldg, r.apt),
    hay: [displayName(r.apt), r.apt.father, r.apt.mother, r.bldg === NO_ADDRESS_KEY ? '' : r.bldg, ...familyPhones(r.apt)].join(' ').replace(/-/g, ''),
  })), [db]);

  const close = () => setPalette(false);
  const nav = (v: View, tab?: CommunityTab) => () => { go(v, tab); close(); };
  const commands: Cmd[] = [
    { label: 'היום', icon: 'sun', run: nav('today'), hay: 'היום בית' },
    { label: 'מפה', icon: 'map', run: nav('community', 'map'), hay: 'מפה קהילה' },
    { label: 'רשימת המשפחות', icon: 'users', run: nav('community', 'people'), hay: 'אנשים משפחות קהילה רשימה טבלה' },
    { label: 'מעגלים', icon: 'users', run: nav('community', 'circles'), hay: 'מעגלים קבוצות' },
    { label: 'הודעות', icon: 'chat', run: nav('messages'), hay: 'הודעות וואטסאפ שליחה חיוג' },
    { label: 'משימות ופרויקטים', icon: 'tasks', run: nav('tasks'), hay: 'משימות פרויקטים לוחות' },
    { label: 'אירועים', icon: 'cal', run: nav('events'), hay: 'אירועים חגים לוח' },
    { label: 'תרומות', icon: 'heart', run: nav('donations'), hay: 'תרומות קמפיין' },
    { label: 'חיבורים', icon: 'plug', run: nav('connections'), hay: 'חיבורים' },
    { label: 'הגדרות', icon: 'gear', run: nav('settings'), hay: 'הגדרות' },
    { label: 'משפחה חדשה', icon: 'plus', run: () => { let ref = null as null | { bldg: string; idx: number }; mutate((d) => { ref = addFamily(d, ''); }); if (ref) openFamily(ref); close(); }, hay: 'משפחה חדשה הוספה' },
    { label: 'סנכרון עכשיו', hint: 'משיכה מהענן ועדכוני שטח', icon: 'cloud', run: () => { void syncNow(true); close(); }, hay: 'סנכרון רענון ענן עדכונים שטח' },
    { label: getThemeMode() === 'dark' ? 'מצב בהיר' : 'מצב כהה', icon: 'moon', run: () => { setThemeMode(getThemeMode() === 'dark' ? 'light' : 'dark'); applyAccent(db.__SETTINGS__?.webAccent as string | undefined); close(); }, hay: 'מצב כהה בהיר לילה ערכת נושא' },
  ];

  if (!paletteOpen) return null;
  const term = q.trim().replace(/-/g, '');
  const famHits = term ? families.filter((f) => f.hay.includes(term)).slice(0, 8) : [];
  const cmdHits = term ? commands.filter((c) => c.hay.includes(term) || c.label.includes(term)) : commands;
  const items: { key: string; label: string; sub?: string; icon: IconName; run: () => void }[] = [
    ...famHits.map((f) => ({ key: `f${f.r.bldg}|${f.r.idx}`, label: f.name, sub: f.addr, icon: 'users' as IconName, run: () => { openFamily({ bldg: f.r.bldg, idx: f.r.idx }); close(); } })),
    ...cmdHits.map((c) => ({ key: `c${c.label}`, label: c.label, sub: c.hint, icon: c.icon, run: c.run })),
  ];
  const cur = Math.min(sel, Math.max(0, items.length - 1));

  return (
    <div className="dialog-back pal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="חיפוש ופקודות">
        <label className="pal-in"><Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="משפחה, כתובת, טלפון או פקודה"
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter') items[cur]?.run();
            }} aria-label="חיפוש" />
        </label>
        <ul className="pal-list" role="listbox">
          {famHits.length > 0 && <li className="pal-h">משפחות</li>}
          {items.map((it, i) => (
            <Fragment key={it.key}>
              {i === famHits.length && <li className="pal-h">{term ? 'פקודות' : 'מעבר מהיר'}</li>}
              <li role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={it.run}>
                <Icon name={it.icon} size={16} /><span className="pl">{it.label}</span>{it.sub && <span className="ps">{it.sub}</span>}
              </li>
            </Fragment>
          ))}
          {items.length === 0 && <li className="pal-empty">לא נמצא דבר עבור "{q}"</li>}
        </ul>
        <div className="pal-foot"><span><b>↑↓</b> בחירה</span><span><b>Enter</b> פתיחה</span><span><b>Esc</b> סגירה</span></div>
      </div>
    </div>
  );
}
