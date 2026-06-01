// ==========================================
// WhatsApp → שליחות CRM  (עם אישור)
// ==========================================

// ⚠️ API keys stored in Script Properties — run setupProperties() once to initialize
// File → Project settings → Script properties: GEMINI_API_KEY, SELF_PHONE, SELF_NAME
function _getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY') || '',
    DB_FILE_NAME: 'community_data_final.json',
    REQUIRE_CONFIRMATION: true,
    SELF_PHONE: props.getProperty('SELF_PHONE') || '',
    SELF_NAME: props.getProperty('SELF_NAME') || '',
  };
}
const CONFIG = _getConfig();

// הפעל פעם אחת בלבד להגדרת פרמטרים
function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  // הכנס כאן את הערכים שלך:
  props.setProperty('GEMINI_API_KEY', 'YOUR_GEMINI_KEY_HERE');
  props.setProperty('SELF_PHONE',     '972XXXXXXXXX');
  props.setProperty('SELF_NAME',      'שמך כאן');
  Logger.log('Properties set successfully');
}

// ==========================================
// doPost — שתי פעולות: analyze | confirm
// ==========================================
function doPost(e) {
  try {
    if (e.parameters && e.parameters.action === 'transcribeCall') {
      return handleTranscribeCall(e.parameters);
    }
    if (e.parameters && e.parameters.action === 'confirmCall') {
      return handleConfirmAudio('call_', e.parameters.token || '');
    }
    if (e.parameters && e.parameters.action === 'transcribeVoice') {
      return handleTranscribeVoice(e.parameters);
    }
    if (e.parameters && e.parameters.action === 'confirmVoice') {
      return handleConfirmAudio('voice_', e.parameters.token || '');
    }

    const data = JSON.parse(e.postData.contents);
    if (data.action === 'confirm') return handleConfirm(data.token);
    else return handleAnalyze(data);
  } catch (err) {
    return jsonResponse({ matched: 'false', error: err.message });
  }
}

// ==========================================
// שלב 1 — האם השולח מוכר? אם כן, נתח
// ==========================================
function handleAnalyze(data) {
  // MacroDroid שולח sender (שם) + text (הודעה)
  const sender    = (data.sender    || data.contact || '').trim();
  const message   = (data.text      || data.message || '').trim();
  const timestamp = data.timestamp  || new Date().toISOString();

  if (!sender) return jsonResponse({ matched: 'false' });

  const { file: _f, db } = loadDB();

  // ── הודעה לעצמך = פקודה לCRM ──
  const selfName  = (CONFIG.SELF_NAME  || '').trim().toLowerCase();
  const selfPhone = (CONFIG.SELF_PHONE || '').replace(/\D/g, '');
  const senderLow = sender.toLowerCase();
  if ((selfName && senderLow === selfName) || (selfPhone && sender.replace(/\D/g,'').slice(-8) === selfPhone.slice(-8))) {
    return handleSelfCommand(message, timestamp, db, _f);
  }

  // חיפוש לפי שם (MacroDroid שולח שם איש קשר)
  const match = findByName(db, sender) || findByPhone(db, sender.replace(/\D/g,''));

  // לא מוכר במערכת → מתעלמים
  if (!match) {
    return jsonResponse({ matched: 'false' });
  }

  // מוכר → ניתוח עם Gemini
  const analysis = analyzeWithGemini(message, sender, match.fam.name);

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
    return simpleResponse({ matched: 'true', summary: buildSummary(match.fam.name, analysis) });
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

  return simpleResponse({ matched: 'true', summary, token });
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
    const respData = JSON.parse(resp.getContentText());
    if (!respData.candidates || respData.candidates.length === 0) {
      return jsonResponse({ matched: 'false', error: 'Gemini no candidates' });
    }
    const txt = respData.candidates[0].content.parts[0].text.trim()
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
    return simpleResponse({ matched: 'true', summary: buildSummary(match.fam.name, parsed) });
  }

  // שמור pending
  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  CacheService.getScriptCache().put(token, JSON.stringify({
    bldgKey: match.bldgKey, aptIdx: match.idx,
    analysis: parsed, timestamp, message: message.slice(0, 300)
  }), 21600);

  return simpleResponse({ matched: 'true', summary: buildSummary(match.fam.name, parsed), token });
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
  // תמיכה בשליחת התגובה המלאה: YES|||token|||summary
  if (token && token.startsWith('YES|||')) {
    token = token.split('|||')[1] || '';
  }
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
    const parsed = JSON.parse(resp.getContentText());
    if (!parsed.candidates || parsed.candidates.length === 0) {
      return { action: 'interaction', amount: null, notes: message.slice(0, 120), type: 'וואטסאפ', taskText: null };
    }
    const txt = parsed.candidates[0].content.parts[0].text.trim()
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
      if (sameDay.thread.length < 50) sameDay.thread.push({ from: 'contact', text: originalMessage, ts: timestamp });
      // עדכן notes לסיכום מצטבר (עד 500 תווים)
      const combined = (sameDay.notes || '') + ' | ' + analysis.notes;
      sameDay.notes = combined.slice(0, 500);
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

// תגובה פשוטה למקרודרויד: NO או YES|||token|||summary
function simpleResponse(obj) {
  if (obj.matched !== 'true') return ContentService.createTextOutput('NO');
  if (obj.token) return ContentService.createTextOutput('YES|||' + obj.token + '|||' + (obj.summary || ''));
  return ContentService.createTextOutput('SAVED|||' + (obj.summary || ''));
}

// ==========================================
// בדיקה ידנית מה-editor
// ==========================================
function testDB() {
  try {
    const { db } = loadDB();
    const keys = Object.keys(db).filter(k => !k.startsWith('__') && k !== 'meta');
    Logger.log('✅ DB נטען. מספר בניינים: ' + keys.length);
    Logger.log('דוגמה: ' + keys[0]);
  } catch(e) {
    Logger.log('❌ שגיאה: ' + e.message);
  }
}

function testAnalyze() {
  const e = { postData: { contents: JSON.stringify({
    sender: 'יוסי כהן',
    text: 'שלום, רציתי לתרום 300 שקל לחנוכה',
    timestamp: new Date().toISOString()
  })}};
  Logger.log(doPost(e).getContent());
}

// ==========================================
// הקלטת שיחה חיה — POST מהמכשיר
// ==========================================
function handleTranscribeCall(params) {
  const filename = params.filename || '';
  const audioBase64 = params.audio || '';
  if (!audioBase64) return ContentService.createTextOutput('NO');

  const rawPhone = (filename.match(/[+]?972\d{8,9}|0[5-9]\d{8}/) || [''])[0];
  const phone = rawPhone.replace(/\D/g, '');
  const { db } = loadDB();
  const match = phone.length >= 9 ? findByPhone(db, phone) : null;
  if (!match) return ContentService.createTextOutput('NO');

  const ext = (filename.split('.').pop() || 'm4a').toLowerCase();
  const mimeMap = { m4a: 'audio/m4a', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac', '3gp': 'audio/3gpp' };
  const mimeType = mimeMap[ext] || 'audio/m4a';

  let analysis;
  try { analysis = transcribeCallBase64(audioBase64, mimeType); }
  catch(err) { return ContentService.createTextOutput('NO'); }

  const ts = new Date().toISOString();
  const date = ts.slice(0, 10);
  const token = Utilities.getUuid().replace(/-/g,'').slice(0,12);

  CacheService.getScriptCache().put('call_' + token, JSON.stringify({
    bldgKey: match.bldgKey, aptIdx: match.idx,
    interaction: { date, type: 'שיחה', notes: analysis.summary || '', transcript: analysis.transcript || '', source: 'call_recording_live', _ts: ts },
    tasks: analysis.tasks || [],
    donationAmount: analysis.donation_amount || null,
  }), 21600);

  const taskCount = (analysis.tasks || []).filter(t => t?.trim()).length;
  let summary = '📞 ' + match.fam.name + '\n' + (analysis.summary || '');
  if (taskCount > 0) summary += '\n📋 ' + taskCount + ' משימות';
  return ContentService.createTextOutput('MATCH:::' + token + ':::' + summary);
}

// ==========================================
// הודעה קולית בוואטסאפ — POST מהמכשיר
// ==========================================
function handleTranscribeVoice(params) {
  const sender = (params.sender || '').trim();
  const audioBase64 = params.audio || '';
  const filename = params.filename || '';
  if (!audioBase64 || !sender) return ContentService.createTextOutput('NO');

  const { db } = loadDB();
  const match = findByName(db, sender) || findByPhone(db, sender.replace(/\D/g,''));
  if (!match) return ContentService.createTextOutput('NO');

  const ext = (filename.split('.').pop() || 'opus').toLowerCase();
  const mimeMap = { opus: 'audio/ogg', m4a: 'audio/m4a', mp3: 'audio/mpeg', ogg: 'audio/ogg', aac: 'audio/aac' };
  const mimeType = mimeMap[ext] || 'audio/ogg';

  let analysis;
  try { analysis = transcribeCallBase64(audioBase64, mimeType); }
  catch(err) { return ContentService.createTextOutput('NO'); }

  const ts = new Date().toISOString();
  const date = ts.slice(0, 10);
  const token = Utilities.getUuid().replace(/-/g,'').slice(0,12);

  CacheService.getScriptCache().put('voice_' + token, JSON.stringify({
    bldgKey: match.bldgKey, aptIdx: match.idx,
    interaction: { date, type: 'הודעה קולית', notes: analysis.summary || '', transcript: analysis.transcript || '', source: 'whatsapp_voice', _ts: ts },
    tasks: analysis.tasks || [],
    donationAmount: analysis.donation_amount || null,
  }), 21600);

  const taskCount = (analysis.tasks || []).filter(t => t?.trim()).length;
  let summary = '🎤 ' + match.fam.name + '\n' + (analysis.summary || '');
  if (taskCount > 0) summary += '\n📋 ' + taskCount + ' משימות';
  return ContentService.createTextOutput('MATCH:::' + token + ':::' + summary);
}

// ==========================================
// אישור שמירה — שיחה או הודעה קולית
// ==========================================
function handleConfirmAudio(prefix, token) {
  if (!token) return ContentService.createTextOutput('ERROR:no_token');
  const raw = CacheService.getScriptCache().get(prefix + token);
  if (!raw) return ContentService.createTextOutput('ERROR:expired');

  const { bldgKey, aptIdx, interaction, tasks, donationAmount } = JSON.parse(raw);
  const { file, db } = loadDB();
  const fam = db[bldgKey]?.apts?.[aptIdx];
  if (!fam) return ContentService.createTextOutput('ERROR:notfound');

  if (!fam.interactions) fam.interactions = [];
  fam.interactions.unshift(interaction);

  if (tasks && tasks.length > 0) {
    if (!fam.tasks) fam.tasks = [];
    tasks.filter(t => t?.trim()).forEach(t => fam.tasks.push({ text: t.trim(), done: false, date: interaction.date }));
  }

  if (donationAmount) {
    if (!fam.donations) fam.donations = [];
    fam.donations.unshift({ amount: donationAmount, date: interaction.date, reason: interaction.type, member: 'family' });
  }

  fam.updatedAt = Date.now();
  file.setContent(JSON.stringify(db));
  CacheService.getScriptCache().remove(prefix + token);
  return ContentService.createTextOutput('OK');
}

function transcribeCallBase64(audioBase64, mimeType) {
  const prompt = `אתה עוזר CRM לשליח חבד. תמלל את שיחת הטלפון הזו ותחזיר JSON בלבד ללא markdown:
{
  "transcript": "תמליל מלא של השיחה",
  "summary": "סיכום קצר 2-3 משפטים",
  "tasks": ["משימה 1", "משימה 2"],
  "notes": "נקודות חשובות",
  "donation_amount": null
}
אם יש תרומה שהוזכרה — שים את הסכום ב-donation_amount.`;

  const resp = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      method: 'POST', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inlineData: { mimeType, data: audioBase64 } }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 }
      })
    }
  );

  const txt = JSON.parse(resp.getContentText())
    ?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    ?.replace(/```json\n?|\n?```/g, '');
  return JSON.parse(txt);
}

// ==========================================
// עיבוד הקלטות שיחות — רץ כל 10 דקות
// ==========================================
function processNewCallRecordings() {
  let folder;
  try {
    const folders = DriveApp.getFoldersByName('שיחות CRM');
    if (!folders.hasNext()) { Logger.log('תיקיית שיחות CRM לא נמצאה'); return; }
    folder = folders.next();
  } catch(e) { Logger.log('שגיאה: ' + e.message); return; }

  const { file: dbFile, db } = loadDB();
  const files = folder.getFiles();
  let processed = 0;

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    const desc = file.getDescription() || '';

    if (desc.includes('crm_done')) continue;
    if (!name.match(/\.(m4a|mp3|ogg|wav|aac|3gp)$/i)) continue;

    // חלץ מספר טלפון משם הקובץ (פורמט סמסונג)
    const rawPhone = (name.match(/[+]?972\d{8,9}|0[5-9]\d{8}/) || [''])[0];
    const phone = rawPhone.replace(/\D/g, '');

    const match = phone.length >= 9 ? findByPhone(db, phone) : null;

    if (!match) {
      file.setDescription('crm_done:unknown');
      Logger.log('לא זוהה: ' + name);
      continue;
    }

    try {
      const analysis = transcribeCall(file);
      const fam = match.fam;
      const ts = new Date().toISOString();
      const date = ts.slice(0, 10);

      if (!fam.interactions) fam.interactions = [];
      fam.interactions.unshift({
        date, type: 'שיחה',
        notes: analysis.summary || '',
        transcript: analysis.transcript || '',
        source: 'call_recording',
        _ts: ts,
      });

      if (Array.isArray(analysis.tasks)) {
        if (!fam.tasks) fam.tasks = [];
        analysis.tasks.forEach(t => { if (t?.trim()) fam.tasks.push({ text: t.trim(), done: false, date }); });
      }

      if (analysis.donation_amount) {
        if (!fam.donations) fam.donations = [];
        fam.donations.unshift({ amount: analysis.donation_amount, date, reason: 'שיחת טלפון', member: 'family' });
      }

      fam.updatedAt = Date.now();
      processed++;
      Logger.log('✅ עובד: ' + fam.name + ' · ' + analysis.summary);
      file.setTrashed(true); // מחק מה-Drive אחרי עיבוד

    } catch(err) {
      Logger.log('❌ שגיאה ב-' + name + ': ' + err.message);
      file.setDescription('crm_done:error'); // לא מוחק אם נכשל
    }
  }

  if (processed > 0) dbFile.setContent(JSON.stringify(db));
  Logger.log('סה"כ עובדו: ' + processed);
}

function transcribeCall(file) {
  const blob = file.getBlob();
  const base64Audio = Utilities.base64Encode(blob.getBytes());
  const mimeType = blob.getContentType() || 'audio/m4a';

  const prompt = `אתה עוזר CRM לשליח חבד. תמלל את שיחת הטלפון הזו ותחזיר JSON בלבד ללא markdown:
{
  "transcript": "תמליל מלא של השיחה",
  "summary": "סיכום קצר 2-3 משפטים",
  "tasks": ["משימה 1", "משימה 2"],
  "notes": "נקודות חשובות",
  "donation_amount": null
}
אם יש תרומה שהוזכרה — שים את הסכום ב-donation_amount.`;

  const resp = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      method: 'POST', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Audio } }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 }
      })
    }
  );

  const txt = JSON.parse(resp.getContentText())
    ?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    ?.replace(/```json\n?|\n?```/g, '');
  return JSON.parse(txt);
}

// הפעל פעם אחת כדי לרשום טריגר אוטומטי כל 10 דקות
function setupCallTrigger() {
  // מחק טריגרים קיימים לאותה פונקציה
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processNewCallRecordings') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processNewCallRecordings')
    .timeBased().everyMinutes(10).create();
  Logger.log('✅ טריגר הוגדר — כל 10 דקות');
}
