import { useState } from 'react';
import {
  type ConnectorCategory, type ConnectorDef, type Db,
  CONNECTORS, connectorState, getPlan, isConnectorActive, setConnector,
} from '@shlichus/core';
import { Icon } from '../icons';
import { hasValidSession } from '../auth';
import { useStore } from '../store';
import { useToast } from '../ui';

const GROUPS: { key: ConnectorCategory; title: string }[] = [
  { key: 'messages', title: 'הודעות' },
  { key: 'calendar', title: 'לוח שנה' },
  { key: 'payments', title: 'תרומות וקבלות' },
  { key: 'data', title: 'ייבוא וייצוא' },
];

export function Connections({ db }: { db: Db }) {
  const settings = db.__SETTINGS__;
  const plan = getPlan(settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const login = useStore((s) => s.login);
  const showToast = useToast((s) => s.show);

  const toggle = async (def: ConnectorDef) => {
    const on = !connectorState(settings, def.id).enabled;
    if (on && def.needs === 'google' && !hasValidSession()) await login();
    await updateSettings({ connectors: setConnector(settings, def.id, { enabled: on }) });
    showToast(on ? `${def.name} הופעל` : `${def.name} כובה`);
  };

  return (
    <>
      <section className="hello">
        <div>
          <h1>חיבורים</h1>
          <p className="lede">כל חיבור נוסף רק אם אתה צריך אותו. החיבורים החינמיים כבר פעילים, ואת השאר מפעילים בלחיצה.</p>
        </div>
      </section>

      {plan === 'free' && (
        <div className="plan-note">
          <div className="tx">
            <b>אתה בחבילה החינמית</b>
            הנתונים נשמרים בגוגל דרייב שלך. חיבורים שמקבלים מידע מבחוץ (תרומות, WhatsApp עסקי, SMS) וצוות עם כמה משתמשים דורשים את חבילת Pro.
          </div>
          <span className="badge badge-pro">Pro בקרוב</span>
        </div>
      )}

      {GROUPS.map((g) => (
        <section className="conn-group" key={g.key}>
          <h2>{g.title}</h2>
          <div className="conn-grid">
            {CONNECTORS.filter((c) => c.category === g.key).map((c) => (
              <ConnectorCard key={c.id} def={c} db={db} locked={c.plan === 'pro' && plan !== 'pro'} onToggle={() => void toggle(c)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function ConnectorCard({ def, db, locked, onToggle }: { def: ConnectorDef; db: Db; locked: boolean; onToggle: () => void }) {
  const settings = db.__SETTINGS__;
  const active = isConnectorActive(settings, def.id);
  const state = connectorState(settings, def.id);
  const updateSettings = useStore((s) => s.updateSettings);
  const [config, setConfig] = useState<Record<string, string>>(state.config ?? {});

  return (
    <article className="panel conn">
      <div className="conn-top">
        <b>{def.name}</b>
        {def.plan === 'free' ? <span className="badge badge-free">חינם</span> : <span className="badge badge-pro">Pro</span>}
        {def.externalCost && <span className="badge badge-cost">בתשלום לספק</span>}
      </div>
      <p>{def.description}</p>

      {!locked && state.enabled && def.fields && (
        <form className="conn-fields" onSubmit={(e) => { e.preventDefault(); void updateSettings({ connectors: setConnector(settings, def.id, { config }) }); }}>
          {def.fields.map((f) => (
            <label className="field" key={f.key} htmlFor={`${def.id}-${f.key}`}>{f.label}
              <input id={`${def.id}-${f.key}`} type={f.secret ? 'password' : 'text'} value={config[f.key] ?? ''}
                onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} autoComplete="off" />
            </label>
          ))}
          <button className="btn" type="submit">שמירת פרטים</button>
        </form>
      )}

      <div className="conn-foot">
        {locked
          ? <span className="conn-state"><Icon name="lock" size={14} /> זמין בחבילת Pro</span>
          : <span className={`conn-state${active ? ' on' : ''}`}>{active ? 'פעיל' : def.needs === 'google' ? 'דורש התחברות לגוגל' : 'כבוי'}</span>}
        <button className="switch" role="switch" aria-checked={active} aria-label={`${def.name}: ${active ? 'פעיל' : 'כבוי'}`}
          disabled={locked} onClick={onToggle} />
      </div>
    </article>
  );
}
