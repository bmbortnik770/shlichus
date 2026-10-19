import { create } from 'zustand';
import type { FamilyRef } from '@shlichus/core';

/**
 * ניווט: המסך הנוכחי נשמר בכתובת (#community/map וכו'), כך ש"אחורה" בדפדפן עובד.
 * כרטיס משפחה גלובלי — נפתח מכל מקום (חיפוש, מפה, משימות) מעל המסך הנוכחי.
 */
export type View = 'today' | 'community' | 'messages' | 'tasks' | 'events' | 'donations' | 'connections' | 'settings' | 'activity' | 'more';
export type CommunityTab = 'map' | 'people' | 'circles';

const VIEWS: View[] = ['today', 'community', 'messages', 'tasks', 'events', 'donations', 'connections', 'settings', 'activity', 'more'];
const TAB_KEY = 'shlichus_community_tab';

export function parseHash(): { view: View; tab: CommunityTab; hub: string } {
  const [v, t] = location.hash.replace('#', '').split('/');
  const lastTab = (() => { try { return (localStorage.getItem(TAB_KEY) as CommunityTab) || 'map'; } catch { return 'map'; } })();
  // תאימות לכתובות קודמות (#map)
  if (v === 'map') return { view: 'community', tab: 'map', hub: '' };
  const view = (VIEWS as string[]).includes(v ?? '') ? (v as View) : 'today';
  const tab = (['map', 'people', 'circles'] as string[]).includes(t ?? '') ? (t as CommunityTab) : lastTab;
  // מסך קבוצה (#activity/<קבוצה>) — הקבוצות מוגדרות בסידור התפריט
  return { view, tab, hub: view === 'activity' ? t || 'activity' : '' };
}

export const goHub = (id: string) => { location.hash = `activity/${id}`; };

export function go(view: View, tab?: CommunityTab): void {
  if (view === 'community') {
    const t = tab ?? parseHash().tab;
    try { localStorage.setItem(TAB_KEY, t); } catch { /* */ }
    location.hash = `community/${t}`;
  } else location.hash = view;
}

interface NavState {
  family: FamilyRef | null;
  openFamily: (r: FamilyRef | null) => void;
  /** בניין לפתוח במפה (מטבלת המשפחות וכו') */
  focusKey: string | null;
  showOnMap: (bldg: string) => void;
  paletteOpen: boolean;
  /** נמענים מוכנים לשליחה (מהמסומנים ברשימה) — נצרכים פעם אחת במסך ההודעות */
  msgPreset: string[] | null;
  msgText: string | null;
  sendTo: (keys: string[], text?: string) => void;
  setPalette: (v: boolean) => void;
}

export const useNav = create<NavState>((set) => ({
  family: null,
  openFamily: (family) => set({ family }),
  focusKey: null,
  showOnMap: (bldg) => { set({ focusKey: bldg }); go('community', 'map'); },
  paletteOpen: false,
  msgPreset: null,
  msgText: null,
  sendTo: (keys, text) => { set({ msgPreset: keys, msgText: text ?? null }); go('messages'); },
  setPalette: (paletteOpen) => set({ paletteOpen }),
}));
