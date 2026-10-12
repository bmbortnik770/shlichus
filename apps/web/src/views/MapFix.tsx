import { useEffect, useState } from 'react';
import { type Db, type MapFix, applyFix, getCategories, matchBuildings, officialLabel, pendingFixes } from '@shlichus/core';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useToast } from '../ui';
import { useMapData } from '../mapData';

/**
 * דיוק המפה: מה שמאומת מול מקור רשמי (או בלי משפחות) מתוקן בלחיצה אחת עם ביטול;
 * כל מה שנוגע במשפחות בלי אימות — מוצג לאישור אחד-אחד.
 */
export function MapFixPanel({ db, noData, fixes, waiting, needUser, total, onClose, onFocus, onPick }: {
  db: Db; noData: boolean; fixes: MapFix[]; waiting: { key: string; families: number }[]; needUser: number; total: number;
  onClose: () => void; onFocus: (t: { id?: string; key?: string }) => void; onPick: (key: string) => void;
}) {
  const { verify, checking, buildings, geo } = useMapData();
  const mutate = useStore((s) => s.mutate);
  const toast = useToast((s) => s.show);
  const [open, setOpen] = useState(false);

  // אימות כתובות מול GovMap (רק מה שלא נמצא ישירות; נשמר במטמון)
  useEffect(() => { if (!noData) void verify(db); }, [noData]); // eslint-disable-line react-hooks/exhaustive-deps

  const safe = fixes.filter((f) => !f.needsUser && f.match.official);
  const manual = fixes.filter((f) => f.needsUser);
  const accurate = total - fixes.filter((f) => f.link || f.relocate || f.renameTo || !f.match.official).length;
  const cats = new Map(getCategories(db).map((c) => [c.id, c.name]));

  const count = (pred: (f: MapFix) => boolean) => safe.filter(pred).length;
  const groups = [
    { n: count((f) => f.link && !f.relocate && !f.renameTo), t: 'קישור לבניין הרשמי (צורה מדויקת ומזהה קבוע)' },
    { n: count((f) => f.relocate && !f.renameTo), t: 'נקודה שנשמרה ליד הבניין ולא עליו' },
    { n: count((f) => !!f.renameTo), t: 'כתובת משובשת בלי משפחות, תתוקן לכתובת הבניין' },
    { n: count((f) => !!f.category), t: 'סיווג: מוסדות לפי השם ברישום, ובניינים שלא סווגו' },
    { n: count((f) => !!f.units), t: 'מספר דירות שהיה חסר' },
  ].filter((g) => g.n);

  const applyAll = () => {
    let done = 0;
    const undo = mutate((d) => {
      // בסבבים: תיקון אחד יכול לחשוף את הבא (למשל איחוד כתובת שמשאיר כתובת יחידה על הבניין)
      let round = safe;
      for (let i = 0; i < 4 && round.length; i++) {
        for (const f of round) applyFix(d, f);
        done += round.length;
        round = pendingFixes(d, matchBuildings(d, buildings, geo), geo).filter((f) => !f.needsUser && f.match.official);
      }
    });
    toast(`${done} תיקונים בוצעו`, undo);
  };
  const applyOne = (f: MapFix, manualDecision: boolean) => {
    const undo = mutate((d) => { applyFix(d, f, { manual: manualDecision }); });
    toast(f.renameTo ? `הועבר ל${f.renameTo}` : 'נשמר', undo);
  };
  const keepAsEntrance = (f: MapFix) => {
    const undo = mutate((d) => { applyFix(d, f, { manual: true, skipRename: true }); });
    toast('הכתובת נשארה ושויכה לבניין', undo);
  };

  return (
    <aside className="sheet" aria-label="דיוק המפה">
      <header className="sheet-head">
        <div>
          <h2>דיוק המפה</h2>
          <div className="sheet-sub">{noData ? 'ממתין לשכבת המבנים' : checking ? 'בודק כתובות מול הרישום הרשמי…' : `${accurate} מתוך ${total} כתובות מקושרות לבניין הנכון`}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="סגירה"><Icon name="x" /></button>
      </header>
      <div className="meter" aria-hidden="true"><i style={{ width: `${total ? (accurate / total) * 100 : 100}%` }} /></div>

      {noData && (
        <p className="sheet-note">שכבת המבנים עוד לא נטענה, ולכן אין מול מה לבדוק. כשהיא תיטען, הבדיקה תרוץ מעצמה.</p>
      )}

      {!noData && fixes.length === 0 && !checking && (
        <div className="fix-done"><Icon name="done" size={22} /><div><b>המפה מדויקת</b><span>כל כתובת מקושרת לבניין שלה, וכל לחיצה על בניין תגיע לכתובת הנכונה.</span></div></div>
      )}

      {checking && !noData && <p className="sheet-note">בודק כל כתובת מול נקודת הכתובת הרשמית. ההחלטות יוצגו כשהבדיקה תסתיים.</p>}

      {!checking && safe.length > 0 && (
        <section className="fix-block">
          <h3 className="sheet-h">תיקונים בטוחים <span className="num">{safe.length}</span></h3>
          <p className="sheet-hint">מאומתים מול הרישום הרשמי, או בבניינים בלי משפחות. אפשר לבטל אחרי ההחלה.</p>
          <ul className="fix-groups">{groups.map((g) => <li key={g.t}><b className="num">{g.n}</b>{g.t}</li>)}</ul>
          <div className="fix-acts">
            <button className="btn btn-primary" onClick={applyAll} disabled={checking}>החלת {safe.length} תיקונים</button>
            <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'הסתרת הפירוט' : 'פירוט'}</button>
          </div>
          {open && (
            <ul className="fix-list">
              {safe.map((f) => (
                <li key={f.key}>
                  <button className="link" onClick={() => onFocus({ key: f.key })}>{f.key}</button>
                  <span className="sheet-hint">{describe(f, cats)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!checking && manual.length > 0 && (
        <section className="fix-block">
          <h3 className="sheet-h">דורש את ההחלטה שלך <span className="num">{needUser}</span></h3>
          {manual.map((f) => (
            <article className="fix-card" key={f.key}>
              <button className="link fix-title" onClick={() => onFocus({ key: f.key })}>{f.key}</button>
              <span className="sheet-hint">{f.match.families} {f.match.families === 1 ? 'משפחה' : 'משפחות'}</span>
              <p>{question(f)}</p>
              <div className="fix-acts">
                {f.renameTo && <button className="btn btn-primary" onClick={() => applyOne(f, true)}>להעביר ל{f.renameTo}</button>}
                {f.renameTo && !f.match.broken && <button className="btn" onClick={() => keepAsEntrance(f)}>זו כניסה נוספת, להשאיר</button>}
                {!f.renameTo && f.match.official && <button className="btn btn-primary" onClick={() => applyOne(f, true)}>כן, זה הבניין</button>}
                <button className="btn" onClick={() => onPick(f.key)}>{f.match.official ? 'בניין אחר' : 'בחירת הבניין במפה'}</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {waiting.length > 0 && (
        <section className="fix-block">
          <h3 className="sheet-h">ממתינות למספר בית <span className="num">{waiting.length}</span></h3>
          <p className="sheet-hint">לא מסומנות במפה עד שיעודכן מספר בית בכרטיס. המערכת לא מנחשת לפי מיקום.</p>
          <ul className="fix-list">
            {waiting.map((w) => (
              <li key={w.key}><b>{w.key}</b><span className="sheet-hint">{w.families === 1 ? 'משפחה אחת' : `${w.families} משפחות`}</span></li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function describe(f: MapFix, cats: Map<string, string>): string {
  const parts: string[] = [];
  if (f.renameTo) parts.push(`→ ${f.renameTo}`);
  else if (f.relocate) parts.push('הנקודה תוזז לבניין');
  else if (f.link) parts.push(f.match.method === 'geocode' ? 'כניסה נוספת של הבניין' : 'קישור לבניין');
  if (f.category) parts.push(`סיווג: ${cats.get(f.category) ?? f.category}`);
  if (f.units) parts.push(`${f.units} דירות`);
  return parts.join(' · ');
}

function question(f: MapFix): string {
  const b = f.match.official;
  if (!b) return 'במקום שבו הכתובת שמורה אין בניין ברישום. איפה המשפחות גרות?';
  const here = officialLabel(b) ? `הבניין ${officialLabel(b)}` : 'בניין (בלי כתובת ברישום)';
  if (f.match.broken) return `הכתובת שמורה ${/\d/.test(f.key) ? 'משובשת' : 'בלי מספר בית'}. במקום שלה נמצא ${here}. להעביר את המשפחות לכתובת ${f.renameTo}?`;
  return `הכתובת לא נמצאה ברישום הרשמי. במקום שלה נמצא ${here}. זה הבניין שבו המשפחות גרות?`;
}
