import { useMemo, useState } from 'react';
import { type Board, type Db, buildingKeys, getBuilding, liveApts } from '@shlichus/core';
import { useCrm } from './store';

interface Card {
  bldg: string;
  idx: number;
  name: string;
  stage: string;
}

export function KanbanView({ db }: { db: Db }) {
  const updateApt = useCrm((s) => s.updateApt);
  const updateBoards = useCrm((s) => s.updateBoards);
  const boards = (db.__BOARDS__ ?? []).filter((b) => !b.archived);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const board: Board | undefined = boards.find((b) => b.id === boardId) ?? boards[0];

  const newBoard = async () => {
    const name = window.prompt('שם הלוח החדש:');
    if (!name?.trim()) return;
    const b: Board = {
      id: 'b_' + Date.now(), name: name.trim(),
      columns: ['מתעניין חדש', 'בטיפול', 'פעיל קבוע', 'לא רלוונטי'],
      archived: false, updatedAt: Date.now(),
    };
    await updateBoards([...(db.__BOARDS__ ?? []), b]);
    setBoardId(b.id);
  };

  const editColumns = async () => {
    if (!board) return;
    const cur = board.columns.join(', ');
    const next = window.prompt('עמודות הלוח (מופרדות בפסיק):', cur);
    if (!next?.trim()) return;
    const columns = next.split(',').map((c) => c.trim()).filter(Boolean);
    if (columns.length === 0) return;
    await updateBoards(
      (db.__BOARDS__ ?? []).map((b) => (b.id === board.id ? { ...b, columns, updatedAt: Date.now() } : b))
    );
  };

  const cards = useMemo(() => {
    if (!board) return [];
    const out: Card[] = [];
    for (const key of buildingKeys(db)) {
      const entry = getBuilding(db, key);
      if (!entry) continue;
      liveApts(entry.apts).forEach((a) => {
        const stage = (a.boards as Record<string, string> | undefined)?.[board.id];
        if (stage) out.push({ bldg: key, idx: entry.apts.indexOf(a), name: a.name || key, stage });
      });
    }
    return out;
  }, [db, board]);

  const move = (card: Card, stage: string) => {
    const entry = getBuilding(db, card.bldg);
    const apt = entry?.apts[card.idx];
    if (!apt) return;
    void updateApt(card.bldg, card.idx, { boards: { ...(apt.boards ?? {}), [board!.id]: stage } });
  };

  if (!board) {
    return (
      <section>
        <div className="table-toolbar">
          <h2 className="view-title"><i className="fas fa-columns" /> לוחות פרויקטים</h2>
          <button className="edit-btn" onClick={() => void newBoard()}><i className="fas fa-plus" /> לוח חדש</button>
        </div>
        <p className="placeholder">אין לוחות עדיין — צור את הראשון.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title"><i className="fas fa-columns" /> לוחות פרויקטים</h2>
        <select className="board-select" value={board.id} onChange={(e) => setBoardId(e.target.value)}>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="login-btn" onClick={() => void editColumns()}><i className="fas fa-cog" /> ערוך עמודות</button>
        <button className="edit-btn" onClick={() => void newBoard()}><i className="fas fa-plus" /> לוח חדש</button>
        <span className="count">{cards.length} כרטיסים</span>
      </div>
      <div className="kanban">
        {board.columns.map((col) => (
          <div className="kanban-col" key={col}>
            <div className="kanban-col-head">
              {col} <span className="col-count">{cards.filter((c) => c.stage === col).length}</span>
            </div>
            {cards.filter((c) => c.stage === col).map((c) => (
              <div className="kanban-card" key={`${c.bldg}|${c.idx}`}>
                <div className="kanban-card-name">{c.name}</div>
                <select
                  className="stage-select"
                  value={c.stage}
                  onChange={(e) => move(c, e.target.value)}
                  aria-label={`העברת ${c.name} לשלב`}
                >
                  {board.columns.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
