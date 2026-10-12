/**
 * תרומות — מבוססות על apt.donations (אותו מבנה כמו במערכת הקיימת) וקמפיינים ב-__SETTINGS__.campaigns.
 */
import type { Db, Donation } from './types.js';
import { getBuilding } from './types.js';
import { type FamilyRef, listFamilies, updateFamily } from './families.js';
import { displayName, lastContact } from './today.js';
import { parseLooseDate } from './dates.js';

export interface Campaign { key: string; label: string; year?: number; active?: boolean; goal?: number }
export interface DonationRow { ref: FamilyRef; name: string; date: Date | null; amount: number; campaign: string; i: number }
export interface DonorSummary { ref: FamilyRef; name: string; total: number; count: number; last: Date | null; needsThanks: boolean }

export const GENERAL_CAMPAIGN = 'כללי';

export function getCampaigns(db: Db): Campaign[] {
  return ((db.__SETTINGS__?.campaigns ?? []) as Campaign[]).filter((c) => c && c.label);
}

export function listDonations(db: Db): DonationRow[] {
  const out: DonationRow[] = [];
  for (const r of listFamilies(db)) {
    (r.apt.donations ?? []).forEach((d, i) => {
      const amount = Number(d.amount) || 0;
      if (!amount) return;
      out.push({ ref: { bldg: r.bldg, idx: r.idx }, name: displayName(r.apt) || r.bldg, date: parseLooseDate(d.date), amount, campaign: String(d.campaign ?? '').trim() || GENERAL_CAMPAIGN, i });
    });
  }
  return out.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

/** סיכום לתורם. "צריך תודה" = תרומה ב-thanksDays האחרונים בלי קשר אחריה */
export function donorSummaries(db: Db, now = new Date(), thanksDays = 30): DonorSummary[] {
  const map = new Map<string, DonorSummary>();
  for (const d of listDonations(db)) {
    const k = `${d.ref.bldg}|${d.ref.idx}`;
    const s = map.get(k) ?? { ref: d.ref, name: d.name, total: 0, count: 0, last: null, needsThanks: false };
    s.total += d.amount;
    s.count++;
    if (d.date && (!s.last || d.date > s.last)) s.last = d.date;
    map.set(k, s);
  }
  for (const s of map.values()) {
    const apt = getBuilding(db, s.ref.bldg)?.apts[s.ref.idx];
    const contact = apt ? lastContact(apt) : null;
    const age = s.last ? (now.getTime() - s.last.getTime()) / 86400000 : Infinity;
    s.needsThanks = age >= 0 && age <= thanksDays && (!contact || contact < s.last!);
  }
  return [...map.values()];
}

/** סכומים לפי חודש ל-n החודשים האחרונים (הישן קודם) */
export function monthlyTotals(rows: DonationRow[], months = 12, now = new Date()): { key: string; label: string; total: number }[] {
  const out: { key: string; label: string; total: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('he-IL', { month: 'short' }), total: 0 });
  }
  const idx = new Map(out.map((m, i) => [m.key, i]));
  for (const r of rows) {
    if (!r.date) continue;
    const i = idx.get(`${r.date.getFullYear()}-${r.date.getMonth()}`);
    if (i !== undefined) out[i]!.total += r.amount;
  }
  return out;
}

export function campaignTotals(rows: DonationRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.campaign, (m.get(r.campaign) ?? 0) + r.amount);
  return m;
}

export function addDonation(db: Db, ref: FamilyRef, d: { amount: number; campaign?: string; date?: string }): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return;
  const don: Donation = { date: d.date || new Date().toISOString().slice(0, 10), amount: d.amount, campaign: (d.campaign ?? '').trim() };
  updateFamily(db, ref, { donations: [...(apt.donations ?? []), don] });
}

export function setCampaigns(db: Db, campaigns: Campaign[]): void {
  db.__SETTINGS__ = { ...(db.__SETTINGS__ ?? {}), campaigns, updatedAt: Date.now() };
}
