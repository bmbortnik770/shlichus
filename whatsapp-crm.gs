// ==========================================
// WhatsApp → שליחות CRM  (עם אישור)
// ==========================================

const CONFIG = {
  GEMINI_API_KEY: '',               // ← Gemini API Key
  DB_FILE_NAME: 'community_data_final.json',
  REQUIRE_CONFIRMATION: true,       // ← false = שמור ישירות ללא אישור
  SELF_PHONE: '',                   // ← מספר הטלפון שלך (לזיהוי הודעות לעצמך)
};

// ==========================================
// doPost — שתי פעולות: analyze | confirm
// ==========================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'confirm') {
      return handleConfirm(data.token);
    } else {
      return handleAnalyze(data);
    }
  } catch (err) {
    return jsonResponse({ matched: 'false', error: err.message });
  }
}

// ==========================================
// שלב 1 — האם המספר מוכר? אם כן, נתח
// ==========================================
function handleAnalyze(data) {
  const phone     = (data.phone     || '').replace(/\D/g, '');
  const contact   = data.contact    || '';
  const message   = data.message    || '';
  const timestamp = data.timestamp  || new Date().toISOString();

  // אין טלפון → לא מזהים
  if (!phone || phone.length < 7) {
    return jsonResponse({ matched: 'false' });
  }

  const { file: _f, db } = loadDB();

  // ── הודעה לעצמך = פקודה לCRM ──
  const selfPhone = (CONFIG.SELF_PHONE || '').replace(/\D/g, '');
  if (selfPhone && phone.slice(-8) === selfPhone.slice(-8)) {
    return handleSelfCommand(message, timestamp, db, _f);
  }

  const match = findByPhone(db, phone);

  // מספר לא מוכר במערכת → מתעלמים
  if (!match) {
    return jsonResponse({ matched: 'false' });
  }

  // מספר מוכר → ניתוח עם Gemini
  const analysis = analyzeWithGemini(message, contact, match.fam.name);

  // הודעה לא רלוונטית → מתעלמים
  if (analysis.action === 'ignore') {
    return jsonResponse({ matched: 'false' });
  }

  // מצב שקט — שמור ישירות ללא אישור
  if (!CONFIG.REQUIRE_CONFIRMATION) {
    const { file, db } = loadDB();
    const fam = db[match.bldgKey]?.apts?.[match.idx];
    if (fam) {
      applyAction(fam, analysis, timestamp, message);
      fam.updatedAt = Date.now();
      file.setContent(JSON.stringify(db));
    }
    return jsonResponse({ matched: 'true', status: 'saved', summary: buildSummary(match.fam.name, analysis) });
  }

  // שמור pending ב-CacheService (תקף 6 שעות)
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const pending = {
    bldgKey:   match.bldgKey,
    aptIdx:    match.idx,
    analysis,
    timestamp,
    message:   message.slice(0, 300),
  };
  CacheService.getScriptCache().put(token, JSON.stringify(pending), 21600);

  // סיכום לתצוגה ב-MacroDroid
  const summary = buildSummary(match.fam.name, analysis);

  return jsonResponse({ matched: 'true', summary, token });
}

// ==========================================
// הודעה לעצמך = פקודה על משפחה אחרת
// ==========================================
function handleSelfCommand(message, timestamp, db, file) {
  if (!CONFIG.GEMINI_API_KEY) {
    return jsonResponse({ matched: 'false', error: 'GEMINI_API_KEY required for self-commands' });
  }

  const prompt = `אתה עוזר CRM לשליח חבד. השליח שלח לעצמו פקודה בוואטסאפ.
נתח את הפקודה והחזר JSON בלבד, ללא markdown.

מבנה:
{
  "targetName": "שם המשפחה או האדם שמוזכר בפקודה",
  "action": "task" | "donation" | "interaction" | "ignore",
  "amount": מספר_או_null,
  "notes": "תיאור קצר",
  "taskText": "טקסט המשימה המלא" | null
}

דוגמאות:
"תוסיף משימה לאבי כהן להניח תפילין" → targetName:"אבי כהן", action:"task", taskText:"להניח תפילין"
"יוסי לוי תרם 500 שקל היום" → targetName:"יוסי לוי", action:"donation", amount:500
"ביקרתי את משפחת גולדברג, מעוניינים בשבת" → targetName:"גולדברג", action:"interaction", notes:"ביקור - מעוניינים בשבת"
"קנה חלב" → targetName:null, action:"ignore"

פקודה: ${message}`;

  let parsed;
  try {
    const resp = UrlFetchApp.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        method: 'POST', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 150 }
        })
      }
    );
    const txt = JSON.parse(resp.getContentText())
      .candidates[0].content.parts[0].text.trim()
      .replace(/```json\n?|\n?```/g, '');
    parsed = JSON.parse(txt);
  } catch {
    return jsonResponse({ matched: 'false', error: 'Gemini parse error' });
  }

  if (parsed.action === 'ignore' || !parsed.targetName) {
    return jsonResponse({ matched: 'false' });
  }

  // חיפוש משפחה לפי שם (לא טלפון)
  const match = findByName(db, parsed.targetName);
  if (!match) {
    // לא נמצא — החזר הצעה לשמור ב-unmatched
    return jsonResponse({ matched: 'true', summary: `❓ לא נמצא: ${parsed.targetName} · ${parsed.notes || parsed.taskText || ''}`, token: '__unmatched__:' + parsed.targetName });
  }

  if (!CONFIG.REQUIRE_CONFIRMATION) {
    applyAction(match.fam, parsed, timestamp, message);
    match.fam.updatedAt = Date.now();
    file.setContent(JSON.stringify(db));
    return jsonResponse({ matched: 'true', status: 'saved', summary: buildSummary(match.fam.name, parsed) });
  }

  // שמור pending
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  CacheService.getScriptCache().put(token, JSON.stringify({
    bldgKey: match.bldgKey, aptIdx: match.idx,
    analysis: parsed, timestamp, message: message.slice(0, 300)
  }), 21600);

  return jsonResponse({ matched: 'true', summary: buildSummary(match.fam.name, parsed), token });
}

// חיפוש לפי שם — לפקודות עצמיות
function findByName(db, targetName) {
  const tLow = targetName.trim().toLowerCase();
  const tWords = tLow.split(/\s+/).filter(w => w.length > 1);
  let bestMatch = null;
  let bestScore = 0;

  for (const bldgKey of Object.keys(db)) {
    if (bldgKey.startsWith('__') || bldgKey === 'meta') continue;
    const bldg = db[bldgKey];
    if (!bldg?.apts) continue;

    for (let i = 0; i < bldg.apts.length; i++) {
      const fam = bldg.apts[i];
      const allNames = [fam.name, fam.fatherName, fam.father, fam.motherName, fam.mother,
        ...(fam.childrenList || []).map(c => c.name)]
        .filter(Boolean).map(n => n.toLowerCase());

      let score = 0;
      for (const n of allNames) {
        if (n.includes(tLow) || tLow.includes(n)) { score = 10; break; }
        const matched = tWords.filter(w => n.includes(w)).length;
        if (matched > score) score = matched;
      }

      if (score > bestScore) { bestScore = score; bestMatch = { bldgKey, idx: i, fam }; }
    }
  }

  return bestScore >= 1 ? bestMatch : null;
}

// ==========================================
// שלב 2 — משתמש אישר → שמור ל-DB
// ==========================================
function handleConfirm(token) {
  if (!token) return jsonResponse({ status: 'error', error: 'no token' });

  const raw = CacheService.getScriptCache().get(token);
  if (!raw) return jsonResponse({ status: 'error', error: 'token expired' });

  const { bldgKey, aptIdx, analysis, timestamp, message } = JSON.parse(raw);
  const { file, db } = loadDB();

  const fam = db[bldgKey]?.apts?.[aptIdx];
  if (!fam) return jsonResponse({ status: 'error', error: 'family not found' });

  applyAction(fam, analysis, timestamp, message);
  fam.updatedAt = Date.now();

  file.setContent(JSON.stringify(db));
  CacheService.getScriptCache().remove(token);

  return jsonResponse({ status: 'ok', family: fam.name, action: analysis.action });
}

// ==========================================
// עזר — טעינת DB
// ==========================================
function loadDB() {
  const files = DriveApp.getFilesByName(CONFIG.DB_FILE_NAME);
  if (!files.hasNext()) throw new Error('DB file not found');
  const file = files.next();
  return { file, db: JSON.parse(file.getBlob().getDataAsString('utf-8')) };
}

// ==========================================
// עזר — חיפוש לפי טלפון בלבד
// ==========================================
function findByPhone(db, phone) {
  const last8 = phone.slice(-8);

  for (const bldgKey of Object.keys(db)) {
    if (bldgKey.startsWith('__') || bldgKey === 'meta') continue;
    const bldg = db[bldgKey];
    if (!bldg?.apts) continue;

    for (let i = 0; i < bldg.apts.length; i++) {
      const fam = bldg.apts[i];

      const phones = [fam.fatherPhone, fam.motherPhone, fam.phone, fam.homePhone,
        ...(fam.childrenList || []).map(c => c.phone)]
        .map(p => (p || '').replace(/\D/g, ''))
        .filter(p => p.length >= 7);

      if (phones.some(p => p.slice(-8) === last8)) {
        return { bldgKey, idx: i, fam };
      }
    }
  }
  return null;
}

// ==========================================
// עזר — Gemini
// ==========================================
function analyzeWithGemini(message, contact, familyName) {
  if (!CONFIG.GEMINI_API_KEY) return simpleAnalyze(message);

  const prompt = `אתה עוזר CRM לשליח חבד. נתח הודעת וואטסאפ והחזר JSON בלבד, ללא markdown.

מבנה:
{"action":"donation"|"interaction"|"task"|"ignore","amount":מספר_או_null,"notes":"תיאור קצר","type":"וואטסאפ"|"שיחה"|"ביקור"|"אחר","taskText":"טקסט_משימה_או_null"}

כללים:
- תרומה/כסף/מעשר/הנחה → "donation"
- פגישה/ביקור/שאלה/שיחה → "interaction"
- צריך לעשות/להחזיר/לבדוק → "task"
- שלום/תודה/אוקי/לא רלוונטי → "ignore"

איש קשר: ${contact} | משפחה: ${familyName}
הודעה: ${message}`;

  const resp = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      method: 'POST', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 150 }
      })
    }
  );

  try {
    const txt = JSON.parse(resp.getContentText())
      .candidates[0].content.parts[0].text.trim()
      .replace(/```json\n?|\n?```/g, '');
    return JSON.parse(txt);
  } catch {
    return { action: 'interaction', amount: null, notes: message.slice(0, 120), type: 'וואטסאפ', taskText: null };
  }
}

function simpleAnalyze(message) {
  const m = message;
  if (/תרומ|שקל|₪|\$|דולר|מעשר|פסק/.test(m)) {
    const n = (m.match(/(\d+)/) || [])[1];
    return { action: 'donation', amount: n ? +n : 0, notes: m.slice(0, 100), type: 'תרומה', taskText: null };
  }
  if (/להחזיר|לבדוק|לשלוח|לתאם|תזכיר/.test(m)) {
    return { action: 'task', amount: null, notes: m.slice(0, 100), type: 'אחר', taskText: m.slice(0, 100) };
  }
  if (/^(שלום|תודה|בסדר|אוקי|👍|❤|ok|כן|לא)$/i.test(m.trim())) {
    return { action: 'ignore', amount: null, notes: '', type: 'וואטסאפ', taskText: null };
  }
  return { action: 'interaction', amount: null, notes: m.slice(0, 120), type: 'וואטסאפ', taskText: null };
}

// ==========================================
// עזר — בניית סיכום לתצוגה
// ==========================================
function buildSummary(famName, analysis) {
  const icons = { donation: '💰', interaction: '💬', task: '📋' };
  const icon = icons[analysis.action] || '📌';
  let line = `${icon} ${famName}`;

  if (analysis.action === 'donation' && analysis.amount) {
    line += ` · תרומה ${analysis.amount}₪`;
  } else if (analysis.notes) {
    line += ` · ${analysis.notes.slice(0, 60)}`;
  }
  return line;
}

// ==========================================
// עזר — כתיבה ל-DB
// ==========================================
function applyAction(fam, analysis, timestamp, originalMessage) {
  const date = timestamp.slice(0, 10);

  if (analysis.action === 'donation') {
    if (!fam.donations) fam.donations = [];
    fam.donations.push({ amount: analysis.amount || 0, date, reason: analysis.notes || '', member: 'family' });

  } else if (analysis.action === 'interaction') {
    if (!fam.interactions) fam.interactions = [];
    // חפש אם יש כבר interaction ביום הזה מאותו מקור — אם כן, הוסף להודעות
    const sameDay = fam.interactions.find(i => i.date === date && i.source === 'whatsapp_auto');
    if (sameDay) {
      if (!sameDay.thread) sameDay.thread = [];
      sameDay.thread.push({ from: 'contact', text: originalMessage, ts: timestamp });
      // עדכן notes לסיכום מצטבר
      sameDay.notes = (sameDay.notes || '') + ' | ' + analysis.notes;
    } else {
      fam.interactions.unshift({
        date, type: analysis.type || 'וואטסאפ',
        notes: analysis.notes || originalMessage.slice(0, 200),
        source: 'whatsapp_auto', _ts: timestamp,
        thread: [{ from: 'contact', text: originalMessage, ts: timestamp }]
      });
    }

  } else if (analysis.action === 'task') {
    if (!fam.tasks) fam.tasks = [];
    fam.tasks.push({ text: analysis.taskText || analysis.notes || originalMessage.slice(0, 100), done: false, date });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// בדיקה ידנית מה-editor
// ==========================================
function testAnalyze() {
  const e = { postData: { contents: JSON.stringify({
    action: 'analyze',
    contact: 'יוסי כהן',
    phone: '0501234567',
    message: 'שלום, רציתי לתרום 300 שקל לחנוכה',
    timestamp: new Date().toISOString()
  })}};
  Logger.log(doPost(e).getContent());
}
