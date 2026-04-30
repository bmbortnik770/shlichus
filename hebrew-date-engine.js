/**
 * ══════════════════════════════════════════════════════
 *  מנוע תאריכים עבריים — Hebrew Date Engine
 *  תלוי ב: jewish-date (נטען מ-CDN לפני קובץ זה)
 *  שימוש: window.HebrewDate.xxxxx()
 * ══════════════════════════════════════════════════════
 */

window.HebrewDate = (function () {

  // ── מיפוי חודשים: אנגלי → עברי ──
  const MONTH_HE = {
    'Tishri':   'תשרי',
    'Cheshvan': 'חשון',
    'Kislev':   'כסלו',
    'Tevet':    'טבת',
    'Shevat':   'שבט',
    'Adar':     'אדר',
    'AdarI':    'אדר א׳',
    'AdarII':   'אדר ב׳',
    'Nisan':    'ניסן',
    'Iyyar':    'אייר',
    'Sivan':    'סיון',
    'Tammuz':   'תמוז',
    'Av':       'אב',
    'Elul':     'אלול',
  };

  // ── רשימת חודשים לתצוגה ב-UI ──
  const MONTHS_FOR_UI = [
    { en: 'Tishri',   he: 'תשרי' },
    { en: 'Cheshvan', he: 'חשון' },
    { en: 'Kislev',   he: 'כסלו' },
    { en: 'Tevet',    he: 'טבת' },
    { en: 'Shevat',   he: 'שבט' },
    { en: 'Adar',     he: 'אדר (שנה רגילה)' },
    { en: 'AdarI',    he: 'אדר א׳ (שנה מעוברת)' },
    { en: 'AdarII',   he: 'אדר ב׳ (שנה מעוברת)' },
    { en: 'Nisan',    he: 'ניסן' },
    { en: 'Iyyar',    he: 'אייר' },
    { en: 'Sivan',    he: 'סיון' },
    { en: 'Tammuz',   he: 'תמוז' },
    { en: 'Av',       he: 'אב' },
    { en: 'Elul',     he: 'אלול' },
  ];

  // סוגי אירועים וההגדרות שלהם
  const EVENT_TYPES = {
    yahrzeit:    { label: 'יארצייט',      icon: 'fa-candle',          color: '#64748b', alertDays: 14, recurring: true },
    birthday:    { label: 'יום הולדת',    icon: 'fa-birthday-cake',   color: '#f59e0b', alertDays: 7,  recurring: true },
    anniversary: { label: 'יום נישואין',  icon: 'fa-heart',           color: '#ec4899', alertDays: 7,  recurring: true },
    bar_mitzva:  { label: 'בר מצווה',     icon: 'fa-star-of-david',   color: '#8b5cf6', alertDays: 30, recurring: false },
    bat_mitzva:  { label: 'בת מצווה',     icon: 'fa-star-of-david',   color: '#8b5cf6', alertDays: 30, recurring: false },
    wedding:     { label: 'חתונה',         icon: 'fa-ring',            color: '#ec4899', alertDays: 30, recurring: false },
    other:       { label: 'אחר',           icon: 'fa-calendar-alt',    color: '#3b82f6', alertDays: 7,  recurring: false },
  };

  // ── פנימי: resolve חודש כשיש שנה מעוברת/רגילה ──
  function _resolveMonth(monthName, year) {
    const isLeap = jewishDate.isLeapYear(year);
    const months = jewishDate.getJewishMonthsInOrder(year, isLeap);
    if (months.includes(monthName)) return monthName;
    // אדר ב' בשנה רגילה → אדר
    if (monthName === 'AdarII' && !isLeap) return 'Adar';
    // אדר בשנה מעוברת → אדר ב'
    if (monthName === 'Adar' && isLeap) return 'AdarII';
    return monthName;
  }

  // ══════════════════════════════════════════════
  //  API ציבורי
  // ══════════════════════════════════════════════

  /**
   * המר תאריך לועזי לעברי
   * @param {Date|string} date
   * @returns {{ year, month, monthName, monthHe, day, display, short }}
   */
  function fromGregorian(date) {
    const d = date instanceof Date ? date : new Date(date);
    const jDate = jewishDate.toJewishDate(d);
    const heDisplay = jewishDate.formatJewishDateInHebrew(jDate);
    const monthHe = MONTH_HE[jDate.monthName] || jDate.monthName;
    return {
      year:      jDate.year,
      month:     jDate.month,
      monthName: jDate.monthName,
      monthHe,
      day:       jDate.day,
      display:   heDisplay,          // י״ד אייר התשפ״ו
      short:     `${jDate.day} ${monthHe}`,  // 14 אייר
    };
  }

  /**
   * המר תאריך עברי ללועזי
   * @param {string} monthName  — שם אנגלי (Tishri, AdarII...)
   * @param {number} day
   * @param {number} year       — שנה עברית
   * @returns {Date}
   */
  function toGregorian(monthName, day, year) {
    const resolved = _resolveMonth(monthName, year);
    return new Date(jewishDate.toGregorianDate({ year, monthName: resolved, day }));
  }

  /**
   * חשב מתי יוצא תאריך עברי קבוע בפעם הבאה
   * @param {string} monthName  — שם חודש אנגלי
   * @param {number} day
   * @returns {{ gregDate: Date, hebrewYear: number, daysUntil: number }}
   */
  function nextOccurrence(monthName, day) {
    const todayHeb = jewishDate.toJewishDate(new Date());
    let year = todayHeb.year;

    // נסה השנה הנוכחית
    const resolved = _resolveMonth(monthName, year);
    const thisYear = new Date(jewishDate.toGregorianDate({ year, monthName: resolved, day }));
    const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);

    if (thisYear > todayMidnight) {
      const daysUntil = Math.round((thisYear - todayMidnight) / 86400000);
      return { gregDate: thisYear, hebrewYear: year, daysUntil };
    }

    // עבר — קח שנה הבאה
    year++;
    const resolvedNext = _resolveMonth(monthName, year);
    const nextYear = new Date(jewishDate.toGregorianDate({ year, monthName: resolvedNext, day }));
    const daysUntil = Math.round((nextYear - todayMidnight) / 86400000);
    return { gregDate: nextYear, hebrewYear: year, daysUntil };
  }

  /**
   * חשב בר/בת מצווה מתאריך לידה לועזי
   * @param {Date|string} birthDate — תאריך לידה לועזי
   * @param {'boy'|'girl'} gender
   * @returns {{ hebrewDate, gregDate: Date, daysUntil: number, hebrewAge: number }}
   */
  function barMitzvaDate(birthDate, gender = 'boy') {
    const bd = birthDate instanceof Date ? birthDate : new Date(birthDate);
    const hBirth = jewishDate.toJewishDate(bd);
    const yearsToAdd = gender === 'boy' ? 13 : 12;
    const targetYear = hBirth.year + yearsToAdd;
    const resolved = _resolveMonth(hBirth.monthName, targetYear);
    const greg = new Date(jewishDate.toGregorianDate({
      year: targetYear,
      monthName: resolved,
      day: hBirth.day
    }));
    const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
    const daysUntil = Math.round((greg - todayMidnight) / 86400000);
    return {
      hebrewDate: fromGregorian(greg),
      gregDate: greg,
      daysUntil,
      hebrewAge: targetYear,
    };
  }

  /**
   * קבל את כל האירועים הקרובים מרשימת משפחות
   * @param {Array} families  — מערך של אובייקטי משפחה מה-DB
   * @param {number} withinDays  — כמה ימים קדימה לבדוק (ברירת מחדל: 30)
   * @returns {Array} אירועים ממוינים לפי קרבה
   */
  function getUpcomingEvents(families, withinDays = 30) {
    const results = [];
    const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);

    families.forEach(({ bldg, apt }) => {
      const milestones = apt.milestones || [];
      milestones.forEach(ms => {
        if (!ms.monthName || !ms.day) return;
        const occ = nextOccurrence(ms.monthName, ms.day);
        if (occ.daysUntil <= withinDays) {
          const typeDef = EVENT_TYPES[ms.type] || EVENT_TYPES.other;
          results.push({
            bldg,
            aptName: apt.name || '',
            type: ms.type,
            label: ms.label || typeDef.label,
            icon: typeDef.icon,
            color: typeDef.color,
            alertDays: typeDef.alertDays,
            daysUntil: occ.daysUntil,
            gregDate: occ.gregDate,
            hebrewYear: occ.hebrewYear,
            hebrewMonthHe: MONTH_HE[ms.monthName] || ms.monthName,
            hebrewDay: ms.day,
            ms, // המקור המלא
          });
        }
      });
    });

    // מיין לפי קרבה
    return results.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  /**
   * בדוק אילו אירועים דורשים משימה אוטומטית היום
   * @param {Array} families
   * @returns {Array} אירועים שצריך ליצור עליהם משימה
   */
  function getAlertsDueToday(families) {
    const all = getUpcomingEvents(families, 60); // בדוק 60 יום
    return all.filter(ev => {
      const typeDef = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
      return ev.daysUntil === typeDef.alertDays;
    });
  }

  /**
   * פורמט יפה לתצוגה — "עוד 3 ימים" / "מחר" / "היום!"
   */
  function formatDaysUntil(daysUntil) {
    if (daysUntil === 0) return '🔴 היום!';
    if (daysUntil === 1) return '🟠 מחר';
    if (daysUntil <= 7)  return `🟡 עוד ${daysUntil} ימים`;
    if (daysUntil <= 30) return `🔵 עוד ${daysUntil} ימים`;
    return `עוד ${daysUntil} יום`;
  }

  /**
   * קבל את היום הזה בלוח העברי — לתצוגה בממשק
   */
  function todayHebrew() {
    return fromGregorian(new Date());
  }

  // ── חשיפת ה-API ──
  return {
    // המרות
    fromGregorian,
    toGregorian,
    // חישובים
    nextOccurrence,
    barMitzvaDate,
    // אירועים
    getUpcomingEvents,
    getAlertsDueToday,
    // עזר
    formatDaysUntil,
    todayHebrew,
    // קבועים לשימוש ב-UI
    EVENT_TYPES,
    MONTHS_FOR_UI,
    MONTH_HE,
  };

})();
