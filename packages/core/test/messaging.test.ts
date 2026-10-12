import { describe, expect, it } from 'vitest';
import { type Db, circleName, getBuilding, getAptScore, getCircles, newCircle, logCall, logSent, personalize, recipients, sendLink, sentCount, setCircleMember } from '../src/index.js';

const db = (): Db => ({
  'א 1': { info: {}, apts: [
    { id: 'a', name: 'כהן', fatherPhone: '050-1234567', style: 'חב"ד', tags: ['תורם'], connectionCircles: ['c1'], tasks: [{ text: 'x', done: false }] },
    { id: 'b', name: 'לוי', motherEmail: 'levi@example.com' },
    { id: 'c', father: 'יוסי', phones: '052-7654321', interactions: [{ date: '2026-10-01', type: 'שיחה' }] },
  ] },
} as Db);

describe('הודעות', () => {
  it('התאמה אישית', () => {
    expect(personalize('שלום משפחת [שם], חג שמח!', { name: 'כהן' })).toBe('שלום משפחת כהן, חג שמח!');
    expect(personalize('שלום משפחת [שם]', { father: 'יוסי' })).toBe('שלום משפחת יוסי');
    expect(personalize('שלום משפחת [שם]', {})).toBe('שלום משפחה יקרה');
  });

  it('נמענים לפי ערוץ', () => {
    const now = new Date(2026, 9, 12);
    const wa = recipients(db(), 'whatsapp', now);
    expect(wa.map((r) => r.name)).toEqual(['יוסי', 'משפחת כהן']);
    expect(wa.find((r) => r.name === 'משפחת כהן')).toMatchObject({ circles: ['c1'], openTasks: true, daysSince: null });
    expect(wa.find((r) => r.name === 'יוסי')!.daysSince).toBe(11);
    expect(recipients(db(), 'email', now).map((r) => r.name)).toEqual(['משפחת לוי']);
  });

  it('קישורי שליחה', () => {
    expect(sendLink('whatsapp', { phone: '050-1234567', email: '' }, 'היי')).toBe('https://wa.me/972501234567?text=%D7%94%D7%99%D7%99');
    expect(sendLink('sms', { phone: '050-1234567', email: '' }, 'a')).toBe('sms:0501234567?body=a');
    expect(sendLink('email', { phone: '', email: 'x@y.com' }, 'a', 'נושא')).toBe('mailto:x@y.com?subject=%D7%A0%D7%95%D7%A9%D7%90&body=a');
  });

  it('שליחה ושיחה נרשמות ונספרות בניקוד', () => {
    const d = db();
    const ref = { bldg: 'א 1', idx: 0 };
    expect(getAptScore(getBuilding(d, 'א 1')!.apts[0]!)).toBe(-1);
    logSent(d, ref, 'whatsapp', 'שלום משפחת כהן');
    logCall(d, ref, 'ענו', 'הוזמנו לקידוש');
    const apt = getBuilding(d, 'א 1')!.apts[0]!;
    expect(apt.interactions!.map((l) => l.type)).toEqual(['שיחה', 'WhatsApp']);
    expect(apt.interactions![0]!.notes).toBe('ענו · הוזמנו לקידוש');
    expect(getAptScore(apt)).toBeGreaterThan(0);
    expect(sentCount(d)).toBe(1);
  });

  it('מעגלים', () => {
    const d = db();
    setCircleMember(d, { bldg: 'א 1', idx: 1 }, 'c1', true);
    setCircleMember(d, { bldg: 'א 1', idx: 0 }, 'c1', false);
    expect(recipients(d, 'email')[0]!.circles).toEqual(['c1']);
    expect(getBuilding(d, 'א 1')!.apts[1]!.connectionCircles).toEqual([{ id: 'c1', member: 'family' }]);
    expect(getBuilding(d, 'א 1')!.apts[0]!.connectionCircles).toEqual([]);
    // מבנה המערכת הקיימת
    const legacy = { 'ב 2': { info: {}, apts: [{ name: 'גל', fatherPhone: '0501111111', connectionCircles: [{ id: 'circle_1', member: 'father' }] }] } } as Db;
    expect(recipients(legacy, 'whatsapp')[0]!.circles).toEqual(['circle_1']);
    const id = newCircle(legacy, 'שיעור תניא');
    expect(circleName(getCircles(legacy).find((c) => c.id === id)!)).toBe('שיעור תניא');
    expect(circleName({ id: 'x', label: 'מניין שבת ' })).toBe('מניין שבת');
  });
});
