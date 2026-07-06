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
  const boards = (db.__BOARDS__ ?? []).filter((b) => !b.archived);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const board: Board | undefined = boards.find((b) => b.id === boardId) ?? boards[0];

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

  if (!board) return <p className="placeholder">אין לוחות עדיין — אפשר ליצור במערכת הקיימת.</p>;

  return (
    <section>
      <div className="table-toolbar">
        <h2 className="view-title">קנבן</h2>
        {boards.length > 1 && (
          <select className="board-select" value={board.id} onChange={(e) => setBoardId(e.target.value)}>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
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
