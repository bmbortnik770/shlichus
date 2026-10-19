import { useState } from 'react';
import { type Db, geocodeAddress, getTerritory, setSetting } from '@shlichus/core';
import { useStore } from '../store';
import { Dialog } from '../ui';
import { go } from '../nav';
import { TerritoryEditor } from './TerritoryEditor';

/** חשבון חדש: אין מיקום, אין תיחום, ועוד לא סיימו/דילגו על האשף */
export function needsOnboarding(db: Db): boolean {
  const s = db.__SETTINGS__ ?? {};
  if (s.onboardingDone) return false;
  const home = (s.homeLocation as { coords?: unknown } | undefined)?.coords;
  const poly = getTerritory(db).polygon;
  return !home && !(poly && poly.length >= 3);
}

/** אשף פתיחה: שם ומיקום → תיחום → סיום */
export function Onboarding({ db, onClose }: { db: Db; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate);
  const s = db.__SETTINGS__ ?? {};
  const [step, setStep] = useState(0);
  const [name, setName] = useState(String(s.missionName ?? ''));
  const [addr, setAddr] = useState(String((s.homeLocation as { address?: string } | undefined)?.address ?? ''));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = (toMap: boolean) => {
    mutate((d) => setSetting(d, { onboardingDone: true }));
    onClose();
    if (toMap) go('community', 'map');
  };

  const saveStep1 = async () => {
    const parts = addr.split(',').map((x) => x.trim()).filter(Boolean);
    const city = parts.length > 1 ? parts[parts.length - 1]! : '';
    if (!city) { setMsg('צריך לכתוב גם עיר, למשל: שמואל תמיר 19, ירושלים'); return; }
    setBusy(true); setMsg('מאתר את הכתובת…');
    const hit = await geocodeAddress(parts.slice(0, -1).join(' '), city).catch(() => null);
    setBusy(false);
    if (!hit) { setMsg('הכתובת לא נמצאה ברישום הרשמי. כדאי לבדוק את האיות ואת מספר הבית.'); return; }
    const loc = { coords: hit.point, address: addr.trim() };
    mutate((d) => setSetting(d, { missionName: name.trim(), branding: { ...((d.__SETTINGS__?.branding ?? {}) as object), name: name.trim() }, homeLocation: { ...loc, isChabad: true }, primaryLocation: loc, center: hit.point }));
    setMsg(''); setStep(1);
  };

  const steps = ['השליחות', 'אזור השליחות', 'מוכנים'];
  return (
    <Dialog title="ברוכים הבאים" onClose={() => finish(false)}>
      <ol className="ob-steps">{steps.map((t, i) => <li key={t} className={i === step ? 'cur' : i < step ? 'done' : ''}>{i + 1}. {t}</li>)}</ol>

      {step === 0 && (
        <div className="ob-body">
          <p className="dialog-note">שתי שאלות קצרות, והמפה תיפתח על השכונה שלך.</p>
          <label className="fld"><span>שם בית חב״ד</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: בית חב״ד פסגת זאב מערב" /></label>
          <label className="fld"><span>הכתובת של בית חב״ד</span><input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="רחוב ומספר, עיר" /></label>
          {msg && <p className="sheet-hint">{msg}</p>}
          <div className="dialog-acts">
            <button className="btn" onClick={() => finish(false)}>דילוג</button>
            <button className="btn btn-primary" disabled={!addr.trim() || busy} onClick={() => void saveStep1()}>{busy ? 'מאתר…' : 'המשך'}</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="ob-body">
          <p className="dialog-note">סמן את גבולות השכונה שבה אתה פועל. כך המפה תדע אילו בניינים ודירות נספרים בהתקדמות. אפשר לשנות אחר כך בהגדרות.</p>
          <TerritoryEditor db={db} />
          <div className="dialog-acts">
            <button className="btn" onClick={() => setStep(0)}>חזרה</button>
            <button className="btn btn-primary" onClick={() => setStep(2)}>המשך</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="ob-body">
          <p className="dialog-note">הכל מוכן. המפה מציגה את בנייני השכונה, וכל משפחה שתוסיף תופיע בבניין שלה.</p>
          <ul className="ob-tips">
            <li>לחיצה על בניין במפה פותחת את הכרטיס שלו, ומשם מוסיפים משפחות.</li>
            <li>יש לך רשימה באקסל או בגוגל שיטס? הגדרות ← ייבוא וגיבוי.</li>
            <li>אפשר לסדר את התפריט כרצונך: "סידור התפריט" בתחתית התפריט.</li>
          </ul>
          <div className="dialog-acts"><button className="btn btn-primary" onClick={() => finish(true)}>למפה</button></div>
        </div>
      )}
    </Dialog>
  );
}
