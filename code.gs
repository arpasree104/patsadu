/***********************************************************************
 * ระบบเสนอความต้องการพัสดุ สำนักงานสาธารณสุขจังหวัดนครนายก
 * Backend : Google Apps Script — Web App (JSON API)
 * Frontend: static site (GitHub → Vercel) เรียกผ่าน fetch()
 *
 * วิธีติดตั้ง ดูที่ README.md ใน repository
 ***********************************************************************/

const CONFIG = {
  SPREADSHEET_ID: '1WXOk6jgVOGiCf02-5AOIy6l8jdgcDbQRU-CSG6n9_Ik',
  USER_SHEET: 'UserAccounts',
  REQUEST_SHEET: 'SupplyRequests',
  ITEM_SHEET: 'SupplyRequestItems',
  INSPECTOR_SHEET: 'SupplyInspectors',
  LOG_SHEET: 'SupplyAuditLogs',
  SETTING_SHEET: 'setting',
  PROGRESS_SHEET: 'SupplyProgressLogs',
  SESSION_SHEET: 'SupplySessions',
  ATTACHMENT_FOLDER_NAME: 'ระบบพัสดุ_ไฟล์แนบ',
  APP_TITLE: 'ระบบเสนอความต้องการพัสดุ สสจ.นครนายก',
  TIMEZONE: 'Asia/Bangkok',
  SESSION_HOURS: 12,
  MAX_LIST_ROWS: 1000
};

/** สถานะคำขอ */
const STATUS = {
  DRAFT: 'ร่าง',
  SUBMITTED: 'รอพัสดุตรวจสอบ',
  RETURNED: 'ส่งกลับแก้ไข',
  CHECKED: 'ผ่านการตรวจสอบ',
  APPROVED: 'อนุมัติแล้ว',
  IN_PROGRESS: 'อยู่ระหว่างจัดซื้อจัดจ้าง',
  COMPLETED: 'ดำเนินการแล้วเสร็จ',
  SUPERSEDED: 'แก้ไขเป็นเวอร์ชันใหม่',
  CANCELLED: 'ยกเลิก'
};

/** ประเภทเอกสารแนบ — BudgetPlan บังคับแนบก่อนส่งให้พัสดุ */
const ATTACHMENT_TYPES = [
  { key: 'BudgetPlan', label: 'แผนการใช้งบประมาณ', required: true },
  { key: 'Project', label: 'โครงการ', required: false },
  { key: 'Quote', label: 'ใบเสนอราคา', required: false },
  { key: 'Tor', label: 'TOR / ขอบเขตของงาน', required: false },
  { key: 'Spec', label: 'Specification / คุณลักษณะเฉพาะ', required: false }
];

/** ขั้นตอนการจัดซื้อจัดจ้างของพัสดุ (ข้อ 4) เรียงตามลำดับการดำเนินงาน */
const PROCUREMENT_STAGES = [
  'แผนจัดซื้อจัดจ้าง',
  'TOR/ราคากลาง',
  'รายงานขอซื้อขอจ้าง',
  'แต่งตั้ง คกก.พิจารณาผลฯ/ตรวจรับพัสดุ',
  'ร่าง/ประกาศประกวดราคา',
  'หนังสือเชิญชวนเสนอราคา',
  'รายงานผลการพิจารณา',
  'ประกาศผู้ชนะการเสนอราคา',
  'เว้นระยะอุทธรณ์',
  'ลงนามสัญญา',
  'บริหารสัญญา',
  'รายงานผลการตรวจรับ'
];

const FINAL_STAGE = 'รายงานผลการตรวจรับ';

const BUDGET_TYPES = ['ในงบประมาณ', 'นอกงบประมาณ'];
const PURCHASE_TYPES = ['ซื้อ', 'จ้าง', 'ซื้อ/จ้าง'];
const OFFICER_METHODS = ['เฉพาะเจาะจง', 'คัดเลือก', 'ตลาดอิเล็กทรอนิกส์ (e-market)', 'ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)'];
const IN_PROGRESS_METHODS = ['e-market', 'e-bidding'];

/** หมวดใน setting ที่ใช้กำหนดสิทธิ */
const ROLE_CATEGORIES = {
  SUPPLY_OFFICER: 'SupplyOfficer',
  SUPPLY_HEAD: 'SupplyHead',
  SUPER_ADMIN: 'SuperAdmin'
};

function attachmentColumns_() {
  const cols = [];
  ATTACHMENT_TYPES.forEach(t => {
    cols.push('Attachment' + t.key);
    cols.push('Attachment' + t.key + 'Sheets');
    cols.push('Attachment' + t.key + 'FileNames');
    cols.push('Attachment' + t.key + 'FileUrls');
    cols.push('Attachment' + t.key + 'FileIds');
  });
  return cols;
}

const REQUEST_HEADERS = [
  'RequestID', 'RequestNo', 'RootRequestID', 'ParentRequestID', 'Version', 'IsLatest',
  'CreatedAt', 'UpdatedAt',
  'CreatedByUserID', 'CreatedByName', 'CreatedByPosition', 'CreatedByDepartment',
  'CreatedByPhone', 'CreatedByEmail',
  'Department', 'Phone', 'DocNoText', 'RequestDate', 'Subject', 'To',
  'PurchaseType', 'ItemCount', 'Reason',
  'PurposeRegular', 'PurposeStock', 'PurposeProject', 'ProjectName'
].concat(attachmentColumns_()).concat([
  'TotalAmount', 'LastPurchaseTotal', 'Status',
  'SubmittedAt', 'SubmittedByUserID', 'SubmittedByName',
  'CheckedAt', 'CheckedByUserID', 'CheckedByName', 'CheckRemark',
  'ReturnedAt', 'ReturnedByUserID', 'ReturnedByName', 'ReturnRemark', 'ReturnCount',
  'OfficerOpinionAnnualUnder100k', 'OfficerOpinionAnnualOver100k',
  'OfficerMethod', 'OfficerMethodInProgress', 'OfficerInProgressMethod',
  'CompletionDays', 'OfficerReason',
  'OfficerName', 'OfficerPosition', 'DeptHeadName', 'DeptHeadPosition',
  'BudgetType', 'PlanInPlan', 'PlanYear', 'PlanOther', 'PlanBudgetSource',
  'PlanAmount', 'PlanRemark', 'FiscalYear',
  'ApproverName', 'ApproverPosition', 'Notes',
  'ApprovedAt', 'ApprovedByUserID', 'ApprovedByName', 'ApprovedRemark',
  'ApprovedDocFileNames', 'ApprovedDocFileUrls', 'ApprovedDocFileIds',
  'IsLocked', 'LockedAt', 'LockedByUserID', 'LockedByName',
  'UnlockedAt', 'UnlockedByUserID', 'UnlockedByName', 'UnlockReason',
  'CurrentStage', 'CurrentStageAt', 'CompletedAt',
  'MainPdfFileId', 'MainPdfUrl'
]);

const ITEM_HEADERS = [
  'LineID', 'RequestID', 'LineNo', 'ItemName', 'PlanBalanceAmount',
  'Quantity', 'Unit', 'UnitPrice', 'TotalPrice', 'LastPrice', 'Remark'
];

const INSPECTOR_HEADERS = [
  'InspectorID', 'RequestID', 'Seq', 'FullName', 'Position', 'CID', 'Email', 'UserID'
];

const LOG_HEADERS = [
  'LogID', 'Timestamp', 'UserID', 'UserName', 'Action', 'RequestID', 'Detail', 'IP'
];

const SETTING_HEADERS = [
  'SettingID', 'Category', 'Label', 'Value', 'SortOrder', 'IsActive', 'Remark', 'UpdatedAt'
];

const PROGRESS_HEADERS = [
  'ProgressID', 'RequestID', 'RequestNo', 'ProgressAt',
  'ProgressByUserID', 'ProgressByName', 'ProgressStatus', 'Note',
  'SupplyNote', 'MyNote',
  'FileNames', 'FileUrls', 'FileIds',
  'SignerRole', 'SignerName', 'SignatureUrl', 'CreatedAt'
];

const SESSION_HEADERS = ['Token', 'UserID', 'UserName', 'CreatedAt', 'ExpiresAt', 'Client'];

/* =====================================================================
 * Web App entry points
 * ===================================================================*/

function doGet(e) {
  return route_(e, 'GET');
}

function doPost(e) {
  return route_(e, 'POST');
}

function route_(e, method) {
  e = e || {};
  const params = e.parameter || {};
  let body = {};
  if (method === 'POST' && e.postData && e.postData.contents) {
    try {
      body = JSON.parse(e.postData.contents) || {};
    } catch (err) {
      return jsonOut_({ ok: false, error: 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง (JSON parse error)' }, params.callback);
    }
  }
  const payload = Object.assign({}, params, body);
  const action = String(payload.action || '').trim();
  const callback = params.callback || body.callback || '';

  if (!action) {
    return jsonOut_({
      ok: true,
      service: CONFIG.APP_TITLE,
      message: 'API พร้อมใช้งาน — ส่ง action มาด้วย เช่น ?action=ping',
      version: apiVersion_()
    }, callback);
  }

  try {
    const handler = ACTIONS[action];
    if (!handler) throw new Error('ไม่รู้จักคำสั่ง: ' + action);
    clearTableCache_();
    const result = handler(payload) || {};
    if (result.ok === undefined) result.ok = true;
    return jsonOut_(result, callback);
  } catch (err) {
    console.error(action + ' error: ' + (err && err.stack ? err.stack : err));
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) }, callback);
  }
}

function apiVersion_() {
  return '2.0.0';
}

function jsonOut_(obj, callback) {
  const text = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================================
 * ตารางคำสั่งของ API
 * ===================================================================*/

const ACTIONS = {
  ping: function (p) { return { ok: true, time: nowText_(), version: apiVersion_() }; },
  setup: function (p) { return apiSetup_(p); },

  login: function (p) { return apiLogin_(p); },
  logout: function (p) { return apiLogout_(p); },
  bootstrap: function (p) { return apiBootstrap_(p); },

  listRequests: function (p) { return apiListRequests_(p); },
  getRequest: function (p) { return apiGetRequest_(p); },
  saveRequest: function (p) { return apiSaveRequest_(p); },
  saveOfficerOpinion: function (p) { return apiSaveOfficerOpinion_(p); },
  submitRequest: function (p) { return apiSubmitRequest_(p); },
  reviewRequest: function (p) { return apiReviewRequest_(p); },
  cancelRequest: function (p) { return apiCancelRequest_(p); },

  attachApproval: function (p) { return apiAttachApproval_(p); },
  setLock: function (p) { return apiSetLock_(p); },

  addProgress: function (p) { return apiAddProgress_(p); },
  listProgress: function (p) { return apiListProgress_(p); },
  deleteProgress: function (p) { return apiDeleteProgress_(p); },

  getSettings: function (p) { return apiGetSettings_(p); },
  saveSetting: function (p) { return apiSaveSetting_(p); },
  deleteSetting: function (p) { return apiDeleteSetting_(p); },
  setRoleMembers: function (p) { return apiSetRoleMembers_(p); },

  dashboard: function (p) { return apiDashboard_(p); },
  publicDashboard: function (p) { return apiPublicDashboard_(p); },
  exportRows: function (p) { return apiExportRows_(p); },

  syncExport: function (p) { return apiSyncExport_(p); },
  externalData: function (p) { return apiExternalData_(p); },

  listLogs: function (p) { return apiListLogs_(p); }
};

/* =====================================================================
 * โครงสร้างสเปรดชีต
 * ===================================================================*/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ระบบพัสดุ')
    .addItem('ติดตั้ง/ปรับตารางระบบ', 'forceSetupSupplySystem_')
    .addItem('ส่งข้อมูลออกไป Sheet ปลายทางเดี๋ยวนี้', 'runExportNow_')
    .addToUi();
}

function forceSetupSupplySystem_() {
  CacheService.getScriptCache().remove('isSetupDone');
  const res = setupSupplySystem(true);
  SpreadsheetApp.getUi().alert(res.message);
}

function setupSupplySystem(force) {
  const cache = CacheService.getScriptCache();
  if (!force && cache.get('isSetupDone')) return { ok: true, message: 'ตรวจสอบตารางระบบเรียบร้อยแล้ว' };

  const ss = getSS_();
  ensureUserSheetReadable_();
  ensureSheet_(ss, CONFIG.REQUEST_SHEET, REQUEST_HEADERS);
  ensureSheet_(ss, CONFIG.ITEM_SHEET, ITEM_HEADERS);
  ensureSheet_(ss, CONFIG.INSPECTOR_SHEET, INSPECTOR_HEADERS);
  ensureSheet_(ss, CONFIG.LOG_SHEET, LOG_HEADERS);
  ensureSheet_(ss, CONFIG.SETTING_SHEET, SETTING_HEADERS);
  ensureSheet_(ss, CONFIG.PROGRESS_SHEET, PROGRESS_HEADERS);
  ensureSheet_(ss, CONFIG.SESSION_SHEET, SESSION_HEADERS);
  seedDefaultSettings_();
  migrateLegacyRequests_();
  applyTextFormats_();

  cache.put('isSetupDone', '1', 21600);
  return { ok: true, message: 'ตรวจสอบ/ปรับโครงสร้างตารางระบบพัสดุเรียบร้อยแล้ว' };
}

function apiSetup_(p) {
  const user = requireAuth_(p.token);
  requireSuperAdmin_(user);
  const res = setupSupplySystem(true);
  addLog_(user, 'SETUP', '', res.message);
  return res;
}

let cachedSS_ = null;
let cachedTableData_ = {};

function getSS_() {
  if (cachedSS_) return cachedSS_;
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID.trim()) {
    cachedSS_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID.trim());
    return cachedSS_;
  }
  cachedSS_ = SpreadsheetApp.getActiveSpreadsheet();
  if (!cachedSS_) throw new Error('ไม่พบ Spreadsheet กรุณากำหนด CONFIG.SPREADSHEET_ID');
  return cachedSS_;
}

function clearTableCache_(sheetName) {
  if (sheetName) delete cachedTableData_[sheetName];
  else cachedTableData_ = {};
}

function ensureSheet_(ss, sheetName, headers) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  const lastCol = Math.max(sh.getLastColumn(), 1);
  let current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (current.length === 1 && current[0] === '') current = [];

  if (current.length === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const missing = headers.filter(h => current.indexOf(h) === -1);
    if (missing.length) {
      sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    }
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn())
    .setBackground('#0f766e').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  return sh;
}

function ensureUserSheetReadable_() {
  const sh = getSS_().getSheetByName(CONFIG.USER_SHEET);
  if (!sh) throw new Error('ไม่พบแผ่นงาน ' + CONFIG.USER_SHEET);
  const headers = getHeaders_(sh);
  ['UserID', 'Username', 'Password', 'FullName', 'Position', 'Department', 'Role', 'IsActive'].forEach(h => {
    if (headers.indexOf(h) === -1) throw new Error('แผ่นงาน ' + CONFIG.USER_SHEET + ' ต้องมีคอลัมน์ ' + h);
  });
}

function applyTextFormats_() {
  setColumnsAsText_(CONFIG.REQUEST_SHEET, ['CreatedByPhone', 'Phone', 'DocNoText']);
  setColumnsAsText_(CONFIG.INSPECTOR_SHEET, ['CID']);
}

function setColumnsAsText_(sheetName, colNames) {
  const sh = getSS_().getSheetByName(sheetName);
  if (!sh) return;
  const headers = getHeaders_(sh);
  colNames.forEach(name => {
    const idx = headers.indexOf(name) + 1;
    if (idx > 0) sh.getRange(1, idx, Math.max(sh.getMaxRows(), 2), 1).setNumberFormat('@');
  });
}

/**
 * เติมค่าให้คำขอเดิมที่สร้างก่อนมีระบบเวอร์ชัน เพื่อให้ข้อมูลเก่ายังใช้งานได้
 */
function migrateLegacyRequests_() {
  const sh = getSS_().getSheetByName(CONFIG.REQUEST_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const headers = getHeaders_(sh);
  const map = getHeaderMap_(headers);
  const range = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length);
  const values = range.getValues();
  let changed = false;

  values.forEach(row => {
    const id = row[map.RequestID];
    if (!id) return;
    if (!row[map.RootRequestID]) { row[map.RootRequestID] = id; changed = true; }
    if (!row[map.Version]) { row[map.Version] = 1; changed = true; }
    if (row[map.IsLatest] === '' || row[map.IsLatest] === null) { row[map.IsLatest] = 1; changed = true; }
    if (!row[map.Status]) { row[map.Status] = STATUS.DRAFT; changed = true; }
    if (!row[map.BudgetType]) {
      row[map.BudgetType] = budgetTypeFromSource_(row[map.PlanBudgetSource]);
      changed = true;
    }
    if (!row[map.FiscalYear]) {
      row[map.FiscalYear] = fiscalYear_(toDate_(row[map.RequestDate]) || toDate_(row[map.CreatedAt]));
      changed = true;
    }
    if (row[map.IsLocked] === '' || row[map.IsLocked] === null) { row[map.IsLocked] = 0; changed = true; }
    // ย้ายข้อมูลแนบเดิม (AttachmentSpec = TOR รวม Specification) ให้อยู่ครบทั้ง 2 ช่องใหม่
    if (row[map.AttachmentTor] === '' && row[map.AttachmentSpec]) {
      row[map.AttachmentTor] = row[map.AttachmentSpec];
      row[map.AttachmentTorSheets] = row[map.AttachmentSpecSheets];
      row[map.AttachmentTorFileNames] = row[map.AttachmentSpecFileNames];
      row[map.AttachmentTorFileUrls] = row[map.AttachmentSpecFileUrls];
      row[map.AttachmentTorFileIds] = row[map.AttachmentSpecFileIds];
      changed = true;
    }
  });

  if (changed) range.setValues(values);
}

/* =====================================================================
 * ตัวช่วยอ่าน/เขียนตาราง
 * ===================================================================*/

function getHeaders_(sh) {
  if (!sh || sh.getLastColumn() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function getHeaderMap_(headers) {
  const map = {};
  headers.forEach((h, i) => map[h] = i);
  return map;
}

function getTableRows_(sheetName, forceRefresh) {
  if (!forceRefresh && cachedTableData_[sheetName]) return cachedTableData_[sheetName];
  const sh = getSS_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) { cachedTableData_[sheetName] = []; return []; }
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  const rows = data.slice(1).map((row, idx) => {
    const obj = { _rowNumber: idx + 2 };
    headers.forEach((h, c) => obj[h] = normalizeCell_(row[c]));
    return obj;
  });
  cachedTableData_[sheetName] = rows;
  return rows;
}

function normalizeCell_(value) {
  if (value instanceof Date) return formatDateTime_(value);
  if (value === null || value === undefined) return '';
  return value;
}

function formatDateTime_(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const hasTime = d.getHours() || d.getMinutes() || d.getSeconds();
  return Utilities.formatDate(d, CONFIG.TIMEZONE, hasTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
}

function nowText_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/** แปลงค่าจากชีต (Date, 'yyyy-MM-dd HH:mm:ss', 'd/M/yyyy, HH:mm:ss') ให้เป็น Date */
function toDate_(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  const s = String(value).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let year = Number(m[3]);
    if (year > 2400) year -= 543;
    return new Date(year, Number(m[2]) - 1, Number(m[1]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/** ปีงบประมาณไทย (1 ต.ค. — 30 ก.ย.) */
function fiscalYear_(date) {
  const d = date instanceof Date ? date : (toDate_(date) || new Date());
  const year = d.getFullYear() + (d.getMonth() >= 9 ? 1 : 0);
  return year + 543;
}

function writeObjectRow_(sh, headers, obj, rowNumber) {
  const row = headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : '');
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function appendObjectRow_(sh, headers, obj) {
  const row = headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : '');
  sh.appendRow(row);
}

function appendObjectRows_(sh, headers, objs) {
  if (!objs.length) return;
  const rows = objs.map(obj => headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : ''));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function deleteRowsByValue_(sheetName, colName, value) {
  const sh = getSS_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return;
  const headers = getHeaders_(sh);
  const colIndex = headers.indexOf(colName) + 1;
  if (colIndex < 1) return;
  const values = sh.getRange(2, colIndex, sh.getLastRow() - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(value)) sh.deleteRow(i + 2);
  }
  clearTableCache_(sheetName);
}

function makeId_(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 8) + '-' + new Date().getTime();
}

function bool01_(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' ? 1 : 0;
}

function isTrue_(value) {
  const v = String(value).toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'active' || v === 'ใช้งาน';
}

function num_(value) {
  const n = Number(String(value === null || value === undefined ? '' : value).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function text_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizePhone_(value) {
  const s = text_(value);
  const digits = s.replace(/\D/g, '');
  if (digits.length === 9 && digits.charAt(0) !== '0') return '0' + digits;
  return s;
}

function joinNonEmpty_(arr) {
  return arr.map(v => text_(v)).filter(Boolean).join('\n');
}

function splitLines_(value) {
  return String(value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/* =====================================================================
 * ผู้ใช้และสิทธิ
 * ===================================================================*/

const HEAVY_USER_COLUMNS = ['SignatureBase64', 'SignatureBase64_2', 'Avatar'];

/**
 * อ่าน UserAccounts โดยข้ามคอลัมน์รูปภาพขนาดใหญ่ เพื่อให้โหลดเร็ว
 */
const USER_CACHE_KEY = 'supply_users_v1';

function getAllUsers_() {
  if (cachedTableData_.__users) return cachedTableData_.__users;

  const cache = CacheService.getScriptCache();
  const cached = cache.get(USER_CACHE_KEY);
  if (cached) {
    try {
      cachedTableData_.__users = JSON.parse(cached);
      return cachedTableData_.__users;
    } catch (err) {
      cache.remove(USER_CACHE_KEY);
    }
  }

  const sh = getSS_().getSheetByName(CONFIG.USER_SHEET);
  if (!sh || sh.getLastRow() < 2) { cachedTableData_.__users = []; return []; }

  const headers = getHeaders_(sh);
  const lastRow = sh.getLastRow();
  const skip = {};
  HEAVY_USER_COLUMNS.forEach(name => {
    const i = headers.indexOf(name);
    if (i > -1) skip[i] = true;
  });

  // อ่านเป็นช่วงคอลัมน์ที่ติดกัน ข้ามคอลัมน์หนัก
  const blocks = [];
  let start = -1;
  for (let c = 0; c <= headers.length; c++) {
    if (c < headers.length && !skip[c]) {
      if (start === -1) start = c;
    } else if (start > -1) {
      blocks.push([start, c - 1]);
      start = -1;
    }
  }

  const rows = [];
  for (let r = 0; r < lastRow - 1; r++) rows.push({ _rowNumber: r + 2 });
  blocks.forEach(b => {
    const width = b[1] - b[0] + 1;
    const values = sh.getRange(2, b[0] + 1, lastRow - 1, width).getDisplayValues();
    values.forEach((row, r) => {
      for (let c = 0; c < width; c++) rows[r][headers[b[0] + c]] = text_(row[c]);
    });
  });

  try {
    const text = JSON.stringify(rows);
    if (text.length < 90000) cache.put(USER_CACHE_KEY, text, 300);
  } catch (err) {
    console.log('cache users: ' + err.message);
  }

  cachedTableData_.__users = rows;
  return rows;
}

function getUserById_(userId) {
  const id = text_(userId);
  if (!id) return null;
  return getAllUsers_().find(u => text_(u.UserID) === id) || null;
}

function safeUser_(u, roleConfig) {
  const cfg = roleConfig || getRoleConfig_();
  const userId = text_(u.UserID);
  return {
    userId: userId,
    username: text_(u.Username),
    fullName: text_(u.FullName),
    position: [text_(u.Position), text_(u.PositionLevel)].filter(Boolean).join(''),
    department: text_(u.Department),
    role: text_(u.Role),
    cid: text_(u.CID),
    email: text_(u.Email),
    phone: normalizePhone_(u.PhoneNumber || u.Phone || ''),
    isSupply: cfg.supplyIds.indexOf(userId) > -1,
    isSupplyHead: cfg.supplyHeadIds.indexOf(userId) > -1,
    isSuperAdmin: cfg.superAdminIds.indexOf(userId) > -1,
    isExecutive: isExecutiveRole_(u),
    isDeptHead: isDeptHeadRole_(u)
  };
}

function isExecutiveRole_(u) {
  const role = text_(u.Role).toLowerCase();
  const pos = text_(u.Position).toLowerCase();
  return role.indexOf('executive') > -1 || pos.indexOf('นายแพทย์สาธารณสุข') > -1 ||
    pos.indexOf('รองนายแพทย์') > -1 || text_(u.Department) === 'ผู้บริหาร';
}

function isDeptHeadRole_(u) {
  const role = text_(u.Role).toLowerCase();
  return role.indexOf('depthead') > -1 || role.indexOf('teamlead') > -1 || role.indexOf('deputydepthead') > -1;
}

/**
 * รายชื่อผู้มีสิทธิพิเศษ อ่านจากแผ่น setting (admin กำหนดเองในหน้า Setting)
 * ถ้ายังไม่เคยตั้งค่า จะ fallback ไปใช้ Role เดิมเพื่อไม่ให้ระบบล็อกตัวเอง
 */
function getRoleConfig_() {
  if (cachedTableData_.__roleConfig) return cachedTableData_.__roleConfig;

  const rows = getTableRows_(CONFIG.SETTING_SHEET).filter(r => isTrue_(r.IsActive));
  const pick = cat => rows.filter(r => text_(r.Category) === cat).map(r => text_(r.Value)).filter(Boolean);

  let supplyIds = pick(ROLE_CATEGORIES.SUPPLY_OFFICER);
  let supplyHeadIds = pick(ROLE_CATEGORIES.SUPPLY_HEAD);
  let superAdminIds = pick(ROLE_CATEGORIES.SUPER_ADMIN);

  if (!superAdminIds.length) {
    superAdminIds = getAllUsers_()
      .filter(u => /admin/i.test(text_(u.Role)))
      .map(u => text_(u.UserID));
  }
  if (!supplyIds.length) {
    supplyIds = getAllUsers_()
      .filter(u => /พัสดุ/.test(text_(u.Position) + text_(u.Department) + text_(u.Role)))
      .map(u => text_(u.UserID));
  }

  // หัวหน้าเจ้าหน้าที่และ superadmin ถือว่ามีสิทธิของเจ้าหน้าที่พัสดุด้วย
  const all = supplyIds.concat(supplyHeadIds).concat(superAdminIds)
    .filter((v, i, a) => v && a.indexOf(v) === i);

  const cfg = {
    supplyIds: all,
    supplyOfficerIds: supplyIds,
    supplyHeadIds: supplyHeadIds,
    superAdminIds: superAdminIds
  };
  cachedTableData_.__roleConfig = cfg;
  return cfg;
}

function isSupply_(user) {
  return getRoleConfig_().supplyIds.indexOf(text_(user.UserID)) > -1;
}

function isSuperAdmin_(user) {
  return getRoleConfig_().superAdminIds.indexOf(text_(user.UserID)) > -1;
}

function requireSupply_(user) {
  if (!isSupply_(user)) throw new Error('เฉพาะเจ้าหน้าที่พัสดุที่ผู้ดูแลระบบกำหนดไว้เท่านั้นที่ทำรายการนี้ได้');
  return user;
}

function requireSuperAdmin_(user) {
  if (!isSuperAdmin_(user)) throw new Error('เฉพาะผู้ดูแลระบบ (Super Admin) เท่านั้นที่ทำรายการนี้ได้');
  return user;
}

function canSeeAll_(user) {
  return isSupply_(user) || isSuperAdmin_(user) || isExecutiveRole_(user);
}

function canSeeDepartment_(user) {
  return isDeptHeadRole_(user);
}

/* =====================================================================
 * Session / Token
 * ===================================================================*/

/**
 * เข้าสู่ระบบและโหลดข้อมูลตั้งต้นทั้งหมดในคำสั่งเดียว (รวม apiBootstrap_ ไว้ในนี้)
 * เพื่อลดจำนวนรอบการเรียก API ตอนเข้าสู่ระบบจาก 2 ครั้งเหลือ 1 ครั้ง — ช่วยให้เปิดระบบได้เร็วขึ้น
 * เพราะ Apps Script Web App แต่ละคำสั่งมีเวลาเริ่มต้นสคริปต์ค่อนข้างนาน
 */
function apiLogin_(p) {
  setupSupplySystem();
  const username = text_(p.username);
  const password = text_(p.password);
  if (!username || !password) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const user = getAllUsers_().find(u => text_(u.Username) === username && text_(u.Password) === password);
  if (!user) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  if (!isTrue_(user.IsActive)) throw new Error('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');

  const token = createSession_(user, text_(p.client));
  addLog_(user, 'LOGIN', '', 'เข้าสู่ระบบ');

  return Object.assign({
    ok: true,
    token: token,
    expiresIn: CONFIG.SESSION_HOURS * 3600
  }, buildBootstrapData_(user, p.filters || {}));
}

function apiLogout_(p) {
  const token = text_(p.token);
  if (!token) return { ok: true };
  CacheService.getScriptCache().remove(sessionCacheKey_(token));
  const sh = getSS_().getSheetByName(CONFIG.SESSION_SHEET);
  if (!sh || sh.getLastRow() < 2) return { ok: true };
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === token) sh.deleteRow(i + 2);
  }
  return { ok: true, message: 'ออกจากระบบแล้ว' };
}

function createSession_(user, client) {
  const sh = getSS_().getSheetByName(CONFIG.SESSION_SHEET);
  const headers = getHeaders_(sh);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().slice(0, 8);
  const now = new Date();
  const expires = new Date(now.getTime() + CONFIG.SESSION_HOURS * 3600 * 1000);
  appendObjectRow_(sh, headers, {
    Token: token,
    UserID: text_(user.UserID),
    UserName: text_(user.FullName),
    CreatedAt: now,
    ExpiresAt: expires,
    Client: text_(client).slice(0, 200)
  });
  clearTableCache_(CONFIG.SESSION_SHEET);
  cacheSession_(token, text_(user.UserID), expires);
  purgeExpiredSessions_(sh);
  return token;
}

function sessionCacheKey_(token) {
  return 'sess_' + token;
}

/** เก็บโทเคนไว้ในแคชไม่เกินอายุจริงของเซสชัน */
function cacheSession_(token, userId, expiresAt) {
  const seconds = Math.floor((expiresAt.getTime() - new Date().getTime()) / 1000);
  if (seconds <= 0) return;
  CacheService.getScriptCache().put(
    sessionCacheKey_(token),
    userId + '|' + expiresAt.getTime(),
    Math.min(seconds, 21600)
  );
}

function purgeExpiredSessions_(sh) {
  if (sh.getLastRow() < 2) return;
  const headers = getHeaders_(sh);
  const map = getHeaderMap_(headers);
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  const now = new Date();
  for (let i = values.length - 1; i >= 0; i--) {
    const exp = toDate_(values[i][map.ExpiresAt]);
    if (!exp || exp < now) sh.deleteRow(i + 2);
  }
}

function requireAuth_(token) {
  token = text_(token);
  if (!token) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน');

  // โทเคนที่ยังอยู่ในแคชไม่ต้องอ่านแผ่นงาน SupplySessions ซ้ำ
  // แต่ยังต้องตรวจวันหมดอายุที่เก็บคู่กันไว้เสมอ
  const cache = CacheService.getScriptCache();
  const cached = cache.get(sessionCacheKey_(token));
  let userId = '';
  if (cached) {
    const parts = String(cached).split('|');
    if (Number(parts[1]) > new Date().getTime()) userId = parts[0];
    else cache.remove(sessionCacheKey_(token));
  }
  if (!userId) {
    const session = getTableRows_(CONFIG.SESSION_SHEET).find(r => text_(r.Token) === token);
    if (!session) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const exp = toDate_(session.ExpiresAt);
    if (!exp || exp < new Date()) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    userId = text_(session.UserID);
    cacheSession_(token, userId, exp);
  }

  const user = getUserById_(userId);
  if (!user) throw new Error('ไม่พบบัญชีผู้ใช้ กรุณาเข้าสู่ระบบใหม่');
  if (!isTrue_(user.IsActive)) throw new Error('บัญชีนี้ถูกปิดใช้งาน');
  return user;
}

/* =====================================================================
 * ข้อมูลตั้งต้นหลังเข้าสู่ระบบ
 * ===================================================================*/

function apiBootstrap_(p) {
  const user = requireAuth_(p.token);
  setupSupplySystem();
  return Object.assign({ ok: true }, buildBootstrapData_(user, p.filters || {}));
}

/** ข้อมูลตั้งต้นทั้งหมดหลังเข้าสู่ระบบ ใช้ร่วมกันทั้ง action login และ bootstrap */
function buildBootstrapData_(user, filters) {
  const cfg = getRoleConfig_();
  const users = getAllUsers_()
    .filter(u => isTrue_(u.IsActive))
    .map(u => safeUser_(u, cfg))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'th'));

  const settings = buildSettings_();
  const requests = listRequestRows_(user, filters || {});
  return {
    user: safeUser_(user, cfg),
    users: users,
    settings: settings,
    requests: requests.map(summarizeRequest_),
    dashboard: buildDashboard_(requests, {}),
    meta: {
      statuses: Object.keys(STATUS).map(k => STATUS[k]),
      stages: settings.stages,
      attachmentTypes: ATTACHMENT_TYPES,
      budgetTypes: settings.budgetTypes,
      serverTime: nowText_()
    }
  };
}

/* =====================================================================
 * คำขอ
 * ===================================================================*/

function listRequestRows_(user, filters) {
  filters = filters || {};
  const includeHistory = isTrue_(filters.includeHistory);
  const canAll = canSeeAll_(user);
  const canDept = canSeeDepartment_(user);
  const userId = text_(user.UserID);
  const department = text_(user.Department);

  let rows = getTableRows_(CONFIG.REQUEST_SHEET).filter(r => {
    if (!includeHistory && String(r.IsLatest) !== '1' && r.IsLatest !== 1 && r.IsLatest !== '') return false;
    if (!canAll) {
      if (canDept) {
        if (text_(r.CreatedByDepartment) !== department && text_(r.CreatedByUserID) !== userId) return false;
      } else if (text_(r.CreatedByUserID) !== userId) {
        return false;
      }
    }
    return matchFilters_(r, filters);
  });

  rows.sort((a, b) => {
    const da = toDate_(a.CreatedAt), db = toDate_(b.CreatedAt);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });
  return rows.slice(0, CONFIG.MAX_LIST_ROWS);
}

function matchFilters_(r, filters) {
  if (filters.status && normalizeStatus_(r.Status) !== filters.status) return false;
  if (filters.department && text_(r.Department) !== text_(filters.department)) return false;
  if (filters.budgetType && text_(r.BudgetType) !== text_(filters.budgetType)) return false;
  if (filters.purchaseType && text_(r.PurchaseType) !== text_(filters.purchaseType)) return false;
  if (filters.stage && text_(r.CurrentStage) !== text_(filters.stage)) return false;
  if (filters.fiscalYear && String(r.FiscalYear) !== String(filters.fiscalYear)) return false;
  if (filters.dateFrom) {
    const d = toDate_(r.RequestDate) || toDate_(r.CreatedAt);
    const from = toDate_(filters.dateFrom);
    if (d && from && d < from) return false;
  }
  if (filters.dateTo) {
    const d = toDate_(r.RequestDate) || toDate_(r.CreatedAt);
    const to = toDate_(filters.dateTo);
    if (d && to && d > new Date(to.getTime() + 86399000)) return false;
  }
  if (filters.keyword) {
    const key = String(filters.keyword).toLowerCase();
    const joined = [r.RequestNo, r.Subject, r.CreatedByName, r.Department, r.Reason, r.Status, r.CurrentStage]
      .join(' ').toLowerCase();
    if (joined.indexOf(key) === -1) return false;
  }
  return true;
}

function summarizeRequest_(r) {
  return {
    requestId: r.RequestID,
    requestNo: r.RequestNo,
    rootRequestId: r.RootRequestID,
    version: num_(r.Version) || 1,
    requestDate: r.RequestDate,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
    subject: r.Subject,
    department: r.Department,
    requester: r.CreatedByName,
    requesterId: r.CreatedByUserID,
    totalAmount: num_(r.TotalAmount),
    status: normalizeStatus_(r.Status),
    purchaseType: text_(r.PurchaseType),
    budgetType: text_(r.BudgetType),
    budgetSource: text_(r.PlanBudgetSource),
    fiscalYear: text_(r.FiscalYear),
    currentStage: text_(r.CurrentStage),
    currentStageAt: r.CurrentStageAt,
    submittedAt: r.SubmittedAt,
    checkedAt: r.CheckedAt,
    approvedAt: r.ApprovedAt,
    completedAt: r.CompletedAt,
    returnRemark: text_(r.ReturnRemark),
    isLocked: bool01_(r.IsLocked) === 1
  };
}

function apiListRequests_(p) {
  const user = requireAuth_(p.token);
  const rows = listRequestRows_(user, p.filters || {});
  return { ok: true, requests: rows.map(summarizeRequest_) };
}

function apiGetRequest_(p) {
  const user = requireAuth_(p.token);
  const request = findRequest_(p.requestId);
  assertCanView_(user, request);

  const detail = Object.assign({}, request);
  detail.Status = normalizeStatus_(detail.Status);
  detail.Phone = normalizePhone_(detail.Phone || detail.CreatedByPhone);

  const items = getTableRows_(CONFIG.ITEM_SHEET)
    .filter(r => text_(r.RequestID) === text_(p.requestId))
    .sort((a, b) => num_(a.LineNo) - num_(b.LineNo));
  const inspectors = getTableRows_(CONFIG.INSPECTOR_SHEET)
    .filter(r => text_(r.RequestID) === text_(p.requestId))
    .sort((a, b) => num_(a.Seq) - num_(b.Seq));

  const versions = getTableRows_(CONFIG.REQUEST_SHEET)
    .filter(r => text_(r.RootRequestID) === text_(request.RootRequestID || request.RequestID))
    .sort((a, b) => num_(a.Version) - num_(b.Version))
    .map(r => ({
      requestId: r.RequestID,
      requestNo: r.RequestNo,
      version: num_(r.Version) || 1,
      status: normalizeStatus_(r.Status),
      createdAt: r.CreatedAt,
      returnRemark: text_(r.ReturnRemark),
      isLatest: bool01_(r.IsLatest) === 1
    }));

  return {
    ok: true,
    request: detail,
    items: items,
    inspectors: inspectors,
    versions: versions,
    progress: readProgress_(p.requestId, user),
    permissions: requestPermissions_(user, request)
  };
}

function findRequest_(requestId) {
  const row = getTableRows_(CONFIG.REQUEST_SHEET).find(r => text_(r.RequestID) === text_(requestId));
  if (!row) throw new Error('ไม่พบคำขอที่ต้องการ');
  return row;
}

function assertCanView_(user, request) {
  if (canSeeAll_(user)) return;
  const userId = text_(user.UserID);
  if (text_(request.CreatedByUserID) === userId) return;
  if (canSeeDepartment_(user) && text_(request.CreatedByDepartment) === text_(user.Department)) return;
  throw new Error('คุณไม่มีสิทธิเข้าถึงคำขอนี้');
}

function requestPermissions_(user, request) {
  const status = normalizeStatus_(request.Status);
  const isOwner = text_(request.CreatedByUserID) === text_(user.UserID);
  const supply = isSupply_(user);
  const locked = bool01_(request.IsLocked) === 1;
  const latest = bool01_(request.IsLatest) === 1;

  return {
    // ส่วนที่ 1-4 และ 6 (ข้อมูลของผู้ยื่นคำขอ) แก้ไขได้เฉพาะเจ้าของคำขอ ขณะสถานะร่าง/ส่งกลับแก้ไข
    canEdit: latest && !locked && isOwner &&
      (status === STATUS.DRAFT || status === STATUS.RETURNED),
    canSubmit: latest && !locked && isOwner && (status === STATUS.DRAFT || status === STATUS.RETURNED),
    // ส่วนที่ 5 (ความเห็นเจ้าหน้าที่ / งานแผน) แก้ไขได้เฉพาะเจ้าหน้าที่พัสดุ ไม่ว่าคำขออยู่สถานะใด (ตราบใดที่ยังไม่ล็อก)
    canEditOfficerSection: latest && !locked && supply &&
      status !== STATUS.CANCELLED && status !== STATUS.SUPERSEDED,
    canReview: latest && supply && status === STATUS.SUBMITTED,
    canDownload: status !== STATUS.CANCELLED,
    isOfficialCopy: status === STATUS.CHECKED || status === STATUS.APPROVED ||
      status === STATUS.IN_PROGRESS || status === STATUS.COMPLETED,
    canAttachApproval: latest && supply && status === STATUS.CHECKED,
    canUnlock: supply && locked,
    canAddProgress: latest && supply && (status === STATUS.APPROVED ||
      status === STATUS.IN_PROGRESS || status === STATUS.COMPLETED),
    canCancel: latest && !locked && (isOwner || supply) && status !== STATUS.CANCELLED,
    isOwner: isOwner,
    isSupply: supply
  };
}

function normalizeStatus_(status) {
  const s = text_(status);
  const legacy = {
    '': STATUS.DRAFT,
    'Draft': STATUS.DRAFT,
    'Submitted': STATUS.SUBMITTED,
    'ส่งให้พัสดุตรวจสอบ': STATUS.SUBMITTED,
    'Checked': STATUS.CHECKED,
    'ApprovedForPrint': STATUS.CHECKED,
    'Returned': STATUS.RETURNED,
    'Cancelled': STATUS.CANCELLED,
    'อนุมัติแล้ว (ล็อก)': STATUS.APPROVED
  };
  return legacy[s] !== undefined ? legacy[s] : s;
}

/* ---------------------- บันทึกคำขอ / เวอร์ชัน ---------------------- */

function apiSaveRequest_(p) {
  const user = requireAuth_(p.token);
  setupSupplySystem();
  const payload = p.payload || {};

  if (!text_(payload.subject)) throw new Error('กรุณากรอกเรื่องที่ขอความเห็นชอบซื้อหรือจ้าง');
  if (!text_(payload.reason)) throw new Error('กรุณากรอกเหตุผลและความจำเป็น');
  const items = sanitizeItems_(payload.items);
  if (!items.length) throw new Error('กรุณาเพิ่มรายการพัสดุอย่างน้อย 1 รายการ');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return saveRequestInternal_(user, payload, items, isTrue_(p.submit));
  } finally {
    lock.releaseLock();
  }
}

function saveRequestInternal_(user, payload, items, alsoSubmit) {
  const now = new Date();
  const sh = getSS_().getSheetByName(CONFIG.REQUEST_SHEET);
  const headers = getHeaders_(sh);
  const all = getTableRows_(CONFIG.REQUEST_SHEET);
  const existing = payload.requestId ? all.find(r => text_(r.RequestID) === text_(payload.requestId)) : null;

  let mode = 'create';
  if (existing) {
    const status = normalizeStatus_(existing.Status);
    if (bool01_(existing.IsLocked) === 1) {
      throw new Error('คำขอนี้ถูกล็อกหลังได้รับอนุมัติแล้ว ต้องให้เจ้าหน้าที่พัสดุปลดล็อกก่อนจึงจะแก้ไขได้');
    }
    // ส่วนที่ 1-4, 6 เป็นของผู้ยื่นคำขอเท่านั้น — เจ้าหน้าที่พัสดุแก้ไขส่วนนี้ไม่ได้แม้เป็นเจ้าหน้าที่พัสดุ
    // (เจ้าหน้าที่พัสดุแก้ไขได้เฉพาะส่วนที่ 5 ผ่าน action saveOfficerOpinion เท่านั้น)
    if (text_(existing.CreatedByUserID) !== text_(user.UserID)) {
      throw new Error('คุณไม่มีสิทธิแก้ไขคำขอนี้ ส่วนนี้แก้ไขได้เฉพาะผู้ยื่นคำขอ');
    }
    if (status === STATUS.RETURNED) mode = 'newVersion';
    else if (status === STATUS.DRAFT) mode = 'update';
    else throw new Error('คำขอสถานะ "' + status + '" ไม่สามารถแก้ไขได้');
  }

  const profile = safeUser_(user);
  const requestId = mode === 'update' ? existing.RequestID : makeId_('REQ');
  const baseNo = existing ? String(existing.RequestNo).replace(/-v\d+$/, '') : makeRequestNo_();
  const version = mode === 'newVersion' ? num_(existing.Version) + 1 : (existing ? num_(existing.Version) || 1 : 1);
  const requestNo = version > 1 ? baseNo + '-v' + version : baseNo;
  const rootId = existing ? text_(existing.RootRequestID) || text_(existing.RequestID) : requestId;

  const totalAmount = items.reduce((s, it) => s + num_(it.TotalPrice), 0);
  const lastTotal = items.reduce((s, it) => s + num_(it.LastPrice), 0);
  const requestDate = toDate_(payload.requestDate) || now;

  const record = {
    RequestID: requestId,
    RequestNo: requestNo,
    RootRequestID: rootId,
    ParentRequestID: mode === 'newVersion' ? existing.RequestID : (existing ? text_(existing.ParentRequestID) : ''),
    Version: version,
    IsLatest: 1,
    CreatedAt: mode === 'update' ? existing.CreatedAt : now,
    UpdatedAt: now,
    CreatedByUserID: existing ? existing.CreatedByUserID : text_(user.UserID),
    CreatedByName: existing ? existing.CreatedByName : profile.fullName,
    CreatedByPosition: existing ? existing.CreatedByPosition : profile.position,
    CreatedByDepartment: existing ? existing.CreatedByDepartment : profile.department,
    CreatedByPhone: normalizePhone_(existing ? existing.CreatedByPhone : profile.phone),
    CreatedByEmail: existing ? existing.CreatedByEmail : profile.email,
    Department: text_(payload.department) || profile.department,
    Phone: normalizePhone_(payload.phone || profile.phone),
    DocNoText: text_(payload.docNoText) || 'นย',
    RequestDate: requestDate,
    Subject: text_(payload.subject),
    To: text_(payload.to) || 'นายแพทย์สาธารณสุขจังหวัดนครนายก',
    PurchaseType: text_(payload.purchaseType) || 'ซื้อ',
    ItemCount: items.length,
    Reason: text_(payload.reason),
    PurposeRegular: bool01_(payload.purposeRegular),
    PurposeStock: bool01_(payload.purposeStock),
    PurposeProject: bool01_(payload.purposeProject),
    ProjectName: text_(payload.projectName),
    TotalAmount: totalAmount,
    LastPurchaseTotal: lastTotal,
    Status: mode === 'newVersion' ? STATUS.DRAFT : (existing ? normalizeStatus_(existing.Status) : STATUS.DRAFT),
    SubmittedAt: '', SubmittedByUserID: '', SubmittedByName: '',
    CheckedAt: '', CheckedByUserID: '', CheckedByName: '', CheckRemark: '',
    ReturnedAt: '', ReturnedByUserID: '', ReturnedByName: '', ReturnRemark: '',
    ReturnCount: existing ? num_(existing.ReturnCount) : 0,
    OfficerOpinionAnnualUnder100k: bool01_(payload.officerOpinionAnnualUnder100k),
    OfficerOpinionAnnualOver100k: bool01_(payload.officerOpinionAnnualOver100k),
    OfficerMethod: text_(payload.officerMethod) || 'เฉพาะเจาะจง',
    OfficerMethodInProgress: bool01_(payload.officerMethodInProgress),
    OfficerInProgressMethod: text_(payload.officerInProgressMethod),
    CompletionDays: num_(payload.completionDays),
    OfficerReason: text_(payload.officerReason) || 'เนื่องจากมีความจำเป็นต้องใช้ในงานราชการของ สสจ.นครนายก',
    OfficerName: text_(payload.officerName),
    OfficerPosition: text_(payload.officerPosition),
    DeptHeadName: text_(payload.deptHeadName),
    DeptHeadPosition: text_(payload.deptHeadPosition),
    BudgetType: text_(payload.budgetType) || budgetTypeFromSource_(payload.planBudgetSource),
    PlanInPlan: bool01_(payload.planInPlan),
    PlanYear: text_(payload.planYear),
    PlanOther: text_(payload.planOther),
    PlanBudgetSource: text_(payload.planBudgetSource),
    PlanAmount: num_(payload.planAmount) || totalAmount,
    PlanRemark: text_(payload.planRemark),
    FiscalYear: fiscalYear_(requestDate),
    ApproverName: text_(payload.approverName),
    ApproverPosition: text_(payload.approverPosition) || 'นายแพทย์สาธารณสุขจังหวัดนครนายก',
    Notes: text_(payload.notes),
    ApprovedAt: '', ApprovedByUserID: '', ApprovedByName: '', ApprovedRemark: '',
    ApprovedDocFileNames: '', ApprovedDocFileUrls: '', ApprovedDocFileIds: '',
    IsLocked: 0, LockedAt: '', LockedByUserID: '', LockedByName: '',
    UnlockedAt: '', UnlockedByUserID: '', UnlockedByName: '', UnlockReason: '',
    CurrentStage: '', CurrentStageAt: '', CompletedAt: '',
    MainPdfFileId: '', MainPdfUrl: ''
  };

  // ไฟล์แนบ 5 ประเภท — เวอร์ชันใหม่จะสืบทอดไฟล์เดิมมาให้ แก้ไขหรือลบทีหลังได้
  const attachments = payload.attachments || {};
  ATTACHMENT_TYPES.forEach(type => {
    const input = attachments[type.key] || {};
    const source = mode === 'create' ? null : existing;
    const merged = mergeAttachment_(source, type.key, input, requestNo);
    record['Attachment' + type.key] = merged.checked;
    record['Attachment' + type.key + 'Sheets'] = merged.sheets;
    record['Attachment' + type.key + 'FileNames'] = merged.names;
    record['Attachment' + type.key + 'FileUrls'] = merged.urls;
    record['Attachment' + type.key + 'FileIds'] = merged.ids;
  });

  if (mode === 'update') {
    writeObjectRow_(sh, headers, record, existing._rowNumber);
    deleteRowsByValue_(CONFIG.ITEM_SHEET, 'RequestID', requestId);
    deleteRowsByValue_(CONFIG.INSPECTOR_SHEET, 'RequestID', requestId);
  } else {
    if (mode === 'newVersion') {
      updateRequestRow_(existing.RequestID, { IsLatest: 0, Status: STATUS.SUPERSEDED, UpdatedAt: now });
      record.ReturnCount = num_(existing.ReturnCount);
    }
    appendObjectRow_(sh, headers, record);
  }
  clearTableCache_(CONFIG.REQUEST_SHEET);

  const itemSheet = getSS_().getSheetByName(CONFIG.ITEM_SHEET);
  appendObjectRows_(itemSheet, getHeaders_(itemSheet), items.map((it, i) => Object.assign({}, it, {
    LineID: makeId_('LINE'), RequestID: requestId, LineNo: i + 1
  })));

  const inspectors = sanitizeInspectors_(payload.inspectors);
  const insSheet = getSS_().getSheetByName(CONFIG.INSPECTOR_SHEET);
  appendObjectRows_(insSheet, getHeaders_(insSheet), inspectors.map((ins, i) => Object.assign({}, ins, {
    InspectorID: makeId_('INS'), RequestID: requestId, Seq: i + 1
  })));
  clearTableCache_(CONFIG.ITEM_SHEET);
  clearTableCache_(CONFIG.INSPECTOR_SHEET);

  addLog_(user, mode === 'create' ? 'CREATE_REQUEST' : (mode === 'newVersion' ? 'CREATE_VERSION' : 'UPDATE_REQUEST'),
    requestId, requestNo + ' (v' + version + ')');

  let message = mode === 'newVersion'
    ? 'บันทึกเป็นคำขอเวอร์ชันที่ ' + version + ' เรียบร้อยแล้ว'
    : 'บันทึกคำขอเรียบร้อยแล้ว';

  let submitResult = null;
  if (alsoSubmit) {
    submitResult = submitRequestInternal_(user, requestId);
    message = submitResult.message;
  }

  return {
    ok: true,
    requestId: requestId,
    requestNo: requestNo,
    version: version,
    mode: mode,
    message: message,
    status: submitResult ? STATUS.SUBMITTED : record.Status
  };
}

function sanitizeItems_(items) {
  return (items || [])
    .filter(it => it && text_(it.itemName))
    .map(it => {
      const quantity = num_(it.quantity);
      const unitPrice = num_(it.unitPrice);
      return {
        ItemName: text_(it.itemName),
        PlanBalanceAmount: num_(it.planBalanceAmount),
        Quantity: quantity,
        Unit: text_(it.unit),
        UnitPrice: unitPrice,
        TotalPrice: num_(it.totalPrice) || quantity * unitPrice,
        LastPrice: num_(it.lastPrice),
        Remark: text_(it.remark)
      };
    });
}

function sanitizeInspectors_(inspectors) {
  return (inspectors || [])
    .filter(ins => ins && text_(ins.fullName))
    .slice(0, 5)
    .map(ins => ({
      FullName: text_(ins.fullName),
      Position: text_(ins.position),
      CID: text_(ins.cid),
      Email: text_(ins.email),
      UserID: text_(ins.userId)
    }));
}

function makeRequestNo_() {
  const ymd = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd');
  const prefix = 'PR' + ymd;
  const rows = getTableRows_(CONFIG.REQUEST_SHEET);
  const count = rows.filter(r => String(r.RequestNo || '').indexOf(prefix) === 0).length + 1;
  return prefix + '-' + ('000' + count).slice(-3);
}

function updateRequestRow_(requestId, fields) {
  const sh = getSS_().getSheetByName(CONFIG.REQUEST_SHEET);
  const headers = getHeaders_(sh);
  const map = getHeaderMap_(headers);
  const row = getTableRows_(CONFIG.REQUEST_SHEET).find(r => text_(r.RequestID) === text_(requestId));
  if (!row) throw new Error('ไม่พบคำขอที่ต้องการปรับปรุง');

  const range = sh.getRange(row._rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  Object.keys(fields).forEach(k => {
    if (map[k] !== undefined) values[map[k]] = fields[k];
  });
  range.setValues([values]);
  clearTableCache_(CONFIG.REQUEST_SHEET);
}

/**
 * บันทึกเฉพาะส่วนที่ 5) ความเห็นเจ้าหน้าที่ / งานแผน
 * ให้เจ้าหน้าที่พัสดุแก้ไขได้โดยไม่ต้องรอสถานะร่าง/ส่งกลับแก้ไข และไม่กระทบส่วนอื่นของคำขอ
 * (ส่วนที่ 1-4, 6 ยังคงแก้ไขได้เฉพาะเจ้าของคำขอผ่าน apiSaveRequest_ เท่านั้น)
 */
function apiSaveOfficerOpinion_(p) {
  const user = requireAuth_(p.token);
  requireSupply_(user);
  const requestId = text_(p.requestId);
  const request = findRequest_(requestId);

  if (bool01_(request.IsLatest) !== 1) throw new Error('คำขอนี้ไม่ใช่เวอร์ชันล่าสุด แก้ไขไม่ได้');
  if (bool01_(request.IsLocked) === 1) throw new Error('คำขอนี้ถูกล็อกหลังได้รับอนุมัติแล้ว ต้องปลดล็อกก่อนจึงจะแก้ไขได้');
  const status = normalizeStatus_(request.Status);
  if (status === STATUS.CANCELLED) throw new Error('คำขอนี้ถูกยกเลิกแล้ว');
  if (status === STATUS.SUPERSEDED) throw new Error('คำขอนี้ถูกแก้ไขเป็นเวอร์ชันใหม่แล้ว');

  const payload = p.payload || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    updateRequestRow_(requestId, {
      OfficerOpinionAnnualUnder100k: bool01_(payload.officerOpinionAnnualUnder100k),
      OfficerOpinionAnnualOver100k: bool01_(payload.officerOpinionAnnualOver100k),
      OfficerMethod: text_(payload.officerMethod) || 'เฉพาะเจาะจง',
      OfficerMethodInProgress: bool01_(payload.officerMethodInProgress),
      OfficerInProgressMethod: text_(payload.officerInProgressMethod),
      CompletionDays: num_(payload.completionDays),
      OfficerReason: text_(payload.officerReason) || 'เนื่องจากมีความจำเป็นต้องใช้ในงานราชการของ สสจ.นครนายก',
      OfficerName: text_(payload.officerName),
      OfficerPosition: text_(payload.officerPosition),
      DeptHeadName: text_(payload.deptHeadName),
      DeptHeadPosition: text_(payload.deptHeadPosition),
      BudgetType: text_(payload.budgetType) || budgetTypeFromSource_(payload.planBudgetSource),
      PlanInPlan: bool01_(payload.planInPlan),
      PlanYear: text_(payload.planYear),
      PlanOther: text_(payload.planOther),
      PlanBudgetSource: text_(payload.planBudgetSource),
      PlanAmount: num_(payload.planAmount) || num_(request.TotalAmount),
      PlanRemark: text_(payload.planRemark),
      UpdatedAt: new Date()
    });
  } finally {
    lock.releaseLock();
  }

  addLog_(user, 'UPDATE_OFFICER_OPINION', requestId, request.RequestNo);
  return { ok: true, message: 'บันทึกความเห็นเจ้าหน้าที่/งานแผนเรียบร้อยแล้ว' };
}

/* ---------------------- ส่ง / ตรวจสอบ / ยกเลิก ---------------------- */

function apiSubmitRequest_(p) {
  const user = requireAuth_(p.token);
  return submitRequestInternal_(user, p.requestId);
}

function submitRequestInternal_(user, requestId) {
  const request = findRequest_(requestId);
  if (text_(request.CreatedByUserID) !== text_(user.UserID) && !isSupply_(user)) {
    throw new Error('ส่งคำขอได้เฉพาะผู้สร้างคำขอเท่านั้น');
  }
  const status = normalizeStatus_(request.Status);
  if (status !== STATUS.DRAFT && status !== STATUS.RETURNED) {
    throw new Error('ส่งให้พัสดุตรวจสอบได้เฉพาะคำขอสถานะ "ร่าง" หรือ "ส่งกลับแก้ไข"');
  }

  ATTACHMENT_TYPES.filter(t => t.required).forEach(t => {
    if (!text_(request['Attachment' + t.key + 'FileIds'])) {
      throw new Error('ต้องแนบไฟล์ "' + t.label + '" ก่อนส่งให้เจ้าหน้าที่พัสดุตรวจสอบ');
    }
  });

  const now = new Date();
  updateRequestRow_(requestId, {
    Status: STATUS.SUBMITTED,
    UpdatedAt: now,
    SubmittedAt: now,
    SubmittedByUserID: text_(user.UserID),
    SubmittedByName: text_(user.FullName)
  });

  addLog_(user, 'SUBMIT_REQUEST', requestId, text_(request.RequestNo));
  writeProgress_(user, requestId, {
    progressStatus: STATUS.SUBMITTED,
    note: 'ส่งคำขอให้เจ้าหน้าที่พัสดุตรวจสอบ'
  });
  notifySupplyOfficers_(request, user);

  return { ok: true, message: 'ส่งคำขอให้เจ้าหน้าที่พัสดุตรวจสอบเรียบร้อยแล้ว', status: STATUS.SUBMITTED };
}

function apiReviewRequest_(p) {
  const user = requireAuth_(p.token);
  requireSupply_(user);
  const request = findRequest_(p.requestId);
  const status = normalizeStatus_(request.Status);
  if (status !== STATUS.SUBMITTED) {
    throw new Error('ตรวจสอบได้เฉพาะคำขอที่อยู่ในสถานะ "' + STATUS.SUBMITTED + '"');
  }

  const now = new Date();
  const remark = text_(p.remark);
  const pass = text_(p.result) === 'pass';

  if (!pass && !remark) throw new Error('กรุณาระบุเหตุผลที่ส่งกลับแก้ไข');

  if (pass) {
    updateRequestRow_(p.requestId, {
      Status: STATUS.CHECKED,
      UpdatedAt: now,
      CheckedAt: now,
      CheckedByUserID: text_(user.UserID),
      CheckedByName: text_(user.FullName),
      CheckRemark: remark || 'ผ่านการตรวจสอบ'
    });
    addLog_(user, 'REVIEW_PASS', p.requestId, remark || 'ผ่านการตรวจสอบ');
    writeProgress_(user, p.requestId, {
      progressStatus: STATUS.CHECKED,
      note: remark || 'ตรวจสอบเอกสารครบถ้วน ผู้ยื่นคำขอดาวน์โหลด PDF/Word ไปเสนอในระบบ SMO ได้'
    });
    notifyRequester_(request, 'ผ่านการตรวจสอบ',
      'เอกสารคำขอ ' + request.RequestNo + ' ผ่านการตรวจสอบแล้ว กรุณาดาวน์โหลดไฟล์ PDF และ Word ไปเสนอในระบบ SMO');
    return { ok: true, message: 'บันทึกผลผ่านการตรวจสอบเรียบร้อยแล้ว', status: STATUS.CHECKED };
  }

  updateRequestRow_(p.requestId, {
    Status: STATUS.RETURNED,
    UpdatedAt: now,
    ReturnedAt: now,
    ReturnedByUserID: text_(user.UserID),
    ReturnedByName: text_(user.FullName),
    ReturnRemark: remark,
    ReturnCount: num_(request.ReturnCount) + 1
  });
  addLog_(user, 'REVIEW_RETURN', p.requestId, remark);
  writeProgress_(user, p.requestId, { progressStatus: STATUS.RETURNED, note: remark });
  notifyRequester_(request, 'ส่งกลับแก้ไข',
    'คำขอ ' + request.RequestNo + ' ถูกส่งกลับให้แก้ไข เหตุผล: ' + remark);

  return { ok: true, message: 'ส่งกลับให้ผู้ยื่นคำขอแก้ไขเรียบร้อยแล้ว', status: STATUS.RETURNED };
}

function apiCancelRequest_(p) {
  const user = requireAuth_(p.token);
  const request = findRequest_(p.requestId);
  if (text_(request.CreatedByUserID) !== text_(user.UserID) && !isSupply_(user)) {
    throw new Error('คุณไม่มีสิทธิยกเลิกคำขอนี้');
  }
  if (bool01_(request.IsLocked) === 1) throw new Error('คำขอถูกล็อกอยู่ ไม่สามารถยกเลิกได้');

  updateRequestRow_(p.requestId, { Status: STATUS.CANCELLED, UpdatedAt: new Date() });
  addLog_(user, 'CANCEL_REQUEST', p.requestId, text_(p.remark));
  writeProgress_(user, p.requestId, { progressStatus: STATUS.CANCELLED, note: text_(p.remark) || 'ยกเลิกคำขอ' });
  return { ok: true, message: 'ยกเลิกคำขอเรียบร้อยแล้ว', status: STATUS.CANCELLED };
}

/* ---------------------- แนบเอกสารอนุมัติและล็อก ---------------------- */

function apiAttachApproval_(p) {
  const user = requireAuth_(p.token);
  requireSupply_(user);
  const request = findRequest_(p.requestId);
  const status = normalizeStatus_(request.Status);
  if (status !== STATUS.CHECKED && status !== STATUS.APPROVED) {
    throw new Error('แนบเอกสารที่ลงนามอนุมัติได้หลังคำขอผ่านการตรวจสอบแล้วเท่านั้น');
  }

  const uploaded = uploadFiles_(p.files || [], request.RequestNo, 'เอกสารอนุมัติ_SMO');
  if (!uploaded.ids) throw new Error('กรุณาแนบไฟล์เอกสารที่ นพ.สสจ. ลงนามอนุมัติแล้ว');

  const now = new Date();
  const approvedAt = toDate_(p.approvedAt) || now;
  updateRequestRow_(p.requestId, {
    Status: STATUS.APPROVED,
    UpdatedAt: now,
    ApprovedAt: approvedAt,
    ApprovedByUserID: text_(user.UserID),
    ApprovedByName: text_(user.FullName),
    ApprovedRemark: text_(p.remark),
    ApprovedDocFileNames: joinNonEmpty_([request.ApprovedDocFileNames, uploaded.names]),
    ApprovedDocFileUrls: joinNonEmpty_([request.ApprovedDocFileUrls, uploaded.urls]),
    ApprovedDocFileIds: joinNonEmpty_([request.ApprovedDocFileIds, uploaded.ids]),
    IsLocked: 1,
    LockedAt: now,
    LockedByUserID: text_(user.UserID),
    LockedByName: text_(user.FullName)
  });

  addLog_(user, 'ATTACH_APPROVAL', p.requestId, 'แนบเอกสารอนุมัติและล็อกคำขอ');
  writeProgress_(user, p.requestId, {
    progressStatus: STATUS.APPROVED,
    note: text_(p.remark) || 'นพ.สสจ. ลงนามอนุมัติในระบบ SMO เรียบร้อย แนบเอกสารเป็นหลักฐานและล็อกข้อมูล',
    fileNames: uploaded.names, fileUrls: uploaded.urls, fileIds: uploaded.ids
  });
  notifyRequester_(request, 'ได้รับอนุมัติแล้ว',
    'คำขอ ' + request.RequestNo + ' ได้รับอนุมัติเรียบร้อยแล้ว เจ้าหน้าที่พัสดุจะเริ่มดำเนินการจัดซื้อจัดจ้างต่อไป');

  return { ok: true, message: 'บันทึกเอกสารอนุมัติและล็อกคำขอเรียบร้อยแล้ว', status: STATUS.APPROVED };
}

function apiSetLock_(p) {
  const user = requireAuth_(p.token);
  requireSupply_(user);
  findRequest_(p.requestId);
  const lock = isTrue_(p.locked);
  const reason = text_(p.reason);
  if (!lock && !reason) throw new Error('กรุณาระบุเหตุผลในการปลดล็อก');

  const now = new Date();
  const fields = lock
    ? { IsLocked: 1, LockedAt: now, LockedByUserID: text_(user.UserID), LockedByName: text_(user.FullName) }
    : { IsLocked: 0, UnlockedAt: now, UnlockedByUserID: text_(user.UserID), UnlockedByName: text_(user.FullName), UnlockReason: reason };
  fields.UpdatedAt = now;
  updateRequestRow_(p.requestId, fields);

  addLog_(user, lock ? 'LOCK_REQUEST' : 'UNLOCK_REQUEST', p.requestId, reason);
  writeProgress_(user, p.requestId, {
    progressStatus: lock ? 'ล็อกข้อมูล' : 'ปลดล็อกข้อมูล',
    note: reason || (lock ? 'ล็อกข้อมูลคำขอ' : 'ปลดล็อกเพื่อแก้ไขข้อมูลให้ตรงกับเอกสารที่ลงนาม')
  });
  return { ok: true, message: lock ? 'ล็อกคำขอเรียบร้อยแล้ว' : 'ปลดล็อกคำขอเรียบร้อยแล้ว', isLocked: lock };
}

/* =====================================================================
 * ความก้าวหน้า (ข้อ 4, 5, 6)
 * ===================================================================*/

function apiAddProgress_(p) {
  const user = requireAuth_(p.token);
  const request = findRequest_(p.requestId);
  assertCanView_(user, request);

  const data = p.data || {};
  const stage = text_(data.progressStatus);
  if (!stage) throw new Error('กรุณาเลือกขั้นตอนความก้าวหน้า');

  const isStageUpdate = getProcurementStages_().indexOf(stage) > -1;
  if (isStageUpdate && !isSupply_(user)) {
    throw new Error('เฉพาะเจ้าหน้าที่พัสดุเท่านั้นที่บันทึกความก้าวหน้าการจัดซื้อจัดจ้างได้');
  }

  const progressAt = toDate_(data.progressAt) || new Date();
  const uploaded = uploadFiles_(data.files || [], request.RequestNo, 'ความก้าวหน้า');

  const progress = writeProgress_(user, p.requestId, {
    progressStatus: stage,
    progressAt: progressAt,
    note: text_(data.note),
    supplyNote: text_(data.supplyNote),
    myNote: text_(data.myNote),
    fileNames: uploaded.names, fileUrls: uploaded.urls, fileIds: uploaded.ids
  });

  if (isStageUpdate) {
    const fields = {
      CurrentStage: stage,
      CurrentStageAt: progressAt,
      UpdatedAt: new Date()
    };
    const status = normalizeStatus_(request.Status);
    if (stage === FINAL_STAGE) {
      fields.Status = STATUS.COMPLETED;
      fields.CompletedAt = progressAt;
    } else if (status === STATUS.APPROVED) {
      fields.Status = STATUS.IN_PROGRESS;
    }
    updateRequestRow_(p.requestId, fields);
  }

  addLog_(user, 'ADD_PROGRESS', p.requestId, stage);
  return {
    ok: true,
    message: 'บันทึกความก้าวหน้าเรียบร้อยแล้ว',
    progressId: progress.ProgressID,
    progress: readProgress_(p.requestId, user)
  };
}

function apiListProgress_(p) {
  const user = requireAuth_(p.token);
  const request = findRequest_(p.requestId);
  assertCanView_(user, request);
  return { ok: true, progress: readProgress_(p.requestId, user) };
}

function apiDeleteProgress_(p) {
  const user = requireAuth_(p.token);
  const rows = getTableRows_(CONFIG.PROGRESS_SHEET);
  const row = rows.find(r => text_(r.ProgressID) === text_(p.progressId));
  if (!row) throw new Error('ไม่พบรายการความก้าวหน้า');
  if (text_(row.ProgressByUserID) !== text_(user.UserID) && !isSuperAdmin_(user)) {
    throw new Error('ลบได้เฉพาะรายการที่ตนเองบันทึก หรือผู้ดูแลระบบเท่านั้น');
  }
  deleteRowsByValue_(CONFIG.PROGRESS_SHEET, 'ProgressID', p.progressId);
  addLog_(user, 'DELETE_PROGRESS', row.RequestID, text_(row.ProgressStatus));
  return { ok: true, message: 'ลบรายการความก้าวหน้าแล้ว', progress: readProgress_(row.RequestID, user) };
}

function writeProgress_(user, requestId, data) {
  const request = getTableRows_(CONFIG.REQUEST_SHEET).find(r => text_(r.RequestID) === text_(requestId));
  const sh = getSS_().getSheetByName(CONFIG.PROGRESS_SHEET);
  const record = {
    ProgressID: makeId_('PROG'),
    RequestID: requestId,
    RequestNo: request ? text_(request.RequestNo) : '',
    ProgressAt: data.progressAt || new Date(),
    ProgressByUserID: text_(user.UserID),
    ProgressByName: text_(user.FullName),
    ProgressStatus: text_(data.progressStatus),
    Note: text_(data.note),
    SupplyNote: text_(data.supplyNote),
    MyNote: text_(data.myNote),
    FileNames: text_(data.fileNames),
    FileUrls: text_(data.fileUrls),
    FileIds: text_(data.fileIds),
    SignerRole: text_(data.signerRole),
    SignerName: text_(data.signerName),
    SignatureUrl: text_(data.signatureUrl),
    CreatedAt: new Date()
  };
  appendObjectRow_(sh, getHeaders_(sh), record);
  clearTableCache_(CONFIG.PROGRESS_SHEET);
  return record;
}

/**
 * คืนรายการความก้าวหน้าโดยกรอง note ตามสิทธิ
 * - Note       : ทุกคนที่เห็นคำขอ
 * - SupplyNote : เฉพาะเจ้าหน้าที่พัสดุที่ admin กำหนด
 * - MyNote     : เฉพาะเจ้าของบันทึก และ superadmin
 */
function readProgress_(requestId, viewer) {
  const supply = isSupply_(viewer);
  const superAdmin = isSuperAdmin_(viewer);
  const viewerId = text_(viewer.UserID);

  return getTableRows_(CONFIG.PROGRESS_SHEET)
    .filter(r => text_(r.RequestID) === text_(requestId))
    .map(r => {
      const own = text_(r.ProgressByUserID) === viewerId;
      return {
        progressId: r.ProgressID,
        requestId: r.RequestID,
        requestNo: r.RequestNo,
        progressAt: r.ProgressAt,
        byUserId: r.ProgressByUserID,
        byName: r.ProgressByName,
        stage: r.ProgressStatus,
        note: text_(r.Note),
        supplyNote: supply ? text_(r.SupplyNote) : '',
        myNote: (own || superAdmin) ? text_(r.MyNote) : '',
        canSeeSupplyNote: supply,
        canSeeMyNote: own || superAdmin,
        canDelete: own || superAdmin,
        fileNames: splitLines_(r.FileNames),
        fileUrls: splitLines_(r.FileUrls)
      };
    })
    .sort((a, b) => {
      const da = toDate_(a.progressAt), db = toDate_(b.progressAt);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });
}

function getProcurementStages_() {
  return getOptionList_('ProcurementStage', PROCUREMENT_STAGES);
}

/**
 * อ่านตัวเลือกของหมวดใดหมวดหนึ่งจากแผ่นงาน setting (กำหนดเองได้จากหน้า ตั้งค่าระบบ → ตัวเลือกในระบบ)
 * ถ้า admin ยังไม่เคยกำหนดตัวเลือกของหมวดนั้น จะใช้ค่าตั้งต้นของระบบแทน
 */
function getOptionList_(category, fallbackArr) {
  const custom = getTableRows_(CONFIG.SETTING_SHEET)
    .filter(r => isTrue_(r.IsActive) && text_(r.Category) === category)
    .sort((a, b) => num_(a.SortOrder) - num_(b.SortOrder))
    .map(r => text_(r.Value) || text_(r.Label))
    .filter(Boolean);
  return custom.length ? custom : fallbackArr.slice();
}

/* =====================================================================
 * ไฟล์แนบ
 * ===================================================================*/

function mergeAttachment_(existing, key, input, requestNo) {
  const keepNames = [], keepUrls = [], keepIds = [];
  const removeIds = (input.removeFileIds || []).map(String);

  if (existing) {
    const names = splitLines_(existing['Attachment' + key + 'FileNames']);
    const urls = splitLines_(existing['Attachment' + key + 'FileUrls']);
    const ids = splitLines_(existing['Attachment' + key + 'FileIds']);
    ids.forEach((id, i) => {
      if (removeIds.indexOf(id) > -1) return;
      keepIds.push(id);
      keepNames.push(names[i] || id);
      keepUrls.push(urls[i] || '');
    });
  }

  const type = ATTACHMENT_TYPES.find(t => t.key === key);
  const uploaded = uploadFiles_(input.files || [], requestNo, type ? type.label : key);
  const names = joinNonEmpty_([keepNames.join('\n'), uploaded.names]);
  const ids = joinNonEmpty_([keepIds.join('\n'), uploaded.ids]);

  return {
    checked: ids ? 1 : bool01_(input.checked),
    sheets: num_(input.sheets),
    names: names,
    urls: joinNonEmpty_([keepUrls.join('\n'), uploaded.urls]),
    ids: ids
  };
}

function uploadFiles_(files, requestNo, category) {
  if (!files || !files.length) return { names: '', urls: '', ids: '' };
  const folder = getAttachmentFolder_();
  const names = [], urls = [], ids = [];

  files.forEach((f, idx) => {
    if (!f || !f.data) return;
    const data = String(f.data);
    const match = data.match(/^data:([^;]*);base64,(.+)$/);
    const base64 = match ? match[2] : data;
    const mimeType = f.mimeType || (match && match[1]) || 'application/octet-stream';
    const bytes = Utilities.base64Decode(base64);
    const original = sanitizeFileName_(f.name || ('file_' + (idx + 1)));
    const finalName = sanitizeFileName_([
      requestNo || 'REQ', category || 'เอกสารแนบ',
      Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss'), original
    ].join('_'));
    const file = folder.createFile(Utilities.newBlob(bytes, mimeType, finalName));
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      console.log('setSharing: ' + err.message);
    }
    names.push(finalName);
    urls.push(file.getUrl());
    ids.push(file.getId());
  });

  return { names: names.join('\n'), urls: urls.join('\n'), ids: ids.join('\n') };
}

function getAttachmentFolder_() {
  const folders = DriveApp.getFoldersByName(CONFIG.ATTACHMENT_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(CONFIG.ATTACHMENT_FOLDER_NAME);
}

function sanitizeFileName_(name) {
  return String(name || '').replace(/[\\/:*?"<>|#%{}~&]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180);
}

/* =====================================================================
 * Setting
 * ===================================================================*/

function apiGetSettings_(p) {
  requireAuth_(p.token);
  return { ok: true, settings: buildSettings_() };
}

function buildSettings_() {
  const rows = getTableRows_(CONFIG.SETTING_SHEET)
    .filter(r => isTrue_(r.IsActive))
    .sort((a, b) => num_(a.SortOrder) - num_(b.SortOrder));

  const byCategory = cat => rows
    .filter(r => text_(r.Category) === cat)
    .map(r => text_(r.Value) || text_(r.Label))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  const defaults = {};
  rows.filter(r => text_(r.Category) === 'Default').forEach(r => {
    const key = text_(r.Label);
    if (key) defaults[key] = text_(r.Value);
  });

  const members = cat => rows
    .filter(r => text_(r.Category) === cat)
    .map(r => ({ userId: text_(r.Value), fullName: text_(r.Label), settingId: text_(r.SettingID) }));

  return {
    raw: rows.map(r => ({
      settingId: r.SettingID, category: r.Category, label: r.Label,
      value: r.Value, sortOrder: num_(r.SortOrder), remark: r.Remark
    })),
    itemNames: byCategory('ItemName'),
    units: byCategory('Unit'),
    budgetSources: byCategory('BudgetSource'),
    budgetTypes: getOptionList_('BudgetType', BUDGET_TYPES),
    purchaseTypes: getOptionList_('PurchaseType', PURCHASE_TYPES),
    officerMethods: getOptionList_('OfficerMethod', OFFICER_METHODS),
    inProgressMethods: getOptionList_('InProgressMethod', IN_PROGRESS_METHODS),
    budgetSourceTypes: rows
      .filter(r => text_(r.Category) === 'BudgetSourceType')
      .map(r => ({ source: text_(r.Label), budgetType: text_(r.Value) })),
    stages: getProcurementStages_(),
    supplyOfficers: members(ROLE_CATEGORIES.SUPPLY_OFFICER),
    supplyHeads: members(ROLE_CATEGORIES.SUPPLY_HEAD),
    superAdmins: members(ROLE_CATEGORIES.SUPER_ADMIN),
    defaults: defaults
  };
}

function apiSaveSetting_(p) {
  const user = requireAuth_(p.token);
  requireSuperAdmin_(user);
  const item = p.item || {};
  const category = text_(item.category);
  const label = text_(item.label);
  const value = text_(item.value) || label;
  if (!category) throw new Error('กรุณาเลือกประเภทของตัวเลือก');
  if (!label && !value) throw new Error('กรุณากรอกชื่อที่แสดงหรือค่า');

  const sh = getSS_().getSheetByName(CONFIG.SETTING_SHEET);
  const headers = getHeaders_(sh);
  const rows = getTableRows_(CONFIG.SETTING_SHEET);
  const existing = item.settingId ? rows.find(r => text_(r.SettingID) === text_(item.settingId)) : null;

  const record = {
    SettingID: existing ? existing.SettingID : makeId_('SET'),
    Category: category,
    Label: label || value,
    Value: value,
    SortOrder: num_(item.sortOrder) || (existing ? num_(existing.SortOrder) : rows.length + 1),
    IsActive: 1,
    Remark: text_(item.remark),
    UpdatedAt: new Date()
  };

  if (existing) writeObjectRow_(sh, headers, record, existing._rowNumber);
  else appendObjectRow_(sh, headers, record);

  clearTableCache_(CONFIG.SETTING_SHEET);
  delete cachedTableData_.__roleConfig;
  addLog_(user, 'SAVE_SETTING', '', category + ': ' + record.Label);
  return { ok: true, message: 'บันทึกตัวเลือกเรียบร้อยแล้ว', settings: buildSettings_() };
}

function apiDeleteSetting_(p) {
  const user = requireAuth_(p.token);
  requireSuperAdmin_(user);
  deleteRowsByValue_(CONFIG.SETTING_SHEET, 'SettingID', p.settingId);
  delete cachedTableData_.__roleConfig;
  addLog_(user, 'DELETE_SETTING', '', text_(p.settingId));
  return { ok: true, message: 'ลบตัวเลือกเรียบร้อยแล้ว', settings: buildSettings_() };
}

/**
 * กำหนดรายชื่อเจ้าหน้าที่พัสดุ / หัวหน้าเจ้าหน้าที่ / superadmin
 * โดยเลือก UserID จากแผ่นงาน UserAccounts
 */
function apiSetRoleMembers_(p) {
  const user = requireAuth_(p.token);
  requireSuperAdmin_(user);
  const category = text_(p.category);
  if ([ROLE_CATEGORIES.SUPPLY_OFFICER, ROLE_CATEGORIES.SUPPLY_HEAD, ROLE_CATEGORIES.SUPER_ADMIN].indexOf(category) === -1) {
    throw new Error('ประเภทสิทธิไม่ถูกต้อง');
  }
  const userIds = (p.userIds || []).map(text_).filter(Boolean);
  if (category === ROLE_CATEGORIES.SUPER_ADMIN && !userIds.length) {
    throw new Error('ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน');
  }

  const sh = getSS_().getSheetByName(CONFIG.SETTING_SHEET);
  const headers = getHeaders_(sh);
  const rows = getTableRows_(CONFIG.SETTING_SHEET);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (text_(rows[i].Category) === category) sh.deleteRow(rows[i]._rowNumber);
  }

  const records = userIds.map((id, i) => {
    const u = getUserById_(id);
    return {
      SettingID: makeId_('SET'),
      Category: category,
      Label: u ? text_(u.FullName) : id,
      Value: id,
      SortOrder: i + 1,
      IsActive: 1,
      Remark: u ? text_(u.Department) : '',
      UpdatedAt: new Date()
    };
  });
  appendObjectRows_(sh, headers, records);

  clearTableCache_(CONFIG.SETTING_SHEET);
  delete cachedTableData_.__roleConfig;
  addLog_(user, 'SET_ROLE_MEMBERS', '', category + ' = ' + userIds.length + ' คน');
  return { ok: true, message: 'บันทึกรายชื่อผู้มีสิทธิเรียบร้อยแล้ว', settings: buildSettings_() };
}

function budgetTypeFromSource_(source) {
  const src = text_(source);
  if (!src) return '';
  const mapping = getTableRows_(CONFIG.SETTING_SHEET)
    .filter(r => isTrue_(r.IsActive) && text_(r.Category) === 'BudgetSourceType')
    .find(r => text_(r.Label) === src);
  if (mapping) return text_(mapping.Value);
  return /งบประมาณรายจ่าย|เงินงบประมาณ/.test(src) ? BUDGET_TYPES[0] : BUDGET_TYPES[1];
}

function seedDefaultSettings_() {
  const sh = getSS_().getSheetByName(CONFIG.SETTING_SHEET);
  if (!sh) return;
  const headers = getHeaders_(sh);
  const existing = getTableRows_(CONFIG.SETTING_SHEET, true);
  const has = (cat, value) => existing.some(r => text_(r.Category) === cat && text_(r.Value) === value);
  const hasCategory = cat => existing.some(r => text_(r.Category) === cat);

  const toAdd = [];
  const push = (cat, label, value, remark) => {
    if (!has(cat, value)) toAdd.push([cat, label, value, remark || 'ค่าเริ่มต้นระบบ']);
  };

  if (!hasCategory('Default')) {
    push('Default', 'ชื่อผู้รับเรื่อง', 'นายแพทย์สาธารณสุขจังหวัดนครนายก');
    push('Default', 'ตำแหน่งเจ้าหน้าที่พัสดุ', 'เจ้าหน้าที่');
    push('Default', 'ตำแหน่งหัวหน้าเจ้าหน้าที่', 'หัวหน้าเจ้าหน้าที่');
  }
  ['NotifyEmail', 'ExportSpreadsheetId', 'ExportSheetPrefix', 'ExportApiKey'].forEach(key => {
    if (!existing.some(r => text_(r.Category) === 'Default' && text_(r.Label) === key)) {
      toAdd.push(['Default', key, key === 'NotifyEmail' ? '0' : '', 'ตั้งค่าระบบ']);
    }
  });

  if (!hasCategory('ProcurementStage')) {
    PROCUREMENT_STAGES.forEach(s => push('ProcurementStage', s, s));
  }
  if (!hasCategory('BudgetSourceType')) {
    push('BudgetSourceType', 'งบประมาณรายจ่ายประจำปี', BUDGET_TYPES[0]);
    push('BudgetSourceType', 'เงินบำรุง', BUDGET_TYPES[1]);
    push('BudgetSourceType', 'เงินโครงการ', BUDGET_TYPES[1]);
  }
  if (!hasCategory('Unit')) {
    ['รีม', 'แท่ง', 'กล่อง', 'ชุด', 'รายการ'].forEach(u => push('Unit', u, u));
  }
  if (!hasCategory('BudgetSource')) {
    ['เงินบำรุง', 'งบประมาณรายจ่ายประจำปี', 'เงินโครงการ'].forEach(b => push('BudgetSource', b, b));
  }

  if (!toAdd.length) return;
  const base = existing.length;
  appendObjectRows_(sh, headers, toAdd.map((d, i) => ({
    SettingID: makeId_('SET'),
    Category: d[0], Label: d[1], Value: d[2],
    SortOrder: base + i + 1, IsActive: 1, Remark: d[3], UpdatedAt: new Date()
  })));
  clearTableCache_(CONFIG.SETTING_SHEET);
}

/* =====================================================================
 * Dashboard (ข้อ 7)
 * ===================================================================*/

function apiDashboard_(p) {
  const user = requireAuth_(p.token);
  const rows = listRequestRows_(user, p.filters || {});
  return {
    ok: true,
    dashboard: buildDashboard_(rows, p.filters || {}),
    requests: rows.map(summarizeRequest_)
  };
}

function apiPublicDashboard_(p) {
  setupSupplySystem();
  const rows = getTableRows_(CONFIG.REQUEST_SHEET)
    .filter(r => bool01_(r.IsLatest) === 1 || text_(r.IsLatest) === '');
  return {
    ok: true,
    dashboard: buildDashboard_(rows, {}),
    requests: rows.slice(0, 300).map(summarizeRequest_)
  };
}

function buildDashboard_(rows, filters) {
  const stages = getProcurementStages_();
  const progressRows = getTableRows_(CONFIG.PROGRESS_SHEET);
  const progressByRequest = {};
  progressRows.forEach(r => {
    const id = text_(r.RequestID);
    if (!progressByRequest[id]) progressByRequest[id] = [];
    progressByRequest[id].push(r);
  });

  const durations = { submitToCheck: [], submitToApprove: [], approveToComplete: [], submitToComplete: [] };
  const stageDurations = {};
  stages.forEach(s => stageDurations[s] = []);

  let totalAmount = 0, approvedAmount = 0;
  const counters = { draft: 0, pending: 0, checked: 0, approved: 0, inProgress: 0, completed: 0, returned: 0, cancelled: 0 };

  rows.forEach(r => {
    const status = normalizeStatus_(r.Status);
    totalAmount += num_(r.TotalAmount);
    if (status === STATUS.DRAFT) counters.draft++;
    else if (status === STATUS.SUBMITTED) counters.pending++;
    else if (status === STATUS.CHECKED) counters.checked++;
    else if (status === STATUS.APPROVED) counters.approved++;
    else if (status === STATUS.IN_PROGRESS) counters.inProgress++;
    else if (status === STATUS.COMPLETED) counters.completed++;
    else if (status === STATUS.RETURNED) counters.returned++;
    else if (status === STATUS.CANCELLED) counters.cancelled++;

    const submitted = toDate_(r.SubmittedAt);
    const checked = toDate_(r.CheckedAt);
    const approved = toDate_(r.ApprovedAt);
    const completed = toDate_(r.CompletedAt);

    if (approved) approvedAmount += num_(r.TotalAmount);
    if (submitted && checked) durations.submitToCheck.push(dayDiff_(submitted, checked));
    if (submitted && approved) durations.submitToApprove.push(dayDiff_(submitted, approved));
    if (approved && completed) durations.approveToComplete.push(dayDiff_(approved, completed));
    if (submitted && completed) durations.submitToComplete.push(dayDiff_(submitted, completed));

    // ระยะเวลาของแต่ละขั้นตอนพัสดุ = เวลาจากขั้นตอนก่อนหน้าถึงขั้นตอนนั้น
    const logs = (progressByRequest[text_(r.RequestID)] || [])
      .filter(x => stages.indexOf(text_(x.ProgressStatus)) > -1)
      .map(x => ({ stage: text_(x.ProgressStatus), at: toDate_(x.ProgressAt) }))
      .filter(x => x.at)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    let prev = approved || submitted;
    logs.forEach(log => {
      if (prev) stageDurations[log.stage].push(dayDiff_(prev, log.at));
      prev = log.at;
    });
  });

  const byYear = aggregate_(rows, r => text_(r.FiscalYear) || String(fiscalYear_(toDate_(r.CreatedAt))));
  byYear.sort((a, b) => String(a.label).localeCompare(String(b.label)));

  return {
    total: rows.length,
    totalAmount: totalAmount,
    approvedAmount: approvedAmount,
    counters: counters,
    durations: {
      submitToCheck: summarizeDurations_(durations.submitToCheck),
      submitToApprove: summarizeDurations_(durations.submitToApprove),
      approveToComplete: summarizeDurations_(durations.approveToComplete),
      submitToComplete: summarizeDurations_(durations.submitToComplete)
    },
    stageDurations: stages.map(s => Object.assign({ stage: s }, summarizeDurations_(stageDurations[s]))),
    byYear: byYear,
    byStatus: aggregate_(rows, r => normalizeStatus_(r.Status)),
    byDepartment: aggregate_(rows, r => text_(r.Department) || 'ไม่ระบุ'),
    byBudgetType: aggregate_(rows, r => text_(r.BudgetType) || 'ไม่ระบุ'),
    byBudgetSource: aggregate_(rows, r => text_(r.PlanBudgetSource) || 'ไม่ระบุ'),
    byPurchaseType: aggregate_(rows, r => text_(r.PurchaseType) || 'ไม่ระบุ'),
    byStage: aggregate_(rows, r => text_(r.CurrentStage) || 'ยังไม่เริ่มดำเนินการ'),
    byMonth: aggregateMonth_(rows),
    filters: filters,
    generatedAt: nowText_()
  };
}

function dayDiff_(a, b) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000 * 100) / 100);
}

function summarizeDurations_(values) {
  if (!values.length) return { count: 0, avg: 0, min: 0, max: 0 };
  const sum = values.reduce((s, v) => s + v, 0);
  return {
    count: values.length,
    avg: Math.round(sum / values.length * 100) / 100,
    min: Math.round(Math.min.apply(null, values) * 100) / 100,
    max: Math.round(Math.max.apply(null, values) * 100) / 100
  };
}

function aggregate_(rows, keyFn) {
  const map = {};
  rows.forEach(r => {
    const label = keyFn(r) || 'ไม่ระบุ';
    if (!map[label]) map[label] = { label: label, count: 0, amount: 0 };
    map[label].count++;
    map[label].amount += num_(r.TotalAmount);
  });
  return Object.keys(map).map(k => map[k]).sort((a, b) => b.count - a.count || b.amount - a.amount);
}

function aggregateMonth_(rows) {
  const map = {};
  rows.forEach(r => {
    const d = toDate_(r.RequestDate) || toDate_(r.CreatedAt);
    if (!d) return;
    const key = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM');
    if (!map[key]) map[key] = { label: key, count: 0, amount: 0 };
    map[key].count++;
    map[key].amount += num_(r.TotalAmount);
  });
  return Object.keys(map).sort().map(k => map[k]);
}

/* =====================================================================
 * ส่งออกข้อมูล (ข้อ 8) และ API ไปยัง Sheet ปลายทาง (ข้อ 9)
 * ===================================================================*/

function apiExportRows_(p) {
  const user = requireAuth_(p.token);
  const rows = listRequestRows_(user, p.filters || {});
  const items = getTableRows_(CONFIG.ITEM_SHEET);
  const supply = isSupply_(user);

  const requestRows = rows.map(r => ({
    'เลขที่คำขอ': text_(r.RequestNo),
    'เวอร์ชัน': num_(r.Version) || 1,
    'ปีงบประมาณ': text_(r.FiscalYear),
    'วันที่คำขอ': formatDateOnly_(r.RequestDate),
    'กลุ่มงาน': text_(r.Department),
    'ผู้ยื่นคำขอ': text_(r.CreatedByName),
    'เรื่อง': text_(r.Subject),
    'ประเภท': text_(r.PurchaseType),
    'ประเภทงบประมาณ': text_(r.BudgetType),
    'แหล่งเงิน': text_(r.PlanBudgetSource),
    'จำนวนรายการ': num_(r.ItemCount),
    'วงเงินรวม': num_(r.TotalAmount),
    'สถานะ': normalizeStatus_(r.Status),
    'ขั้นตอนพัสดุล่าสุด': text_(r.CurrentStage),
    'วันที่ส่งพัสดุ': formatDateOnly_(r.SubmittedAt),
    'วันที่ผ่านตรวจสอบ': formatDateOnly_(r.CheckedAt),
    'วันที่อนุมัติ': formatDateOnly_(r.ApprovedAt),
    'วันที่แล้วเสร็จ': formatDateOnly_(r.CompletedAt),
    'จำนวนครั้งที่ถูกตีกลับ': num_(r.ReturnCount),
    'ล็อกข้อมูล': bool01_(r.IsLocked) === 1 ? 'ล็อก' : ''
  }));

  const ids = {};
  rows.forEach(r => ids[text_(r.RequestID)] = text_(r.RequestNo));
  const itemRows = items.filter(it => ids[text_(it.RequestID)]).map(it => ({
    'เลขที่คำขอ': ids[text_(it.RequestID)],
    'ลำดับ': num_(it.LineNo),
    'รายการ': text_(it.ItemName),
    'จำนวน': num_(it.Quantity),
    'หน่วยนับ': text_(it.Unit),
    'ราคา/หน่วย': num_(it.UnitPrice),
    'ราคารวม': num_(it.TotalPrice),
    'ราคาซื้อหลังสุด': num_(it.LastPrice)
  }));

  const progressRows = getTableRows_(CONFIG.PROGRESS_SHEET)
    .filter(r => ids[text_(r.RequestID)])
    .map(r => {
      const row = {
        'เลขที่คำขอ': ids[text_(r.RequestID)],
        'วันที่': formatDateTime_(toDate_(r.ProgressAt)) || text_(r.ProgressAt),
        'ขั้นตอน': text_(r.ProgressStatus),
        'ผู้บันทึก': text_(r.ProgressByName),
        'หมายเหตุ': text_(r.Note)
      };
      if (supply) row['note พัสดุ'] = text_(r.SupplyNote);
      return row;
    });

  addLog_(user, 'EXPORT', '', 'ส่งออกข้อมูล ' + requestRows.length + ' คำขอ');
  return { ok: true, requests: requestRows, items: itemRows, progress: progressRows, generatedAt: nowText_() };
}

function formatDateOnly_(value) {
  const d = toDate_(value);
  return d ? Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd') : '';
}

function getSettingValue_(label, fallback) {
  const row = getTableRows_(CONFIG.SETTING_SHEET)
    .find(r => text_(r.Category) === 'Default' && text_(r.Label) === label);
  const value = row ? text_(row.Value) : '';
  return value || (fallback || '');
}

/**
 * คัดลอกข้อมูลไปยัง Google Sheet ปลายทางที่กำหนดใน setting → Default → ExportSpreadsheetId
 * เรียกได้ทั้งจากปุ่มในระบบ และจาก time-driven trigger (scheduledExport)
 */
function apiSyncExport_(p) {
  const user = requireAuth_(p.token);
  requireSuperAdmin_(user);
  const result = runExport_();
  addLog_(user, 'SYNC_EXPORT', '', result.message);
  return result;
}

function runExportNow_() {
  const res = runExport_();
  SpreadsheetApp.getUi().alert(res.message);
}

function scheduledExport() {
  try {
    const res = runExport_();
    console.log(res.message);
  } catch (err) {
    console.error('scheduledExport: ' + err.message);
  }
}

function runExport_() {
  clearTableCache_();
  const targetId = getSettingValue_('ExportSpreadsheetId');
  if (!targetId) throw new Error('ยังไม่ได้ตั้งค่า ExportSpreadsheetId ในหน้า Setting');
  const prefix = getSettingValue_('ExportSheetPrefix', 'Supply_');
  const target = SpreadsheetApp.openById(targetId);

  // MyNote เป็นบันทึกส่วนตัวของผู้บันทึก จึงไม่ส่งออกไปยังไฟล์ปลายทาง
  const tables = [
    [CONFIG.REQUEST_SHEET, []],
    [CONFIG.ITEM_SHEET, []],
    [CONFIG.PROGRESS_SHEET, ['MyNote']]
  ];

  let totalRows = 0;
  tables.forEach(pair => {
    const source = getSS_().getSheetByName(pair[0]);
    if (!source || source.getLastRow() < 1) return;
    let values = source.getDataRange().getDisplayValues();
    const skip = pair[1].map(name => values[0].indexOf(name)).filter(i => i > -1);
    if (skip.length) {
      values = values.map(row => row.filter((cell, i) => skip.indexOf(i) === -1));
    }
    const name = prefix + pair[0];
    let sheet = target.getSheetByName(name);
    if (!sheet) sheet = target.insertSheet(name);
    sheet.clear();
    sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
    sheet.setFrozenRows(1);
    totalRows += values.length - 1;
  });

  const stamp = target.getSheetByName(prefix + 'SyncInfo') || target.insertSheet(prefix + 'SyncInfo');
  stamp.clear();
  stamp.getRange(1, 1, 2, 2).setValues([
    ['ซิงก์ล่าสุด', nowText_()],
    ['จำนวนแถวข้อมูล', totalRows]
  ]);

  return { ok: true, message: 'ส่งข้อมูลไป Sheet ปลายทางแล้ว ' + totalRows + ' แถว เมื่อ ' + nowText_(), rows: totalRows };
}

/** ติดตั้ง trigger ตามเวลา — เรียกครั้งเดียวจาก Apps Script editor */
function installExportTriggerHourly() {
  removeExportTriggers_();
  ScriptApp.newTrigger('scheduledExport').timeBased().everyHours(1).create();
}

function installExportTriggerDaily() {
  removeExportTriggers_();
  ScriptApp.newTrigger('scheduledExport').timeBased().everyDays(1).atHour(1).create();
}

function removeExportTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scheduledExport')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** API แบบ read-only ให้ระบบภายนอกดึงข้อมูลด้วย API key */
function apiExternalData_(p) {
  const key = getSettingValue_('ExportApiKey');
  if (!key) throw new Error('ยังไม่ได้ตั้งค่า ExportApiKey');
  if (text_(p.key) !== key) throw new Error('API key ไม่ถูกต้อง');

  const rows = getTableRows_(CONFIG.REQUEST_SHEET)
    .filter(r => bool01_(r.IsLatest) === 1 || text_(r.IsLatest) === '')
    .filter(r => matchFilters_(r, p.filters || {}))
    .map(summarizeRequest_);
  return { ok: true, count: rows.length, requests: rows, generatedAt: nowText_() };
}

/* =====================================================================
 * แจ้งเตือนทางอีเมล (ไม่บังคับ — เปิด/ปิดที่ setting Default → NotifyEmail)
 * ===================================================================*/

function notifyEnabled_() {
  return isTrue_(getSettingValue_('NotifyEmail', '0'));
}

function notifySupplyOfficers_(request, sender) {
  if (!notifyEnabled_()) return;
  try {
    const cfg = getRoleConfig_();
    const emails = cfg.supplyIds
      .map(id => getUserById_(id))
      .filter(u => u && text_(u.Email))
      .map(u => text_(u.Email));
    if (!emails.length) return;
    MailApp.sendEmail({
      to: emails.join(','),
      subject: '[พัสดุ] คำขอใหม่รอตรวจสอบ ' + text_(request.RequestNo),
      body: [
        'มีคำขอใช้พัสดุรอการตรวจสอบ',
        'เลขที่คำขอ: ' + text_(request.RequestNo),
        'เรื่อง: ' + text_(request.Subject),
        'กลุ่มงาน: ' + text_(request.Department),
        'ผู้ยื่นคำขอ: ' + text_(sender.FullName),
        'วงเงิน: ' + num_(request.TotalAmount).toLocaleString('th-TH') + ' บาท'
      ].join('\n')
    });
  } catch (err) {
    console.log('notifySupplyOfficers_: ' + err.message);
  }
}

function notifyRequester_(request, subject, body) {
  if (!notifyEnabled_()) return;
  try {
    const owner = getUserById_(request.CreatedByUserID);
    const email = owner ? text_(owner.Email) : text_(request.CreatedByEmail);
    if (!email) return;
    MailApp.sendEmail({ to: email, subject: '[พัสดุ] ' + subject + ' ' + text_(request.RequestNo), body: body });
  } catch (err) {
    console.log('notifyRequester_: ' + err.message);
  }
}

/* =====================================================================
 * Audit log (ข้อ 10)
 * ===================================================================*/

function addLog_(user, action, requestId, detail) {
  try {
    const sh = getSS_().getSheetByName(CONFIG.LOG_SHEET);
    if (!sh) return;
    appendObjectRow_(sh, getHeaders_(sh), {
      LogID: makeId_('LOG'),
      Timestamp: new Date(),
      UserID: text_(user.UserID),
      UserName: text_(user.FullName) || text_(user.Username),
      Action: action,
      RequestID: text_(requestId),
      Detail: String(detail || '').slice(0, 500),
      IP: ''
    });
  } catch (err) {
    console.log('addLog_: ' + err.message);
  }
}

function apiListLogs_(p) {
  const user = requireAuth_(p.token);
  requireSuperAdmin_(user);
  const limit = Math.min(num_(p.limit) || 300, 2000);
  const rows = getTableRows_(CONFIG.LOG_SHEET)
    .filter(r => {
      if (p.requestId && text_(r.RequestID) !== text_(p.requestId)) return false;
      if (p.userId && text_(r.UserID) !== text_(p.userId)) return false;
      if (p.action && text_(r.Action) !== text_(p.action)) return false;
      return true;
    })
    .sort((a, b) => {
      const da = toDate_(a.Timestamp), db = toDate_(b.Timestamp);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    })
    .slice(0, limit)
    .map(r => ({
      logId: r.LogID,
      timestamp: r.Timestamp,
      userId: r.UserID,
      userName: r.UserName,
      action: r.Action,
      requestId: r.RequestID,
      detail: r.Detail
    }));
  return { ok: true, logs: rows };
}
