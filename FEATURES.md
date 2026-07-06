# מפת תכונות — «השליחות שלי» CRM

> **מסמך זה הוא חוזה המעבר ל-React.**
> נבנה מסריקה שיטתית של הקוד (5.7.2026): ‏~380 פונקציות ציבוריות, 16 מודולים, 20 מודלים, 10 תצוגות.
> כלל ברזל: שום מסך ישן לא נגנז עד שכל הסעיפים שלו מסומנים ✅ בגרסת ה-React ונבדקו ביד.

## מצב v2 (עודכן 6.7.2026, commit אחרון בריפו shlichus-crm)

**קיים ב-v2 ‏(/shlichus/v2/), מכוסה בבדיקות אוטומטיות:** מפה (markers+ניווט לבניין) · טבלת משפחות (חיפוש/מיון/קשר-אחרון) · כרטיס משפחה (צפייה+עריכת פרטים) · משימות (כולל מהשטח, סימון בוצע) · אירועים (שטח+ציוני דרך עבריים) · קנבן (העברת שלבים) · תרומות · מעגלי קשר (צפייה) · תקשורת WhatsApp+מייל (תבניות, תיעוד) · הגדרות (תגיות/סגנונות/תבניות) · סנכרון דו-כיווני בטוח (safeSave + מיזוג tombstones/meta).

**עדיין רק במערכת הקיימת:** עורך טריטוריה וקטגוריות · ייבוא (CSV/Sheets/Contacts) · פעולות bulk · Smart Views · SMS/Twilio · בונה קהלים · ניקוד מלא · פיצול משפחה/נפטר/איש קשר ראשי · onboarding · מיתוג · גיבויים ידניים. **אף מסך ישן לא נגנז.**

---

## 1. תצוגות ראשיות (ניווט)

- [ ] מפה (`map`) — תצוגת ברירת מחדל
- [ ] רשימת משפחות / טבלה (`table` / `list-container`)
- [ ] מרכז תקשורת (`comm`)
- [ ] מרכז פעילות (`activity`) עם 5 תתי-תצוגות: דשבורד · משימות · קנבן · אירועים · מעגלים
- [ ] תרומות גלובליות (`globaldonations`)
- [ ] Command Palette ‏(Ctrl+K) — ניווט, סנכרון, הגדרות, מצב כהה, צפיפות טבלה (palette.js)
- [ ] ESC סוגר מודלים (עם אישור אם יש שינויים — תיקון באג 5)

## 2. מפה וטריטוריה

- [ ] מפת Mapbox עם markers לכל הבניינים + fly-to מבניין בטבלה + fly-to הביתה
- [ ] מצבי צבע markers: לפי סגנון/סטטוס/קטגוריה (`changeMarkerColorMode`, `setItemColor`)
- [ ] החלפת סגנון מפה + לוויין + מצב מעורב (`toggleMapStyle`, `toggleSatellite`, `toggleMixedStyle`)
- [ ] **עורך טריטוריה** (`territoryMapEditorModal`):
  - [ ] ציור תיחום (draw modes, polygon ring closing — `_ensureClosedRing`)
  - [ ] צביעה דינמית: ירוק=בתיחום · כחול=ידני · אדום=הוסר · אפור=מחוץ
  - [ ] טאב סיווג — צביעה לפי קטגוריה
  - [ ] סריקת POI + אישור/דילוג/שיוך מחדש (`tmScanPOIs`, `tmApprovePOI`, `tmSkipPOI`, `tmReassignPOI`)
  - [ ] בניינים ידניים (`tmManualBuildings` + רשימה + מחיקה)
  - [ ] ניהול קטגוריות מלא: 7 ראשיות + תתי-קטגוריות + צבעים + שדות ברירת מחדל (CRUD)
  - [ ] סיווג אוטומטי «מגורים» לבניין חדש
- [ ] Geocoding אוטומטי לכתובות חסרות (proximity + bbox סביב הבית) + תיקון מיקומים גורף (`regeocodeAllBuildings`, `fixOverwrittenCoords`)
- [ ] דיאגרמת מבנים בסיידבר — גרף עוגה Chart.js + פילטר קטגוריה + badge (`toggleBuildingsStats`, `setBldgStatsFilter`)
- [ ] חיפוש כתובת (geocoder) + מודל חיפוש כתובת (`addressSearchModal`)

## 3. כרטיס לקוח (clientModal) — המודל המרכזי

- [ ] 5 טאבים: פרטים · פעילות · אבני דרך · מסמכים · תרומות (`switchCrmTab`)
- [ ] פרטים: שם, טלפונים, מייל, ילדים (+טלפון לילד), תגיות, סגנון/סטטוס, שדות מותאמים
- [ ] שיוך ללוחות קנבן מתוך הכרטיס (`renderModalBoards`, `addModalBoard`)
- [ ] טאב פעילות: ציר זמן משפחתי — לוגים, משימות, מעגלים, מטרות (timeline.js: `renderFamilyActivityTab`, `_tlShowThread`, `_tlSetFilter`)
- [ ] אבני דרך: תאריך עברי ↔ לועזי (hebrew-date-engine), סוגים, חוזרים (`addMilestone`, `setMsInputMode`, `onMsHebYearChange`)
- [ ] מסמכי שיחה (conversation docs): הוספה/עריכה/מחיקה, פילטר ערוץ/סוג, חיפוש, הקלטות (`saveConvDoc`, `setDocsChannelFilter`)
- [ ] תרומות בכרטיס: הוספת תרומה, התחייבויות (pledges), תשלומים, קמפיינים
- [ ] ניקוד מעורבות + badge «קשר אחרון» + סיכון נטישה (scoring.js)
- [ ] פיצול משפחה (`splitFamilyModal`) + שינוי איש קשר ראשי (`openPrimaryChangeUI`)
- [ ] תיעוד נפטר (`deceasedModal`) + החזרה לסטטוס פעיל (`restoreActiveStatus`)
- [ ] סגירה עם בדיקת שינויים לא שמורים (`attemptCloseCrmModal`, `isDirty`)

## 4. כרטיס בניין ומוסד

- [ ] מודל בניין (`buildingModal`): טאב דירות + טאב פרטים (קוד, נציג, הערות, ניווט)
- [ ] עורך יחידות דיור: גרירת משפחות בין קומות, ספירת דירות ידנית (`unitsEditorModal`, `floorDrop`, `saveManualUnitsCount`)
- [ ] כרטיס מוסד (`institutionCardModal`) לבניינים שאינם מגורים — שדות לפי קטגוריה + שדות מותאמים
- [ ] רלוונטיות בניין (`saveBldgRelevance`) + הוספת משפחה מהירה (`quickAddFamily`, `quickAddAptModal`)

## 5. טבלה, חיפוש ופילטרים

- [ ] חיפוש חכם (omni-search עם debounce) + קפיצה לתוצאה
- [ ] Smart Views: שמירה/טעינה/מחיקה + מנהל (`smartViewsManagerModal`, `applySmartView`)
- [ ] פילטרים מתקדמים בקבוצות (`applyAdvFilters`, `openFilterGroup`, `toggleFilterVal`)
- [ ] מיון עמודות + מיון חכם מותאם (`sortByColumn`, `customSmartSort`)
- [ ] הצגת/הסתרת עמודות (`toggleColumnVisibility`) + צפיפות תצוגה (compact/normal/spacious)
- [ ] **פעולות bulk**: בחירת הכל, תגית, לוח, מחיקה, מייל, WhatsApp, טלפון, מסלול ניווט (`bulkRoute`)
- [ ] ייצוא CSV + ייצוא/ייבוא נתונים מלא (`exportData`, `importData`)
- [ ] אשף ייבוא רב-שלבי: CSV / Google Sheets → מיפוי עמודות → תצוגה מקדימה → ביצוע
- [ ] סנכרון Google Contacts: סריקה, התאמה חכמה, ייבוא והשלמת פרטים (`openContactsSync`)

## 6. מרכז תקשורת (comm)

- [ ] 3 ערוצים: WhatsApp · Email · SMS (`switchCommChannel`, `switchCommTab`)
- [ ] תבניות הודעה: יצירה/עריכה/מחיקה/תצוגה מקדימה + משתני מיזוג (`createNewTemplate`, `previewWaTemplate`)
- [ ] בחירת נמענים: מה-DB, ידני, recipient picker + ספירה חיה (`recipientPickerModal`)
- [ ] Email: בחירת ספק (`emailProviderModal`), שולחים (`renderCommSenders`)
- [ ] SMS: ‏Twilio (הגדרות + בדיקה), תור שליחה עם ביטול (`_smsQueueNext`, `cancelSMSQueue`)
- [ ] יומן שיחות: תיעוד שיחה מהירה (`quickCallModal`), פילטר/חיפוש/מיון, תוצאות שיחה
- [ ] לוג תקשורת מרכזי + תיעוד אוטומטי של הודעות שנשלחו (`autoLogSentMessage`)
- [ ] טיוטות נשמרות (`_restoreCommDraft`) + סטטיסטיקות (`updateCommStats`)
- [ ] **בונה קהלים** (audience.js): פילטרים מתקדמים, סגמנטים שמורים, שיתוף קהל בין ערוצים

## 7. אירועים ומועדים

- [ ] תצוגת אירועים: KPI, ציר זמן, טאבים (`renderEventsView`, `_renderEventsKPI`)
- [ ] סוגי אירועים מותאמים + חוזרים שנתית (`eventTypesModal`, `setNewTypeRecurring`)
- [ ] תאריכים עבריים מלאים (hebrew-date-engine.js + jewish-date-browser.js) — ימי הולדת, יארצייט, בר/בת מצווה
- [ ] התראות אירועים קרובים בעליית המערכת (`checkStartupAlerts`) + מעבר מהתראה לאירוע
- [ ] שליחת WhatsApp מאירוע (`sendEventWhatsApp`) + יצירת משימה מאירוע (`addTaskFromEvent`)
- [ ] אירועי מחזור חיים (lifecycle.js): סוגים, התראות, סקשן בכרטיס

## 8. משימות, קנבן, מעגלים, דשבורד

- [ ] משימות גלובליות: יצירה, השלמה, אזכורים (@mentions) של משפחות (tasks.js)
- [ ] קנבן: לוחות מרובים (CRUD + ארכיון), עמודות, גרירת כרטיסים, העברת שלב (kanban.js)
- [ ] מעגלי קשר: יצירה/עריכה/מחיקה, חברים (משפחה/פרט), תצוגת פירוט (circles-hub.js)
- [ ] דשבורד פעילות: סיכומים, משימות להיום עם סימון ביצוע (`renderActivityDashboard`, `markTaskDoneFromDash`)

## 9. תרומות והתחייבויות

- [ ] תרומות בכרטיס משפחה + סטטיסטיקות (`computeDonationStats`)
- [ ] התחייבויות (pledges): יצירה, תשלומים, הסרה
- [ ] קמפיינים: יצירה/הפעלה/כיבוי + הגדרות (`renderCampaignSettings`)
- [ ] דוח תורם (`donorReportModal`)
- [ ] תצוגת תרומות גלובלית: פילטר, מיון (global-donations.js)
- [ ] מעקב יעד (goal tracker) + עריכת יעד

## 10. ניקוד מעורבות (scoring)

- [ ] חישוב ציון מעורבות לפי סוגי אינטראקציה עם משקלים (`computeEngagementScore`)
- [ ] סוגי אינטראקציה מותאמים (CRUD) + כיוון (נכנס/יוצא)
- [ ] תוויות ציון + badge + משפחות בסיכון (`getAtRiskFamilies`)
- [ ] הגדרות ניקוד במסך ההגדרות

## 11. סנכרון וענן (drive.js) — **נבנה מחדש ב-core עם תיקוני הבאגים**

- [ ] Google OAuth (GIS tokenClient) + רענון טוקן שקט + התנתקות + «המשך בלי התחברות» (מצב מקומי)
- [ ] מבנה תיקיות Drive: `השליחות שלי/` ‏+ `field-updates/` + `whatsapp-agent/` + `backups/`
- [ ] קובץ `community_data_final.json` — טעינה, מיזוג, שמירה ‏(**+ תיקונים: res.ok, tombstones, revision check**)
- [ ] שמירה מקומית + autosave בעריכה + תור שמירות ‏(**+ מעבר ל-IndexedDB**)
- [ ] סנכרון אוטומטי כל 30 שניות (מכבד isDirty) + polling עדכוני שטח כל 5 דקות
- [ ] משיכה כפויה מהענן (`forcePullFromDrive`) + סנכרון ידני
- [ ] גיבויים + שחזור מגיבוי
- [ ] **עדכוני שטח**: קליטת outbox מאפליקציית השטח, מודל אישור, החלה בררנית/גורפת, מניעת כפילות (`appliedEventIds`)
- [ ] חיווי סטטוס סנכרון (שומר/נשמר/שגיאה/מצב מקומי) + «עודכן לפני X»

## 12. הגדרות ואישיות

- [ ] מודל הגדרות עם סקשנים מתקפלים
- [ ] צבע ערכת נושא + מצב כהה/בהיר + תצוגה מקדימה
- [ ] תגיות (CRUD), סגנונות/סטטוסים (CRUD + שינוי שם + צבע), שדות מותאמים
- [ ] מיקום בית / ברירת מחדל (`setDefaultLocation`, `toggleHomeLocUI`)
- [ ] מיתוג (branding): לוגו, presets ‏(`brandingModal`)
- [ ] אשף Onboarding לחשבון חדש (מיקום → ציור תיחום → סיום/דילוג)

## 13. חוץ-דפדפן (לא חלק ממעבר ה-React אך אסור לשבור)

- [ ] `whatsapp-crm.gs` — ‏Google Apps Script: ‏WhatsApp → CRM עם Gemini + אישורים (Script Properties)
- [ ] אפליקציית שטח (React/Vite, ריפו `shlichus-field`) — נשארת, עוברת ל-core המשותף בשלב 4
- [ ] `field-sw.js` + `field-manifest.json` — ‏PWA של השטח
- [ ] `landing.html` — דף נחיתה שיווקי
- [ ] `nadlan-scraper.js` — סקריפט Node נפרד (puppeteer) — יוצא לתיקייה משלו

## 14. חוויית שימוש רוחבית

- [ ] עברית + RTL בכל מקום · טוסטים · haptic feedback · אנימציות GSAP (animations.js)
- [ ] תפריט הקשר (context menu): עריכה/העברה/מחיקה
- [ ] FAB בדסקטופ (`toggleDesktopFab`)
- [ ] תאריך עברי בכותרות

---

## נוהל אימות פר-מסך (לפני גניזת מסך ישן)

1. כל סעיף במסך מסומן ✅ בגרסת React.
2. בדיקה ידנית מקבילה: אותה פעולה בישן ובחדש → אותה תוצאה ב-DB.
3. הישן והחדש רצים על **אותו קובץ Drive** — אין מיגרציית נתונים חד-כיוונית לפני שלב 4.
4. tag בגיט לפני כל גניזה (`legacy-<screen>-retired`).
