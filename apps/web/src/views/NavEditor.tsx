import { useState } from 'react';
import type { Db } from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Dialog, useToast } from '../ui';
import {
  type MobileEntry, type NavLayout, type ScreenKey, DEFAULT_LAYOUT, MOBILE_SLOTS, SCREENS, UNHIDEABLE,
  applySuggestion, dismissSuggestion, entryLabel, getLayout, normalize, setLayout, suggestion, usage,
} from '../navLayout';
import '../navedit.css';

const clone = (l: NavLayout): NavLayout => JSON.parse(JSON.stringify(l)) as NavLayout;

/**
 * סידור התפריט: גרירה (או חצים, בטלפון) של לשוניות בין קבוצות, שינוי שם לקבוצה,
 * קבוצה חדשה, הסתרה, וכפתורי הסרגל בטלפון. נשמר רק בלחיצה על "שמירה".
 */
export function NavEditor({ db, onClose }: { db: Db; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const [l, setL] = useState<NavLayout>(() => getLayout(db));
  const [drag, setDrag] = useState<ScreenKey | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const u = usage();
  const sug = suggestion(l);

  const edit = (fn: (n: NavLayout) => void) => setL((cur) => { const n = clone(cur); fn(n); return normalize(n); });
  const removeEverywhere = (n: NavLayout, k: ScreenKey) => { for (const g of n.groups) g.items = g.items.filter((x) => x !== k); n.hidden = n.hidden.filter((x) => x !== k); };
  /** העברת לשונית לקבוצה, לפני לשונית מסוימת (או לסוף) */
  const moveTo = (k: ScreenKey, groupId: string, before?: ScreenKey) => edit((n) => {
    removeEverywhere(n, k);
    const g = n.groups.find((x) => x.id === groupId)!;
    const i = before ? g.items.indexOf(before) : -1;
    if (i < 0) g.items.push(k); else g.items.splice(i, 0, k);
  });
  const hide = (k: ScreenKey) => edit((n) => { removeEverywhere(n, k); n.hidden.push(k); n.mobile = n.mobile.filter((m) => m !== k); });
  /** חץ למעלה/למטה — בגבול הקבוצה עובר לקבוצה הסמוכה */
  const step = (k: ScreenKey, dir: -1 | 1) => edit((n) => {
    const gi = n.groups.findIndex((g) => g.items.includes(k));
    const g = n.groups[gi]!;
    const i = g.items.indexOf(k);
    const j = i + dir;
    if (j >= 0 && j < g.items.length) { g.items.splice(i, 1); g.items.splice(j, 0, k); return; }
    const ng = n.groups[gi + dir];
    if (!ng) return;
    g.items.splice(i, 1);
    if (dir < 0) ng.items.push(k); else ng.items.unshift(k);
  });
  const addGroup = () => edit((n) => {
    const at = n.groups.findIndex((g) => g.foot);
    const g = { id: `g_${Date.now().toString(36)}`, label: 'קבוצה חדשה', items: [] as ScreenKey[] };
    if (at < 0) n.groups.push(g); else n.groups.splice(at, 0, g);
  });
  const removeGroup = (id: string) => edit((n) => {
    const i = n.groups.findIndex((g) => g.id === id);
    const target = n.groups[i - 1] ?? n.groups[i + 1];
    if (!target) return;
    target.items.push(...n.groups[i]!.items);
    n.groups.splice(i, 1);
    n.mobile = n.mobile.filter((m) => m !== `group:${id}`);
  });

  /** הלשונית הנגררת — מהגרירה עצמה (אמין גם כשהשחרור מהיר), ואם אין — מהמצב */
  const dragged = (e: React.DragEvent): ScreenKey | null => { const k = e.dataTransfer?.getData('text/plain') as ScreenKey; return k && k in SCREENS ? k : drag; };
  const onDrop = (e: React.DragEvent, groupId: string, before?: ScreenKey) => { const k = dragged(e); if (k && k !== before) moveTo(k, groupId, before); setDrag(null); setOver(null); };
  const save = () => {
    const undo = mutate((d) => setLayout(d, l));
    toast('סידור התפריט נשמר', undo);
    onClose();
  };

  const mobileOptions: MobileEntry[] = [
    ...l.groups.flatMap((g) => g.items).filter((k) => !l.hidden.includes(k)),
    ...l.groups.filter((g) => g.label && g.items.length).map((g) => `group:${g.id}` as MobileEntry),
  ].filter((m) => !l.mobile.includes(m));

  return (
    <Dialog title="סידור התפריט" onClose={onClose}>
      <div className="ne">
        <p className="dialog-note">גורר לשונית למקום אחר, לתוך קבוצה או מחוץ לה. בטלפון אפשר להשתמש בחצים.</p>

        {sug && (
          <div className="ne-sug">
            <span>נכנסת ל<b>{SCREENS[sug.add].label}</b> {sug.count} פעמים. להוסיף לסרגל בטלפון{sug.replace ? ` במקום "${entryLabel(l, sug.replace)}"` : ''}?</span>
            <button className="btn btn-s" onClick={() => setL(normalize(applySuggestion(l, sug)))}>כן</button>
            <button className="link" onClick={() => { dismissSuggestion(sug.add); setL(clone(l)); }}>לא עכשיו</button>
          </div>
        )}

        <h3 className="dlg-h">תפריט הצד (מחשב)</h3>
        {l.groups.map((g, gi) => (
          <div key={g.id} className={`ne-group${over === g.id ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(g.id); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); onDrop(e, g.id); }}>
            <div className="ne-ghead">
              {g.foot ? <span className="meta">בתחתית התפריט</span> : (
                <input className="ne-glabel" value={g.label} placeholder={gi === 0 ? 'ראשי (בלי כותרת)' : 'שם הקבוצה'}
                  onChange={(e) => { const v = e.target.value; edit((n) => { n.groups.find((x) => x.id === g.id)!.label = v; }); }} aria-label="שם הקבוצה" />
              )}
              {!g.foot && l.groups.length > 2 && <button className="link" onClick={() => removeGroup(g.id)}>מחיקת הקבוצה</button>}
            </div>
            <ul className="ne-items">
              {g.items.map((k) => (
                <li key={k} draggable className={drag === k ? 'dragging' : ''}
                  onDragStart={(e) => { setDrag(k); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k); }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(g.id); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(e, g.id, k); }}>
                  <span className="ne-grip" aria-hidden="true">⋮⋮</span>
                  <Icon name={SCREENS[k].icon} size={16} />
                  <span className="ne-name">{SCREENS[k].label}</span>
                  {u[k] ? <span className="meta" title="כמה פעמים נכנסת">{u[k]}</span> : null}
                  <button className="ib ne-ib" aria-label={`${SCREENS[k].label} למעלה`} onClick={() => step(k, -1)}>↑</button>
                  <button className="ib ne-ib" aria-label={`${SCREENS[k].label} למטה`} onClick={() => step(k, 1)}>↓</button>
                  {!UNHIDEABLE.includes(k) && <button className="ib ne-ib" aria-label={`הסתרת ${SCREENS[k].label}`} title="הסתרה" onClick={() => hide(k)}>×</button>}
                </li>
              ))}
              {g.items.length === 0 && <li className="ne-empty">גרור לכאן לשוניות</li>}
            </ul>
          </div>
        ))}
        <button className="btn btn-s" onClick={addGroup}><Icon name="plus" size={14} />קבוצה חדשה</button>

        {l.hidden.length > 0 && (
          <>
            <h3 className="dlg-h">מוסתרות</h3>
            <div className="chips">
              {l.hidden.map((k) => <button key={k} className="chip-f" onClick={() => moveTo(k, l.groups[0]!.id)}>+ {SCREENS[k].label}</button>)}
            </div>
            <p className="sheet-hint">לשונית מוסתרת עדיין נגישה מהחיפוש (Ctrl+K).</p>
          </>
        )}

        <h3 className="dlg-h">הסרגל התחתון (טלפון)</h3>
        <p className="sheet-hint">עד {MOBILE_SLOTS} כפתורים, ואחריהם "עוד" עם כל השאר. קבוצה נפתחת כמסך קצר עם הלשוניות שלה.</p>
        <ol className="ne-mobile">
          {l.mobile.map((m, i) => (
            <li key={m}>
              <b>{i + 1}</b><span className="ne-name">{entryLabel(l, m)}{m.startsWith('group:') ? ' (קבוצה)' : ''}</span>
              <button className="ib ne-ib" aria-label="ימינה" disabled={i === 0} onClick={() => edit((n) => { n.mobile.splice(i, 1); n.mobile.splice(i - 1, 0, m); })}>↑</button>
              <button className="ib ne-ib" aria-label="שמאלה" disabled={i === l.mobile.length - 1} onClick={() => edit((n) => { n.mobile.splice(i, 1); n.mobile.splice(i + 1, 0, m); })}>↓</button>
              <button className="ib ne-ib" aria-label={`הסרה מהסרגל: ${entryLabel(l, m)}`} onClick={() => edit((n) => { n.mobile = n.mobile.filter((x) => x !== m); })}>×</button>
            </li>
          ))}
          <li className="ne-more"><b>{l.mobile.length + 1}</b><span className="ne-name">עוד</span><span className="meta">קבוע</span></li>
        </ol>
        {l.mobile.length < MOBILE_SLOTS && mobileOptions.length > 0 && (
          <select className="sel" value="" onChange={(e) => { const v = e.target.value as MobileEntry; if (v) edit((n) => { n.mobile.push(v); }); }} aria-label="הוספה לסרגל">
            <option value="">הוספה לסרגל…</option>
            {mobileOptions.map((m) => <option key={m} value={m}>{entryLabel(l, m)}{m.startsWith('group:') ? ' (קבוצה)' : ''}</option>)}
          </select>
        )}

        <div className="dialog-acts">
          <button className="btn" onClick={() => setL(clone(DEFAULT_LAYOUT))}>חזרה לברירת המחדל</button>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={save}>שמירה</button>
        </div>
      </div>
    </Dialog>
  );
}
