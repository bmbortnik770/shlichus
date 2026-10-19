import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERACTION_TYPES, engagementLabel, engagementScore, getAptScore, guessTypeKey, logTypeKey, makeLog, typeInfo } from '../src/index.js';

describe('סוגי פעילות', () => {
  it('ברירת מחדל כשאין הגדרה, ומותאם כשיש', () => {
    expect(typeInfo(undefined, 'call').label).toBe('שיחת טלפון');
    const s = { interactionTypes: [{ key: 'farbrengen', label: 'התוועדות', color: '#000', direction: 'incoming', defaultScore: 30 }] };
    expect(typeInfo(s, 'farbrengen').label).toBe('התוועדות');
    expect(typeInfo(s, 'לא קיים').key).toBe('other');
  });

  it('רישום באותו מבנה כמו הישן, עם ערוץ לניקוד הסטטוס', () => {
    const l = makeLog(undefined, { date: '2026-10-01', typeKey: 'visit', text: 'ביקור', member: 'father' });
    expect(l).toMatchObject({ date: '2026-10-01', type: 'ביקור בית', interactionType: 'visit', text: 'ביקור', member: 'father', direction: 'outgoing', channel: 'visit' });
    const now = new Date();
    const fresh = makeLog(undefined, { date: now.toISOString().slice(0, 10), typeKey: 'tefillin', text: 'x' });
    expect(getAptScore({ interactions: [fresh] })).toBe(50);
  });

  it('ניחוש סוג לרישומים ישנים', () => {
    expect(guessTypeKey('WhatsApp')).toBe('message');
    expect(guessTypeKey('שיחה')).toBe('call');
    expect(guessTypeKey('ביקור')).toBe('visit');
    expect(logTypeKey({ type: 'משהו' })).toBe('other');
  });

  it('ציון מעורבות דועך עם הזמן ומוגבל ל-100', () => {
    const now = Date.parse('2026-10-19T12:00:00');
    const today = { interactions: [{ date: '2026-10-19', interactionType: 'mezuzah' }] };
    const old = { interactions: [{ date: '2026-07-21', interactionType: 'mezuzah' }] }; // 90 יום = מחצית
    expect(engagementScore(today, undefined, now)).toBe(20);
    expect(engagementScore(old, undefined, now)).toBe(10);
    const many = { interactions: Array.from({ length: 10 }, () => ({ date: '2026-10-19', interactionType: 'mourning' })) };
    expect(engagementScore(many, undefined, now)).toBe(100);
    expect(engagementLabel(75).label).toBe('מעורב מאוד');
    expect(engagementLabel(0).level).toBe('cold');
    expect(DEFAULT_INTERACTION_TYPES).toHaveLength(13);
  });
});
