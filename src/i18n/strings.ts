/**
 * Every piece of text in the product, in the three languages it ships in.
 *
 * The same dictionary drives the interface *and* the generated PDF and Word
 * documents, so switching the language in Settings changes the reports too —
 * labels, headings, the date wording and the reading direction.
 *
 * `Strings` is a closed type, so adding a key without translating it in all
 * three languages is a compile error rather than a missing label in a report.
 */

import type { LogLevel } from '../lib/log';

export const LANGUAGES = ['he', 'ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export type Direction = 'rtl' | 'ltr';

export interface Strings {
  /* meta */
  languageName: string;
  dir: Direction;
  locale: string;

  /* app shell */
  appName: string;
  navDiary: string;
  navReports: string;
  navProjects: string;
  navContacts: string;
  navSettings: string;
  navNew: string;

  /* typeface */
  fontTitle: string;
  fontHint: string;
  fontSample: string;
  fontNote: (kind: string) => string;

  /* storage health */
  dbStuckTitle: string;
  dbStuckBody: string;
  dbFailedBody: string;
  dbRetry: string;

  /* generic actions */
  save: string;
  cancel: string;
  update: string;
  delete: string;
  remove: string;
  edit: string;
  add: string;
  loading: string;
  back: string;
  backToReports: string;
  print: string;

  /* diary list */
  diaryTitle: string;
  newToday: string;
  duplicateLast: string;
  combinedReport: string;
  searchPlaceholder: string;
  noEntriesTitle: string;
  noEntriesBody: string;
  noMatches: string;
  daysCount: (n: number) => string;
  workersShort: (n: number) => string;
  toolsShort: (n: number) => string;
  photosShort: (n: number) => string;
  noDescription: string;
  statusDraft: string;
  statusSigned: string;

  /* entry editor */
  sectionProjectDate: string;
  sectionManagement: string;
  sectionContractors: string;
  sectionEquipment: string;
  sectionWorkDescription: string;
  sectionCasting: string;
  sectionSupervisorNotes: string;
  sectionReceivedToday: string;
  sectionSignatures: string;
  sectionPhotos: string;
  hintProjectDate: string;
  hintManagement: string;
  hintContractors: string;
  hintEquipment: string;
  hintCasting: string;
  hintSignatures: string;
  hintPhotos: string;
  hintDescriptionLines: string;
  addStaff: string;
  addContractor: string;
  addEquipment: string;
  rowNumber: (n: number) => string;
  moveUp: string;
  moveDown: string;
  deleteRow: string;
  markSigned: string;
  markDraft: string;
  deleteEntry: string;
  confirmDeleteEntry: (date: string) => string;
  savedNote: string;
  savingNote: string;
  unsavedNote: string;
  entryExists: string;
  entryExistsBody: string;
  previewButton: string;
  exportPdf: string;
  shareButton: string;
  sharing: string;
  shareNoRoute: string;
  reportPreviewTitle: string;
  reportPreviewOf: (shown: number, total: number) => string;
  exportImage: string;
  /** The heading on the actions menu, and its label for a screen reader. */
  pageActions: string;
  /** Group headings inside it. */
  actionsExport: string;
  actionsPage: string;
  exportWord: string;
  generating: string;
  exporting: string;
  fileCreated: (name: string) => string;
  pdfFailed: string;
  wordFailed: string;
  entrySaved: string;
  entryDeleted: string;
  markedSigned: string;
  markedDraft: string;

  /* form labels — these are also the printed labels */
  labelProject: string;
  labelProjectName: string;
  labelAddress: string;
  labelCompany: string;
  labelDateWeather: string;
  labelDate: string;
  labelWeather: string;
  labelCrewSection: string;
  labelManagement: string;
  labelName: string;
  labelRole: string;
  labelContractor: string;
  labelTrade: string;
  labelWorkers: string;
  labelEquipment: string;
  labelKind: string;
  labelQty: string;
  labelHours: string;
  labelWorkDescription: string;
  labelCasting: string;
  labelDescription: string;
  labelSizeQty: string;
  labelPump: string;
  labelConcrete: string;
  labelConcreteType: string;
  labelConcreteQty: string;
  labelNotes: string;
  labelSupervisorNotes: string;
  labelReceivedToday: string;
  labelSupervisorSignature: string;
  labelManagerSignature: string;
  labelConcreteTypeNote: string;

  /* placeholders */
  phFullName: string;
  phRole: string;
  phTrade: string;
  phEquipment: string;
  phHours: string;
  phWeather: string;
  phCastingDescription: string;
  phSizeQty: string;
  phPump: string;
  phConcreteType: string;
  phConcreteQty: string;
  phWorkDescription: string;
  phSupervisorNotes: string;
  phReceivedToday: string;
  phProjectName: string;
  phAddress: string;
  phCompany: string;
  phCaption: string;

  /* signatures + photos */
  signHere: (label: string) => string;
  signed: (label: string) => string;
  signAgain: string;
  clear: string;
  saveSignature: string;
  addPhotos: string;
  takePhoto: string;
  photosSummary: (count: number, size: string) => string;
  deletePhoto: string;
  photoLoadFailed: string;
  photoNumber: (n: number) => string;

  /* סל מחיקה */
  trashTitle: string;
  trashOpen: string;
  trashBlurb: string;
  trashEmptyTitle: string;
  trashEmptyBody: string;
  trashDeletedOn: (when: string) => string;
  trashRestore: string;
  trashDeleteForever: string;
  trashEmptyAll: string;
  trashRestored: (n: number) => string;
  trashPurged: (n: number) => string;
  trashClash: string;
  confirmPurge: (n: number) => string;
  backToDiary: string;

  /* projects */
  projectsTitle: string;
  newProject: string;
  noProjectsTitle: string;
  noProjectsBody: string;
  restoreInstead: string;
  activeProject: string;
  makeActive: string;
  editDetails: string;
  switchedTo: (name: string) => string;
  projectAdded: string;
  projectUpdated: string;
  projectDeleted: string;
  projectNameRequired: string;
  confirmDeleteProject: (name: string, count: number) => string;
  startTitle: string;
  startBody: string;
  startAction: string;

  /* ספקים וקבלנים — the site's address book */
  contactsTitle: string;
  contactsBlurb: string;
  newContact: string;
  noContactsTitle: string;
  noContactsBody: string;
  searchContacts: string;
  contactsCount: (n: number) => string;
  contactDeleted: string;
  contactNo: string;
  labelContactName: string;
  labelContactTrade: string;
  labelContactPhone: string;
  labelContactProjects: string;
  labelContactNotes: string;
  phContactName: string;
  phContactTrade: string;
  phContactPhone: string;
  phContactProjects: string;
  phContactNotes: string;
  callContact: (name: string) => string;
  deleteContact: string;
  unnamedContact: string;
  contactsPrint: string;
  contactsExport: string;
  contactsImport: string;
  contactsImported: (added: number, updated: number) => string;
  contactsImportEmpty: string;
  contactsImportFailed: string;
  contactsNothingToExport: string;

  /* reports */
  reportsTitle: string;
  period: string;
  fromDate: string;
  toDate: string;
  prevMonth: string;
  thisMonth: string;
  nextMonth: string;
  invalidRange: string;
  reportContent: string;
  includeSummary: string;
  includePhotos: string;
  periodSummary: string;
  noEntriesInRange: string;
  statDiaryDays: string;
  statActiveDays: string;
  statCastingDays: string;
  statConcreteTotal: string;
  statSigned: string;
  statPhotos: string;
  summaryTrades: string;
  summaryEquipment: string;
  summaryConcrete: string;
  unitWorkers: string;
  unitHours: string;
  unitCubicMetres: string;
  unitDays: string;
  detail: string;
  total: string;
  generateReportPdf: (days: number) => string;
  reportCovers: (from: string, to: string) => string;
  reportFailed: string;

  /* settings */
  settingsTitle: string;
  display: string;
  displayHint: string;
  themeLight: string;
  themeDark: string;
  themeBlack: string;
  themeAuto: string;
  themeLightHint: string;
  themeDarkHint: string;
  themeBlackHint: string;
  themeAutoHint: string;
  language: string;
  languageHint: string;
  companyLogo: string;
  companyLogoHint: string;
  noLogo: string;
  uploadLogo: string;
  replaceLogo: string;
  logoSaved: string;
  logoRemoved: string;
  logoFailed: string;
  backupNowAction: string;
  backupSaved: (where: string) => string;
  backupNever: string;
  backupLast: (when: string) => string;
  backupWhere: (where: string) => string;
  backupTitle: string;
  backupHint: string;
  downloadBackup: string;
  restoreBackup: string;
  exportAll: string;
  exportAllHint: string;
  exportAllFilePrefix: string;
  exportAllWorking: (done: number, total: number) => string;
  exportAllDone: (entries: number, projects: number) => string;
  exportAllEmpty: string;
  exportAllFailed: string;
  storageUsage: (used: string, quota: string) => string;
  storageNotPersisted: string;
  backupDownloaded: string;
  backupFailed: string;
  confirmRestore: string;
  restored: (projects: number, entries: number) => string;
  restoreFailed: string;
  savedLists: string;
  savedListsHint: string;
  presetStaff: string;
  presetRole: string;
  presetTrade: string;
  presetEquipment: string;
  presetWeather: string;
  presetConcrete: string;
  noValuesYet: string;
  addTo: (list: string) => string;
  about: string;
  aboutBody: string;
  installTip: string;

  /* document look */
  docThemeTitle: string;
  docThemeHint: string;
  docThemeNames: Record<'navy' | 'graphite' | 'sky' | 'olive' | 'amber', string>;

  /* sync */
  syncTitle: string;
  syncHostHint: string;
  syncHostOffline: string;
  syncStartHost: string;
  syncPortBusy: string;
  syncHostRetrying: string;
  syncAddressChanged: string;
  syncClientHint: string;
  syncAddress: string;
  syncAddressHint: string;
  syncCode: string;
  syncNewCode: string;
  syncConnect: string;
  syncNow: string;
  syncWorking: string;
  syncForget: string;
  syncForgotten: string;
  syncNeedDetails: string;
  syncNotFound: string;
  syncBadCode: string;
  syncFailed: string;
  syncUnreachable: string;
  syncTimeout: string;
  syncVersionMismatch: string;
  syncProgress: (done: number, total: number) => string;
  syncAuto: string;
  syncAutoHint: string;
  syncAutoReceived: (n: number) => string;
  syncDone: (received: number, sent: number) => string;
  syncLastAt: (when: string) => string;

  /* excel export */
  exportExcel: string;
  excelFailed: string;
  xlsxSheetDays: string;
  xlsxSheetSummary: string;
  xlsxSummaryTitle: string;
  xlsxWeekday: string;
  xlsxManagement: string;
  xlsxConcreteQty: string;
  xlsxPhotos: string;
  xlsxStatus: string;

  /* diary view: grid, list and selection */
  viewOptions: string;
  viewGrid: string;
  viewList: string;
  sortHeading: string;
  sortByDate: string;
  sortByUpdated: string;
  sortByStatus: string;
  selectItems: string;
  selectDone: string;
  selectAll: string;
  selectNone: string;
  selectedCount: (n: number) => string;
  selectNothing: string;
  deleteSelected: string;
  confirmDeleteSelected: (n: number) => string;
  deletedSelected: (n: number) => string;
  reportFromSelected: string;

  /* pin and delete, by swipe or from the selection bar */
  pinAction: string;
  unpinAction: string;
  deleteAction: string;
  pinnedHeading: string;
  pinnedDone: string;
  unpinnedDone: string;
  undo: string;
  undoEdit: string;
  redoEdit: string;
  pinSelected: string;
  pinnedSelected: (n: number) => string;
  swipeHint: string;
  /** When an action on the diary itself fails, rather than an export. */
  actionFailed: string;

  /* saved signatures */
  signaturesTitle: string;
  signaturesHint: string;
  signatureEmpty: string;
  signatureDraw: string;
  signatureRedraw: string;
  signatureUpload: string;
  signatureUploadHint: string;
  signatureSaved: string;
  signatureRemoved: string;
  signatureFailed: string;
  signatureUseSaved: string;

  /* activity log */
  logTitle: string;
  logHint: string;
  logLevel: string;
  logLevelHint: string;
  logLevelNames: Record<LogLevel, string>;
  logShare: string;
  logShareFailed: string;
  logClear: string;
  logCleared: string;
  logEmpty: string;
  logEntries: (n: number) => string;
  logShow: string;
  logHide: string;
  logPrivacy: string;
  fileLogPrefix: string;

  /* documents */
  docWorkDiary: string;
  docCombinedReport: string;
  docPhotoAppendix: string;
  docPage: (n: number, of: number) => string;
  docGeneratedBy: string;
  docNoEntries: string;
  docReportPeriod: string;
  docPhotosInReport: string;
  fileEntryPrefix: string;
  fileReportPrefix: string;
  fileUntil: string;
  fileBackupPrefix: string;
  weekdays: string[];
  /**
   * The same seven days, short enough to sit under a date in a list.
   *
   * A separate array rather than an abbreviation rule, because there isn't one
   * that works in three scripts: English clips to three letters, Hebrew uses
   * the letter-numerals with a geresh, and Arabic drops the article instead.
   */
  weekdaysShort: string[];
  months: string[];
  longDate: (weekday: string, date: string) => string;
}

const he: Strings = {
  languageName: 'עברית',
  dir: 'rtl',
  locale: 'he-IL',

  appName: 'יומן עבודה',
  navDiary: 'יומן',
  navReports: 'דוחות',
  navProjects: 'פרויקטים',
  navContacts: 'ספקים',
  navSettings: 'הגדרות',
  navNew: 'חדש',

  fontTitle: 'גופן',
  fontHint: 'משנה את הגופן בכל האפליקציה. הבחירה נשמרת בנפרד לכל שפה ובמכשיר הזה בלבד.',
  fontSample: 'יומן עבודה 12/08',
  fontNote: (kind) =>
    ({
      system: 'של המכשיר',
      default: 'ברירת מחדל',
      friendly: 'נעים לקריאה',
      rounded: 'עגול',
      serif: 'קלאסי',
      mono: 'רוחב קבוע',
    })[kind] ?? '',
  dbStuckTitle: 'היומן לא נפתח',
  dbStuckBody:
    'ככל הנראה היומן כבר פתוח בחלון או בעותק אחר של האפליקציה, ורק אחד יכול לקרוא את הנתונים. סגור את החלון השני ונסה שוב.',
  dbFailedBody:
    'לא הצלחתי לפתוח את אחסון הנתונים במכשיר הזה. הנתונים לא נמחקו — נסה שוב, ואם זה חוזר שלח את יומן האירועים מההגדרות.',
  dbRetry: 'נסה שוב',

  save: 'שמור',
  cancel: 'ביטול',
  update: 'עדכן',
  delete: 'מחק',
  remove: 'הסר',
  edit: 'ערוך',
  add: 'הוסף',
  loading: 'טוען…',
  back: 'חזרה לעריכה',
  backToReports: 'חזרה לדוחות',
  print: 'הדפס',

  diaryTitle: 'יומן עבודה',
  newToday: 'יומן להיום',
  duplicateLast: 'שכפל את היומן האחרון',
  combinedReport: 'דוח מרוכז',
  searchPlaceholder: 'חיפוש בתאריך, מקצוע, תיאור…',
  noEntriesTitle: 'עדיין אין רישומים',
  noEntriesBody: 'התחל ביומן של היום — הוא ייפתח בתבנית של הטופס המקורי.',
  noMatches: 'לא נמצאו רישומים תואמים',
  daysCount: (n) => (n === 1 ? 'יום אחד' : n === 2 ? 'יומיים' : `${n} ימים`),
  workersShort: (n) => (n === 1 ? 'עובד אחד' : `${n} עובדים`),
  toolsShort: (n) => (n === 1 ? 'כלי אחד' : `${n} כלים`),
  photosShort: (n) => `${n}`,
  noDescription: 'ללא תיאור עבודה',
  statusDraft: 'טיוטה',
  statusSigned: 'פעיל',

  sectionProjectDate: 'פרויקט ותאריך',
  sectionManagement: 'צוות הנהלה',
  sectionContractors: 'קבלנים',
  sectionEquipment: 'ציוד',
  sectionWorkDescription: 'תיאור העבודה שבוצעה',
  sectionCasting: 'פרטי יציקה',
  sectionSupervisorNotes: 'הערות המפקח',
  sectionReceivedToday: 'התקבל היום',
  sectionSignatures: 'חתימות',
  sectionPhotos: 'תמונות מהאתר',
  hintProjectDate: 'שם הפרויקט, הכתובת ושם החברה נלקחים מהפרויקט הפעיל ומודפסים בראש הדף.',
  hintManagement: 'השמות והתפקידים שנרשמים בעמודות הימניות של הטבלה.',
  hintContractors: 'מקצוע וכמות העובדים שהגיעו מכל קבלן.',
  hintEquipment: 'סוג הציוד, הכמות ושעות העבודה.',
  hintCasting: 'השאר ריק בימים ללא יציקה.',
  hintSignatures: 'החתימות מוטמעות בדוח בתחתית הדף.',
  hintPhotos: 'התמונות מודפסות בנספח בסוף הדוח.',
  hintDescriptionLines: 'כל שורה תודפס על שורה נפרדת בטופס.',
  addStaff: 'הוסף איש צוות',
  addContractor: 'הוסף קבלן',
  addEquipment: 'הוסף ציוד',
  rowNumber: (n) => `שורה ${n}`,
  moveUp: 'הזז למעלה',
  moveDown: 'הזז למטה',
  deleteRow: 'מחק שורה',
  markSigned: 'סמן כפעיל',
  markDraft: 'החזר לטיוטה',
  deleteEntry: 'מחק יומן',
  confirmDeleteEntry: (date) => `למחוק את היומן מתאריך ${date}?`,
  savedNote: 'נשמר',
  savingNote: 'שומר…',
  unsavedNote: 'לא נשמר',
  entryExists: 'קיים כבר יומן לתאריך הזה',
  entryExistsBody: 'בחר תאריך אחר כדי לשמור את הדף.',
  previewButton: 'תצוגה מקדימה',
  exportPdf: 'הפק PDF',
  shareButton: 'שתף',
  sharing: 'מכין לשיתוף…',
  shareNoRoute: 'המכשיר הזה לא תומך בשיתוף — הקובץ נשמר במקום',
  reportPreviewTitle: 'תצוגה מקדימה של הדוח',
  reportPreviewOf: (shown, total) => `מוצגים ${shown} מתוך ${total} ימים`,
  exportImage: 'ייצא כתמונה',
  pageActions: 'שיתוף וייצוא',
  actionsExport: 'ייצוא',
  actionsPage: 'הדף',
  exportWord: 'ייצא ל-Word',
  generating: 'מפיק…',
  exporting: 'מייצא…',
  fileCreated: (name) => `נוצר הקובץ ${name}`,
  pdfFailed: 'הפקת ה-PDF נכשלה',
  wordFailed: 'ייצוא ל-Word נכשל',
  entrySaved: 'היומן נשמר',
  entryDeleted: 'היומן נמחק',
  markedSigned: 'היומן סומן כפעיל',
  markedDraft: 'היומן חזר לטיוטה',

  labelProject: 'פרויקט',
  labelProjectName: 'שם הפרויקט',
  labelAddress: 'כתובת',
  labelCompany: 'שם חברה',
  labelDateWeather: 'תאריך – מזג האוויר',
  labelDate: 'תאריך',
  labelWeather: 'מזג אוויר',
  labelCrewSection: 'רישום יומי של עובדים וציוד',
  labelManagement: 'צוות הנהלה',
  labelName: 'שם',
  labelRole: 'תפקיד',
  labelContractor: 'קבלן',
  labelTrade: 'מקצוע',
  labelWorkers: 'כמות עובדים',
  labelEquipment: 'ציוד',
  labelKind: 'סוג',
  labelQty: 'כמות',
  labelHours: 'שט"ע',
  labelWorkDescription: 'תיאור העבודה שבוצעה',
  labelCasting: 'פרטי יציקה',
  labelDescription: 'תיאור',
  labelSizeQty: 'גודל-כמות',
  labelPump: 'משאבה',
  labelConcrete: 'בטון',
  labelConcreteType: 'סוג בטון',
  labelConcreteQty: 'כמות בטון',
  labelNotes: 'הערות',
  labelSupervisorNotes: 'הערות המפקח',
  labelReceivedToday: 'התקבל היום',
  labelSupervisorSignature: 'חתימת מפקח',
  labelManagerSignature: 'חתימת מנ"ע',
  labelConcreteTypeNote: 'סוג בטון (שורת הערות)',

  phFullName: 'שם מלא',
  phRole: 'מנהל עבודה',
  phTrade: 'טפסנות',
  phEquipment: 'מנוף צריח',
  phHours: 'שעות',
  phWeather: 'בהיר, 30°C',
  phCastingDescription: 'תקרת קומה 3',
  phSizeQty: '240 מ"ר',
  phPump: 'משאבה 42 מ׳',
  phConcreteType: 'ב-30',
  phConcreteQty: '58',
  phWorkDescription: 'המשך יציקת תקרה קומה 3…',
  phSupervisorNotes: 'נבדק ברזל הזיון לפני היציקה…',
  phReceivedToday: '20 טון ברזל · 3 משטחי בלוקים…',
  phProjectName: 'מגדלי הים התיכון',
  phAddress: 'רחוב הרצל 15, חיפה',
  phCompany: 'חברה לבנייה בע"מ',
  phCaption: 'כיתוב',

  signHere: (label) => `${label} — חתום באצבע או בעכבר`,
  signed: (label) => `${label} — נחתם`,
  signAgain: 'חתום מחדש',
  clear: 'נקה',
  saveSignature: 'שמור חתימה',
  addPhotos: 'בחר תמונות',
  takePhoto: 'צלם עכשיו',
  photosSummary: (count, size) => `${count} תמונות · ${size}`,
  deletePhoto: 'מחק תמונה',
  photoLoadFailed: 'לא ניתן היה לטעון את התמונות',
  photoNumber: (n) => `תמונה ${n}`,

  trashTitle: 'סל מחיקה',
  trashOpen: 'סל מחיקה',
  trashBlurb: 'יומנים שנמחקו נשמרים כאן עד שתרוקן את הסל. הם לא מופיעים ברשימה ולא נכנסים לדוחות.',
  trashEmptyTitle: 'הסל ריק',
  trashEmptyBody: 'יומן שתמחק יגיע לכאן, ותוכל להחזיר אותו כל עוד לא רוקנת את הסל.',
  trashDeletedOn: (when) => `נמחק ב-${when}`,
  trashRestore: 'שחזור',
  trashDeleteForever: 'מחיקה לצמיתות',
  trashEmptyAll: 'רוקן את הסל',
  trashRestored: (n) => (n === 1 ? 'היומן שוחזר' : `${n} יומנים שוחזרו`),
  trashPurged: (n) => (n === 1 ? 'היומן נמחק לצמיתות' : `${n} יומנים נמחקו לצמיתות`),
  trashClash: 'כבר קיים יומן לתאריך הזה — מחק אותו קודם או שנה את התאריך',
  confirmPurge: (n) =>
    n === 1
      ? 'למחוק את היומן לצמיתות? אי אפשר לבטל את זה.'
      : `למחוק ${n} יומנים לצמיתות? אי אפשר לבטל את זה.`,
  backToDiary: 'חזרה ליומן',
  projectsTitle: 'פרויקטים',
  newProject: 'פרויקט חדש',
  noProjectsTitle: 'אין עדיין פרויקטים',
  noProjectsBody: 'הוסף את האתר הראשון כדי להתחיל לנהל יומן עבודה.',
  restoreInstead: 'כבר יש לי גיבוי — שחזר אותו',
  activeProject: 'פעיל',
  makeActive: 'הפוך לפעיל',
  editDetails: 'ערוך פרטים',
  switchedTo: (name) => `עברת לפרויקט ${name}`,
  projectAdded: 'הפרויקט נוסף',
  projectUpdated: 'הפרויקט עודכן',
  projectDeleted: 'הפרויקט נמחק',
  projectNameRequired: 'חובה להזין שם פרויקט',
  confirmDeleteProject: (name, count) =>
    count > 0
      ? `למחוק את "${name}" ואת ${count} רישומי היומן שלו? הפעולה אינה הפיכה.`
      : `למחוק את "${name}"?`,
  startTitle: 'בואו נתחיל',
  startBody: 'כדי לנהל יומן עבודה צריך קודם להגדיר פרויקט אחד.',
  startAction: 'הגדרת פרויקט',

  contactsTitle: 'ספקים וקבלנים',
  contactsBlurb: 'רשימת אנשי הקשר של האתר — נשמרת במכשיר ומסתנכרנת עם שאר המכשירים.',
  newContact: 'שורה חדשה',
  noContactsTitle: 'הרשימה עדיין ריקה',
  noContactsBody: 'הוסיפו כאן ספקים וקבלנים שעבדתם איתם, כדי שהטלפון שלהם יהיה בהישג יד בפרויקט הבא.',
  searchContacts: 'חיפוש בשם, תחום, טלפון…',
  contactsCount: (n) => (n === 1 ? 'רשומה אחת' : `${n} רשומות`),
  contactDeleted: 'השורה נמחקה',
  contactNo: 'מס׳',
  labelContactName: 'שם קבלן או ספק',
  labelContactTrade: 'תחום התעסקות',
  labelContactPhone: 'מספר טלפון',
  labelContactProjects: 'באיזה פרויקט עבד איתי',
  labelContactNotes: 'הערות כלליות',
  phContactName: 'שם מלא או שם החברה',
  phContactTrade: 'טיח, חשמל, משאבת בטון…',
  phContactPhone: '05X-0000000',
  phContactProjects: 'שם הפרויקט',
  phContactNotes: 'מחירים, זמינות, מה שכדאי לזכור',
  callContact: (name) => `התקשר אל ${name}`,
  deleteContact: 'מחיקת השורה',
  unnamedContact: 'ללא שם',
  contactsPrint: 'הדפסה / PDF',
  contactsExport: 'ייצוא לקובץ',
  contactsImport: 'ייבוא מקובץ',
  contactsImported: (added, updated) =>
    updated === 0
      ? `יובאו ${added} רשומות`
      : `יובאו ${added} רשומות, ${updated} עודכנו`,
  contactsImportEmpty: 'לא נמצאו רשומות בקובץ',
  contactsImportFailed: 'לא הצלחתי לקרוא את הקובץ',
  contactsNothingToExport: 'אין עדיין מה לייצא',

  reportsTitle: 'דוח מרוכז',
  period: 'תקופה',
  fromDate: 'מתאריך',
  toDate: 'עד תאריך',
  prevMonth: 'חודש קודם',
  thisMonth: 'החודש הנוכחי',
  nextMonth: 'חודש הבא',
  invalidRange: 'טווח התאריכים אינו תקין.',
  reportContent: 'תוכן הדוח',
  includeSummary: 'עמוד סיכום בתחילת הדוח',
  includePhotos: 'כלול נספחי תמונות (מגדיל את הקובץ)',
  periodSummary: 'סיכום התקופה',
  noEntriesInRange: 'אין רישומים בטווח שנבחר',
  statDiaryDays: 'ימי יומן',
  statActiveDays: 'ימי עבודה בפועל',
  statCastingDays: 'ימי יציקה',
  statConcreteTotal: 'סה"כ בטון (מ"ק)',
  statSigned: 'יומנים חתומים',
  statPhotos: 'תמונות',
  summaryTrades: 'סה"כ עובדים לפי מקצוע',
  summaryEquipment: 'שעות ציוד לפי סוג',
  summaryConcrete: 'בטון לפי סוג',
  unitWorkers: 'עובדים',
  unitHours: 'שעות',
  unitCubicMetres: 'מ"ק',
  unitDays: 'ימים',
  detail: 'פירוט',
  total: 'סה"כ',
  generateReportPdf: (days) => `הפק דוח PDF (${days} ימים)`,
  reportCovers: (from, to) => `הדוח יכלול את הימים ${from} — ${to}.`,
  reportFailed: 'הפקת הדוח נכשלה',

  settingsTitle: 'הגדרות',
  display: 'תצוגה',
  displayHint: 'בוקר או לילה — הבחירה נשמרת במכשיר הזה.',
  themeLight: 'בוקר',
  themeDark: 'לילה',
  themeBlack: 'שחור',
  themeAuto: 'אוטומטי',
  themeLightHint: 'רקע בהיר',
  themeDarkHint: 'רקע כהה',
  themeBlackHint: 'שחור מלא — נוח לעיניים בלילה וחוסך סוללה במסכי OLED',
  themeAutoHint: 'לפי המכשיר',
  language: 'שפה',
  languageHint: 'משנה את כל האפליקציה ואת הדוחות שמופקים — כותרות, תוויות וכיוון הכתיבה.',
  companyLogo: 'לוגו החברה',
  companyLogoHint: 'מודפס בראש כל דוח PDF ו-Word. מומלץ קובץ PNG עם רקע שקוף.',
  noLogo: 'אין לוגו',
  uploadLogo: 'העלה לוגו',
  replaceLogo: 'החלף לוגו',
  logoSaved: 'הלוגו נשמר ויופיע בדוחות',
  logoRemoved: 'הלוגו הוסר',
  logoFailed: 'לא ניתן היה לטעון את הלוגו',
  backupNowAction: 'גיבוי עכשיו',
  backupSaved: (where) =>
    ({
      mac: 'הגיבוי נשמר בתיקיית מסמכים',
      device: 'הגיבוי נשמר במכשיר',
    })[where] ?? 'הגיבוי נשמר',
  backupNever: 'עדיין לא נשמר גיבוי אוטומטי',
  backupLast: (when) => `גיבוי אחרון: ${when}`,
  backupWhere: (where) =>
    ({
      mac: 'נשמר לבד בתיקיית מסמכים ← "יומן עבודה - גיבויים"',
      device: 'נשמר לבד במכשיר, ונכלל בגיבוי iCloud',
      none: 'בדפדפן אין לאן לשמור לבד — כדאי לייצא גיבוי מדי פעם',
    })[where] ?? '',
  backupTitle: 'גיבוי ושחזור',
  backupHint: 'הנתונים נשמרים במכשיר בלבד. מומלץ לגבות מדי שבוע.',
  downloadBackup: 'ייצוא נתונים',
  restoreBackup: 'ייבוא נתונים',
  exportAll: 'ייצוא הכול',
  exportAllHint: 'כל ימי היומן כקובצי PDF, בתיקייה לכל פרויקט, עם גיליון סיכום לצידם — הכול בקובץ ZIP אחד.',
  exportAllFilePrefix: 'יומן-עבודה-הכול',
  exportAllWorking: (done, total) => `מכין ${done} מתוך ${total}…`,
  exportAllDone: (entries, projects) => `${entries} ימים מ-${projects} פרויקטים`,
  exportAllEmpty: 'אין עדיין ימים לייצוא',
  exportAllFailed: 'הייצוא נכשל',
  storageUsage: (used, quota) => `בשימוש: ${used} מתוך ${quota} הזמינים לאפליקציה במכשיר.`,
  storageNotPersisted:
    'הדפדפן לא הבטיח שמירה קבועה של הנתונים. מומלץ להתקין את האפליקציה למסך הבית, ולגבות באופן קבוע.',
  backupDownloaded: 'הגיבוי הורד',
  backupFailed: 'יצירת הגיבוי נכשלה',
  confirmRestore:
    'שחזור גיבוי ימחק את כל הנתונים הקיימים במכשיר ויחליף אותם בתוכן הקובץ. להמשיך?',
  restored: (projects, entries) => `שוחזרו ${projects} פרויקטים ו-${entries} רישומים`,
  restoreFailed: 'השחזור נכשל',
  savedLists: 'רשימות שמורות',
  savedListsHint: 'הערכים נלמדים אוטומטית מכל יומן שנשמר ומוצעים בהשלמה אוטומטית.',
  presetStaff: 'אנשי צוות',
  presetRole: 'תפקידים',
  presetTrade: 'מקצועות',
  presetEquipment: 'ציוד',
  presetWeather: 'מזג אוויר',
  presetConcrete: 'סוגי בטון',
  noValuesYet: 'אין ערכים עדיין',
  addTo: (list) => `הוסף ל${list}`,
  about: 'אודות',
  aboutBody:
    'יומן עבודה לעבודות בנייה — מבוסס על טופס היומן המודפס. הנתונים נשמרים במכשיר, האפליקציה פועלת גם ללא אינטרנט, והדוחות נוצרים מקומית.',
  installTip: 'טיפ: אפשר להתקין את האפליקציה למסך הבית מתפריט הדפדפן ← "הוסף למסך הבית".',

  docThemeTitle: 'עיצוב המסמך',
  docThemeHint: 'הצבעים של הדוחות שמופקים — PDF, Word והתצוגה המקדימה.',
  docThemeNames: {
    navy: 'כחול ניווט',
    graphite: 'אפור גרפיט',
    sky: 'תכלת',
    olive: 'ירוק זית',
    amber: 'ענבר',
  },

  syncTitle: 'סנכרון בין המכשירים',
  syncHostHint:
    'המחשב הזה משמש כמרכז. בטלפון, בהגדרות ← סנכרון, מזינים את הכתובת והקוד שלמטה — פעם אחת בלבד.',
  syncHostOffline: 'שרת הסנכרון כבוי.',
  syncStartHost: 'הפעל סנכרון',
  syncPortBusy: 'הפורט תפוס — כנראה נשארה גרסה קודמת של האפליקציה פתוחה.',
  syncHostRetrying: 'מנסה שוב לבד…',
  syncAddressChanged: 'ייתכן שכתובת המק השתנתה. בדקו אותה באפליקציית המק ← הגדרות ← סנכרון.',
  syncClientHint:
    'פותחים את אפליקציית המק, נכנסים להגדרות ← סנכרון, ומעתיקים מכאן את הכתובת והקוד. שני המכשירים צריכים להיות על אותה רשת Wi-Fi.',
  syncAddress: 'כתובת המחשב',
  syncAddressHint: 'מופיעה באפליקציית המק, בהגדרות ← סנכרון',
  syncCode: 'קוד',
  syncNewCode: 'צור קוד חדש',
  syncConnect: 'התחבר וסנכרן',
  syncNow: 'סנכרן עכשיו',
  syncWorking: 'מסנכרן…',
  syncForget: 'נתק',
  syncForgotten: 'החיבור נותק',
  syncNeedDetails: 'צריך כתובת וקוד',
  syncNotFound: 'לא נמצא מחשב בכתובת הזו. ודא ששני המכשירים על אותה רשת ושאפליקציית המק פתוחה.',
  syncBadCode: 'הקוד שגוי',
  syncFailed: 'הסנכרון נכשל',
  syncUnreachable: 'לא הצלחתי להגיע למחשב — ודא ששני המכשירים על אותה רשת Wi-Fi ושאפליקציית המק פתוחה',
  syncTimeout: 'הסנכרון לקח יותר מדי זמן ונעצר — נסה שוב קרוב יותר לראוטר',
  syncVersionMismatch: 'גרסאות שונות בשני המכשירים — עדכן את שניהם ונסה שוב',
  syncProgress: (done, total) => `מסנכרן ${done} מתוך ${total}…`,
  syncAuto: 'סנכרון אוטומטי',
  syncAutoHint: 'מסנכרן לבד כשהאפליקציה פתוחה ושני המכשירים על אותה רשת — בפתיחה, בחזרה לאפליקציה, וכל כמה דקות.',
  syncAutoReceived: (n) =>
    n === 1 ? 'התקבל עדכון אחד מהמכשיר השני' : `התקבלו ${n} עדכונים מהמכשיר השני`,
  syncDone: (received, sent) => `הסנכרון הושלם · התקבלו ${received}, נשלחו ${sent}`,
  syncLastAt: (when) => `סנכרון אחרון: ${when}`,

  exportExcel: 'ייצוא ל-Excel',
  excelFailed: 'ייצוא ל-Excel נכשל',
  xlsxSheetDays: 'ימי עבודה',
  xlsxSheetSummary: 'סיכום',
  xlsxSummaryTitle: 'סיכום תקופה',
  xlsxWeekday: 'יום',
  xlsxManagement: 'צוות הנהלה',
  xlsxConcreteQty: 'כמות בטון (מ"ק)',
  xlsxPhotos: 'תמונות',
  xlsxStatus: 'סטטוס',

  viewOptions: 'תצוגה',
  viewGrid: 'רשת',
  viewList: 'רשימה',
  sortHeading: 'מיון',
  sortByDate: 'תאריך',
  sortByUpdated: 'עודכן לאחרונה',
  sortByStatus: 'סטטוס',
  selectItems: 'בחר פריטים',
  selectDone: 'סיום',
  selectAll: 'בחר הכל',
  selectNone: 'נקה בחירה',
  selectedCount: (n) => (n === 1 ? 'אחד נבחר' : `${n} נבחרו`),
  selectNothing: 'לא נבחר אף יומן',
  deleteSelected: 'מחק',
  confirmDeleteSelected: (n) =>
    n === 1 ? 'למחוק יומן אחד? הפעולה אינה הפיכה.' : `למחוק ${n} יומנים? הפעולה אינה הפיכה.`,
  deletedSelected: (n) => (n === 1 ? 'יומן אחד נמחק' : `${n} יומנים נמחקו`),
  reportFromSelected: 'דוח מהנבחרים',

  pinAction: 'הצמד',
  unpinAction: 'בטל הצמדה',
  deleteAction: 'מחק',
  pinnedHeading: 'מוצמדים',
  pinnedDone: 'היומן הוצמד',
  unpinnedDone: 'ההצמדה בוטלה',
  undo: 'בטל',
  undoEdit: 'בטל שינוי',
  redoEdit: 'בצע שוב',
  pinSelected: 'הצמד',
  pinnedSelected: (n) => (n === 1 ? 'יומן אחד הוצמד' : `${n} יומנים הוצמדו`),
  swipeHint: 'החליקו יומן הצידה כדי להצמיד או למחוק',
  actionFailed: 'הפעולה נכשלה',

  signaturesTitle: 'חתימות שמורות',
  signaturesHint: 'חתימה אחת שנשמרת פעם אחת ומוחתמת על כל יומן בלחיצה — במקום לצייר באצבע כל בוקר.',
  signatureEmpty: 'עוד אין חתימה',
  signatureDraw: 'צייר חתימה',
  signatureRedraw: 'צייר מחדש',
  signatureUpload: 'העלה תמונה',
  signatureUploadHint: 'אפשר גם לצלם חתימה על דף לבן ולהעלות — הרקע הלבן יוסר אוטומטית.',
  signatureSaved: 'החתימה נשמרה',
  signatureRemoved: 'החתימה נמחקה',
  signatureFailed: 'לא ניתן היה לשמור את החתימה',
  signatureUseSaved: 'השתמש בחתימה השמורה',

  logTitle: 'יומן אירועים',
  logHint: 'רישום פנימי של מה שהאפליקציה עשתה. עוזר להסביר תקלה שקרתה באתר, גם יום אחרי.',
  logLevel: 'רמת פירוט',
  logLevelHint: '"רגיל" מתאים לשימוש יומיומי. "הכול" מפרט הרבה יותר — כדאי להדליק רק כשמחפשים תקלה.',
  logLevelNames: {
    debug: 'הכול',
    info: 'רגיל',
    warn: 'אזהרות ושגיאות',
    error: 'שגיאות בלבד',
  },
  logShare: 'שלח את היומן',
  logShareFailed: 'שליחת היומן נכשלה',
  logClear: 'נקה יומן',
  logCleared: 'היומן נוקה',
  logEmpty: 'עוד לא נרשם כלום',
  logEntries: (n) => (n === 1 ? 'רשומה אחת' : `${n} רשומות`),
  logShow: 'הצג',
  logHide: 'הסתר',
  logPrivacy: 'היומן רושם פעולות ושגיאות בלבד — לא את תוכן הדוחות, לא שמות ולא תמונות.',
  fileLogPrefix: 'יומן-אירועים',

  docWorkDiary: 'יומן עבודה',
  docCombinedReport: 'דוח מרוכז',
  docPhotoAppendix: 'נספח תמונות',
  docPage: (n, of) => `דף ${n} מתוך ${of}`,
  docGeneratedBy: 'הופק ביומן עבודה',
  docNoEntries: 'לא נמצאו רישומי יומן בתקופה שנבחרה',
  docReportPeriod: 'תקופת הדוח',
  docPhotosInReport: 'תמונות בדוח',
  fileEntryPrefix: 'יומן',
  fileReportPrefix: 'דוח-יומן',
  fileUntil: 'עד',
  fileBackupPrefix: 'גיבוי-יומן-עבודה',
  weekdays: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
  weekdaysShort: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
  months: [
    'ינואר',
    'פברואר',
    'מרץ',
    'אפריל',
    'מאי',
    'יוני',
    'יולי',
    'אוגוסט',
    'ספטמבר',
    'אוקטובר',
    'נובמבר',
    'דצמבר',
  ],
  longDate: (weekday, date) => `יום ${weekday}, ${date}`,
};

const ar: Strings = {
  languageName: 'العربية',
  dir: 'rtl',
  locale: 'ar',

  appName: 'سجل العمل',
  navDiary: 'السجل',
  navReports: 'التقارير',
  navProjects: 'المشاريع',
  navContacts: 'الموردون',
  navSettings: 'الإعدادات',
  navNew: 'جديد',

  fontTitle: 'الخط',
  fontHint: 'يغيّر الخط في كل التطبيق. يُحفظ الاختيار لكل لغة على حدة وعلى هذا الجهاز فقط.',
  fontSample: 'سجل العمل ١٢/٠٨',
  fontNote: (kind) =>
    ({
      system: 'خط الجهاز',
      default: 'الافتراضي',
      friendly: 'مريح للقراءة',
      rounded: 'دائري',
      serif: 'كلاسيكي',
      mono: 'عرض ثابت',
    })[kind] ?? '',
  dbStuckTitle: 'السجل لم يُفتح',
  dbStuckBody:
    'على الأرجح أن السجل مفتوح في نافذة أو نسخة أخرى من التطبيق، ولا يمكن إلا لواحدة قراءة البيانات. أغلق النافذة الأخرى وحاول مرة أخرى.',
  dbFailedBody:
    'تعذّر فتح مخزن البيانات على هذا الجهاز. البيانات لم تُحذف — حاول مرة أخرى، وإذا تكرر ذلك أرسل سجل الأحداث من الإعدادات.',
  dbRetry: 'حاول مرة أخرى',

  save: 'حفظ',
  cancel: 'إلغاء',
  update: 'تحديث',
  delete: 'حذف',
  remove: 'إزالة',
  edit: 'تعديل',
  add: 'إضافة',
  loading: 'جارٍ التحميل…',
  back: 'العودة للتحرير',
  backToReports: 'العودة إلى التقارير',
  print: 'طباعة',

  diaryTitle: 'سجل العمل',
  newToday: 'سجل اليوم',
  duplicateLast: 'نسخ السجل الأخير',
  combinedReport: 'تقرير مجمّع',
  searchPlaceholder: 'بحث بالتاريخ أو المهنة أو الوصف…',
  noEntriesTitle: 'لا توجد سجلات بعد',
  noEntriesBody: 'ابدأ بسجل اليوم — سيُفتح بنفس تنسيق النموذج الأصلي.',
  noMatches: 'لم يتم العثور على سجلات مطابقة',
  /*
   * Arabic counts in four forms, not two: one, a dual, a paucal for three to
   * ten, and the accusative singular from eleven up. `${n} أيام` is only ever
   * right for three to ten of them — it reads as broken for every other count,
   * which on a diary heading is most of the time.
   */
  daysCount: (n) =>
    n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يومًا`,
  workersShort: (n) =>
    n === 1 ? 'عامل واحد' : n === 2 ? 'عاملان' : n <= 10 ? `${n} عمال` : `${n} عاملًا`,
  toolsShort: (n) =>
    n === 1 ? 'معدة واحدة' : n === 2 ? 'معدتان' : n <= 10 ? `${n} معدات` : `${n} معدة`,
  photosShort: (n) => `${n}`,
  noDescription: 'بدون وصف للعمل',
  statusDraft: 'مسودة',
  statusSigned: 'فعال',

  sectionProjectDate: 'المشروع والتاريخ',
  sectionManagement: 'طاقم الإدارة',
  sectionContractors: 'المقاولون',
  sectionEquipment: 'المعدات',
  sectionWorkDescription: 'وصف العمل المنفَّذ',
  sectionCasting: 'تفاصيل الصب',
  sectionSupervisorNotes: 'ملاحظات المشرف',
  sectionReceivedToday: 'ما تم استلامه اليوم',
  sectionSignatures: 'التواقيع',
  sectionPhotos: 'صور من الموقع',
  hintProjectDate: 'اسم المشروع والعنوان واسم الشركة تؤخذ من المشروع النشط وتُطبع أعلى الصفحة.',
  hintManagement: 'الأسماء والوظائف التي تُسجَّل في أعمدة الجدول.',
  hintContractors: 'المهنة وعدد العمال الذين حضروا من كل مقاول.',
  hintEquipment: 'نوع المعدات والكمية وساعات العمل.',
  hintCasting: 'اتركه فارغًا في الأيام التي لا يوجد فيها صب.',
  hintSignatures: 'تُدرج التواقيع في أسفل صفحة التقرير.',
  hintPhotos: 'تُطبع الصور في ملحق بنهاية التقرير.',
  hintDescriptionLines: 'كل سطر سيُطبع في سطر منفصل في النموذج.',
  addStaff: 'إضافة موظف',
  addContractor: 'إضافة مقاول',
  addEquipment: 'إضافة معدات',
  rowNumber: (n) => `صف ${n}`,
  moveUp: 'تحريك للأعلى',
  moveDown: 'تحريك للأسفل',
  deleteRow: 'حذف الصف',
  markSigned: 'وضع علامة فعال',
  markDraft: 'إرجاع إلى مسودة',
  deleteEntry: 'حذف السجل',
  confirmDeleteEntry: (date) => `هل تريد حذف سجل تاريخ ${date}؟`,
  savedNote: 'تم الحفظ',
  savingNote: 'جارٍ الحفظ…',
  unsavedNote: 'لم يُحفظ',
  entryExists: 'يوجد سجل لهذا التاريخ بالفعل',
  entryExistsBody: 'اختر تاريخًا آخر لحفظ الصفحة.',
  previewButton: 'معاينة',
  exportPdf: 'إنشاء PDF',
  shareButton: 'مشاركة',
  sharing: 'جارٍ التحضير للمشاركة…',
  shareNoRoute: 'هذا الجهاز لا يدعم المشاركة — تم حفظ الملف بدلاً من ذلك',
  reportPreviewTitle: 'معاينة التقرير',
  reportPreviewOf: (shown, total) => `يتم عرض ${shown} من ${total} أيام`,
  exportImage: 'تصدير كصورة',
  pageActions: 'مشاركة وتصدير',
  actionsExport: 'تصدير',
  actionsPage: 'الصفحة',
  exportWord: 'تصدير إلى Word',
  generating: 'جارٍ الإنشاء…',
  exporting: 'جارٍ التصدير…',
  fileCreated: (name) => `تم إنشاء الملف ${name}`,
  pdfFailed: 'فشل إنشاء ملف PDF',
  wordFailed: 'فشل التصدير إلى Word',
  entrySaved: 'تم حفظ السجل',
  entryDeleted: 'تم حذف السجل',
  markedSigned: 'تم وضع علامة فعال',
  markedDraft: 'أُعيد السجل إلى مسودة',

  labelProject: 'المشروع',
  labelProjectName: 'اسم المشروع',
  labelAddress: 'العنوان',
  labelCompany: 'اسم الشركة',
  labelDateWeather: 'التاريخ – الطقس',
  labelDate: 'التاريخ',
  labelWeather: 'الطقس',
  labelCrewSection: 'سجل يومي للعمال والمعدات',
  labelManagement: 'طاقم الإدارة',
  labelName: 'الاسم',
  labelRole: 'الوظيفة',
  labelContractor: 'المقاول',
  labelTrade: 'المهنة',
  labelWorkers: 'عدد العمال',
  labelEquipment: 'المعدات',
  labelKind: 'النوع',
  labelQty: 'الكمية',
  labelHours: 'ساعات العمل',
  labelWorkDescription: 'وصف العمل المنفَّذ',
  labelCasting: 'تفاصيل الصب',
  labelDescription: 'الوصف',
  labelSizeQty: 'الحجم والكمية',
  labelPump: 'المضخة',
  labelConcrete: 'الخرسانة',
  labelConcreteType: 'نوع الخرسانة',
  labelConcreteQty: 'كمية الخرسانة',
  labelNotes: 'ملاحظات',
  labelSupervisorNotes: 'ملاحظات المشرف',
  labelReceivedToday: 'ما تم استلامه اليوم',
  labelSupervisorSignature: 'توقيع المشرف',
  labelManagerSignature: 'توقيع مدير العمل',
  labelConcreteTypeNote: 'نوع الخرسانة (سطر الملاحظات)',

  phFullName: 'الاسم الكامل',
  phRole: 'مدير عمل',
  phTrade: 'أعمال الطوبار',
  phEquipment: 'رافعة برجية',
  phHours: 'ساعات',
  phWeather: 'صحو، 30°C',
  phCastingDescription: 'سقف الطابق 3',
  phSizeQty: '240 م²',
  phPump: 'مضخة 42 م',
  phConcreteType: 'ب-30',
  phConcreteQty: '58',
  phWorkDescription: 'متابعة صب سقف الطابق 3…',
  phSupervisorNotes: 'تم فحص حديد التسليح قبل الصب…',
  phReceivedToday: '20 طن حديد · 3 منصات بلوك…',
  phProjectName: 'أبراج البحر المتوسط',
  phAddress: 'شارع هرتسل 15، حيفا',
  phCompany: 'شركة للبناء م.ض',
  phCaption: 'تعليق',

  signHere: (label) => `${label} — وقّع بإصبعك أو بالفأرة`,
  signed: (label) => `${label} — تم التوقيع`,
  signAgain: 'إعادة التوقيع',
  clear: 'مسح',
  saveSignature: 'حفظ التوقيع',
  addPhotos: 'اختيار صور',
  takePhoto: 'التقاط صورة',
  photosSummary: (count, size) => `${count} صور · ${size}`,
  deletePhoto: 'حذف الصورة',
  photoLoadFailed: 'تعذر تحميل الصور',
  photoNumber: (n) => `صورة ${n}`,

  trashTitle: 'سلة المحذوفات',
  trashOpen: 'سلة المحذوفات',
  trashBlurb: 'السجلات المحذوفة تبقى هنا حتى تُفرغ السلة. لا تظهر في القائمة ولا تدخل في التقارير.',
  trashEmptyTitle: 'السلة فارغة',
  trashEmptyBody: 'أي سجل تحذفه سيصل إلى هنا، ويمكنك استعادته ما دامت السلة لم تُفرَّغ.',
  trashDeletedOn: (when) => `حُذف في ${when}`,
  trashRestore: 'استعادة',
  trashDeleteForever: 'حذف نهائي',
  trashEmptyAll: 'إفراغ السلة',
  trashRestored: (n) => (n === 1 ? 'تمت استعادة السجل' : `تمت استعادة ${n} سجلات`),
  trashPurged: (n) => (n === 1 ? 'حُذف السجل نهائيًا' : `حُذفت ${n} سجلات نهائيًا`),
  trashClash: 'يوجد سجل بهذا التاريخ — احذفه أولاً أو غيّر التاريخ',
  confirmPurge: (n) =>
    n === 1
      ? 'حذف السجل نهائيًا؟ لا يمكن التراجع عن ذلك.'
      : `حذف ${n} سجلات نهائيًا؟ لا يمكن التراجع عن ذلك.`,
  backToDiary: 'العودة إلى السجل',
  projectsTitle: 'المشاريع',
  newProject: 'مشروع جديد',
  noProjectsTitle: 'لا توجد مشاريع بعد',
  noProjectsBody: 'أضف الموقع الأول لتبدأ في إدارة سجل العمل.',
  restoreInstead: 'لدي نسخة احتياطية — استعادتها',
  activeProject: 'نشط',
  makeActive: 'اجعله نشطًا',
  editDetails: 'تعديل التفاصيل',
  switchedTo: (name) => `تم التحويل إلى مشروع ${name}`,
  projectAdded: 'تمت إضافة المشروع',
  projectUpdated: 'تم تحديث المشروع',
  projectDeleted: 'تم حذف المشروع',
  projectNameRequired: 'يجب إدخال اسم المشروع',
  confirmDeleteProject: (name, count) =>
    count > 0
      ? `هل تريد حذف "${name}" و${count} من سجلاته؟ لا يمكن التراجع عن هذا.`
      : `هل تريد حذف "${name}"؟`,
  startTitle: 'لنبدأ',
  startBody: 'لإدارة سجل العمل يجب أولًا تعريف مشروع واحد.',
  startAction: 'تعريف مشروع',

  contactsTitle: 'الموردون والمقاولون',
  contactsBlurb: 'دفتر عناوين الموقع — يُحفظ في الجهاز ويتزامن مع بقية الأجهزة.',
  newContact: 'صف جديد',
  noContactsTitle: 'القائمة فارغة حتى الآن',
  noContactsBody: 'أضِف هنا الموردين والمقاولين الذين عملت معهم، ليكون رقم هاتفهم جاهزًا في المشروع القادم.',
  searchContacts: 'بحث بالاسم أو المجال أو الهاتف…',
  contactsCount: (n) => (n === 1 ? 'سجل واحد' : `${n} سجلات`),
  contactDeleted: 'تم حذف الصف',
  contactNo: 'رقم',
  labelContactName: 'اسم المقاول أو المورد',
  labelContactTrade: 'مجال العمل',
  labelContactPhone: 'رقم الهاتف',
  labelContactProjects: 'في أي مشروع عمل معي',
  labelContactNotes: 'ملاحظات عامة',
  phContactName: 'الاسم الكامل أو اسم الشركة',
  phContactTrade: 'قصارة، كهرباء، مضخة باطون…',
  phContactPhone: '05X-0000000',
  phContactProjects: 'اسم المشروع',
  phContactNotes: 'الأسعار، التوفّر، ما يستحق التذكّر',
  callContact: (name) => `الاتصال بـ ${name}`,
  deleteContact: 'حذف الصف',
  unnamedContact: 'بدون اسم',
  contactsPrint: 'طباعة / PDF',
  contactsExport: 'تصدير إلى ملف',
  contactsImport: 'استيراد من ملف',
  contactsImported: (added, updated) =>
    updated === 0
      ? `تم استيراد ${added} سجلات`
      : `تم استيراد ${added} سجلات وتحديث ${updated}`,
  contactsImportEmpty: 'لم يتم العثور على سجلات في الملف',
  contactsImportFailed: 'تعذّرت قراءة الملف',
  contactsNothingToExport: 'لا يوجد ما يُصدَّر بعد',

  reportsTitle: 'تقرير مجمّع',
  period: 'الفترة',
  fromDate: 'من تاريخ',
  toDate: 'إلى تاريخ',
  prevMonth: 'الشهر السابق',
  thisMonth: 'الشهر الحالي',
  nextMonth: 'الشهر التالي',
  invalidRange: 'نطاق التواريخ غير صالح.',
  reportContent: 'محتوى التقرير',
  includeSummary: 'صفحة ملخص في بداية التقرير',
  includePhotos: 'تضمين ملاحق الصور (يزيد حجم الملف)',
  periodSummary: 'ملخص الفترة',
  noEntriesInRange: 'لا توجد سجلات في النطاق المحدد',
  statDiaryDays: 'أيام السجل',
  statActiveDays: 'أيام العمل الفعلية',
  statCastingDays: 'أيام الصب',
  statConcreteTotal: 'إجمالي الخرسانة (م³)',
  statSigned: 'سجلات موقّعة',
  statPhotos: 'الصور',
  summaryTrades: 'إجمالي العمال حسب المهنة',
  summaryEquipment: 'ساعات المعدات حسب النوع',
  summaryConcrete: 'الخرسانة حسب النوع',
  unitWorkers: 'عمال',
  unitHours: 'ساعات',
  unitCubicMetres: 'م³',
  unitDays: 'أيام',
  detail: 'التفصيل',
  total: 'الإجمالي',
  generateReportPdf: (days) => `إنشاء تقرير PDF (${days} أيام)`,
  reportCovers: (from, to) => `سيشمل التقرير الأيام ${from} — ${to}.`,
  reportFailed: 'فشل إنشاء التقرير',

  settingsTitle: 'الإعدادات',
  display: 'العرض',
  displayHint: 'نهاري أو ليلي — يُحفظ الاختيار على هذا الجهاز.',
  themeLight: 'نهاري',
  themeDark: 'ليلي',
  themeBlack: 'أسود',
  themeAuto: 'تلقائي',
  themeLightHint: 'خلفية فاتحة',
  themeDarkHint: 'خلفية داكنة',
  themeBlackHint: 'أسود كامل — أروح للعين ليلاً ويوفّر البطارية في شاشات OLED',
  themeAutoHint: 'حسب الجهاز',
  language: 'اللغة',
  languageHint: 'تغيّر التطبيق بالكامل والتقارير المنشأة — العناوين والتسميات واتجاه الكتابة.',
  companyLogo: 'شعار الشركة',
  companyLogoHint: 'يُطبع أعلى كل تقرير PDF وWord. يُفضل ملف PNG بخلفية شفافة.',
  noLogo: 'لا يوجد شعار',
  uploadLogo: 'رفع شعار',
  replaceLogo: 'استبدال الشعار',
  logoSaved: 'تم حفظ الشعار وسيظهر في التقارير',
  logoRemoved: 'تمت إزالة الشعار',
  logoFailed: 'تعذر تحميل الشعار',
  backupNowAction: 'نسخ احتياطي الآن',
  backupSaved: (where) =>
    ({
      mac: 'حُفظت النسخة في مجلد المستندات',
      device: 'حُفظت النسخة على الجهاز',
    })[where] ?? 'حُفظت النسخة',
  backupNever: 'لم يُحفظ نسخ احتياطي تلقائي بعد',
  backupLast: (when) => `آخر نسخة: ${when}`,
  backupWhere: (where) =>
    ({
      mac: 'تُحفظ تلقائيًا في مجلد المستندات ← "يومن عفودا - نسخ احتياطية"',
      device: 'تُحفظ تلقائيًا على الجهاز وتدخل في نسخة iCloud',
      none: 'في المتصفح لا مكان للحفظ التلقائي — صدّر نسخة من حين لآخر',
    })[where] ?? '',
  backupTitle: 'النسخ الاحتياطي والاستعادة',
  backupHint: 'تُحفظ البيانات على الجهاز فقط. يُنصح بعمل نسخة احتياطية أسبوعيًا.',
  downloadBackup: 'تصدير البيانات',
  restoreBackup: 'استيراد البيانات',
  exportAll: 'تصدير الكل',
  exportAllHint: 'كل أيام السجل كملفات PDF، مجلد لكل مشروع، مع ورقة ملخّص بجانبها — كله في ملف ZIP واحد.',
  exportAllFilePrefix: 'سجل-العمل-الكل',
  exportAllWorking: (done, total) => `يجري التحضير ${done} من ${total}…`,
  exportAllDone: (entries, projects) => `${entries} يومًا من ${projects} مشاريع`,
  exportAllEmpty: 'لا توجد أيام للتصدير بعد',
  exportAllFailed: 'فشل التصدير',
  storageUsage: (used, quota) => `مستخدم: ${used} من ${quota} المتاحة للتطبيق على الجهاز.`,
  storageNotPersisted:
    'لم يضمن المتصفح حفظ البيانات بشكل دائم. يُنصح بتثبيت التطبيق على الشاشة الرئيسية وعمل نسخ احتياطي بانتظام.',
  backupDownloaded: 'تم تنزيل النسخة الاحتياطية',
  backupFailed: 'فشل إنشاء النسخة الاحتياطية',
  confirmRestore:
    'الاستعادة ستحذف كل البيانات الموجودة على الجهاز وتستبدلها بمحتوى الملف. هل تريد المتابعة؟',
  restored: (projects, entries) => `تمت استعادة ${projects} مشاريع و${entries} سجلات`,
  restoreFailed: 'فشلت الاستعادة',
  savedLists: 'القوائم المحفوظة',
  savedListsHint: 'تُتعلَّم القيم تلقائيًا من كل سجل يُحفظ وتُقترح في الإكمال التلقائي.',
  presetStaff: 'الموظفون',
  presetRole: 'الوظائف',
  presetTrade: 'المهن',
  presetEquipment: 'المعدات',
  presetWeather: 'الطقس',
  presetConcrete: 'أنواع الخرسانة',
  noValuesYet: 'لا توجد قيم بعد',
  addTo: (list) => `إضافة إلى ${list}`,
  about: 'حول',
  aboutBody:
    'سجل عمل لأعمال البناء — مبني على نموذج السجل المطبوع. تُحفظ البيانات على الجهاز، ويعمل التطبيق بدون إنترنت، وتُنشأ التقارير محليًا.',
  installTip: 'نصيحة: يمكن تثبيت التطبيق على الشاشة الرئيسية من قائمة المتصفح ← "إضافة إلى الشاشة الرئيسية".',

  docThemeTitle: 'تصميم المستند',
  docThemeHint: 'ألوان التقارير التي تُنشأ — PDF وWord والمعاينة.',
  docThemeNames: {
    navy: 'أزرق داكن',
    graphite: 'رمادي جرافيت',
    sky: 'سماوي',
    olive: 'أخضر زيتوني',
    amber: 'كهرماني',
  },

  syncTitle: 'المزامنة بين الأجهزة',
  syncHostHint:
    'هذا الحاسوب هو المركز. في الهاتف، الإعدادات ← المزامنة، أدخل العنوان والرمز أدناه — مرة واحدة فقط.',
  syncHostOffline: 'خادم المزامنة متوقف.',
  syncStartHost: 'تشغيل المزامنة',
  syncPortBusy: 'المنفذ مشغول — على الأرجح ما زالت نسخة سابقة من التطبيق مفتوحة.',
  syncHostRetrying: 'تتم إعادة المحاولة تلقائيًا…',
  syncAddressChanged: 'ربما تغيّر عنوان الماك. تحقق منه في تطبيق الماك ← الإعدادات ← المزامنة.',
  syncClientHint:
    'افتح تطبيق الماك، ادخل إلى الإعدادات ← المزامنة، وانسخ العنوان والرمز من هناك. يجب أن يكون الجهازان على نفس شبكة Wi-Fi.',
  syncAddress: 'عنوان الحاسوب',
  syncAddressHint: 'يظهر في تطبيق الماك، الإعدادات ← المزامنة',
  syncCode: 'الرمز',
  syncNewCode: 'إنشاء رمز جديد',
  syncConnect: 'اتصال ومزامنة',
  syncNow: 'زامن الآن',
  syncWorking: 'جارٍ المزامنة…',
  syncForget: 'قطع الاتصال',
  syncForgotten: 'تم قطع الاتصال',
  syncNeedDetails: 'مطلوب عنوان ورمز',
  syncNotFound: 'لم يتم العثور على حاسوب بهذا العنوان. تأكد أن الجهازين على نفس الشبكة وأن تطبيق الماك مفتوح.',
  syncBadCode: 'الرمز غير صحيح',
  syncFailed: 'فشلت المزامنة',
  syncUnreachable: 'تعذر الوصول إلى الحاسوب — تأكد أن الجهازين على نفس شبكة Wi-Fi وأن تطبيق الماك مفتوح',
  syncTimeout: 'استغرقت المزامنة وقتاً طويلاً وتوقفت — حاول مجدداً بالقرب من الراوتر',
  syncVersionMismatch: 'إصدارات مختلفة على الجهازين — حدّث كليهما وحاول مجدداً',
  syncProgress: (done, total) => `تتم المزامنة ${done} من ${total}…`,
  syncAuto: 'مزامنة تلقائية',
  syncAutoHint: 'تتم المزامنة تلقائياً عندما يكون التطبيق مفتوحاً والجهازان على نفس الشبكة — عند الفتح، وعند العودة للتطبيق، وكل بضع دقائق.',
  syncAutoReceived: (n) =>
    n === 1
      ? 'تم استلام تحديث واحد من الجهاز الآخر'
      : n === 2
        ? 'تم استلام تحديثين من الجهاز الآخر'
        : n <= 10
          ? `تم استلام ${n} تحديثات من الجهاز الآخر`
          : `تم استلام ${n} تحديثًا من الجهاز الآخر`,
  syncDone: (received, sent) => `اكتملت المزامنة · وردت ${received}، أُرسلت ${sent}`,
  syncLastAt: (when) => `آخر مزامنة: ${when}`,

  exportExcel: 'تصدير إلى Excel',
  excelFailed: 'فشل التصدير إلى Excel',
  xlsxSheetDays: 'أيام العمل',
  xlsxSheetSummary: 'ملخص',
  xlsxSummaryTitle: 'ملخص الفترة',
  xlsxWeekday: 'اليوم',
  xlsxManagement: 'طاقم الإدارة',
  xlsxConcreteQty: 'كمية الباطون (م³)',
  xlsxPhotos: 'صور',
  xlsxStatus: 'الحالة',

  viewOptions: 'العرض',
  viewGrid: 'شبكة',
  viewList: 'قائمة',
  sortHeading: 'الترتيب',
  sortByDate: 'التاريخ',
  sortByUpdated: 'آخر تحديث',
  sortByStatus: 'الحالة',
  selectItems: 'اختيار عناصر',
  selectDone: 'تم',
  selectAll: 'اختيار الكل',
  selectNone: 'إلغاء الاختيار',
  selectedCount: (n) => (n === 1 ? 'واحدة مختارة' : `${n} مختارة`),
  selectNothing: 'لم تُختر أي يومية',
  deleteSelected: 'حذف',
  confirmDeleteSelected: (n) =>
    n === 1
      ? 'حذف يومية واحدة؟ لا يمكن التراجع.'
      : n === 2
        ? 'حذف يوميتين؟ لا يمكن التراجع.'
        : n <= 10
          ? `حذف ${n} يوميات؟ لا يمكن التراجع.`
          : `حذف ${n} يومية؟ لا يمكن التراجع.`,
  deletedSelected: (n) =>
    n === 1
      ? 'تم حذف يومية واحدة'
      : n === 2
        ? 'تم حذف يوميتين'
        : n <= 10
          ? `تم حذف ${n} يوميات`
          : `تم حذف ${n} يومية`,
  reportFromSelected: 'تقرير من المختارة',

  pinAction: 'تثبيت',
  unpinAction: 'إلغاء التثبيت',
  deleteAction: 'حذف',
  pinnedHeading: 'المثبتة',
  pinnedDone: 'تم تثبيت اليومية',
  unpinnedDone: 'أُلغي التثبيت',
  undo: 'تراجع',
  undoEdit: 'تراجع عن التغيير',
  redoEdit: 'إعادة التغيير',
  pinSelected: 'تثبيت',
  pinnedSelected: (n) =>
    n === 1
      ? 'تم تثبيت يومية واحدة'
      : n === 2
        ? 'تم تثبيت يوميتين'
        : n <= 10
          ? `تم تثبيت ${n} يوميات`
          : `تم تثبيت ${n} يومية`,
  swipeHint: 'اسحب اليومية جانبًا للتثبيت أو الحذف',
  actionFailed: 'فشل تنفيذ العملية',

  signaturesTitle: 'التواقيع المحفوظة',
  signaturesHint: 'توقيع يُحفظ مرة واحدة ويُختم على كل يومية بضغطة — بدل رسمه بالإصبع كل صباح.',
  signatureEmpty: 'لا يوجد توقيع بعد',
  signatureDraw: 'ارسم توقيعاً',
  signatureRedraw: 'ارسم من جديد',
  signatureUpload: 'رفع صورة',
  signatureUploadHint: 'يمكن أيضاً تصوير توقيع على ورقة بيضاء ورفعه — ستُزال الخلفية البيضاء تلقائياً.',
  signatureSaved: 'تم حفظ التوقيع',
  signatureRemoved: 'تم حذف التوقيع',
  signatureFailed: 'تعذر حفظ التوقيع',
  signatureUseSaved: 'استخدم التوقيع المحفوظ',

  logTitle: 'سجل الأحداث',
  logHint: 'تسجيل داخلي لما قام به التطبيق. يساعد على تفسير عطل حدث في الموقع، حتى بعد يوم.',
  logLevel: 'مستوى التفصيل',
  logLevelHint: '"عادي" مناسب للاستخدام اليومي. "الكل" أكثر تفصيلاً بكثير — يُفضّل تفعيله فقط عند البحث عن عطل.',
  logLevelNames: {
    debug: 'الكل',
    info: 'عادي',
    warn: 'تحذيرات وأخطاء',
    error: 'أخطاء فقط',
  },
  logShare: 'إرسال السجل',
  logShareFailed: 'فشل إرسال السجل',
  logClear: 'مسح السجل',
  logCleared: 'تم مسح السجل',
  logEmpty: 'لم يُسجَّل شيء بعد',
  logEntries: (n) =>
    n === 1 ? 'سجل واحد' : n === 2 ? 'سجلان' : n <= 10 ? `${n} سجلات` : `${n} سجلًا`,
  logShow: 'عرض',
  logHide: 'إخفاء',
  logPrivacy: 'السجل يسجّل الإجراءات والأخطاء فقط — لا محتوى التقارير ولا الأسماء ولا الصور.',
  fileLogPrefix: 'سجل-الأحداث',

  docWorkDiary: 'سجل العمل',
  docCombinedReport: 'تقرير مجمّع',
  docPhotoAppendix: 'ملحق الصور',
  docPage: (n, of) => `صفحة ${n} من ${of}`,
  docGeneratedBy: 'أُنشئ بواسطة سجل العمل',
  docNoEntries: 'لا توجد سجلات في الفترة المحددة',
  docReportPeriod: 'فترة التقرير',
  docPhotosInReport: 'صور في التقرير',
  fileEntryPrefix: 'سجل',
  fileReportPrefix: 'تقرير-سجل',
  fileUntil: 'حتى',
  fileBackupPrefix: 'نسخة-سجل-العمل',
  weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  weekdaysShort: ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'],
  months: [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ],
  longDate: (weekday, date) => `${weekday}، ${date}`,
};

const en: Strings = {
  languageName: 'English',
  dir: 'ltr',
  locale: 'en-GB',

  appName: 'Work Diary',
  navDiary: 'Diary',
  navReports: 'Reports',
  navProjects: 'Projects',
  navContacts: 'Suppliers',
  navSettings: 'Settings',
  navNew: 'New',

  fontTitle: 'Typeface',
  fontHint: 'Changes the font everywhere in the app. Kept per language, and on this device only.',
  fontSample: 'Work Diary 12/08',
  fontNote: (kind) =>
    ({
      system: "the device's own",
      default: 'default',
      friendly: 'easy to read',
      rounded: 'rounded',
      serif: 'classic',
      mono: 'fixed width',
    })[kind] ?? '',
  dbStuckTitle: 'The diary did not open',
  dbStuckBody:
    'It is most likely already open in another window or copy of the app, and only one of them can read the data. Close the other window and try again.',
  dbFailedBody:
    'The storage on this device could not be opened. Nothing has been deleted — try again, and if it keeps happening send the activity log from Settings.',
  dbRetry: 'Try again',

  save: 'Save',
  cancel: 'Cancel',
  update: 'Update',
  delete: 'Delete',
  remove: 'Remove',
  edit: 'Edit',
  add: 'Add',
  loading: 'Loading…',
  back: 'Back to editing',
  backToReports: 'Back to reports',
  print: 'Print',

  diaryTitle: 'Work Diary',
  newToday: "Today's entry",
  duplicateLast: 'Duplicate last entry',
  combinedReport: 'Combined report',
  searchPlaceholder: 'Search by date, trade, description…',
  noEntriesTitle: 'No entries yet',
  noEntriesBody: "Start with today's entry — it opens in the original form's layout.",
  noMatches: 'No matching entries',
  daysCount: (n) => `${n} ${n === 1 ? 'day' : 'days'}`,
  workersShort: (n) => `${n} ${n === 1 ? 'worker' : 'workers'}`,
  toolsShort: (n) => `${n} ${n === 1 ? 'machine' : 'machines'}`,
  photosShort: (n) => `${n}`,
  noDescription: 'No work description',
  statusDraft: 'Draft',
  statusSigned: 'Active',

  sectionProjectDate: 'Project and date',
  sectionManagement: 'Management team',
  sectionContractors: 'Contractors',
  sectionEquipment: 'Equipment',
  sectionWorkDescription: 'Description of work performed',
  sectionCasting: 'Casting details',
  sectionSupervisorNotes: "Supervisor's remarks",
  sectionReceivedToday: 'Received today',
  sectionSignatures: 'Signatures',
  sectionPhotos: 'Site photos',
  hintProjectDate:
    'The project name, address and company are taken from the active project and printed at the top of the page.',
  hintManagement: 'The names and roles recorded in the table columns.',
  hintContractors: 'Trade and the number of workers each contractor brought.',
  hintEquipment: 'Equipment type, quantity and working hours.',
  hintCasting: 'Leave empty on days with no pour.',
  hintSignatures: 'Signatures are embedded at the foot of the report page.',
  hintPhotos: 'Photos are printed in an appendix at the end of the report.',
  hintDescriptionLines: 'Each line is printed on its own ruled line in the form.',
  addStaff: 'Add team member',
  addContractor: 'Add contractor',
  addEquipment: 'Add equipment',
  rowNumber: (n) => `Row ${n}`,
  moveUp: 'Move up',
  moveDown: 'Move down',
  deleteRow: 'Delete row',
  markSigned: 'Mark as active',
  markDraft: 'Back to draft',
  deleteEntry: 'Delete entry',
  confirmDeleteEntry: (date) => `Delete the entry for ${date}?`,
  savedNote: 'saved',
  savingNote: 'saving…',
  unsavedNote: 'unsaved',
  entryExists: 'An entry already exists for this date',
  entryExistsBody: 'Choose another date to save this page.',
  previewButton: 'Preview',
  exportPdf: 'Create PDF',
  shareButton: 'Share',
  sharing: 'Preparing to share…',
  shareNoRoute: "This device can't share — the file was saved instead",
  reportPreviewTitle: 'Report preview',
  reportPreviewOf: (shown, total) => `Showing ${shown} of ${total} days`,
  exportImage: 'Export as image',
  pageActions: 'Share and export',
  actionsExport: 'Export',
  actionsPage: 'Page',
  exportWord: 'Export to Word',
  generating: 'Creating…',
  exporting: 'Exporting…',
  fileCreated: (name) => `Created ${name}`,
  pdfFailed: 'PDF creation failed',
  wordFailed: 'Word export failed',
  entrySaved: 'Entry saved',
  entryDeleted: 'Entry deleted',
  markedSigned: 'Entry marked as active',
  markedDraft: 'Entry returned to draft',

  labelProject: 'Project',
  labelProjectName: 'Project name',
  labelAddress: 'Address',
  labelCompany: 'Company',
  labelDateWeather: 'Date – Weather',
  labelDate: 'Date',
  labelWeather: 'Weather',
  labelCrewSection: 'Daily record of workers and equipment',
  labelManagement: 'Management team',
  labelName: 'Name',
  labelRole: 'Role',
  labelContractor: 'Contractor',
  labelTrade: 'Trade',
  labelWorkers: 'Workers',
  labelEquipment: 'Equipment',
  labelKind: 'Type',
  labelQty: 'Qty',
  labelHours: 'Hours',
  labelWorkDescription: 'Description of work performed',
  labelCasting: 'Casting details',
  labelDescription: 'Description',
  labelSizeQty: 'Size / quantity',
  labelPump: 'Pump',
  labelConcrete: 'Concrete',
  labelConcreteType: 'Grade',
  labelConcreteQty: 'Volume',
  labelNotes: 'Notes',
  labelSupervisorNotes: "Supervisor's remarks",
  labelReceivedToday: 'Received today',
  labelSupervisorSignature: 'Supervisor signature',
  labelManagerSignature: 'Site manager signature',
  labelConcreteTypeNote: 'Concrete grade (notes line)',

  phFullName: 'Full name',
  phRole: 'Site manager',
  phTrade: 'Formwork',
  phEquipment: 'Tower crane',
  phHours: 'Hours',
  phWeather: 'Clear, 30°C',
  phCastingDescription: 'Level 3 slab',
  phSizeQty: '240 m²',
  phPump: '42 m pump',
  phConcreteType: 'C30',
  phConcreteQty: '58',
  phWorkDescription: 'Continued pouring the level 3 slab…',
  phSupervisorNotes: 'Reinforcement checked before the pour…',
  phReceivedToday: '20 t rebar · 3 pallets of blocks…',
  phProjectName: 'Mediterranean Towers',
  phAddress: '15 Herzl St, Haifa',
  phCompany: 'Construction Ltd',
  phCaption: 'Caption',

  signHere: (label) => `${label} — sign with a finger or the mouse`,
  signed: (label) => `${label} — signed`,
  signAgain: 'Sign again',
  clear: 'Clear',
  saveSignature: 'Save signature',
  addPhotos: 'Choose photos',
  takePhoto: 'Take photo',
  photosSummary: (count, size) => `${count} photos · ${size}`,
  deletePhoto: 'Delete photo',
  photoLoadFailed: 'Could not load the photos',
  photoNumber: (n) => `Photo ${n}`,

  trashTitle: 'Trash',
  trashOpen: 'Trash',
  trashBlurb:
    'Deleted pages stay here until you empty the trash. They are out of the list and out of every report.',
  trashEmptyTitle: 'The trash is empty',
  trashEmptyBody: 'A page you delete lands here, and can be put back until you empty the trash.',
  trashDeletedOn: (when) => `Deleted ${when}`,
  trashRestore: 'Restore',
  trashDeleteForever: 'Delete for good',
  trashEmptyAll: 'Empty the trash',
  trashRestored: (n) => (n === 1 ? 'Page restored' : `${n} pages restored`),
  trashPurged: (n) => (n === 1 ? 'Page deleted for good' : `${n} pages deleted for good`),
  trashClash: 'There is already a page for that date — delete it first, or change the date',
  confirmPurge: (n) =>
    n === 1
      ? 'Delete this page for good? This cannot be undone.'
      : `Delete ${n} pages for good? This cannot be undone.`,
  backToDiary: 'Back to the diary',
  projectsTitle: 'Projects',
  newProject: 'New project',
  noProjectsTitle: 'No projects yet',
  noProjectsBody: 'Add your first site to start keeping a work diary.',
  restoreInstead: 'I already have a backup — restore it',
  activeProject: 'Active',
  makeActive: 'Make active',
  editDetails: 'Edit details',
  switchedTo: (name) => `Switched to ${name}`,
  projectAdded: 'Project added',
  projectUpdated: 'Project updated',
  projectDeleted: 'Project deleted',
  projectNameRequired: 'A project name is required',
  confirmDeleteProject: (name, count) =>
    count > 0
      ? `Delete "${name}" and its ${count} diary entries? This cannot be undone.`
      : `Delete "${name}"?`,
  startTitle: "Let's start",
  startBody: 'To keep a work diary you first need to set up a project.',
  startAction: 'Set up a project',

  contactsTitle: 'Suppliers & contractors',
  contactsBlurb: 'The site address book — kept on this device and synced with the others.',
  newContact: 'New row',
  noContactsTitle: 'The list is still empty',
  noContactsBody:
    'Add the suppliers and contractors you have worked with, so their number is to hand on the next job.',
  searchContacts: 'Search by name, trade, phone…',
  contactsCount: (n) => (n === 1 ? '1 record' : `${n} records`),
  contactDeleted: 'Row deleted',
  contactNo: 'No.',
  labelContactName: 'Contractor or supplier',
  labelContactTrade: 'Field of work',
  labelContactPhone: 'Phone number',
  labelContactProjects: 'Worked with me on',
  labelContactNotes: 'General notes',
  phContactName: 'Full name or company',
  phContactTrade: 'Plastering, electrics, concrete pump…',
  phContactPhone: '05X-0000000',
  phContactProjects: 'Project name',
  phContactNotes: 'Prices, availability, anything worth remembering',
  callContact: (name) => `Call ${name}`,
  deleteContact: 'Delete row',
  unnamedContact: 'Unnamed',
  contactsPrint: 'Print / PDF',
  contactsExport: 'Export to a file',
  contactsImport: 'Import from a file',
  contactsImported: (added, updated) =>
    updated === 0
      ? `Imported ${added} records`
      : `Imported ${added} records, updated ${updated}`,
  contactsImportEmpty: 'No records found in that file',
  contactsImportFailed: 'That file could not be read',
  contactsNothingToExport: 'Nothing to export yet',

  reportsTitle: 'Combined report',
  period: 'Period',
  fromDate: 'From',
  toDate: 'To',
  prevMonth: 'Previous month',
  thisMonth: 'This month',
  nextMonth: 'Next month',
  invalidRange: 'The date range is not valid.',
  reportContent: 'Report contents',
  includeSummary: 'Summary page at the start',
  includePhotos: 'Include photo appendices (larger file)',
  periodSummary: 'Period summary',
  noEntriesInRange: 'No entries in the selected range',
  statDiaryDays: 'Diary days',
  statActiveDays: 'Working days',
  statCastingDays: 'Pour days',
  statConcreteTotal: 'Total concrete (m³)',
  statSigned: 'Signed entries',
  statPhotos: 'Photos',
  summaryTrades: 'Workers by trade',
  summaryEquipment: 'Equipment hours by type',
  summaryConcrete: 'Concrete by grade',
  unitWorkers: 'workers',
  unitHours: 'hours',
  unitCubicMetres: 'm³',
  unitDays: 'days',
  detail: 'Detail',
  total: 'Total',
  generateReportPdf: (days) => `Create PDF report (${days} days)`,
  reportCovers: (from, to) => `The report covers ${from} — ${to}.`,
  reportFailed: 'Report creation failed',

  settingsTitle: 'Settings',
  display: 'Appearance',
  displayHint: 'Day or night — the choice is saved on this device.',
  themeLight: 'Day',
  themeDark: 'Night',
  themeBlack: 'Black',
  themeAuto: 'Auto',
  themeLightHint: 'Light background',
  themeDarkHint: 'Dark background',
  themeBlackHint: 'True black — easier at night, and cheaper on an OLED screen',
  themeAutoHint: 'Follow the device',
  language: 'Language',
  languageHint:
    'Changes the whole app and the generated reports — headings, labels and writing direction.',
  companyLogo: 'Company logo',
  companyLogoHint: 'Printed at the top of every PDF and Word report. A transparent PNG works best.',
  noLogo: 'No logo',
  uploadLogo: 'Upload logo',
  replaceLogo: 'Replace logo',
  logoSaved: 'Logo saved — it will appear on reports',
  logoRemoved: 'Logo removed',
  logoFailed: 'Could not load the logo',
  backupNowAction: 'Back up now',
  backupSaved: (where) =>
    ({
      mac: 'Backup written to Documents',
      device: 'Backup written on this device',
    })[where] ?? 'Backup written',
  backupNever: 'No automatic backup yet',
  backupLast: (when) => `Last backup: ${when}`,
  backupWhere: (where) =>
    ({
      mac: 'written by itself to Documents → "יומן עבודה - גיבויים"',
      device: 'written by itself on the device, and included in the iCloud backup',
      none: 'a browser has nowhere to write on its own — export one now and then',
    })[where] ?? '',
  backupTitle: 'Backup and restore',
  backupHint: 'Data is stored on this device only. Back up weekly.',
  downloadBackup: 'Export data',
  restoreBackup: 'Import data',
  exportAll: 'Export all',
  exportAllHint: 'Every diary day as a PDF, one folder per project, with a summary sheet beside them — all in a single ZIP.',
  exportAllFilePrefix: 'work-diary-everything',
  exportAllWorking: (done, total) => `Preparing ${done} of ${total}…`,
  exportAllDone: (entries, projects) => `${entries} days from ${projects} projects`,
  exportAllEmpty: 'No days to export yet',
  exportAllFailed: 'The export failed',
  storageUsage: (used, quota) => `Using ${used} of the ${quota} available to the app.`,
  storageNotPersisted:
    'The browser has not guaranteed to keep this data. Install the app to your home screen, and back up regularly.',
  backupDownloaded: 'Backup downloaded',
  backupFailed: 'Creating the backup failed',
  confirmRestore:
    'Restoring will delete everything on this device and replace it with the file contents. Continue?',
  restored: (projects, entries) => `Restored ${projects} projects and ${entries} entries`,
  restoreFailed: 'Restore failed',
  savedLists: 'Saved lists',
  savedListsHint: 'Values are learned from every saved entry and offered as suggestions.',
  presetStaff: 'Team members',
  presetRole: 'Roles',
  presetTrade: 'Trades',
  presetEquipment: 'Equipment',
  presetWeather: 'Weather',
  presetConcrete: 'Concrete grades',
  noValuesYet: 'No values yet',
  addTo: (list) => `Add to ${list}`,
  about: 'About',
  aboutBody:
    'A construction site work diary based on the printed form. Data stays on the device, the app works offline, and reports are generated locally.',
  installTip: 'Tip: install the app to your home screen from the browser menu → "Add to Home Screen".',

  docThemeTitle: 'Document design',
  docThemeHint: 'The colours of the reports you produce — PDF, Word and the preview.',
  docThemeNames: {
    navy: 'Navy',
    graphite: 'Graphite',
    sky: 'Sky',
    olive: 'Olive',
    amber: 'Amber',
  },

  syncTitle: 'Sync between devices',
  syncHostHint:
    'This Mac is the hub. On the phone, open Settings → Sync and enter the address and code below — once.',
  syncHostOffline: 'The sync server is not running.',
  syncStartHost: 'Start sync',
  syncPortBusy: 'The port is taken — an earlier copy of the app is probably still open.',
  syncHostRetrying: 'Retrying by itself…',
  syncAddressChanged: "The Mac's address may have changed. Check it in the Mac app under Settings \u2190 Sync.",
  syncClientHint:
    'Open the Mac app, go to Settings → Sync, and copy the address and code from there. Both devices must be on the same Wi-Fi.',
  syncAddress: 'Computer address',
  syncAddressHint: 'Shown in the Mac app under Settings → Sync',
  syncCode: 'Code',
  syncNewCode: 'New code',
  syncConnect: 'Connect and sync',
  syncNow: 'Sync now',
  syncWorking: 'Syncing…',
  syncForget: 'Disconnect',
  syncForgotten: 'Disconnected',
  syncNeedDetails: 'An address and a code are needed',
  syncNotFound: 'No computer found at that address. Check both devices are on the same network and the Mac app is open.',
  syncBadCode: 'Wrong code',
  syncFailed: 'Sync failed',
  syncUnreachable: 'Could not reach the Mac — check both devices are on the same Wi-Fi and the Mac app is open',
  syncTimeout: 'Sync took too long and stopped — try again closer to the router',
  syncVersionMismatch: 'The two devices are on different versions — update both and try again',
  syncProgress: (done, total) => `Syncing ${done} of ${total}…`,
  syncAuto: 'Automatic sync',
  syncAutoHint: 'Syncs by itself while the app is open and both devices are on the same network — on opening, on returning to the app, and every few minutes.',
  syncAutoReceived: (n) =>
    `${n} ${n === 1 ? 'update' : 'updates'} received from the other device`,
  syncDone: (received, sent) => `Sync complete · ${received} in, ${sent} out`,
  syncLastAt: (when) => `Last sync: ${when}`,

  exportExcel: 'Export to Excel',
  excelFailed: 'Export to Excel failed',
  xlsxSheetDays: 'Work days',
  xlsxSheetSummary: 'Summary',
  xlsxSummaryTitle: 'Period summary',
  xlsxWeekday: 'Day',
  xlsxManagement: 'Management crew',
  xlsxConcreteQty: 'Concrete (m³)',
  xlsxPhotos: 'Photos',
  xlsxStatus: 'Status',

  viewOptions: 'View',
  viewGrid: 'Grid',
  viewList: 'List',
  sortHeading: 'Sort by',
  sortByDate: 'Date',
  sortByUpdated: 'Last modified',
  sortByStatus: 'Status',
  selectItems: 'Select items',
  selectDone: 'Done',
  selectAll: 'Select all',
  selectNone: 'Clear selection',
  selectedCount: (n) => `${n} selected`,
  selectNothing: 'No pages selected',
  deleteSelected: 'Delete',
  confirmDeleteSelected: (n) =>
    `Delete ${n} ${n === 1 ? 'page' : 'pages'}? This cannot be undone.`,
  deletedSelected: (n) => `${n} ${n === 1 ? 'page' : 'pages'} deleted`,
  reportFromSelected: 'Report from selected',

  pinAction: 'Pin',
  unpinAction: 'Unpin',
  deleteAction: 'Delete',
  pinnedHeading: 'Pinned',
  pinnedDone: 'Page pinned',
  unpinnedDone: 'Pin removed',
  undo: 'Undo',
  undoEdit: 'Undo change',
  redoEdit: 'Redo change',
  pinSelected: 'Pin',
  pinnedSelected: (n) => `${n} ${n === 1 ? 'page' : 'pages'} pinned`,
  swipeHint: 'Swipe a page sideways to pin or delete it',
  actionFailed: 'The action failed',

  signaturesTitle: 'Saved signatures',
  signaturesHint: 'Sign once and stamp every diary page with a tap, instead of drawing with a fingertip each morning.',
  signatureEmpty: 'No signature yet',
  signatureDraw: 'Draw a signature',
  signatureRedraw: 'Draw again',
  signatureUpload: 'Upload an image',
  signatureUploadHint: 'You can also photograph a signature on white paper and upload it — the white background is removed automatically.',
  signatureSaved: 'Signature saved',
  signatureRemoved: 'Signature removed',
  signatureFailed: 'Could not save the signature',
  signatureUseSaved: 'Use the saved signature',

  logTitle: 'Activity log',
  logHint: 'An internal record of what the app did. It makes a fault on site explainable a day later.',
  logLevel: 'Detail level',
  logLevelHint: '"Normal" suits everyday use. "Everything" is far noisier — turn it on only while chasing a fault.',
  logLevelNames: {
    debug: 'Everything',
    info: 'Normal',
    warn: 'Warnings and errors',
    error: 'Errors only',
  },
  logShare: 'Send the log',
  logShareFailed: 'Could not send the log',
  logClear: 'Clear log',
  logCleared: 'Log cleared',
  logEmpty: 'Nothing recorded yet',
  logEntries: (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`,
  logShow: 'Show',
  logHide: 'Hide',
  logPrivacy: 'The log records actions and errors only — never report contents, names or photos.',
  fileLogPrefix: 'activity-log',

  docWorkDiary: 'WORK DIARY',
  docCombinedReport: 'COMBINED REPORT',
  docPhotoAppendix: 'PHOTO APPENDIX',
  docPage: (n, of) => `Page ${n} of ${of}`,
  docGeneratedBy: 'Generated with Work Diary',
  docNoEntries: 'No diary entries in the selected period',
  docReportPeriod: 'Report period',
  docPhotosInReport: 'Photos in report',
  fileEntryPrefix: 'diary',
  fileReportPrefix: 'diary-report',
  fileUntil: 'to',
  fileBackupPrefix: 'work-diary-backup',
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  months: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  longDate: (weekday, date) => `${weekday}, ${date}`,
};

export const STRINGS: Record<Language, Strings> = { he, ar, en };

export const DEFAULT_LANGUAGE: Language = 'he';

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}
