import { describe, expect, it } from 'vitest';
import {
  type Db, addDonationFull, addLifeEvent, addPledge, computeToday, dateAlerts, getBuilding, matchSmartView,
  memberOptions, missingAny, recalcPledges, removeDonation, setPledgeCancelled,
} from '../src/index.js';

const now = new Date(2026, 9, 19, 10); // 19.10.2026
const ref = { bldg: 'א 1', idx: 0 };
const db = (): Db => ({
  'א 1': { info: {}, apts: [{
    id: 'a', name: 'כהן', father: 'משה', mother: 'שרה', fatherDob: '1980-10-22',
    childrenList: [{ name: 'יוסי', dob: '2013-11-30', gender: 'boy' }, { name: 'רחלי', dob: '2014-10-20', gender: 'girl' }],
  }] },
} as Db);

describe('אירועי חיים ותאריכי לידה', () => {
  it('בני משפחה לבחירה', () => {
    expect(memberOptions(getBuilding(db(), 'א 1')!.apts[0]!).map((m) => m.key)).toEqual(['family', 'father', 'mother', 'child:יוסי', 'child:רחלי']);
  });

  it('תזכורות: יום הולדת לילד ולאב, בר מצווה (13) ובת מצווה (12) בטווח', () => {
    const a = dateAlerts(getBuilding(db(), 'א 1')!.apts[0]!, now);
    expect(a).toEqual(expect.arrayContaining([
      { kind: 'birthday', inDays: 1, title: 'יום הולדת לרחלי' },
      { kind: 'birthday', inDays: 3, title: 'יום הולדת למשה' },
      { kind: 'barmitzva', inDays: 42, title: 'בר מצווה ליוסי' }, // 30.11.2026
    ]));
    expect(a).toContainEqual({ kind: 'barmitzva', inDays: 1, title: 'בת מצווה לרחלי' }); // 12 שנה מ-20.10.2014
  });

  it('אירוע פטירה יוצר משימות המשך; מה שעבר מסומן כבוצע', () => {
    const d = db();
    const n = addLifeEvent(d, ref, { type: 'death', date: '2026-10-10', memberKey: 'father' }, now);
    const apt = getBuilding(d, 'א 1')!.apts[0]!;
    expect(n).toBe(4);
    expect((apt.tasks ?? []).map((t) => [t.text, t.date, t.done])).toEqual([
      ['ניחום אבלים — לבקר בשבעה — משה', '2026-10-10', true],
      ['סוף שבעה — לברר ולהתקשר — משה', '2026-10-17', true],
      ['שלושים — ליצור קשר — משה', '2026-11-09', false],
      ['יארצייט ראשון — לאזכר — משה', '2027-10-10', false],
    ]);
    expect(apt.lifecycleEvents).toEqual([{ type: 'death', date: '2026-10-10', memberKey: 'father', memberName: 'משה', notes: '', autoTasks: 4 }]);
  });

  it('תזכורות נכנסות למסך היום', () => {
    const t = computeToday(db(), { now });
    const item = t.items.find((i) => i.name === 'משפחת כהן')!;
    expect(item.reasons.map((r) => r.detail)).toEqual(expect.arrayContaining([expect.stringContaining('יום הולדת לרחלי'), expect.stringContaining('בר מצווה ליוסי')]));
  });
});

describe('התחייבויות ותרומות', () => {
  it('תשלום על חשבון מעדכן יתרה וסטטוס; תרומה גדולה יוצרת משימת תודה', () => {
    const d = db();
    addPledge(d, ref, { amount: 1000, campaign: 'סוכות' });
    const id = (getBuilding(d, 'א 1')!.apts[0]!.pledges as { id: string }[])[0]!.id;
    expect(addDonationFull(d, ref, { amount: 400, pledgeId: id, reason: 'תשלום על הבטחה' })).toBe(false);
    let p = recalcPledges(getBuilding(d, 'א 1')!.apts[0]!)[0]!;
    expect([p.paid, p.status]).toEqual([400, 'partial']);
    expect(addDonationFull(d, ref, { amount: 600, pledgeId: id })).toBe(true);
    p = (getBuilding(d, 'א 1')!.apts[0]!.pledges as typeof p[])[0]!;
    expect([p.paid, p.status]).toEqual([1000, 'fulfilled']);
    expect(getBuilding(d, 'א 1')!.apts[0]!.tasks![0]!.text).toContain('תודה אישית');
    removeDonation(d, ref, 1);
    expect((getBuilding(d, 'א 1')!.apts[0]!.pledges as typeof p[])[0]!.status).toBe('partial');
    setPledgeCancelled(d, ref, id, true);
    expect((getBuilding(d, 'א 1')!.apts[0]!.pledges as typeof p[])[0]!.status).toBe('cancelled');
  });
});

describe('תצוגות חכמות ונתונים חסרים', () => {
  const apt = { name: 'כהן', tags: ['מקורב'], tasks: [{ text: 'x', done: false }], boards: { b1: 'בטיפול' }, childrenList: [{ dob: '2016-10-05' }], interactions: [{ date: '2026-05-01', type: 'ביקור' }, { date: '2026-10-01', type: 'שיחה' }] };
  it('כל הכללים', () => {
    const m = (rule: string, extra = {}) => matchSmartView(apt, { id: 'x', name: 'x', rule, ...extra }, now);
    expect(m('child_age', { param1: '10' })).toBe(true);
    expect(m('child_age', { param1: '9' })).toBe(false);
    expect(m('no_visit_months', { value: '3' })).toBe(true);
    expect(m('no_call_months', { value: '3' })).toBe(false);
    expect(m('no_interaction', { param1: 'כלשהו', param2: '1' })).toBe(false);
    expect(m('has_open_tasks')).toBe(true);
    expect(m('in_project', { param1: 'b1' })).toBe(true);
    expect(m('in_project', { param1: 'b2' })).toBe(false);
    expect(m('bday_month')).toBe(true);
    expect(m('has_tag', { value: 'מקורב' })).toBe(true);
  });
  it('נתונים חסרים', () => {
    expect(missingAny(apt, 'א 1', ['phone'])).toBe(true);
    expect(missingAny({ ...apt, fatherPhone: '0501234567' }, 'א 1', ['phone'])).toBe(false);
    expect(missingAny(apt, '__NO_ADDRESS__', ['address'])).toBe(true);
    expect(missingAny(apt, 'א 1', ['tags', 'style'])).toBe(true);
    expect(missingAny(apt, 'א 1', [])).toBe(true);
  });
});
