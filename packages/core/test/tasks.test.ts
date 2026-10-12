import { describe, expect, it } from 'vitest';
import { type Db, addTask, listTasks, mergeDb, normalizeDue, setTaskDone, taskGroup } from '../src/index.js';

const now = new Date(2026, 9, 12, 10); // 12.10.2026
const db = (): Db => ({
  meta: { lastModified: 1, generalTasks: [{ text: 'להזמין כיבוד', date: '15.10.2026', done: false }, { text: 'ישן', date: '2026-10-01' }] },
  'א 1': { info: {}, apts: [{ id: 'x', name: 'כהן', tasks: [{ text: 'להתקשר', due: '2026-10-12' }, { text: '', due: '' }] }] },
} as Db);

describe('משימות', () => {
  it('מאחד כלליות ומשפחתיות ומנרמל תאריכים', () => {
    const t = listTasks(db());
    expect(t.map((x) => [x.text, x.due, x.family?.name ?? 'כללית'])).toEqual([
      ['להזמין כיבוד', '2026-10-15', 'כללית'], ['ישן', '2026-10-01', 'כללית'], ['להתקשר', '2026-10-12', 'משפחת כהן'],
    ]);
    expect(normalizeDue('6.7.2026 14:30')).toBe('2026-07-06');
  });

  it('קבוצות לפי מועד', () => {
    const [a, b, c] = listTasks(db());
    expect([taskGroup(a!, now), taskGroup(b!, now), taskGroup(c!, now)]).toEqual(['week', 'overdue', 'today']);
    expect(taskGroup({ ...a!, due: '' }, now)).toBe('nodate');
    expect(taskGroup({ ...a!, due: '2026-12-01' }, now)).toBe('later');
  });

  it('סימון בוצע שורד מיזוג, והוספה כללית ולמשפחה', () => {
    const local = db();
    const remote = db();
    setTaskDone(local, listTasks(local)[0]!, true);
    setTaskDone(local, listTasks(local)[2]!, true);
    addTask(local, 'חדשה', '2026-10-20');
    addTask(local, 'לבקר', '', { bldg: 'א 1', idx: 0 });
    const merged = mergeDb(local, remote);
    const t = listTasks(merged);
    expect(t.find((x) => x.text === 'להזמין כיבוד')!.done).toBe(true);
    expect(t.find((x) => x.text === 'להתקשר')!.done).toBe(true);
    expect(t.map((x) => x.text)).toEqual(expect.arrayContaining(['חדשה', 'לבקר']));
  });
});
