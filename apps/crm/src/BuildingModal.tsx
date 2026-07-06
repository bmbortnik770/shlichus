import { useState } from 'react';
import { type Apartment, type BuildingInfo, type Db, getBuilding, getCategories, liveApts } from '@shlichus/core';
import { FamilyCard } from './FamilyCard';
import { useCrm } from './store';

interface Props {
  db: Db;
  bldg: string;
  onClose: () => void;
}

/** מודל בניין — כמו buildingModal בישן: רשימת דירות + טאב פרטי בניין */
export function BuildingModal({ db, bldg, onClose }: Props) {
  const updateApt = useCrm((s) => s.updateApt);
  const addApt = useCrm((s) => s.addApt);
  const updateBuildingInfo = useCrm((s) => s.updateBuildingInfo);
  const [tab, setTab] = useState<'apts' | 'info'>('apts');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const entry = getBuilding(db, bldg);
  const apts = liveApts(entry?.apts);
  const info: BuildingInfo = entry?.info ?? {};

  const units = (info.units ?? {}) as { count?: number };
  const [infoForm, setInfoForm] = useState({
    code: String(info.code ?? ''),
    rep: String(info.rep ?? ''),
    notes: String(info.notes ?? ''),
    category: String(info.categoryId ?? info.category ?? 'residential'),
    unitsCount: units.count ? String(units.count) : '',
    instName: String((info as Record<string, unknown>).instName ?? ''),
    instPhone: String((info as Record<string, unknown>).instPhone ?? ''),
  });
  const categories = getCategories(db);
  const isInstitution = infoForm.category !== 'residential' && infoForm.category !== 'irrelevant';

  const saveInfo = () => {
    const patch: Record<string, unknown> = {
      code: infoForm.code, rep: infoForm.rep, notes: infoForm.notes, category: infoForm.category,
    };
    const n = parseInt(infoForm.unitsCount, 10);
    if (!isNaN(n) && n >= 1) {
      // אותו מבנה כמו saveManualUnitsCount בישן
      patch.units = { ...(info.units ?? {}), source: 'VERIFIED', count: n, verifiedAt: Date.now() };
    }
    if (isInstitution) { patch.instName = infoForm.instName; patch.instPhone = infoForm.instPhone; }
    void updateBuildingInfo(bldg, patch);
  };

  const selectedApt: Apartment | undefined =
    selectedIdx !== null ? entry?.apts[selectedIdx] : undefined;

  const addFamilyHere = async () => {
    const created = await addApt(bldg);
    if (created) setSelectedIdx(created.idx);
  };

  const navUrl = info.coords
    ? `https://waze.com/ul?ll=${info.coords[1]},${info.coords[0]}&navigate=yes`
    : '';

  if (selectedApt && selectedIdx !== null) {
    return (
      <FamilyCard
        bldg={bldg}
        apt={selectedApt}
        onClose={() => setSelectedIdx(null)}
        onSave={(patch) => updateApt(bldg, selectedIdx, patch)}
      />
    );
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2><i className="fas fa-building" style={{ color: 'var(--accent)', marginInlineEnd: 8 }} />{bldg}</h2>
          <div className="drawer-actions">
            {navUrl && (
              <a className="close-btn" href={navUrl} target="_blank" rel="noreferrer" title="ניווט">
                <i className="fas fa-route" style={{ color: 'var(--accent)' }} />
              </a>
            )}
            <button className="close-btn" onClick={onClose} aria-label="סגירה">✕</button>
          </div>
        </header>
        <p className="drawer-sub">{apts.length} משפחות בבניין</p>

        <div className="card-tabs">
          <button className={tab === 'apts' ? 'active' : ''} onClick={() => setTab('apts')}>
            <i className="fas fa-users" /> דירות
          </button>
          <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>
            <i className="fas fa-info-circle" /> פרטי בניין
          </button>
        </div>

        {tab === 'apts' && (
          <>
            <div className="bldg-fam-list">
              {apts.length === 0 && <p className="placeholder">אין משפחות בבניין הזה עדיין.</p>}
              {apts.map((a) => {
                const realIdx = entry!.apts.indexOf(a);
                return (
                  <button className="bldg-fam-item" key={realIdx} onClick={() => setSelectedIdx(realIdx)}>
                    <span className="fam-name">
                      {a.name || 'ללא שם'}
                      {a.num ? <span className="fam-num"> (דירה {a.num})</span> : null}
                    </span>
                    <span className="fam-style">{a.style ?? ''}</span>
                    <i className="fas fa-pen" />
                  </button>
                );
              })}
            </div>
            <button className="edit-btn" onClick={() => void addFamilyHere()}>
              <i className="fas fa-plus" /> הוספת משפחה לבניין
            </button>
          </>
        )}

        {tab === 'info' && (
          <section className="edit-form">
            <label className="edit-field">
              <span>קטגוריה</span>
              <select
                className="board-select"
                value={infoForm.category}
                onChange={(e) => setInfoForm({ ...infoForm, category: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.emoji ?? ''} {c.name}</option>
                ))}
              </select>
            </label>
            {isInstitution && (
              <>
                <label className="edit-field">
                  <span>שם המוסד</span>
                  <input value={infoForm.instName} onChange={(e) => setInfoForm({ ...infoForm, instName: e.target.value })} />
                </label>
                <label className="edit-field">
                  <span>טלפון המוסד</span>
                  <input dir="ltr" value={infoForm.instPhone} onChange={(e) => setInfoForm({ ...infoForm, instPhone: e.target.value })} />
                </label>
              </>
            )}
            <label className="edit-field">
              <span>מספר דירות בבניין</span>
              <input
                type="number" min={1} dir="ltr" style={{ maxWidth: 120 }}
                value={infoForm.unitsCount}
                onChange={(e) => setInfoForm({ ...infoForm, unitsCount: e.target.value })}
              />
            </label>
            <label className="edit-field">
              <span>קוד כניסה</span>
              <input value={infoForm.code} onChange={(e) => setInfoForm({ ...infoForm, code: e.target.value })} />
            </label>
            <label className="edit-field">
              <span>נציג בניין</span>
              <input value={infoForm.rep} onChange={(e) => setInfoForm({ ...infoForm, rep: e.target.value })} />
            </label>
            <label className="edit-field">
              <span>הערות</span>
              <textarea rows={3} value={infoForm.notes} onChange={(e) => setInfoForm({ ...infoForm, notes: e.target.value })} />
            </label>
            <div className="edit-actions">
              <button className="save-btn" onClick={saveInfo}>שמירה</button>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
