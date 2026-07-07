import { describe, it, expect } from 'vitest';
import { getAptScore, getStatusColor, statusSeverity } from '../src/scoring.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

describe('getAptScore — זהה ללוגיקת הישן', () => {
  it('בלי אינטראקציות → ‎-1 (אפור)', () => {
    expect(getAptScore({})).toBe(-1);
    expect(getStatusColor({})).toBe('#94a3b8');
  });

  it('ביקור טרי (50) + שיחה (30) = 80 → ירוק', () => {
    const a = { interactions: [
      { date: daysAgo(5), channel: 'visit' },
      { date: daysAgo(10), type: 'שיחה' },
    ] };
    expect(getAptScore(a)).toBe(80);
    expect(getStatusColor(a)).toBe('#10b981');
  });

  it('וואטסאפ בתוך 30 יום = 20 → אדום (מתחת ל-25)', () => {
    const a = { interactions: [{ date: daysAgo(7), type: 'WhatsApp' }] };
    expect(getAptScore(a)).toBe(20);
    expect(getStatusColor(a)).toBe('#ef4444');
  });

  it('שיחה שפג תוקפה (61+ יום) לא נספרת → 0 → אדום', () => {
    const a = { interactions: [{ date: daysAgo(70), channel: 'phone' }] };
    expect(getAptScore(a)).toBe(0);
    expect(getStatusColor(a)).toBe('#ef4444');
  });

  it('שיחה 30 + וואטסאפ 20 = 50 → כתום', () => {
    const a = { interactions: [
      { date: daysAgo(3), channel: 'phone' },
      { date: daysAgo(3), channel: 'whatsapp' },
    ] };
    expect(getStatusColor(a)).toBe('#f59e0b');
  });

  it('ספי thresholds מותאמים מכובדים', () => {
    const a = { interactions: [{ date: daysAgo(1), channel: 'whatsapp' }] };
    expect(getStatusColor(a, { scoringRules: {
      thresholds: { green: 15, orange: 5 },
      channels: [{ key: 'whatsapp', points: 20, ttlDays: 30 }],
    } } as never)).toBe('#10b981');
  });
});

describe('statusSeverity', () => {
  it('סדר חומרה: אפור<ירוק<כתום<אדום', () => {
    expect(statusSeverity('#94a3b8')).toBe(0);
    expect(statusSeverity('#10b981')).toBe(1);
    expect(statusSeverity('#f59e0b')).toBe(2);
    expect(statusSeverity('#ef4444')).toBe(3);
  });
});
