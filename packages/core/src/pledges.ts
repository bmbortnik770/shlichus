/**
 * התחייבויות (pledges) ותרומות מלאות — אותו מבנה כמו pledges.js ו-addDonation במערכת הקיימת:
 * apt.pledges [{id, date, amount, paid, dueDate, campaign, member, notes, status}],
 * donation {date, amount, reason, member, campaign, pledgeId?}.
 */
import type { Db, Donation } from './types.js';
import { getBuilding } from './types.js';
import { type FamilyRef, updateFamily } from './families.js';

export interface Pledge {
  id: string; date: string; amount: number; paid?: number; dueDate?: string; campaign?: string;
  member?: string; notes?: string; status: 'pending' | 'partial' | 'fulfilled' | 'cancelled';
}

export const PLEDGE_STATUS: Record<Pledge['status'], string> = { pending: 'ממתינה', partial: 'שולמה חלקית', fulfilled: 'שולמה', cancelled: 'בוטלה' };

/** סכום ששולם וסטטוס — מחושבים מהתרומות שמקושרות להתחייבות (pledgeId) */
export function recalcPledges(apt: { donations?: Donation[]; pledges?: unknown[] }): Pledge[] {
  const dons = apt.donations ?? [];
  return ((apt.pledges ?? []) as Pledge[]).map((p) => {
    const paid = dons.filter((d) => (d as { pledgeId?: string }).pledgeId === p.id).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const status: Pledge['status'] = p.status === 'cancelled' ? 'cancelled' : paid >= p.amount ? 'fulfilled' : paid > 0 ? 'partial' : 'pending';
    return { ...p, paid, status };
  });
}

export function addPledge(db: Db, ref: FamilyRef, p: { amount: number; dueDate?: string; campaign?: string; member?: string; notes?: string }): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return;
  const pledge: Pledge = {
    id: `p_${Date.now()}`, date: new Date().toISOString().slice(0, 10), amount: p.amount, paid: 0,
    dueDate: p.dueDate ?? '', campaign: p.campaign ?? '', member: p.member ?? 'family', notes: p.notes ?? '', status: 'pending',
  };
  updateFamily(db, ref, { pledges: [...((apt.pledges ?? []) as Pledge[]), pledge] });
}

export function setPledgeCancelled(db: Db, ref: FamilyRef, id: string, cancelled: boolean): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return;
  const pledges = ((apt.pledges ?? []) as Pledge[]).map((p) => (p.id === id ? ({ ...p, status: cancelled ? 'cancelled' : 'pending' } as Pledge) : p));
  updateFamily(db, ref, { pledges: recalcPledges({ donations: apt.donations, pledges }) });
}

export function removePledge(db: Db, ref: FamilyRef, id: string): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return;
  updateFamily(db, ref, { pledges: ((apt.pledges ?? []) as Pledge[]).filter((p) => p.id !== id) });
}

/**
 * תרומה מלאה: סיבה, בן משפחה, קישור להתחייבות. ₪500 ומעלה → משימת תודה אישית
 * (כמו addDonation במערכת הקיימת). מחזיר true אם נוצרה משימת תודה.
 */
export function addDonationFull(db: Db, ref: FamilyRef, d: { amount: number; date?: string; campaign?: string; reason?: string; member?: string; pledgeId?: string }): boolean {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return false;
  const date = d.date || new Date().toISOString().slice(0, 10);
  const don = { date, amount: d.amount, reason: d.reason || 'כללי', member: d.member || 'family', campaign: (d.campaign ?? '').trim(), ...(d.pledgeId ? { pledgeId: d.pledgeId } : {}) } as Donation;
  const donations = [...(apt.donations ?? []), don];
  const thank = d.amount >= 500;
  const patch: Record<string, unknown> = { donations, pledges: recalcPledges({ donations, pledges: apt.pledges }) };
  if (thank) patch.tasks = [...(apt.tasks ?? []), { text: `להתקשר להגיד תודה אישית על התרומה (${d.amount} ש"ח)`, date, done: false }];
  updateFamily(db, ref, patch);
  return thank;
}

export function removeDonation(db: Db, ref: FamilyRef, i: number): void {
  const apt = getBuilding(db, ref.bldg)?.apts[ref.idx];
  if (!apt) return;
  const donations = (apt.donations ?? []).filter((_, j) => j !== i);
  updateFamily(db, ref, { donations, pledges: recalcPledges({ donations, pledges: apt.pledges }) });
}
