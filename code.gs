/*******************************
 * ระบบบันทึกความต้องการใช้พัสดุ
 * Google Apps Script Web App
 * ไฟล์: Code.gs
 * รุ่นแก้ไขสมบูรณ์: เพิ่ม setting, workflow, upload files, progress logs, dashboard
 *******************************/

const CONFIG = {
  SPREADSHEET_ID: '1WXOk6jgVOGiCf02-5AOIy6l8jdgcDbQRU-CSG6n9_Ik',
  USER_SHEET: 'UserAccounts',
  REQUEST_SHEET: 'SupplyRequests',
  ITEM_SHEET: 'SupplyRequestItems',
  INSPECTOR_SHEET: 'SupplyInspectors',
  LOG_SHEET: 'SupplyAuditLogs',
  SETTING_SHEET: 'setting',
  PROGRESS_SHEET: 'SupplyProgressLogs',
  ATTACHMENT_FOLDER_NAME: 'ระบบพัสดุ_ไฟล์แนบ',
  APP_TITLE: 'ระบบบันทึกความต้องการใช้พัสดุ',
  TIMEZONE: 'Asia/Bangkok'
};

const STATUS = {
  DRAFT: 'ร่าง',
  SUBMITTED: 'ส่งให้พัสดุตรวจสอบ',
  CHECKED: 'ผ่านการตรวจสอบ',
  RETURNED: 'ส่งกลับแก้ไข',
  CANCELLED: 'ยกเลิก'
};

const REQUEST_HEADERS = [
  'RequestID', 'RequestNo', 'CreatedAt', 'UpdatedAt',
  'CreatedByUserID', 'CreatedByName', 'CreatedByPosition', 'CreatedByDepartment',
  'CreatedByPhone', 'CreatedByEmail',
  'Department', 'Phone', 'DocNoText', 'RequestDate', 'Subject', 'To',
  'PurchaseType', 'ItemCount', 'Reason',
  'PurposeRegular', 'PurposeStock', 'PurposeProject', 'ProjectName',
  'AttachmentSpec', 'AttachmentSpecSheets', 'AttachmentSpecFileNames', 'AttachmentSpecFileUrls', 'AttachmentSpecFileIds',
  'AttachmentQuote', 'AttachmentQuoteSheets', 'AttachmentQuoteFileNames', 'AttachmentQuoteFileUrls', 'AttachmentQuoteFileIds',
  'AttachmentProject', 'AttachmentProjectSheets', 'AttachmentProjectFileNames', 'AttachmentProjectFileUrls', 'AttachmentProjectFileIds',
  'TotalAmount', 'LastPurchaseTotal', 'Status',
  'SubmittedAt', 'SubmittedByUserID', 'SubmittedByName',
  'CheckedAt', 'CheckedByUserID', 'CheckedByName', 'CheckRemark',
  'ReturnedAt', 'ReturnedByUserID', 'ReturnedByName', 'ReturnRemark',
  'OfficerOpinionAnnualUnder100k', 'OfficerOpinionAnnualOver100k',
  'OfficerMethod', 'OfficerMethodInProgress', 'OfficerInProgressMethod',
  'CompletionDays', 'OfficerReason',
  'OfficerName', 'OfficerPosition', 'DeptHeadName', 'DeptHeadPosition',
  'PlanInPlan', 'PlanYear', 'PlanOther', 'PlanBudgetSource', 'PlanAmount', 'PlanRemark',
  'ApproverName', 'ApproverPosition', 'ApprovedAt', 'Notes',
  'MainPdfFileId', 'MainPdfUrl'
];

const ITEM_HEADERS = [
  'LineID', 'RequestID', 'LineNo', 'ItemName', 'PlanBalanceAmount',
  'Quantity', 'Unit', 'UnitPrice', 'TotalPrice', 'LastPrice', 'Remark'
];

const INSPECTOR_HEADERS = [
  'InspectorID', 'RequestID', 'Seq', 'FullName', 'Position', 'CID', 'Email', 'UserID'
];

const LOG_HEADERS = [
  'LogID', 'Timestamp', 'UserID', 'UserName', 'Action', 'RequestID', 'Detail'
];

const SETTING_HEADERS = [
  'SettingID', 'Category', 'Label', 'Value', 'SortOrder', 'IsActive', 'Remark', 'UpdatedAt'
];

const PROGRESS_HEADERS = [
  'ProgressID', 'RequestID', 'RequestNo', 'ProgressAt',
  'ProgressByUserID', 'ProgressByName', 'ProgressStatus', 'Note',
  'FileNames', 'FileUrls', 'FileIds',
  'SignerRole', 'SignerName', 'SignatureUrl'
];

function doGet() {
  setupSupplySystem();
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle(CONFIG.APP_TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ระบบพัสดุ')
    .addItem('ติดตั้ง/ปรับตารางระบบ', 'forceSetupSupplySystem_')
    .addToUi();
}

function forceSetupSupplySystem_() {
  CacheService.getScriptCache().remove('isSetupDone');
  const res = setupSupplySystem();
  SpreadsheetApp.getUi().alert(res.message);
}

function setupSupplySystem() {
  const cache = CacheService.getScriptCache();
  if (cache.get('isSetupDone')) return { ok: true, message: 'ตรวจสอบตารางระบบเรียบร้อยแล้ว (Cached)' };

  const ss = getSS_();
  ensureUserSheetReadable_();
  ensureSheet_(ss, CONFIG.REQUEST_SHEET, REQUEST_HEADERS);
  ensureSheet_(ss, CONFIG.ITEM_SHEET, ITEM_HEADERS);
  ensureSheet_(ss, CONFIG.INSPECTOR_SHEET, INSPECTOR_HEADERS);
  ensureSheet_(ss, CONFIG.LOG_SHEET, LOG_HEADERS);
  ensureSheet_(ss, CONFIG.SETTING_SHEET, SETTING_HEADERS);
  ensureSheet_(ss, CONFIG.PROGRESS_SHEET, PROGRESS_HEADERS);
  seedDefaultSettings_();
  applyTextFormats_();
  
  cache.put('isSetupDone', '1', 21600);
  return {
    ok: true,
    message: 'ตรวจสอบ/สร้างตารางระบบพัสดุเรียบร้อยแล้ว รวม setting และ SupplyProgressLogs แล้ว'
  };
}

let cachedSS_ = null;
let cachedTableData_ = {}; // batch-read cache: prevents re-reading the same sheet within one request

function getSS_() {
  if (cachedSS_) return cachedSS_;
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID.trim()) {
    cachedSS_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID.trim());
    return cachedSS_;
  }
  cachedSS_ = SpreadsheetApp.getActiveSpreadsheet();
  if (!cachedSS_) {
    throw new Error('ไม่พบ Spreadsheet กรุณาเปิด Apps Script จากไฟล์ Google Sheet หรือกำหนด CONFIG.SPREADSHEET_ID');
  }
  return cachedSS_;
}

function clearTableCache_(sheetName) {
  if (sheetName) { delete cachedTableData_[sheetName]; }
  else { cachedTableData_ = {}; }
}

function ensureSheet_(ss, sheetName, headers) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  const lastCol = Math.max(sh.getLastColumn(), 1);
  let currentHeaders = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (currentHeaders.length === 1 && currentHeaders[0] === '') currentHeaders = [];

  if (currentHeaders.length === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const missing = headers.filter(h => currentHeaders.indexOf(h) === -1);
    if (missing.length) {
      sh.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    }
  }

  const finalLastCol = sh.getLastColumn();
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, finalLastCol)
    .setBackground('#0f766e')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  try {
    sh.autoResizeColumns(1, Math.min(finalLastCol, 30));
  } catch (err) {
    console.log(err.message);
  }
  return sh;
}

function ensureUserSheetReadable_() {
  const sh = getSS_().getSheetByName(CONFIG.USER_SHEET);
  if (!sh) throw new Error('ไม่พบแผ่นงาน UserAccounts กรุณาตรวจสอบชื่อแผ่นงานให้ตรงกับไฟล์เดิม');
  const headers = getHeaders_(sh);
  ['UserID', 'Username', 'Password', 'FullName', 'Position', 'Department', 'Role', 'IsActive'].forEach(h => {
    if (headers.indexOf(h) === -1) throw new Error('แผ่นงาน UserAccounts ต้องมีคอลัมน์ ' + h);
  });
}

function applyTextFormats_() {
  const ss = getSS_();
  setColumnsAsText_(CONFIG.USER_SHEET, ['UserID', 'Username', 'Password', 'CID', 'PhoneNumber']);
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
  if (value instanceof Date) {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  if (value === null || value === undefined) return '';
  return value;
}

function writeObjectRow_(sh, headers, obj, rowNumber) {
  const row = headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : '');
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function appendObjectRow_(sh, headers, obj) {
  const row = headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : '');
  sh.appendRow(row);
}

function login(username, password) {
  setupSupplySystem();
  username = String(username || '').trim();
  password = String(password || '').trim();
  if (!username || !password) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const user = getUserByLogin_(username, password);
  if (!user) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  if (!isActive_(user.IsActive)) throw new Error('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');

  addLog_(user, 'LOGIN', '', 'เข้าสู่ระบบ');
  
  const session = { userId: String(user.UserID), username: String(user.Username) };
  const initialData = getInitialData(session);
  return { ok: true, user: safeUser_(user), initialData: initialData };
}

function getUserByLogin_(username, password) {
  const users = getAllUsers_();
  return users.find(u => String(u.Username || '').trim() === username && String(u.Password || '').trim() === password) || null;
}

function getAllUsers_() {
  const sh = getSS_().getSheetByName(CONFIG.USER_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getDisplayValues();
  const headers = data[0].map(String);
  return data.slice(1).map((row, idx) => {
    const obj = { _rowNumber: idx + 2 };
    headers.forEach((h, c) => obj[h] = row[c] === undefined || row[c] === null ? '' : String(row[c]));
    return obj;
  });
}

function getUserById_(userId) {
  userId = String(userId || '').trim();
  if (!userId) return null;
  return getAllUsers_().find(u => String(u.UserID || '').trim() === userId) || null;
}

function isActive_(value) {
  const v = String(value).toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'active' || v === 'yes' || v === 'ใช้งาน' || v === 'y';
}

function safeUser_(u) {
  const positionLevel = String(u.PositionLevel || '').trim();
  const position = [String(u.Position || '').trim(), positionLevel].filter(Boolean).join('');
  const role = String(u.Role || '').trim();
  return {
    userId: String(u.UserID || '').trim(),
    username: String(u.Username || '').trim(),
    fullName: String(u.FullName || '').trim(),
    position: position,
    department: String(u.Department || '').trim(),
    role: role,
    cid: normalizeTextNumber_(u.CID),
    email: String(u.Email || '').trim(),
    phone: normalizePhone_(u.PhoneNumber || u.Phone || u.Mobile || ''),
    signatureBase64: String(u.SignatureBase64 || u.Signature || u.signature || u.SignatureImage || '').trim(),
    signatureBase64_2: String(u.SignatureBase64_2 || '').trim(),
    personnelType: String(u.PersonnelType || '').trim(),
    isSupply: isSupplyOfficer_(u),
    isExecutive: isExecutive_(u)
  };
}

function isSupplyOfficer_(user) {
  const role = String(user.Role || '').toLowerCase();
  const pos = String(user.Position || '').toLowerCase();
  const dep = String(user.Department || '').toLowerCase();
  return (role.indexOf('admin') > -1 && role.indexOf('hr') === -1) || role.indexOf('supply') > -1 || role.indexOf('พัสดุ') > -1 ||
    pos.indexOf('พัสดุ') > -1 || dep.indexOf('พัสดุ') > -1;
}

function isExecutive_(user) {
  const role = String(user.Role || '').toLowerCase();
  const pos = String(user.Position || '').toLowerCase();
  return role.indexOf('executive') > -1 || role.indexOf('ผู้บริหาร') > -1 ||
         pos.indexOf('นายแพทย์') > -1 || pos.indexOf('รอง นพ.') > -1 || pos.indexOf('ผู้อำนวยการ') > -1;
}

function canSeeAll_(user) {
  return isSupplyOfficer_(user) || isExecutive_(user);
}

function canSeeDepartment_(user) {
  const role = String(user.Role || '').toLowerCase();
  const pos = String(user.Position || '').toLowerCase();
  return role.indexOf('depthead') > -1 || role.indexOf('หัวหน้า') > -1 ||
         pos.indexOf('หัวหน้า') > -1 || pos.indexOf('รองหัวหน้า') > -1;
}

function requireUser_(session) {
  if (!session || !session.userId) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const user = getUserById_(session.userId);
  if (!user) throw new Error('ไม่พบบัญชีผู้ใช้ กรุณาเข้าสู่ระบบใหม่');
  if (!isActive_(user.IsActive)) throw new Error('บัญชีนี้ถูกปิดใช้งาน');
  return user;
}

function getInitialData(session) {
  clearTableCache_(); // clear cache at start of each request
  const user = requireUser_(session);
  setupSupplySystem();
  const users = getAllUsers_()
    .filter(u => isActive_(u.IsActive))
    .map(safeUser_)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'th'));
  const requestsResult = listRequests(session, {});
  const settings = getSettingsData_(session);
  const dashboard = getDashboardData_(session, requestsResult.requests);
  return {
    ok: true,
    user: safeUser_(user),
    users: users,
    requests: requestsResult.requests,
    settings: settings.settings,
    dashboard: dashboard.dashboard
  };
}

function listRequests(session, filters) {
  const user = requireUser_(session);
  const rows = getTableRows_(CONFIG.REQUEST_SHEET);
  const canAll = canSeeAll_(user);
  const canDept = canSeeDepartment_(user);
  filters = filters || {};

  let result = rows.filter(r => {
    if (!canAll) {
      if (canDept) {
        if (String(r.CreatedByDepartment || '') !== String(user.Department || '') && String(r.CreatedByUserID || '') !== String(user.UserID || '')) return false;
      } else {
        if (String(r.CreatedByUserID || '') !== String(user.UserID || '')) return false;
      }
    }
    if (filters.status && normalizeStatus_(r.Status) !== normalizeStatus_(filters.status)) return false;
    if (filters.keyword) {
      const key = String(filters.keyword).toLowerCase();
      const joined = [r.RequestNo, r.Subject, r.CreatedByName, r.Department, r.Reason, r.Status].join(' ').toLowerCase();
      if (joined.indexOf(key) === -1) return false;
    }
    return true;
  });

  result.sort((a, b) => String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || '')) || String(b.RequestNo || '').localeCompare(String(a.RequestNo || '')));
  result = result.slice(0, 300).map(r => ({
    requestId: r.RequestID,
    requestNo: r.RequestNo,
    requestDate: r.RequestDate,
    subject: r.Subject,
    department: r.Department,
    requester: r.CreatedByName,
    totalAmount: Number(r.TotalAmount || 0),
    status: normalizeStatus_(r.Status),
    purchaseType: r.PurchaseType || '',
    submittedAt: r.SubmittedAt || '',
    checkedAt: r.CheckedAt || '',
    attachmentSpecFileUrls: r.AttachmentSpecFileUrls || '',
    attachmentQuoteFileUrls: r.AttachmentQuoteFileUrls || '',
    attachmentProjectFileUrls: r.AttachmentProjectFileUrls || ''
  }));
  return { ok: true, requests: result };
}

function getRequest(session, requestId) {
  const user = requireUser_(session);
  const request = getTableRows_(CONFIG.REQUEST_SHEET).find(r => String(r.RequestID) === String(requestId));
  if (!request) throw new Error('ไม่พบคำขอ');

  if (!canSeeAll_(user) && !canSeeDepartment_(user) && String(request.CreatedByUserID) !== String(user.UserID)) {
    throw new Error('คุณไม่มีสิทธิเข้าถึงคำขอนี้');
  }
  if (canSeeDepartment_(user) && !canSeeAll_(user)) {
    if (String(request.CreatedByDepartment || '') !== String(user.Department || '') && String(request.CreatedByUserID || '') !== String(user.UserID || '')) {
      throw new Error('คุณไม่มีสิทธิเข้าถึงคำขอนี้');
    }
  }

  request.Status = normalizeStatus_(request.Status);
  request.Phone = normalizePhone_(request.Phone || request.CreatedByPhone || '');
  request.CreatedByPhone = normalizePhone_(request.CreatedByPhone || '');

  const items = getTableRows_(CONFIG.ITEM_SHEET)
    .filter(r => String(r.RequestID) === String(requestId))
    .sort((a, b) => Number(a.LineNo || 0) - Number(b.LineNo || 0));
  const inspectors = getTableRows_(CONFIG.INSPECTOR_SHEET)
    .filter(r => String(r.RequestID) === String(requestId))
    .sort((a, b) => Number(a.Seq || 0) - Number(b.Seq || 0));
  const progress = getProgressRows_(requestId);
  const signatures = getSignaturesForRequest_(requestId);

  const creator = getUserById_(request.CreatedByUserID);
  return {
    ok: true,
    request: request,
    items: items,
    inspectors: inspectors,
    progress: progress,
    signatures: signatures,
    creator: creator ? safeUser_(creator) : null
  };
}

function saveRequest(session, payload) {
  const user = requireUser_(session);
  setupSupplySystem();
  payload = payload || {};
  if (!payload.subject) throw new Error('กรุณากรอกเรื่อง/รายการที่ต้องการซื้อหรือจ้าง');
  if (!payload.reason) throw new Error('กรุณากรอกเหตุผลและความจำเป็น');
  if (!payload.items || !payload.items.length) throw new Error('กรุณาเพิ่มรายการพัสดุอย่างน้อย 1 รายการ');

  const now = new Date();
  const requestSheet = getSS_().getSheetByName(CONFIG.REQUEST_SHEET);
  const requestHeaders = getHeaders_(requestSheet);
  const allRequests = getTableRows_(CONFIG.REQUEST_SHEET);
  const isUpdate = payload.requestId && allRequests.some(r => String(r.RequestID) === String(payload.requestId));
  const old = isUpdate ? allRequests.find(r => String(r.RequestID) === String(payload.requestId)) : null;

  if (isUpdate && String(old.CreatedByUserID || '') !== String(user.UserID || '') && !canSeeAll_(user)) {
    throw new Error('คุณไม่มีสิทธิแก้ไขคำขอนี้');
  }

  const oldStatus = isUpdate ? normalizeStatus_(old.Status) : STATUS.DRAFT;
  if (isUpdate && oldStatus === STATUS.CHECKED && !isSupplyOfficer_(user)) {
    throw new Error('คำขอนี้ผ่านการตรวจสอบแล้ว หากต้องการแก้ไขให้เจ้าหน้าที่พัสดุส่งกลับแก้ไขก่อน');
  }

  const userSafe = safeUser_(user);
  const requestId = isUpdate ? old.RequestID : makeId_('REQ');
  const requestNo = isUpdate ? old.RequestNo : makeRequestNo_();
  const items = sanitizeItems_(payload.items);
  const inspectors = sanitizeInspectors_(payload.inspectors || []);
  const totalAmount = items.reduce((sum, it) => sum + Number(it.TotalPrice || 0), 0);
  const lastPurchaseTotal = items.reduce((sum, it) => sum + Number(it.LastPrice || 0), 0);

  const uploadedSpec = payload.attachmentSpec ? uploadFiles_(payload.attachmentSpecFiles || [], requestNo, 'รายละเอียดคุณลักษณะเฉพาะ_TOR') : emptyUpload_();
  const uploadedQuote = payload.attachmentQuote ? uploadFiles_(payload.attachmentQuoteFiles || [], requestNo, 'ใบเสนอราคา') : emptyUpload_();
  const uploadedProject = payload.attachmentProject ? uploadFiles_(payload.attachmentProjectFiles || [], requestNo, 'โครงการ') : emptyUpload_();

  const specFiles = mergeOrClearFiles_(old, 'AttachmentSpec', 'AttachmentSpecFileNames', 'AttachmentSpecFileUrls', 'AttachmentSpecFileIds', payload.attachmentSpec, uploadedSpec);
  const quoteFiles = mergeOrClearFiles_(old, 'AttachmentQuote', 'AttachmentQuoteFileNames', 'AttachmentQuoteFileUrls', 'AttachmentQuoteFileIds', payload.attachmentQuote, uploadedQuote);
  const projectFiles = mergeOrClearFiles_(old, 'AttachmentProject', 'AttachmentProjectFileNames', 'AttachmentProjectFileUrls', 'AttachmentProjectFileIds', payload.attachmentProject, uploadedProject);

  const status = isUpdate ? oldStatus : STATUS.DRAFT;
  const record = {
    RequestID: requestId,
    RequestNo: requestNo,
    CreatedAt: isUpdate ? old.CreatedAt : now,
    UpdatedAt: now,
    CreatedByUserID: isUpdate ? old.CreatedByUserID : user.UserID,
    CreatedByName: isUpdate ? old.CreatedByName : userSafe.fullName,
    CreatedByPosition: isUpdate ? old.CreatedByPosition : userSafe.position,
    CreatedByDepartment: isUpdate ? old.CreatedByDepartment : userSafe.department,
    CreatedByPhone: normalizePhone_(isUpdate ? old.CreatedByPhone : userSafe.phone),
    CreatedByEmail: isUpdate ? old.CreatedByEmail : userSafe.email,
    Department: payload.department || userSafe.department,
    Phone: normalizePhone_(payload.phone || userSafe.phone),
    DocNoText: payload.docNoText || 'นย',
    RequestDate: payload.requestDate ? new Date(payload.requestDate) : now,
    Subject: payload.subject || '',
    To: payload.to || 'นายแพทย์สาธารณสุขจังหวัดนครนายก',
    PurchaseType: payload.purchaseType || 'ซื้อ',
    ItemCount: items.length,
    Reason: payload.reason || '',
    PurposeRegular: bool01_(payload.purposeRegular),
    PurposeStock: bool01_(payload.purposeStock),
    PurposeProject: bool01_(payload.purposeProject),
    ProjectName: payload.projectName || '',
    AttachmentSpec: bool01_(payload.attachmentSpec),
    AttachmentSpecSheets: Number(payload.attachmentSpecSheets || 0),
    AttachmentSpecFileNames: specFiles.names,
    AttachmentSpecFileUrls: specFiles.urls,
    AttachmentSpecFileIds: specFiles.ids,
    AttachmentQuote: bool01_(payload.attachmentQuote),
    AttachmentQuoteSheets: Number(payload.attachmentQuoteSheets || 0),
    AttachmentQuoteFileNames: quoteFiles.names,
    AttachmentQuoteFileUrls: quoteFiles.urls,
    AttachmentQuoteFileIds: quoteFiles.ids,
    AttachmentProject: bool01_(payload.attachmentProject),
    AttachmentProjectSheets: Number(payload.attachmentProjectSheets || 0),
    AttachmentProjectFileNames: projectFiles.names,
    AttachmentProjectFileUrls: projectFiles.urls,
    AttachmentProjectFileIds: projectFiles.ids,
    TotalAmount: totalAmount,
    LastPurchaseTotal: lastPurchaseTotal,
    Status: status,
    SubmittedAt: isUpdate ? old.SubmittedAt : '',
    SubmittedByUserID: isUpdate ? old.SubmittedByUserID : '',
    SubmittedByName: isUpdate ? old.SubmittedByName : '',
    CheckedAt: isUpdate ? old.CheckedAt : '',
    CheckedByUserID: isUpdate ? old.CheckedByUserID : '',
    CheckedByName: isUpdate ? old.CheckedByName : '',
    CheckRemark: isUpdate ? old.CheckRemark : '',
    ReturnedAt: isUpdate ? old.ReturnedAt : '',
    ReturnedByUserID: isUpdate ? old.ReturnedByUserID : '',
    ReturnedByName: isUpdate ? old.ReturnedByName : '',
    ReturnRemark: isUpdate ? old.ReturnRemark : '',
    OfficerOpinionAnnualUnder100k: bool01_(payload.officerOpinionAnnualUnder100k),
    OfficerOpinionAnnualOver100k: bool01_(payload.officerOpinionAnnualOver100k),
    OfficerMethod: payload.officerMethod || 'เฉพาะเจาะจง',
    OfficerMethodInProgress: bool01_(payload.officerMethodInProgress),
    OfficerInProgressMethod: payload.officerInProgressMethod || '',
    CompletionDays: Number(payload.completionDays || 0),
    OfficerReason: payload.officerReason || 'เนื่องจากมีความจำเป็นต้องใช้ในงานราชการของ สสจ.นครนายก',
    OfficerName: payload.officerName || '',
    OfficerPosition: payload.officerPosition || '',
    DeptHeadName: payload.deptHeadName || '',
    DeptHeadPosition: payload.deptHeadPosition || '',
    PlanInPlan: bool01_(payload.planInPlan),
    PlanYear: payload.planYear || '',
    PlanOther: payload.planOther || '',
    PlanBudgetSource: payload.planBudgetSource || '',
    PlanAmount: Number(payload.planAmount || totalAmount || 0),
    PlanRemark: payload.planRemark || '',
    ApproverName: payload.approverName || '',
    ApproverPosition: payload.approverPosition || 'นายแพทย์สาธารณสุขจังหวัดนครนายก',
    ApprovedAt: payload.approvedAt ? new Date(payload.approvedAt) : '',
    Notes: payload.notes || ''
  };

  if (isUpdate) {
    writeObjectRow_(requestSheet, requestHeaders, record, old._rowNumber);
    deleteRowsByRequestId_(CONFIG.ITEM_SHEET, 'RequestID', requestId);
    deleteRowsByRequestId_(CONFIG.INSPECTOR_SHEET, 'RequestID', requestId);
  } else {
    appendObjectRow_(requestSheet, requestHeaders, record);
  }

  const itemSheet = getSS_().getSheetByName(CONFIG.ITEM_SHEET);
  const itemHeaders = getHeaders_(itemSheet);
  items.forEach((it, i) => {
    appendObjectRow_(itemSheet, itemHeaders, Object.assign({}, it, {
      LineID: makeId_('LINE'),
      RequestID: requestId,
      LineNo: i + 1
    }));
  });

  const inspectorSheet = getSS_().getSheetByName(CONFIG.INSPECTOR_SHEET);
  const inspectorHeaders = getHeaders_(inspectorSheet);
  inspectors.forEach((ins, i) => {
    appendObjectRow_(inspectorSheet, inspectorHeaders, Object.assign({}, ins, {
      InspectorID: makeId_('INS'),
      RequestID: requestId,
      Seq: i + 1
    }));
  });

  addLog_(user, isUpdate ? 'UPDATE_REQUEST' : 'CREATE_REQUEST', requestId, requestNo);
  return { ok: true, requestId: requestId, requestNo: requestNo, message: 'บันทึกคำขอเรียบร้อยแล้ว' };
}

function sanitizeItems_(items) {
  return (items || [])
    .filter(it => it && String(it.itemName || '').trim())
    .map(it => {
      const quantity = Number(it.quantity || 0);
      const unitPrice = Number(it.unitPrice || 0);
      const total = quantity * unitPrice;
      return {
        ItemName: String(it.itemName || '').trim(),
        PlanBalanceAmount: Number(it.planBalanceAmount || 0),
        Quantity: quantity,
        Unit: String(it.unit || '').trim(),
        UnitPrice: unitPrice,
        TotalPrice: Number(it.totalPrice || total || 0),
        LastPrice: Number(it.lastPrice || 0),
        Remark: String(it.remark || '').trim()
      };
    });
}

function sanitizeInspectors_(inspectors) {
  return (inspectors || [])
    .filter(ins => ins && String(ins.fullName || '').trim())
    .slice(0, 3)
    .map(ins => ({
      FullName: String(ins.fullName || '').trim(),
      Position: String(ins.position || '').trim(),
      CID: normalizeTextNumber_(ins.cid || ''),
      Email: String(ins.email || '').trim(),
      UserID: String(ins.userId || '').trim()
    }));
}

function forwardRequest(session, payload) {
  const user = requireUser_(session);
  clearTableCache_(); // clear cache before mutation
  const row = getRequestRow_(payload.requestId);
  const toUser = payload.toUser ? String(payload.toUser).trim() : 'ไม่ระบุชื่อ';
  const signerRole = payload.signerRole ? String(payload.signerRole).trim() : '';
  const userSafe = safeUser_(user);
  const signatureUrl = userSafe.signatureBase64 || '';
  
  const status = normalizeStatus_(row.Status);
  const nextStatus = payload.nextStatus || status;

  let updateData = {
    Status: nextStatus,
    UpdatedAt: new Date()
  };

  if (nextStatus === STATUS.SUBMITTED) {
    updateData.SubmittedAt = new Date();
    updateData.SubmittedByUserID = user.UserID;
    updateData.SubmittedByName = user.FullName || user.Username || '';
  } else if (nextStatus === STATUS.CHECKED) {
    updateData.CheckedAt = new Date();
    updateData.CheckedByUserID = user.UserID;
    updateData.CheckedByName = user.FullName || user.Username || '';
    updateData.CheckRemark = payload.note || 'ผ่านการตรวจสอบ';
  } else if (nextStatus === STATUS.RETURNED) {
    updateData.ReturnedAt = new Date();
    updateData.ReturnedByUserID = user.UserID;
    updateData.ReturnedByName = user.FullName || user.Username || '';
    updateData.ReturnRemark = payload.note || 'ส่งกลับแก้ไข';
  }

  updateRequestFields_(payload.requestId, updateData);
  addLog_(user, 'FORWARD_REQUEST', payload.requestId, `ส่งต่อเป็น ${nextStatus} ให้ ${toUser}`);
  addProgressWithSignature_(session, payload.requestId, {
    progressStatus: nextStatus,
    note: (payload.note ? payload.note + '\n\n' : '') + 'ส่งเรื่องพิจารณาต่อให้: ' + toUser,
    signerRole: signerRole,
    signerName: userSafe.fullName,
    signatureUrl: signatureUrl
  });

  return { ok: true, message: 'ลงนามและส่งต่อเรียบร้อยแล้ว' };
}


function submitRequest(session, requestId) {
  const user = requireUser_(session);
  const row = getRequestRow_(requestId);
  if (String(row.CreatedByUserID || '') !== String(user.UserID || '') && !canSeeAll_(user)) {
    throw new Error('ส่งคำขอได้เฉพาะผู้สร้างคำขอหรือเจ้าหน้าที่ที่มีสิทธิ');
  }
  const status = normalizeStatus_(row.Status);
  if (status !== STATUS.DRAFT && status !== STATUS.RETURNED) {
    throw new Error('ส่งให้พัสดุตรวจสอบได้เฉพาะสถานะร่างหรือส่งกลับแก้ไข');
  }
  updateRequestFields_(requestId, {
    Status: STATUS.SUBMITTED,
    UpdatedAt: new Date(),
    SubmittedAt: new Date(),
    SubmittedByUserID: user.UserID,
    SubmittedByName: user.FullName || user.Username || ''
  });
  addLog_(user, 'SUBMIT_REQUEST', requestId, row.RequestNo);
  addProgressUpdate(session, requestId, {
    progressStatus: STATUS.SUBMITTED,
    note: 'ส่งคำขอให้เจ้าหน้าที่พัสดุตรวจสอบ',
    files: []
  });
  return { ok: true, message: 'ส่งคำขอให้เจ้าหน้าที่พัสดุตรวจสอบเรียบร้อยแล้ว' };
}

function supplyCheckPassed(session, requestId, remark) {
  const user = requireUser_(session);
  if (!isSupplyOfficer_(user)) throw new Error('เฉพาะเจ้าหน้าที่พัสดุหรือผู้ดูแลระบบเท่านั้นที่กดผ่านการตรวจสอบได้');
  const row = getRequestRow_(requestId);
  const status = normalizeStatus_(row.Status);
  if (status !== STATUS.SUBMITTED && status !== STATUS.RETURNED && status !== STATUS.DRAFT) {
    throw new Error('สถานะนี้ไม่สามารถกดผ่านการตรวจสอบได้');
  }
  updateRequestFields_(requestId, {
    Status: STATUS.CHECKED,
    UpdatedAt: new Date(),
    CheckedAt: new Date(),
    CheckedByUserID: user.UserID,
    CheckedByName: user.FullName || user.Username || '',
    CheckRemark: remark || 'ผ่านการตรวจสอบ'
  });
  addLog_(user, 'SUPPLY_CHECK_PASSED', requestId, remark || 'ผ่านการตรวจสอบ');
  addProgressUpdate(session, requestId, {
    progressStatus: STATUS.CHECKED,
    note: remark || 'ผ่านการตรวจสอบ',
    files: []
  });
  return { ok: true, message: 'บันทึกผลผ่านการตรวจสอบเรียบร้อยแล้ว' };
}

function supplyReturnRequest(session, requestId, remark) {
  const user = requireUser_(session);
  if (!isSupplyOfficer_(user)) throw new Error('เฉพาะเจ้าหน้าที่พัสดุหรือผู้ดูแลระบบเท่านั้นที่ส่งกลับแก้ไขได้');
  const row = getRequestRow_(requestId);
  updateRequestFields_(requestId, {
    Status: STATUS.RETURNED,
    UpdatedAt: new Date(),
    ReturnedAt: new Date(),
    ReturnedByUserID: user.UserID,
    ReturnedByName: user.FullName || user.Username || '',
    ReturnRemark: remark || ''
  });
  addLog_(user, 'SUPPLY_RETURN_REQUEST', requestId, remark || 'ส่งกลับแก้ไข');
  addProgressUpdate(session, requestId, {
    progressStatus: STATUS.RETURNED,
    note: remark || 'ส่งกลับแก้ไข',
    files: []
  });
  return { ok: true, message: 'ส่งกลับให้แก้ไขเรียบร้อยแล้ว' };
}

function cancelRequest(session, requestId) {
  const user = requireUser_(session);
  const row = getRequestRow_(requestId);
  if (String(row.CreatedByUserID || '') !== String(user.UserID || '') && !canSeeAll_(user)) {
    throw new Error('คุณไม่มีสิทธิยกเลิกคำขอนี้');
  }
  updateRequestFields_(requestId, {
    Status: STATUS.CANCELLED,
    UpdatedAt: new Date()
  });
  addLog_(user, 'CANCEL_REQUEST', requestId, row.RequestNo);
  return { ok: true, message: 'ยกเลิกคำขอแล้ว' };
}

function getRequestRow_(requestId) {
  const row = getTableRows_(CONFIG.REQUEST_SHEET).find(r => String(r.RequestID) === String(requestId));
  if (!row) throw new Error('ไม่พบคำขอ');
  return row;
}

function updateRequestFields_(requestId, fields) {
  const sh = getSS_().getSheetByName(CONFIG.REQUEST_SHEET);
  const headers = getHeaders_(sh);
  const map = getHeaderMap_(headers);
  const row = getRequestRow_(requestId);
  Object.keys(fields).forEach(k => {
    if (map[k] !== undefined) sh.getRange(row._rowNumber, map[k] + 1).setValue(fields[k]);
  });
}

function addProgressUpdate(session, requestId, payload) {
  const user = requireUser_(session);
  setupSupplySystem();
  const row = getRequestRow_(requestId);
  if (!canSeeAll_(user) && !canSeeDepartment_(user) && String(row.CreatedByUserID || '') !== String(user.UserID || '')) {
    throw new Error('คุณไม่มีสิทธิบันทึกความก้าวหน้าคำขอนี้');
  }
  const files = uploadFiles_((payload && payload.files) || [], row.RequestNo || requestId, 'ความก้าวหน้า');
  const progressStatus = payload && payload.progressStatus ? String(payload.progressStatus).trim() : 'บันทึกความก้าวหน้า';
  const note = payload && payload.note ? String(payload.note).trim() : '';
  const sh = getSS_().getSheetByName(CONFIG.PROGRESS_SHEET);
  const headers = getHeaders_(sh);
  appendObjectRow_(sh, headers, {
    ProgressID: makeId_('PROG'),
    RequestID: requestId,
    RequestNo: row.RequestNo || '',
    ProgressAt: new Date(),
    ProgressByUserID: user.UserID || '',
    ProgressByName: user.FullName || user.Username || '',
    ProgressStatus: progressStatus,
    Note: note,
    FileNames: files.names,
    FileUrls: files.urls,
    FileIds: files.ids,
    SignerRole: '',
    SignerName: '',
    SignatureUrl: ''
  });
  clearTableCache_(CONFIG.PROGRESS_SHEET);
  updateRequestFields_(requestId, { UpdatedAt: new Date() });
  addLog_(user, 'ADD_PROGRESS', requestId, progressStatus + ' ' + note);
  return {
    ok: true,
    message: 'บันทึกความก้าวหน้าเรียบร้อยแล้ว',
    progress: getProgressRows_(requestId)
  };
}

// บันทึกความก้าวหน้าพร้อมลายเซ็น (ใช้จาก forwardRequest)
function addProgressWithSignature_(session, requestId, data) {
  const user = requireUser_(session);
  const row = getRequestRow_(requestId);
  const sh = getSS_().getSheetByName(CONFIG.PROGRESS_SHEET);
  const headers = getHeaders_(sh);
  appendObjectRow_(sh, headers, {
    ProgressID: makeId_('PROG'),
    RequestID: requestId,
    RequestNo: row.RequestNo || '',
    ProgressAt: new Date(),
    ProgressByUserID: user.UserID || '',
    ProgressByName: user.FullName || user.Username || '',
    ProgressStatus: data.progressStatus || '',
    Note: data.note || '',
    FileNames: '',
    FileUrls: '',
    FileIds: '',
    SignerRole: data.signerRole || '',
    SignerName: data.signerName || '',
    SignatureUrl: data.signatureUrl || ''
  });
  clearTableCache_(CONFIG.PROGRESS_SHEET);
  updateRequestFields_(requestId, { UpdatedAt: new Date() });
  addLog_(user, 'SIGN_AND_FORWARD', requestId, (data.signerRole || '') + ' ' + (data.signerName || ''));
}

// ดึงลายเซ็นทั้งหมดของคำขอ จัดกลุ่มตาม SignerRole
function getSignaturesForRequest_(requestId) {
  const rows = getTableRows_(CONFIG.PROGRESS_SHEET)
    .filter(r => String(r.RequestID) === String(requestId) && String(r.SignerRole || '').trim());
  const sigs = {};
  rows.forEach(r => {
    const role = String(r.SignerRole || '').trim();
    // เก็บลายเซ็นล่าสุดของแต่ละ role
    sigs[role] = {
      signerRole: role,
      signerName: String(r.SignerName || '').trim(),
      signatureUrl: String(r.SignatureUrl || '').trim(),
      signedAt: r.ProgressAt || ''
    };
  });
  return sigs;
}

function getProgressRows_(requestId) {
  return getTableRows_(CONFIG.PROGRESS_SHEET)
    .filter(r => String(r.RequestID) === String(requestId))
    .sort((a, b) => String(b.ProgressAt || '').localeCompare(String(a.ProgressAt || '')) || String(b.ProgressID || '').localeCompare(String(a.ProgressID || '')));
}

function saveSetting(session, item) {
  const user = requireUser_(session);
  if (!isSupplyOfficer_(user)) throw new Error('เฉพาะเจ้าหน้าที่พัสดุหรือผู้ดูแลระบบเท่านั้นที่แก้ไข Setting ได้');
  item = item || {};
  const category = String(item.category || '').trim();
  const label = String(item.label || '').trim();
  const value = String(item.value || label || '').trim();
  if (!category) throw new Error('กรุณาเลือกประเภท');
  if (!label && !value) throw new Error('กรุณากรอกชื่อที่แสดงหรือค่า');

  const sh = getSS_().getSheetByName(CONFIG.SETTING_SHEET);
  const headers = getHeaders_(sh);
  const count = Math.max(0, sh.getLastRow() - 1);
  appendObjectRow_(sh, headers, {
    SettingID: makeId_('SET'),
    Category: category,
    Label: label || value,
    Value: value,
    SortOrder: count + 1,
    IsActive: 1,
    Remark: '',
    UpdatedAt: new Date()
  });
  addLog_(user, 'SAVE_SETTING', '', category + ': ' + (label || value));
  return { ok: true, message: 'เพิ่มตัวเลือกเรียบร้อยแล้ว', settings: buildSettings_() };
}

function getSettingsData_(session) {
  requireUser_(session);
  return { ok: true, settings: buildSettings_() };
}

function buildSettings_() {
  const rows = getTableRows_(CONFIG.SETTING_SHEET)
    .filter(r => isActive_(r.IsActive))
    .sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0));

  const byCategory = function(category) {
    return rows
      .filter(r => String(r.Category || '') === category)
      .map(r => String(r.Value || r.Label || '').trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
  };
  const defaults = {};
  rows.filter(r => String(r.Category || '') === 'Default').forEach(r => {
    const key = String(r.Label || '').trim();
    if (key) defaults[key] = String(r.Value || '').trim();
  });
  return {
    raw: rows.map(r => ({
      category: r.Category || '',
      label: r.Label || '',
      value: r.Value || ''
    })),
    itemNames: byCategory('ItemName'),
    units: byCategory('Unit'),
    budgetSources: byCategory('BudgetSource'),
    progressStatuses: byCategory('ProgressStatus'),
    defaults: defaults
  };
}

function seedDefaultSettings_() {
  const sh = getSS_().getSheetByName(CONFIG.SETTING_SHEET);
  if (!sh) return;
  if (sh.getLastRow() > 1) return;
  const headers = getHeaders_(sh);
  const defaults = [
    ['Default', 'ชื่อผู้รับเรื่อง', 'นายแพทย์สาธารณสุขจังหวัดนครนายก'],
    ['Default', 'ชื่อเจ้าหน้าที่พัสดุ', ''],
    ['Default', 'ตำแหน่งเจ้าหน้าที่พัสดุ', 'เจ้าหน้าที่'],
    ['Default', 'ชื่อหัวหน้าเจ้าหน้าที่', ''],
    ['Default', 'ตำแหน่งหัวหน้าเจ้าหน้าที่', 'หัวหน้าเจ้าหน้าที่'],
    ['Default', 'ชื่อนายแพทย์สาธารณสุขจังหวัดนครนายก', ''],
    ['ItemName', 'กระดาษ A4', 'กระดาษ A4'],
    ['ItemName', 'ปากกาลูกลื่น', 'ปากกาลูกลื่น'],
    ['ItemName', 'หมึกพิมพ์', 'หมึกพิมพ์'],
    ['Unit', 'รีม', 'รีม'],
    ['Unit', 'แท่ง', 'แท่ง'],
    ['Unit', 'กล่อง', 'กล่อง'],
    ['Unit', 'ชุด', 'ชุด'],
    ['Unit', 'รายการ', 'รายการ'],
    ['BudgetSource', 'เงินบำรุง', 'เงินบำรุง'],
    ['BudgetSource', 'งบประมาณรายจ่ายประจำปี', 'งบประมาณรายจ่ายประจำปี'],
    ['BudgetSource', 'เงินโครงการ', 'เงินโครงการ'],
    ['ProgressStatus', 'เสนอหัวหน้ากลุ่มงาน', 'เสนอหัวหน้ากลุ่มงาน'],
    ['ProgressStatus', 'ส่งให้พัสดุตรวจสอบ', STATUS.SUBMITTED],
    ['ProgressStatus', 'ผ่านการตรวจสอบ', STATUS.CHECKED],
    ['ProgressStatus', 'เสนอผู้บริหาร', 'เสนอผู้บริหาร'],
    ['ProgressStatus', 'ได้รับอนุมัติ', 'ได้รับอนุมัติ'],
    ['ProgressStatus', 'ออกใบสั่งซื้อ/สั่งจ้าง', 'ออกใบสั่งซื้อ/สั่งจ้าง'],
    ['ProgressStatus', 'ตรวจรับพัสดุ', 'ตรวจรับพัสดุ'],
    ['ProgressStatus', 'เบิกจ่ายแล้ว', 'เบิกจ่ายแล้ว']
  ];
  defaults.forEach((d, i) => {
    appendObjectRow_(sh, headers, {
      SettingID: makeId_('SET'),
      Category: d[0],
      Label: d[1],
      Value: d[2],
      SortOrder: i + 1,
      IsActive: 1,
      Remark: 'ค่าเริ่มต้นระบบ',
      UpdatedAt: new Date()
    });
  });
}

function getDashboardData_(session, prefetchedRequests) {
  const user = requireUser_(session);
  const rows = prefetchedRequests || listRequests(session, {}).requests || [];
  const total = rows.length;
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
  const pending = rows.filter(r => normalizeStatus_(r.status) === STATUS.SUBMITTED).length;
  const checked = rows.filter(r => normalizeStatus_(r.status) === STATUS.CHECKED).length;
  const byStatus = aggregate_(rows, 'status');
  const byDepartment = aggregate_(rows, 'department');
  return {
    ok: true,
    dashboard: {
      total: total,
      totalAmount: totalAmount,
      pending: pending,
      checked: checked,
      byStatus: byStatus,
      byDepartment: byDepartment,
      generatedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss')
    }
  };
}

function aggregate_(rows, key) {
  const map = {};
  rows.forEach(r => {
    const label = String(r[key] || 'ไม่ระบุ').trim() || 'ไม่ระบุ';
    if (!map[label]) map[label] = { label: label, count: 0, amount: 0 };
    map[label].count += 1;
    map[label].amount += Number(r.totalAmount || 0);
  });
  return Object.keys(map).map(k => map[k]).sort((a, b) => b.count - a.count || b.amount - a.amount);
}

function getPublicDashboardData() {
  clearTableCache_();
  setupSupplySystem();
  
  const rows = getTableRows_(CONFIG.REQUEST_SHEET);
  const allRequests = rows.map(r => ({
    requestId: r.RequestID,
    requestNo: r.RequestNo,
    requestDate: r.RequestDate,
    subject: r.Subject,
    department: r.Department,
    requester: r.CreatedByName,
    totalAmount: Number(r.TotalAmount || 0),
    status: normalizeStatus_(r.Status),
    purchaseType: r.PurchaseType || '',
    createdAt: r.CreatedAt || ''
  }));

  const total = allRequests.length;
  const totalAmount = allRequests.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
  const pending = allRequests.filter(r => r.status === STATUS.SUBMITTED).length;
  const checked = allRequests.filter(r => r.status === STATUS.CHECKED).length;
  
  const byStatus = aggregate_(allRequests, 'status');
  const byDepartment = aggregate_(allRequests, 'department');
  
  allRequests.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.requestNo || '').localeCompare(String(a.requestNo || '')));
  
  return {
    ok: true,
    requests: allRequests.slice(0, 300),
    dashboard: {
      total: total,
      totalAmount: totalAmount,
      pending: pending,
      checked: checked,
      byStatus: byStatus,
      byDepartment: byDepartment,
      generatedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss')
    }
  };
}

function uploadFiles_(files, requestNo, category) {
  if (!files || !files.length) return emptyUpload_();
  const folder = getAttachmentFolder_();
  const names = [];
  const urls = [];
  const ids = [];
  files.forEach((f, idx) => {
    if (!f || !f.data) return;
    const data = String(f.data);
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;
    const mimeType = f.mimeType || match[1] || 'application/octet-stream';
    const bytes = Utilities.base64Decode(match[2]);
    const originalName = sanitizeFileName_(f.name || ('file_' + (idx + 1)));
    const finalName = sanitizeFileName_([requestNo || 'REQ', category || 'เอกสารแนบ', Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss'), originalName].join('_'));
    const blob = Utilities.newBlob(bytes, mimeType, finalName);
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      console.log('setSharing error: ' + err.message);
    }
    names.push(finalName);
    urls.push(file.getUrl());
    ids.push(file.getId());
  });
  return {
    names: names.join('\n'),
    urls: urls.join('\n'),
    ids: ids.join('\n')
  };
}

function getAttachmentFolder_() {
  const rootName = CONFIG.ATTACHMENT_FOLDER_NAME;
  const folders = DriveApp.getFoldersByName(rootName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(rootName);
}

function emptyUpload_() {
  return { names: '', urls: '', ids: '' };
}

function mergeOrClearFiles_(old, flagName, nameField, urlField, idField, checked, uploaded) {
  if (!checked) return emptyUpload_();
  const oldNames = old ? String(old[nameField] || '') : '';
  const oldUrls = old ? String(old[urlField] || '') : '';
  const oldIds = old ? String(old[idField] || '') : '';
  return {
    names: joinNonEmpty_([oldNames, uploaded.names]),
    urls: joinNonEmpty_([oldUrls, uploaded.urls]),
    ids: joinNonEmpty_([oldIds, uploaded.ids])
  };
}

function joinNonEmpty_(arr) {
  return arr.map(v => String(v || '').trim()).filter(Boolean).join('\n');
}

function sanitizeFileName_(name) {
  return String(name || '').replace(/[\\/:*?"<>|#%{}~&]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function normalizeStatus_(status) {
  const s = String(status || '').trim();
  if (!s || s === 'Draft') return STATUS.DRAFT;
  if (s === 'Submitted') return STATUS.SUBMITTED;
  if (s === 'Checked' || s === 'ApprovedForPrint') return STATUS.CHECKED;
  if (s === 'Returned') return STATUS.RETURNED;
  if (s === 'Cancelled') return STATUS.CANCELLED;
  return s;
}

function normalizePhone_(value) {
  let s = normalizeTextNumber_(value);
  const digits = s.replace(/\D/g, '');
  if (digits.length === 9 && digits.charAt(0) !== '0') return '0' + digits;
  return s;
}

function normalizeTextNumber_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function deleteRowsByRequestId_(sheetName, colName, requestId) {
  const sh = getSS_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return;
  const headers = getHeaders_(sh);
  const colIndex = headers.indexOf(colName) + 1;
  if (colIndex < 1) return;
  const values = sh.getRange(2, colIndex, sh.getLastRow() - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(requestId)) sh.deleteRow(i + 2);
  }
}

function bool01_(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' ? 1 : 0;
}

function makeId_(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 8) + '-' + new Date().getTime();
}

function makeRequestNo_() {
  const now = new Date();
  const ymd = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyyMMdd');
  const prefix = 'PR' + ymd;
  const rows = getTableRows_(CONFIG.REQUEST_SHEET);
  const count = rows.filter(r => String(r.RequestNo || '').indexOf(prefix) === 0).length + 1;
  return prefix + '-' + ('000' + count).slice(-3);
}

function addLog_(user, action, requestId, detail) {
  try {
    const sh = getSS_().getSheetByName(CONFIG.LOG_SHEET);
    if (!sh) return;
    appendObjectRow_(sh, getHeaders_(sh), {
      LogID: makeId_('LOG'),
      Timestamp: new Date(),
      UserID: user.UserID || '',
      UserName: user.FullName || user.Username || '',
      Action: action,
      RequestID: requestId || '',
      Detail: detail || ''
    });
  } catch (err) {
    console.log('Log error: ' + err.message);
  }
}

function getMainPdfBase64(session, requestId) {
  const user = verifySession_(session);
  const sh = getSS_().getSheetByName(CONFIG.REQUEST_SHEET);
  const rows = getTableRows_(CONFIG.REQUEST_SHEET);
  const req = rows.find(r => r.RequestID === requestId);
  if (!req) throw new Error('ไม่พบคำขอนี้');
  if (!req.MainPdfFileId) throw new Error('ยังไม่มีไฟล์ PDF');
  try {
    const file = DriveApp.getFileById(req.MainPdfFileId);
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    return { ok: true, base64: base64 };
  } catch (err) {
    throw new Error('ไม่สามารถอ่านไฟล์ PDF ได้: ' + err.message);
  }
}

function saveEditedPdf(session, requestId, base64Data) {
  const user = verifySession_(session);
  const sh = getSS_().getSheetByName(CONFIG.REQUEST_SHEET);
  const headers = getHeaders_(sh);
  const rows = getTableRows_(CONFIG.REQUEST_SHEET);
  const rowIndex = rows.findIndex(r => r.RequestID === requestId);
  if (rowIndex === -1) throw new Error('ไม่พบคำขอนี้');
  
  const req = rows[rowIndex];
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), MimeType.PDF, 'request_' + requestId + '.pdf');
  
  let file, url, fileId;
  if (req.MainPdfFileId) {
    try {
      file = DriveApp.getFileById(req.MainPdfFileId);
      // Create a new file and trash the old one, or just update the content if possible.
      // Apps Script doesn't have a direct file.setContent(blob) for PDF, it only updates text.
      // So we trash the old one and create a new one.
      file.setTrashed(true);
    } catch(e) {}
  }
  
  const folder = getFolder_(CONFIG.ATTACHMENT_FOLDER_NAME);
  file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  url = file.getUrl();
  fileId = file.getId();
  
  const idCol = headers.indexOf('MainPdfFileId') + 1;
  const urlCol = headers.indexOf('MainPdfUrl') + 1;
  
  if (idCol > 0 && urlCol > 0) {
    sh.getRange(rowIndex + 2, idCol).setValue(fileId);
    sh.getRange(rowIndex + 2, urlCol).setValue(url);
  }
  
  clearTableCache_(CONFIG.REQUEST_SHEET);
  addLog_(user, 'Save_PDF', requestId, 'อัปเดตไฟล์ PDF (Save PDF)');
  
  return { ok: true, url: url, fileId: fileId };
}
