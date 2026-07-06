import { describe, it, expect } from 'vitest';
import { DEFAULT_CATEGORIES, getCategories, pointInPolygon, categoryColor } from '../src/territory.js';
import type { Db } from '../src/types.js';

describe('getCategories — מיזוג עם שמורות', () => {
  it('בלי הגדרות — 7 ברירות מחדל, מגורים היא ברירת המחדל', () => {
    const cats = getCategories({ meta: { lastModified: 0 } });
    expect(cats).toHaveLength(7);
    expect(cats.filter((c) => c.isDefault)).toHaveLength(1);
    expect(cats.find((c) => c.isDefault)!.id).toBe('residential');
  });

  it('קטגוריה שמורה דורסת צבע; מותאמת-אישית מתווספת', () => {
    const db: Db = {
      meta: { lastModified: 0 },
      __SETTINGS__: { territory: { categories: [
        { id: 'business', name: 'עסקים', color: '#000000' },
        { id: 'custom1', name: 'שכונה חדשה', color: '#123456' },
      ] } } as never,
    };
    const cats = getCategories(db);
    expect(cats.find((c) => c.id === 'business')!.color).toBe('#000000');
    expect(cats.find((c) => c.id === 'custom1')).toBeDefined();
    expect(cats).toHaveLength(8);
  });

  it('כפל isDefault מתוקן לאחד בלבד (הבאג שהיה בישן)', () => {
    const db: Db = {
      meta: { lastModified: 0 },
      __SETTINGS__: { territory: { categories: [
        { id: 'business', name: 'עסקים', color: '#f59e0b', isDefault: true },
        { id: 'education', name: 'חינוך', color: '#10b981', isDefault: true },
      ] } } as never,
    };
    const cats = getCategories(db);
    expect(cats.filter((c) => c.isDefault)).toHaveLength(1);
  });
});

describe('pointInPolygon', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('נקודה בפנים', () => expect(pointInPolygon([5, 5], square)).toBe(true));
  it('נקודה בחוץ', () => expect(pointInPolygon([15, 5], square)).toBe(false));
  it('עובד גם עם טבעת סגורה (נקודה אחרונה=ראשונה)', () => {
    const closed: [number, number][] = [...square, [0, 0]];
    expect(pointInPolygon([5, 5], closed)).toBe(true);
    expect(pointInPolygon([-1, 5], closed)).toBe(false);
  });
  it('פוליגון קטן מדי → false', () => {
    expect(pointInPolygon([1, 1], [[0, 0], [1, 0]])).toBe(false);
  });
});

describe('categoryColor', () => {
  it('צבע לפי קטגוריה; אפור לחסר', () => {
    const db: Db = { meta: { lastModified: 0 } };
    expect(categoryColor(db, 'synagogue')).toBe('#8b5cf6');
    expect(categoryColor(db, undefined)).toBe('#94a3b8');
    expect(categoryColor(db, 'no_such')).toBe('#94a3b8');
  });
});

describe('DEFAULT_CATEGORIES — נאמנות לישן', () => {
  it('אותם 7 מזהים כמו tmCategories', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.id)).toEqual(
      ['residential', 'synagogue', 'education', 'medical', 'business', 'offices', 'irrelevant']
    );
  });
});
