/**
 * ระบบเสนอความต้องการพัสดุ สสจ.นครนายก
 * Frontend (static) — เรียก Apps Script Web App ผ่าน fetch
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var STATE = {
    endpoint: '',
    token: '',
    user: null,
    users: [],
    settings: {},
    meta: { stages: [], attachmentTypes: [], budgetTypes: [], statuses: [] },
    requests: [],
    dashboard: null,
    detail: null,
    currentRequestId: '',
    removeFiles: {},
    reviewAction: '',
    progressRequestId: '',
    publicMode: false,
    printKind: ''
  };

  var STATUS = {
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

  var STATUS_STYLE = {};
  STATUS_STYLE[STATUS.DRAFT] = 'badge-gray';
  STATUS_STYLE[STATUS.SUBMITTED] = 'badge-warn';
  STATUS_STYLE[STATUS.RETURNED] = 'badge-danger';
  STATUS_STYLE[STATUS.CHECKED] = 'badge-ok';
  STATUS_STYLE[STATUS.APPROVED] = 'badge-brand';
  STATUS_STYLE[STATUS.IN_PROGRESS] = 'badge-info';
  STATUS_STYLE[STATUS.COMPLETED] = 'badge-ok';
  STATUS_STYLE[STATUS.SUPERSEDED] = 'badge-gray';
  STATUS_STYLE[STATUS.CANCELLED] = 'badge-gray';

  /* ==================== ตัวช่วยพื้นฐาน ==================== */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }
  function num(v) { var n = Number(String(v === null || v === undefined ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function money(v) { return num(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function count(v) { return num(v).toLocaleString('th-TH', { maximumFractionDigits: 2 }); }
  function thNum(s) { return String(s === null || s === undefined ? '' : s).replace(/[0-9]/g, function (d) { return '๐๑๒๓๔๕๖๗๘๙'[d]; }); }

  function toISODate(v) {
    if (!v) return '';
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      var y = Number(m[3]); if (y > 2400) y -= 543;
      return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    var d = new Date(s);
    if (isNaN(d)) return '';
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function todayISO() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function nowHM() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  var THAI_MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  function thaiDate(v) {
    var iso = toISODate(v);
    if (!iso) return '';
    var p = iso.split('-');
    return Number(p[2]) + ' ' + THAI_MONTHS[Number(p[1])] + ' ' + (Number(p[0]) + 543);
  }
  function thaiDateTime(v) {
    var iso = toISODate(v);
    if (!iso) return '';
    var m = String(v).match(/(\d{1,2}):(\d{2})/);
    return thaiDate(v) + (m ? ' เวลา ' + m[1] + ':' + m[2] + ' น.' : '');
  }
  function statusBadge(s) {
    return '<span class="badge ' + (STATUS_STYLE[s] || 'badge-gray') + '">' + esc(s || '-') + '</span>';
  }
  function alertBox(id, msg, type) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = msg ? '<div class="alert alert-' + (type || 'ok') + '">' + esc(msg) + '</div>' : '';
  }

  /* ==================== แจ้งสถานะการทำงาน ==================== */

  var busyCount = 0, statusTimer = null;

  function busy(message) {
    busyCount++;
    var bar = $('statusBar');
    $('statusText').textContent = message || 'กำลังทำงาน...';
    bar.className = 'show';
    bar.querySelector('.spinner').style.display = '';
    var p = $('topProgress');
    p.style.opacity = '1';
    p.style.width = '25%';
    setTimeout(function () { if (busyCount > 0) p.style.width = '70%'; }, 220);
  }

  function idle(message, isError) {
    busyCount = Math.max(0, busyCount - 1);
    var p = $('topProgress');
    if (busyCount === 0) {
      p.style.width = '100%';
      setTimeout(function () { p.style.opacity = '0'; p.style.width = '0'; }, 320);
    }
    var bar = $('statusBar');
    if (message) {
      bar.querySelector('.spinner').style.display = 'none';
      $('statusText').textContent = message;
      bar.className = 'show ' + (isError ? 'err' : 'ok');
      clearTimeout(statusTimer);
      statusTimer = setTimeout(function () { bar.className = ''; }, isError ? 6000 : 2600);
    } else if (busyCount === 0) {
      bar.className = '';
    }
  }

  function skeleton(el, lines) {
    var html = '';
    for (var i = 0; i < (lines || 3); i++) {
      html += '<div class="skeleton" style="width:' + (60 + Math.random() * 40) + '%"></div>';
    }
    if (el) el.innerHTML = html;
  }

  /* ==================== เรียก API ==================== */

  function api(action, payload, options) {
    options = options || {};
    var body = Object.assign({ action: action }, payload || {});
    if (STATE.token && !options.anonymous) body.token = STATE.token;
    if (options.message !== false) busy(options.message || 'กำลังติดต่อเซิร์ฟเวอร์...');

    return fetch(STATE.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    })
      .then(function (res) {
        return res.text().then(function (text) { return { status: res.status, text: text }; });
      })
      .then(function (raw) {
        var json;
        try { json = JSON.parse(raw.text); }
        catch (e) {
          throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ' + raw.status + ') — ตรวจสอบว่า Deploy Web App โดยตั้ง "ผู้ที่มีสิทธิ์เข้าถึง" เป็น "ทุกคน" แล้ว');
        }
        if (!json.ok) throw new Error(json.error || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์');
        if (options.message !== false) idle(options.done || '');
        return json;
      })
      .catch(function (err) {
        idle(err.message || 'เชื่อมต่อไม่สำเร็จ', true);
        if (/เซสชันหมดอายุ|เข้าสู่ระบบ/.test(err.message || '')) {
          localStorage.removeItem(CFG.SESSION_KEY);
          STATE.token = '';
          showLogin();
        }
        throw err;
      });
  }

  function encodeFiles(input) {
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    if (!files.length) return Promise.resolve([]);
    return Promise.all(files.map(function (file) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve({ name: file.name, mimeType: file.type, data: fr.result }); };
        fr.onerror = function () { reject(new Error('อ่านไฟล์ ' + file.name + ' ไม่สำเร็จ')); };
        fr.readAsDataURL(file);
      });
    }));
  }

  function readFiles(inputId) { return encodeFiles($(inputId)); }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src;
      s.setAttribute('data-src', src);
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('โหลดไลบรารีไม่สำเร็จ')); };
      document.head.appendChild(s);
    });
  }

  /* ==================== เริ่มต้นระบบ ==================== */

  function boot() {
    $('orgName').textContent = CFG.ORG_NAME || '';
    STATE.endpoint = (CFG.API_URL || '').trim() || localStorage.getItem(CFG.ENDPOINT_KEY) || '';
    if (!STATE.endpoint) { show('setupView'); return; }

    var saved = localStorage.getItem(CFG.SESSION_KEY);
    if (saved) {
      try {
        var session = JSON.parse(saved);
        if (session && session.token) {
          STATE.token = session.token;
          bootstrap();
          return;
        }
      } catch (e) { /* ข้อมูลเสีย — เข้าสู่ระบบใหม่ */ }
    }
    showLogin();
  }

  function show(viewId) {
    ['setupView', 'loginView', 'appView'].forEach(function (id) {
      $(id).classList.toggle('hidden', id !== viewId);
    });
  }

  function showLogin() {
    show('loginView');
    setTimeout(function () { var el = $('loginUsername'); if (el) el.focus(); }, 60);
  }

  function saveEndpoint() {
    var url = $('setupUrl').value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      alertBox('setupAlert', 'URL ต้องเป็นลิงก์ Apps Script Web App ที่ลงท้ายด้วย /exec', 'danger');
      return;
    }
    localStorage.setItem(CFG.ENDPOINT_KEY, url);
    STATE.endpoint = url;
    busy('กำลังทดสอบการเชื่อมต่อ...');
    api('ping', {}, { anonymous: true, message: false })
      .then(function () { idle('เชื่อมต่อสำเร็จ'); showLogin(); })
      .catch(function () { alertBox('setupAlert', 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบ URL และการ Deploy', 'danger'); });
  }

  function login() {
    alertBox('loginAlert', '');
    var username = $('loginUsername').value.trim();
    var password = $('loginPassword').value;
    if (!username || !password) { alertBox('loginAlert', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'danger'); return; }

    $('loginBtn').disabled = true;
    api('login', { username: username, password: password, client: navigator.userAgent },
      { anonymous: true, message: 'กำลังตรวจสอบสิทธิเข้าใช้งาน...', done: 'เข้าสู่ระบบสำเร็จ' })
      .then(function (res) {
        STATE.token = res.token;
        localStorage.setItem(CFG.SESSION_KEY, JSON.stringify({ token: res.token, userId: res.user.userId }));
        return bootstrap();
      })
      .catch(function (err) { alertBox('loginAlert', err.message, 'danger'); })
      .then(function () { $('loginBtn').disabled = false; });
  }

  function logout() {
    api('logout', {}, { message: 'กำลังออกจากระบบ...', done: 'ออกจากระบบแล้ว' }).catch(function () { });
    localStorage.removeItem(CFG.SESSION_KEY);
    STATE.token = '';
    STATE.user = null;
    showLogin();
  }

  function bootstrap() {
    show('appView');
    skeleton($('kpiGrid'), 4);
    return api('bootstrap', { filters: currentFilters() },
      { message: 'กำลังโหลดข้อมูลระบบ...', done: 'โหลดข้อมูลเรียบร้อย' })
      .then(function (res) {
        STATE.publicMode = false;
        STATE.user = res.user;
        STATE.users = res.users || [];
        STATE.settings = res.settings || {};
        STATE.meta = res.meta || STATE.meta;
        STATE.requests = res.requests || [];
        STATE.dashboard = res.dashboard;
        applyUserChrome();
        fillStaticOptions();
        renderDashboard();
        renderList();
        renderSettings();
        fillTrackSelect();
        $('lastSync').textContent = 'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH');
      });
  }

  function viewPublicDashboard() {
    show('appView');
    skeleton($('kpiGrid'), 4);
    api('publicDashboard', {}, { anonymous: true, message: 'กำลังโหลดภาพรวม...', done: 'โหลดข้อมูลเรียบร้อย' })
      .then(function (res) {
        STATE.publicMode = true;
        STATE.user = null;
        STATE.requests = res.requests || [];
        STATE.dashboard = res.dashboard;
        applyUserChrome();
        fillStaticOptions();
        renderDashboard();
        renderList();
        showPage('dashboard');
      });
  }

  function applyUserChrome() {
    var pub = STATE.publicMode || !STATE.user;
    $('currentUserName').textContent = pub ? 'บุคคลทั่วไป' : (STATE.user.fullName || STATE.user.username);
    $('currentUserMeta').textContent = pub ? 'กรุณาเข้าสู่ระบบเพื่อจัดการข้อมูล'
      : [STATE.user.position, STATE.user.department].filter(Boolean).join(' / ');
    $('logoutBtn').classList.toggle('hidden', pub);
    $('loginBtnTop').classList.toggle('hidden', !pub);
    $('navForm').classList.toggle('hidden', pub);
    $('navTrack').classList.toggle('hidden', pub);
    $('navSettings').classList.toggle('hidden', pub || !STATE.user.isSuperAdmin);
    $('navLogs').classList.toggle('hidden', pub || !STATE.user.isSuperAdmin);
    $('dashboardScope').textContent = pub ? 'ข้อมูลสาธารณะ'
      : (STATE.user.isSupply ? 'มุมมองเจ้าหน้าที่พัสดุ — เห็นคำขอทุกกลุ่มงาน' : 'เห็นเฉพาะคำขอที่คุณมีสิทธิเข้าถึง');
  }

  function fillStaticOptions() {
    var s = STATE.settings || {};
    var stages = (STATE.meta.stages && STATE.meta.stages.length) ? STATE.meta.stages : (s.stages || []);
    var statuses = STATE.meta.statuses && STATE.meta.statuses.length
      ? STATE.meta.statuses
      : Object.keys(STATUS).map(function (k) { return STATUS[k]; });

    fillSelect('fltStage', stages, 'ทุกขั้นตอน');
    fillSelect('fltStatus', statuses, 'ทุกสถานะ');
    fillSelect('searchStatus', statuses, 'ทั้งหมด');
    fillSelect('progressStage', stages, '');
    fillSelect('fltBudgetType', (s.budgetTypes || STATE.meta.budgetTypes || []), 'ทั้งหมด');
    fillSelect('budgetType', (s.budgetTypes || STATE.meta.budgetTypes || []), 'เลือกประเภทงบประมาณ');

    var departments = uniq(STATE.requests.map(function (r) { return r.department; })
      .concat(STATE.users.map(function (u) { return u.department; }))).filter(Boolean).sort();
    fillSelect('fltDepartment', departments, 'ทุกกลุ่มงาน');

    var years = uniq(STATE.requests.map(function (r) { return r.fiscalYear; })).filter(Boolean).sort().reverse();
    fillSelect('fltYear', years, 'ทุกปี');

    fillDatalist('itemNameList', s.itemNames || []);
    fillDatalist('unitList', s.units || []);
    fillDatalist('budgetSourceList', s.budgetSources || []);
    $('userList').innerHTML = STATE.users.map(function (u) {
      return '<option value="' + esc(u.fullName) + '">' + esc([u.position, u.department].filter(Boolean).join(' / ')) + '</option>';
    }).join('');
  }

  function uniq(arr) { return arr.filter(function (v, i, a) { return v && a.indexOf(v) === i; }); }

  function fillSelect(id, values, placeholder) {
    var el = $(id);
    if (!el) return;
    var keep = el.value;
    var html = placeholder !== undefined && placeholder !== null ? '<option value="">' + esc(placeholder) + '</option>' : '';
    html += (values || []).map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    el.innerHTML = html;
    if (keep) el.value = keep;
  }

  function fillDatalist(id, values) {
    var el = $(id);
    if (el) el.innerHTML = (values || []).map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('');
  }

  /* ==================== นำทาง ==================== */

  var PAGES = ['dashboard', 'list', 'form', 'track', 'settings', 'logs'];
  var NAV = { dashboard: 'navDashboard', list: 'navList', form: 'navForm', track: 'navTrack', settings: 'navSettings', logs: 'navLogs' };

  function showPage(page) {
    PAGES.forEach(function (p) {
      $(p + 'Page').classList.toggle('hidden', p !== page);
      var nav = $(NAV[p]);
      if (nav) nav.classList.toggle('active', p === page);
    });
    if (page === 'logs') loadLogs();
    if (window.innerWidth <= 960) window.scrollTo(0, 0);
  }

  function toggleSidebar() { $('sidebar').classList.toggle('hidden'); }

  function reload() {
    if (STATE.publicMode) return viewPublicDashboard();
    return bootstrap();
  }

  /* ==================== ตัวกรอง + แดชบอร์ด ==================== */

  function currentFilters() {
    if (!$('fltYear')) return {};
    return {
      fiscalYear: $('fltYear').value,
      department: $('fltDepartment').value,
      budgetType: $('fltBudgetType').value,
      purchaseType: $('fltPurchaseType').value,
      stage: $('fltStage').value,
      status: $('fltStatus').value,
      dateFrom: $('fltDateFrom').value,
      dateTo: $('fltDateTo').value
    };
  }

  function applyFilters() {
    if (STATE.publicMode) return;
    api('dashboard', { filters: currentFilters() }, { message: 'กำลังกรองข้อมูล...', done: 'กรองข้อมูลแล้ว' })
      .then(function (res) {
        STATE.dashboard = res.dashboard;
        STATE.requests = res.requests || [];
        renderDashboard();
        renderList();
        fillTrackSelect();
      });
  }

  function clearFilters() {
    ['fltYear', 'fltDepartment', 'fltBudgetType', 'fltPurchaseType', 'fltStage', 'fltStatus', 'fltDateFrom', 'fltDateTo']
      .forEach(function (id) { $(id).value = ''; });
    applyFilters();
  }

  function renderDashboard() {
    var d = STATE.dashboard || {};
    var c = d.counters || {};
    var kpis = [
      ['คำขอทั้งหมด', count(d.total || 0), 'เรื่อง'],
      ['วงเงินรวม', money(d.totalAmount || 0), 'บาท'],
      ['รอพัสดุตรวจสอบ', count(c.pending || 0), 'เรื่อง'],
      ['อยู่ระหว่างดำเนินการ', count((c.approved || 0) + (c.inProgress || 0)), 'เรื่อง'],
      ['ผ่านการตรวจสอบ', count(c.checked || 0), 'รอเสนอ SMO'],
      ['ดำเนินการแล้วเสร็จ', count(c.completed || 0), 'เรื่อง'],
      ['ส่งกลับแก้ไข', count(c.returned || 0), 'เรื่อง'],
      ['วงเงินที่ได้รับอนุมัติ', money(d.approvedAmount || 0), 'บาท']
    ];
    $('kpiGrid').innerHTML = kpis.map(function (k) {
      return '<div class="kpi"><div class="label">' + esc(k[0]) + '</div><div class="value">' + k[1] + '</div><div class="sub">' + esc(k[2]) + '</div></div>';
    }).join('');

    var dur = d.durations || {};
    var durRows = [
      ['ยื่นคำขอ → พัสดุตรวจสอบเสร็จ', dur.submitToCheck],
      ['ยื่นคำขอ → ได้รับอนุมัติ (SMO)', dur.submitToApprove],
      ['ได้รับอนุมัติ → ตรวจรับเสร็จ', dur.approveToComplete],
      ['ยื่นคำขอ → แล้วเสร็จทั้งกระบวนการ', dur.submitToComplete]
    ];
    $('durationTbody').innerHTML = durRows.map(function (r) {
      var v = r[1] || {};
      return '<tr><td>' + esc(r[0]) + '</td><td class="right">' + count(v.count || 0) + '</td><td class="right bold">' +
        count(v.avg || 0) + '</td><td class="right">' + count(v.min || 0) + '</td><td class="right">' + count(v.max || 0) + '</td></tr>';
    }).join('');

    $('stageDurationTbody').innerHTML = (d.stageDurations || []).map(function (r) {
      return '<tr><td>' + esc(r.stage) + '</td><td class="right">' + count(r.count) + '</td><td class="right bold">' +
        count(r.avg) + '</td><td class="right">' + count(r.min) + '</td><td class="right">' + count(r.max) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="center muted">ยังไม่มีข้อมูลความก้าวหน้า</td></tr>';

    bars('chartYear', d.byYear, 'fiscalYear');
    bars('chartDepartment', (d.byDepartment || []).slice(0, 15), 'department');
    bars('chartStatus', d.byStatus, 'status');
    bars('chartStage', d.byStage, 'stage');
    bars('chartBudgetType', d.byBudgetType, 'budgetType');
    bars('chartPurchaseType', d.byPurchaseType, 'purchaseType');
  }

  function bars(id, rows, filterKey) {
    var el = $(id);
    if (!el) return;
    rows = rows || [];
    if (!rows.length) { el.innerHTML = '<div class="muted center">ไม่มีข้อมูล</div>'; return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }).concat([1]));
    el.innerHTML = rows.map(function (r) {
      return '<div class="bar-row" style="cursor:pointer" title="คลิกเพื่อกรอง" data-key="' + esc(filterKey) + '" data-value="' + esc(r.label) + '">' +
        '<div class="nowrap">' + esc(r.label) + '</div>' +
        '<div class="bar"><span style="width:' + Math.max(4, r.count / max * 100) + '%"></span></div>' +
        '<div class="right small">' + count(r.count) + ' เรื่อง<br>' + money(r.amount) + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.bar-row'), function (row) {
      row.onclick = function () { quickFilter(row.getAttribute('data-key'), row.getAttribute('data-value')); };
    });
  }

  var FILTER_FIELD = {
    fiscalYear: 'fltYear', department: 'fltDepartment', status: 'fltStatus',
    stage: 'fltStage', budgetType: 'fltBudgetType', purchaseType: 'fltPurchaseType'
  };

  function quickFilter(key, value) {
    var field = FILTER_FIELD[key];
    if (!field) return;
    var el = $(field);
    el.value = el.value === value ? '' : value;
    applyFilters();
  }

  /* ==================== รายการคำขอ ==================== */

  function visibleRequests() {
    var key = ($('searchKeyword') ? $('searchKeyword').value : '').toLowerCase().trim();
    var status = $('searchStatus') ? $('searchStatus').value : '';
    var scope = $('searchScope') ? $('searchScope').value : 'all';
    var me = STATE.user ? STATE.user.userId : '';
    var supply = STATE.user && STATE.user.isSupply;

    return (STATE.requests || []).filter(function (r) {
      if (status && r.status !== status) return false;
      if (scope === 'mine' && r.requesterId !== me) return false;
      if (scope === 'todo') {
        var mine = r.requesterId === me;
        var todo = supply ? r.status === STATUS.SUBMITTED : false;
        if (mine && (r.status === STATUS.RETURNED || r.status === STATUS.CHECKED || r.status === STATUS.DRAFT)) todo = true;
        if (!todo) return false;
      }
      if (key) {
        var joined = [r.requestNo, r.subject, r.requester, r.department, r.status, r.currentStage].join(' ').toLowerCase();
        if (joined.indexOf(key) === -1) return false;
      }
      return true;
    });
  }

  function renderList() {
    var rows = visibleRequests();
    if ($('recordCount')) $('recordCount').textContent = '(' + count(rows.length) + ' รายการ)';
    $('requestTbody').innerHTML = rows.length ? rows.map(function (r) {
      return '<tr>' +
        '<td class="nowrap">' + esc(r.requestNo) + (r.version > 1 ? ' <span class="badge badge-info">v' + r.version + '</span>' : '') +
        (r.isLocked ? ' <span class="lock-chip">🔒</span>' : '') + '</td>' +
        '<td class="nowrap">' + esc(thaiDate(r.requestDate)) + '</td>' +
        '<td>' + esc(r.subject) + '</td>' +
        '<td>' + esc(r.requester) + '<br><span class="muted small">' + esc(r.department) + '</span></td>' +
        '<td class="right nowrap">' + money(r.totalAmount) + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td class="small">' + esc(r.currentStage || '-') + '</td>' +
        '<td>' + rowActions(r) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="center muted">ไม่พบข้อมูล</td></tr>';

    Array.prototype.forEach.call($('requestTbody').querySelectorAll('[data-open]'), function (btn) {
      btn.onclick = function () { openRequest(btn.getAttribute('data-open')); };
    });
    Array.prototype.forEach.call($('requestTbody').querySelectorAll('[data-track]'), function (btn) {
      btn.onclick = function () { openTrack(btn.getAttribute('data-track')); };
    });
  }

  function rowActions(r) {
    if (STATE.publicMode) return '<span class="muted small">เข้าสู่ระบบเพื่อจัดการ</span>';
    return '<div class="row-actions">' +
      '<button class="btn btn-soft btn-sm" data-open="' + esc(r.requestId) + '">เปิด</button>' +
      '<button class="btn btn-ghost btn-sm" data-track="' + esc(r.requestId) + '">ติดตาม</button></div>';
  }

  /* ==================== ฟอร์มคำขอ ==================== */

  function newRequest() {
    STATE.currentRequestId = '';
    STATE.detail = null;
    STATE.removeFiles = {};
    var u = STATE.user || {};
    var def = (STATE.settings && STATE.settings.defaults) || {};

    $('formTitle').textContent = 'บันทึกคำขอใหม่';
    $('formSubtitle').textContent = 'กรอกข้อมูลตามแบบขอความเห็นชอบซื้อ/จ้าง';
    $('statusPanel').innerHTML = '<div class="muted">คำขอใหม่จะเริ่มจากสถานะ “' + STATUS.DRAFT + '” และส่งให้เจ้าหน้าที่พัสดุตรวจสอบเมื่อพร้อม</div>';
    alertBox('formAlert', '');

    setVal('department', u.department); setVal('phone', u.phone);
    setVal('docNoText', 'นย'); setVal('requestDate', todayISO());
    setVal('to', def['ชื่อผู้รับเรื่อง'] || 'นายแพทย์สาธารณสุขจังหวัดนครนายก');
    setVal('purchaseType', 'ซื้อ'); setVal('subject', ''); setVal('reason', '');
    ['purposeRegular', 'purposeStock', 'purposeProject', 'officerOpinionAnnualUnder100k',
      'officerOpinionAnnualOver100k', 'officerMethodInProgress', 'planInPlan'].forEach(function (id) { $(id).checked = false; });
    setVal('projectName', ''); setVal('officerMethod', 'เฉพาะเจาะจง'); setVal('officerInProgressMethod', '');
    setVal('completionDays', 0);
    setVal('officerReason', 'เนื่องจากมีความจำเป็นต้องใช้ในงานราชการของ สสจ.นครนายก');
    setVal('officerName', def['ชื่อเจ้าหน้าที่พัสดุ'] || ''); setVal('officerPosition', def['ตำแหน่งเจ้าหน้าที่พัสดุ'] || 'เจ้าหน้าที่');
    setVal('deptHeadName', def['ชื่อหัวหน้าเจ้าหน้าที่'] || ''); setVal('deptHeadPosition', def['ตำแหน่งหัวหน้าเจ้าหน้าที่'] || 'หัวหน้าเจ้าหน้าที่');
    setVal('budgetType', ''); setVal('planBudgetSource', '');
    setVal('planYear', new Date().getFullYear() + 543); setVal('planAmount', 0);
    setVal('planOther', ''); setVal('planRemark', '');
    setVal('approverName', def['ชื่อนายแพทย์สาธารณสุขจังหวัดนครนายก'] || '');
    setVal('approverPosition', 'นายแพทย์สาธารณสุขจังหวัดนครนายก');
    setVal('notes', '');

    $('itemsTbody').innerHTML = ''; addItemRow();
    $('inspectorsTbody').innerHTML = ''; addInspectorRow();
    renderAttachments(null);
    updateFormButtons(null);
    showPage('form');
  }

  function setVal(id, v) { var el = $(id); if (el) el.value = v === undefined || v === null ? '' : v; }

  function openRequest(requestId) {
    showPage('form');
    $('statusPanel').innerHTML = '';
    skeleton($('statusPanel'), 2);
    return api('getRequest', { requestId: requestId }, { message: 'กำลังเปิดคำขอ...', done: '' })
      .then(function (res) {
        STATE.detail = res;
        STATE.currentRequestId = requestId;
        STATE.removeFiles = {};
        fillForm(res);
      });
  }

  function fillForm(res) {
    var r = res.request || {};
    var perm = res.permissions || {};
    $('formTitle').textContent = 'คำขอเลขที่ ' + (r.RequestNo || '');
    $('formSubtitle').innerHTML = 'เวอร์ชัน ' + (r.Version || 1) + ' • ผู้ยื่น ' + esc(r.CreatedByName || '');

    var versionHtml = (res.versions || []).length > 1
      ? '<div class="mt small"><b>ประวัติเวอร์ชัน:</b> ' + res.versions.map(function (v) {
        return '<button class="btn btn-ghost btn-sm" data-ver="' + esc(v.requestId) + '">v' + v.version +
          (v.isLatest ? ' (ปัจจุบัน)' : '') + '</button>';
      }).join(' ') + '</div>'
      : '';

    $('statusPanel').innerHTML =
      '<div class="row-actions">' + statusBadge(r.Status) +
      (r.IsLocked == 1 ? '<span class="lock-chip">🔒 ล็อกข้อมูลหลังได้รับอนุมัติ</span>' : '') +
      '<span class="muted small">อัปเดตล่าสุด ' + esc(thaiDateTime(r.UpdatedAt || r.CreatedAt)) + '</span></div>' +
      (r.ReturnRemark ? '<div class="alert alert-danger mt"><b>เหตุผลที่ส่งกลับแก้ไข:</b> ' + esc(r.ReturnRemark) + '</div>' : '') +
      (r.CheckRemark && r.Status === STATUS.CHECKED ? '<div class="alert alert-ok mt">' + esc(r.CheckRemark) + '</div>' : '') +
      stageTrack(r) + versionHtml;

    Array.prototype.forEach.call($('statusPanel').querySelectorAll('[data-ver]'), function (btn) {
      btn.onclick = function () { openRequest(btn.getAttribute('data-ver')); };
    });

    setVal('department', r.Department); setVal('phone', r.Phone); setVal('docNoText', r.DocNoText || 'นย');
    setVal('requestDate', toISODate(r.RequestDate)); setVal('to', r.To); setVal('purchaseType', r.PurchaseType || 'ซื้อ');
    setVal('subject', r.Subject); setVal('reason', r.Reason);
    $('purposeRegular').checked = r.PurposeRegular == 1;
    $('purposeStock').checked = r.PurposeStock == 1;
    $('purposeProject').checked = r.PurposeProject == 1;
    setVal('projectName', r.ProjectName);
    $('officerOpinionAnnualUnder100k').checked = r.OfficerOpinionAnnualUnder100k == 1;
    $('officerOpinionAnnualOver100k').checked = r.OfficerOpinionAnnualOver100k == 1;
    setVal('officerMethod', r.OfficerMethod || 'เฉพาะเจาะจง');
    $('officerMethodInProgress').checked = r.OfficerMethodInProgress == 1;
    setVal('officerInProgressMethod', r.OfficerInProgressMethod);
    setVal('completionDays', r.CompletionDays || 0); setVal('officerReason', r.OfficerReason);
    setVal('officerName', r.OfficerName); setVal('officerPosition', r.OfficerPosition);
    setVal('deptHeadName', r.DeptHeadName); setVal('deptHeadPosition', r.DeptHeadPosition);
    setVal('budgetType', r.BudgetType); setVal('planBudgetSource', r.PlanBudgetSource);
    $('planInPlan').checked = r.PlanInPlan == 1;
    setVal('planYear', r.PlanYear); setVal('planAmount', r.PlanAmount || r.TotalAmount || 0);
    setVal('planOther', r.PlanOther); setVal('planRemark', r.PlanRemark);
    setVal('approverName', r.ApproverName); setVal('approverPosition', r.ApproverPosition);
    setVal('notes', r.Notes);

    $('itemsTbody').innerHTML = '';
    (res.items || []).forEach(function (it) {
      addItemRow({ itemName: it.ItemName, planBalanceAmount: it.PlanBalanceAmount, quantity: it.Quantity, unit: it.Unit, unitPrice: it.UnitPrice, totalPrice: it.TotalPrice, lastPrice: it.LastPrice });
    });
    if (!(res.items || []).length) addItemRow();
    calcTotal();

    $('inspectorsTbody').innerHTML = '';
    (res.inspectors || []).forEach(function (ins) {
      addInspectorRow({ fullName: ins.FullName, position: ins.Position, cid: ins.CID, email: ins.Email, userId: ins.UserID });
    });
    if (!(res.inspectors || []).length) addInspectorRow();

    renderAttachments(r);
    updateFormButtons(perm, r);
  }

  function stageTrack(r) {
    var stages = STATE.meta.stages || [];
    if (!stages.length || !r.CurrentStage) return '';
    var idx = stages.indexOf(r.CurrentStage);
    return '<div class="stage-track mt">' + stages.map(function (s, i) {
      var cls = i < idx ? 'done' : (i === idx ? 'current' : '');
      return '<span class="stage-pill ' + cls + '">' + esc(s) + '</span>';
    }).join('') + '</div>';
  }

  function updateFormButtons(perm, r) {
    var readOnly = false;
    if (!perm) {
      perm = { canEdit: true, canSubmit: true };
    } else {
      readOnly = !perm.canEdit;
    }
    $('btnSaveDraft').classList.toggle('hidden', !perm.canEdit);
    $('btnSaveSubmit').classList.toggle('hidden', !perm.canEdit);
    $('btnReviewPass').classList.toggle('hidden', !perm.canReview);
    $('btnReviewReturn').classList.toggle('hidden', !perm.canReview);
    $('btnAttachApproval').classList.toggle('hidden', !perm.canAttachApproval);
    $('btnUnlock').classList.toggle('hidden', !perm.canUnlock);
    $('btnLock').classList.toggle('hidden', !(perm.isSupply && r && r.IsLocked != 1 && r.Status === STATUS.APPROVED));
    $('btnCancel').classList.toggle('hidden', !perm.canCancel);
    $('btnPrint').classList.toggle('hidden', !perm.canDownload);
    $('btnTrack').classList.toggle('hidden', !STATE.currentRequestId);

    setFormReadOnly(readOnly && !!STATE.currentRequestId);
  }

  function setFormReadOnly(readOnly) {
    var page = $('formPage');
    Array.prototype.forEach.call(page.querySelectorAll('input, select, textarea'), function (el) {
      if (el.type === 'file') { el.disabled = readOnly; return; }
      el.disabled = readOnly;
    });
  }

  function addItemRow(data) {
    data = data || {};
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="center rowno"></td>' +
      '<td><input list="itemNameList" class="item-name" value="' + esc(data.itemName || '') + '"></td>' +
      '<td><input type="number" step="0.01" class="plan" value="' + num(data.planBalanceAmount) + '"></td>' +
      '<td><input type="number" step="0.01" class="qty" value="' + num(data.quantity) + '"></td>' +
      '<td><input list="unitList" class="unit" value="' + esc(data.unit || '') + '"></td>' +
      '<td><input type="number" step="0.01" class="unitprice" value="' + num(data.unitPrice) + '"></td>' +
      '<td><input type="number" step="0.01" class="total" value="' + num(data.totalPrice) + '"></td>' +
      '<td><input type="number" step="0.01" class="lastprice" value="' + num(data.lastPrice) + '"></td>' +
      '<td><button class="btn btn-danger btn-sm" type="button">ลบ</button></td>';
    $('itemsTbody').appendChild(tr);

    tr.querySelector('.qty').oninput = tr.querySelector('.unitprice').oninput = function () {
      tr.querySelector('.total').value = (num(tr.querySelector('.qty').value) * num(tr.querySelector('.unitprice').value)).toFixed(2);
      calcTotal();
    };
    tr.querySelector('.total').oninput = calcTotal;
    tr.querySelector('button').onclick = function () { tr.remove(); renumber(); calcTotal(); };
    renumber(); calcTotal();
  }

  function addInspectorRow(data) {
    data = data || {};
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="center rowno"></td>' +
      '<td><input class="ins-name" list="userList" value="' + esc(data.fullName || '') + '"></td>' +
      '<td><input class="ins-position" value="' + esc(data.position || '') + '"></td>' +
      '<td><input class="ins-cid" value="' + esc(data.cid || '') + '"></td>' +
      '<td><input class="ins-email" value="' + esc(data.email || '') + '"></td>' +
      '<td><input type="hidden" class="ins-userid" value="' + esc(data.userId || '') + '"><button class="btn btn-danger btn-sm" type="button">ลบ</button></td>';
    $('inspectorsTbody').appendChild(tr);

    tr.querySelector('.ins-name').onchange = function () {
      var name = this.value;
      var u = STATE.users.filter(function (x) { return x.fullName === name; })[0];
      if (!u) return;
      tr.querySelector('.ins-position').value = u.position || '';
      tr.querySelector('.ins-cid').value = u.cid || '';
      tr.querySelector('.ins-email').value = u.email || '';
      tr.querySelector('.ins-userid').value = u.userId || '';
    };
    tr.querySelector('button').onclick = function () { tr.remove(); renumber(); };
    renumber();
  }

  function renumber() {
    ['itemsTbody', 'inspectorsTbody'].forEach(function (id) {
      Array.prototype.forEach.call($(id).children, function (tr, i) {
        var cell = tr.querySelector('.rowno');
        if (cell) cell.textContent = i + 1;
      });
    });
  }

  function calcTotal() {
    var total = 0;
    Array.prototype.forEach.call($('itemsTbody').querySelectorAll('.total'), function (el) { total += num(el.value); });
    $('itemsTotal').textContent = money(total);
    var plan = $('planAmount');
    if (!num(plan.value)) plan.value = total.toFixed(2);
  }

  function syncBudgetType() {
    var source = $('planBudgetSource').value;
    if (!source || $('budgetType').value) return;
    var map = (STATE.settings.budgetSourceTypes || []).filter(function (m) { return m.source === source; })[0];
    if (map) $('budgetType').value = map.budgetType;
  }

  /* ---------- เอกสารแนบ ---------- */

  function attachmentTypes() {
    return (STATE.meta.attachmentTypes && STATE.meta.attachmentTypes.length)
      ? STATE.meta.attachmentTypes
      : [{ key: 'BudgetPlan', label: 'แผนการใช้งบประมาณ', required: true }];
  }

  function renderAttachments(r) {
    $('attachmentGrid').innerHTML = attachmentTypes().map(function (t) {
      var names = splitLines(r ? r['Attachment' + t.key + 'FileNames'] : '');
      var urls = splitLines(r ? r['Attachment' + t.key + 'FileUrls'] : '');
      var ids = splitLines(r ? r['Attachment' + t.key + 'FileIds'] : '');
      var existing = ids.map(function (id, i) {
        return '<div class="file-row"><input type="checkbox" class="rmfile" data-key="' + esc(t.key) + '" data-id="' + esc(id) + '" title="เลือกเพื่อลบ">' +
          '<a href="' + esc(urls[i] || '#') + '" target="_blank" rel="noopener">' + esc(shortName(names[i] || id)) + '</a></div>';
      }).join('');

      return '<div class="attach-box' + (t.required ? ' required' : '') + '">' +
        '<div class="bold">' + esc(t.label) + (t.required ? ' <span style="color:#b91c1c">*</span>' : '') + '</div>' +
        '<div class="field mt"><label class="small">จำนวนแผ่น</label>' +
        '<input type="number" min="0" class="att-sheets" data-key="' + esc(t.key) + '" value="' + num(r ? r['Attachment' + t.key + 'Sheets'] : 0) + '"></div>' +
        '<input type="file" multiple class="att-files" data-key="' + esc(t.key) + '">' +
        '<div class="file-list mt">' + (existing || '<span class="muted small">ยังไม่มีไฟล์แนบ</span>') + '</div>' +
        (existing ? '<div class="muted small">ติ๊กหน้าไฟล์ที่ต้องการลบ แล้วกดบันทึก</div>' : '') +
        '</div>';
    }).join('');
  }

  function shortName(name) {
    var s = String(name || '');
    return s.length > 42 ? s.slice(0, 20) + '…' + s.slice(-18) : s;
  }

  function splitLines(v) {
    return String(v || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function collectAttachments() {
    var types = attachmentTypes();
    return Promise.all(types.map(function (t) {
      var input = document.querySelector('.att-files[data-key="' + t.key + '"]');
      return encodeFiles(input).then(function (encoded) {
        var sheets = document.querySelector('.att-sheets[data-key="' + t.key + '"]');
        var removeIds = Array.prototype.slice.call(document.querySelectorAll('.rmfile[data-key="' + t.key + '"]'))
          .filter(function (cb) { return cb.checked; })
          .map(function (cb) { return cb.getAttribute('data-id'); });
        return { key: t.key, value: { checked: 1, sheets: sheets ? num(sheets.value) : 0, files: encoded, removeFileIds: removeIds } };
      });
    })).then(function (list) {
      var out = {};
      list.forEach(function (x) { out[x.key] = x.value; });
      return out;
    });
  }

  /* ---------- บันทึกคำขอ ---------- */

  function buildPayload() {
    return collectAttachments().then(function (attachments) {
      return {
        requestId: STATE.currentRequestId,
        department: $('department').value, phone: $('phone').value,
        docNoText: $('docNoText').value, requestDate: $('requestDate').value,
        to: $('to').value, purchaseType: $('purchaseType').value,
        subject: $('subject').value, reason: $('reason').value,
        purposeRegular: $('purposeRegular').checked, purposeStock: $('purposeStock').checked,
        purposeProject: $('purposeProject').checked, projectName: $('projectName').value,
        officerOpinionAnnualUnder100k: $('officerOpinionAnnualUnder100k').checked,
        officerOpinionAnnualOver100k: $('officerOpinionAnnualOver100k').checked,
        officerMethod: $('officerMethod').value,
        officerMethodInProgress: $('officerMethodInProgress').checked,
        officerInProgressMethod: $('officerInProgressMethod').value,
        completionDays: $('completionDays').value, officerReason: $('officerReason').value,
        officerName: $('officerName').value, officerPosition: $('officerPosition').value,
        deptHeadName: $('deptHeadName').value, deptHeadPosition: $('deptHeadPosition').value,
        budgetType: $('budgetType').value, planBudgetSource: $('planBudgetSource').value,
        planInPlan: $('planInPlan').checked, planYear: $('planYear').value,
        planAmount: $('planAmount').value, planOther: $('planOther').value, planRemark: $('planRemark').value,
        approverName: $('approverName').value, approverPosition: $('approverPosition').value,
        notes: $('notes').value,
        items: Array.prototype.map.call($('itemsTbody').children, function (tr) {
          return {
            itemName: tr.querySelector('.item-name').value,
            planBalanceAmount: tr.querySelector('.plan').value,
            quantity: tr.querySelector('.qty').value,
            unit: tr.querySelector('.unit').value,
            unitPrice: tr.querySelector('.unitprice').value,
            totalPrice: tr.querySelector('.total').value,
            lastPrice: tr.querySelector('.lastprice').value
          };
        }).filter(function (x) { return x.itemName.trim(); }),
        inspectors: Array.prototype.map.call($('inspectorsTbody').children, function (tr) {
          return {
            fullName: tr.querySelector('.ins-name').value,
            position: tr.querySelector('.ins-position').value,
            cid: tr.querySelector('.ins-cid').value,
            email: tr.querySelector('.ins-email').value,
            userId: tr.querySelector('.ins-userid').value
          };
        }).filter(function (x) { return x.fullName.trim(); }),
        attachments: attachments
      };
    });
  }

  function saveRequest(alsoSubmit) {
    alertBox('formAlert', '');
    if (!$('subject').value.trim()) { alertBox('formAlert', 'กรุณากรอกเรื่องที่ขอความเห็นชอบ', 'danger'); return; }
    if (!$('reason').value.trim()) { alertBox('formAlert', 'กรุณากรอกเหตุผลและความจำเป็น', 'danger'); return; }

    busy('กำลังเตรียมไฟล์แนบ...');
    buildPayload()
      .then(function (payload) {
        idle();
        return api('saveRequest', { payload: payload, submit: alsoSubmit ? 1 : 0 },
          { message: alsoSubmit ? 'กำลังบันทึกและส่งให้พัสดุ...' : 'กำลังบันทึกคำขอ...', done: 'บันทึกเรียบร้อย' });
      })
      .then(function (res) {
        alertBox('formAlert', res.message, 'ok');
        STATE.currentRequestId = res.requestId;
        return reload().then(function () { return openRequest(res.requestId); });
      })
      .catch(function (err) {
        idle();
        alertBox('formAlert', err.message, 'danger');
      });
  }

  /* ---------- ตรวจสอบ / อนุมัติ / ล็อก ---------- */

  function review(action) {
    STATE.reviewAction = action;
    $('reviewTitle').textContent = action === 'pass' ? 'ยืนยันผ่านการตรวจสอบ' : 'ส่งกลับให้แก้ไข';
    $('reviewLabel').textContent = action === 'pass' ? 'หมายเหตุการตรวจสอบ (ถ้ามี)' : 'เหตุผลที่ส่งกลับแก้ไข (จำเป็น)';
    $('reviewRemark').value = action === 'pass' ? 'ตรวจสอบเอกสารครบถ้วนถูกต้อง' : '';
    $('reviewConfirm').className = 'btn ' + (action === 'pass' ? 'btn-ok' : 'btn-danger');
    alertBox('reviewAlert', '');
    $('reviewModal').classList.remove('hidden');
  }

  function confirmReview() {
    var remark = $('reviewRemark').value.trim();
    if (STATE.reviewAction === 'return' && !remark) {
      alertBox('reviewAlert', 'กรุณาระบุเหตุผลที่ส่งกลับแก้ไข เพื่อให้ผู้ยื่นคำขอแก้ไขได้ถูกต้อง', 'danger');
      return;
    }
    api('reviewRequest', { requestId: STATE.currentRequestId, result: STATE.reviewAction, remark: remark },
      { message: 'กำลังบันทึกผลการตรวจสอบ...', done: 'บันทึกผลเรียบร้อย' })
      .then(function (res) {
        closeModal('reviewModal');
        alertBox('formAlert', res.message, 'ok');
        return reload().then(function () { return openRequest(STATE.currentRequestId); });
      })
      .catch(function (err) { alertBox('reviewAlert', err.message, 'danger'); });
  }

  function openApprovalModal() {
    $('approvalDate').value = todayISO();
    $('approvalRemark').value = '';
    $('approvalFiles').value = '';
    alertBox('approvalAlert', '');
    $('approvalModal').classList.remove('hidden');
  }

  function submitApproval() {
    busy('กำลังอ่านไฟล์เอกสาร...');
    readFiles('approvalFiles')
      .then(function (files) {
        idle();
        if (!files.length) throw new Error('กรุณาแนบไฟล์เอกสารที่ลงนามอนุมัติแล้ว');
        return api('attachApproval', {
          requestId: STATE.currentRequestId, files: files,
          approvedAt: $('approvalDate').value, remark: $('approvalRemark').value
        }, { message: 'กำลังอัปโหลดและล็อกคำขอ...', done: 'บันทึกเอกสารอนุมัติแล้ว' });
      })
      .then(function (res) {
        closeModal('approvalModal');
        alertBox('formAlert', res.message, 'ok');
        return reload().then(function () { return openRequest(STATE.currentRequestId); });
      })
      .catch(function (err) { idle(); alertBox('approvalAlert', err.message, 'danger'); });
  }

  function toggleLock(lock) {
    var reason = lock ? 'ล็อกข้อมูลอีกครั้ง' : prompt('ระบุเหตุผลในการปลดล็อก (เพื่อบันทึกใน log)');
    if (!lock && !reason) return;
    api('setLock', { requestId: STATE.currentRequestId, locked: lock ? 1 : 0, reason: reason },
      { message: 'กำลังปรับสถานะการล็อก...', done: lock ? 'ล็อกแล้ว' : 'ปลดล็อกแล้ว' })
      .then(function () { return reload().then(function () { return openRequest(STATE.currentRequestId); }); });
  }

  function cancelRequest() {
    var remark = prompt('ระบุเหตุผลในการยกเลิกคำขอ');
    if (remark === null) return;
    api('cancelRequest', { requestId: STATE.currentRequestId, remark: remark },
      { message: 'กำลังยกเลิกคำขอ...', done: 'ยกเลิกคำขอแล้ว' })
      .then(function () { return reload().then(function () { return openRequest(STATE.currentRequestId); }); });
  }

  /* ==================== ติดตามความก้าวหน้า ==================== */

  function fillTrackSelect() {
    var el = $('trackRequestSelect');
    if (!el) return;
    var key = ($('trackSearch') ? $('trackSearch').value : '').toLowerCase().trim();
    var rows = (STATE.requests || []).filter(function (r) {
      if (!key) return true;
      return [r.requestNo, r.subject, r.department].join(' ').toLowerCase().indexOf(key) > -1;
    });
    var keep = el.value;
    el.innerHTML = '<option value="">— เลือกคำขอ —</option>' + rows.map(function (r) {
      return '<option value="' + esc(r.requestId) + '">' + esc(r.requestNo + ' : ' + r.subject) + '</option>';
    }).join('');
    if (keep) el.value = keep;
  }

  function openTrack(requestId) {
    showPage('track');
    $('trackRequestSelect').value = requestId;
    loadTrack();
  }

  function openTrackFromForm() {
    if (STATE.currentRequestId) openTrack(STATE.currentRequestId);
  }

  function loadTrack() {
    var requestId = $('trackRequestSelect').value;
    if (!requestId) { $('trackDetail').innerHTML = '<div class="card muted center">เลือกคำขอเพื่อดูความก้าวหน้า</div>'; return; }
    skeleton($('trackDetail'), 5);
    api('getRequest', { requestId: requestId }, { message: 'กำลังโหลดความก้าวหน้า...', done: '' })
      .then(function (res) { renderTrack(res); });
  }

  function renderTrack(res) {
    var r = res.request || {};
    var perm = res.permissions || {};
    var progress = res.progress || [];

    var html =
      '<div class="card"><div class="section-title">' + esc(r.RequestNo || '') + ' : ' + esc(r.Subject || '') +
      '<span>' + statusBadge(r.Status) + '</span></div>' +
      '<div class="grid grid-4">' +
      kv('กลุ่มงาน', r.Department) + kv('ผู้ยื่นคำขอ', r.CreatedByName) +
      kv('วงเงิน', money(r.TotalAmount) + ' บาท') + kv('ประเภทงบประมาณ', r.BudgetType) +
      kv('วันที่ยื่นคำขอ', thaiDate(r.SubmittedAt)) + kv('ผ่านการตรวจสอบ', thaiDate(r.CheckedAt)) +
      kv('ได้รับอนุมัติ', thaiDate(r.ApprovedAt)) + kv('แล้วเสร็จ', thaiDate(r.CompletedAt)) +
      '</div>' + stageTrack(r) +
      (splitLines(r.ApprovedDocFileUrls).length
        ? '<div class="mt"><b class="small">เอกสารอนุมัติที่ลงนามแล้ว</b><div class="file-list">' +
        splitLines(r.ApprovedDocFileUrls).map(function (u, i) {
          return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(shortName(splitLines(r.ApprovedDocFileNames)[i] || 'เอกสาร ' + (i + 1))) + '</a>';
        }).join('') + '</div></div>' : '') +
      '<div class="row-actions mt">' +
      (perm.canAddProgress ? '<button class="btn btn-primary btn-sm" id="btnAddProgress">➕ บันทึกความก้าวหน้า</button>' : '') +
      '<button class="btn btn-soft btn-sm" id="btnOpenFromTrack">เปิดรายละเอียดคำขอ</button>' +
      '</div></div>';

    html += '<div class="card"><div class="section-title">ไทม์ไลน์การดำเนินการ (' + count(progress.length) + ' รายการ)</div>' +
      (progress.length ? '<div class="timeline">' + progress.map(progressItem).join('') + '</div>'
        : '<div class="muted center">ยังไม่มีการบันทึกความก้าวหน้า</div>') + '</div>';

    $('trackDetail').innerHTML = html;

    var addBtn = $('btnAddProgress');
    if (addBtn) addBtn.onclick = function () { openProgress(r.RequestID, r.RequestNo + ' : ' + r.Subject, progress); };
    $('btnOpenFromTrack').onclick = function () { openRequest(r.RequestID); };

    Array.prototype.forEach.call($('trackDetail').querySelectorAll('[data-del-progress]'), function (btn) {
      btn.onclick = function () { deleteProgress(btn.getAttribute('data-del-progress')); };
    });
  }

  function kv(label, value) {
    return '<div><div class="muted small">' + esc(label) + '</div><div class="bold">' + esc(value || '-') + '</div></div>';
  }

  function progressItem(p) {
    return '<div class="tl-item done">' +
      '<div class="tl-head">' + esc(p.stage) + '</div>' +
      '<div class="tl-meta">' + esc(thaiDateTime(p.progressAt)) + ' • บันทึกโดย ' + esc(p.byName) +
      (p.canDelete ? ' <button class="btn btn-ghost btn-sm" data-del-progress="' + esc(p.progressId) + '">ลบ</button>' : '') + '</div>' +
      (p.note ? '<div class="note-block">' + esc(p.note) + '</div>' : '') +
      (p.supplyNote ? '<div class="note-block note-supply"><span class="note-tag">note พัสดุ (เห็นเฉพาะเจ้าหน้าที่พัสดุ)</span>' + esc(p.supplyNote) + '</div>' : '') +
      (p.myNote ? '<div class="note-block note-my"><span class="note-tag">my note (ส่วนตัว)</span>' + esc(p.myNote) + '</div>' : '') +
      ((p.fileUrls || []).length ? '<div class="file-list">' + p.fileUrls.map(function (u, i) {
        return '<a href="' + esc(u) + '" target="_blank" rel="noopener">📎 ' + esc(shortName((p.fileNames || [])[i] || 'ไฟล์ ' + (i + 1))) + '</a>';
      }).join('') + '</div>' : '') +
      '</div>';
  }

  function openProgress(requestId, title, progress) {
    STATE.progressRequestId = requestId;
    $('progressTitle').textContent = title || '';
    $('progressStage').value = '';
    $('progressDate').value = todayISO();
    $('progressTime').value = nowHM();
    $('progressNote').value = '';
    $('progressSupplyNote').value = '';
    $('progressMyNote').value = '';
    $('progressFiles').value = '';
    $('supplyNoteField').classList.toggle('hidden', !(STATE.user && STATE.user.isSupply));
    alertBox('progressAlert', '');
    renderProgressHistory(progress || []);
    $('progressModal').classList.remove('hidden');
  }

  function renderProgressHistory(progress) {
    $('progressHistory').innerHTML = progress.length
      ? '<div class="timeline">' + progress.map(progressItem).join('') + '</div>'
      : '<div class="muted center">ยังไม่มีการบันทึกความก้าวหน้า</div>';
  }

  function saveProgress() {
    var stage = $('progressStage').value;
    if (!stage) { alertBox('progressAlert', 'กรุณาเลือกขั้นตอนความก้าวหน้า', 'danger'); return; }
    var at = $('progressDate').value + ' ' + ($('progressTime').value || '00:00') + ':00';

    busy('กำลังเตรียมไฟล์แนบ...');
    readFiles('progressFiles')
      .then(function (files) {
        idle();
        return api('addProgress', {
          requestId: STATE.progressRequestId,
          data: {
            progressStatus: stage, progressAt: at,
            note: $('progressNote').value,
            supplyNote: $('progressSupplyNote').value,
            myNote: $('progressMyNote').value,
            files: files
          }
        }, { message: 'กำลังบันทึกความก้าวหน้า...', done: 'บันทึกความก้าวหน้าแล้ว' });
      })
      .then(function (res) {
        alertBox('progressAlert', res.message, 'ok');
        $('progressNote').value = ''; $('progressSupplyNote').value = ''; $('progressMyNote').value = '';
        $('progressFiles').value = '';
        renderProgressHistory(res.progress || []);
        return reload().then(function () {
          if ($('trackRequestSelect').value === STATE.progressRequestId) loadTrack();
        });
      })
      .catch(function (err) { idle(); alertBox('progressAlert', err.message, 'danger'); });
  }

  function deleteProgress(progressId) {
    if (!confirm('ยืนยันลบรายการความก้าวหน้านี้?')) return;
    api('deleteProgress', { progressId: progressId }, { message: 'กำลังลบ...', done: 'ลบแล้ว' })
      .then(function (res) {
        renderProgressHistory(res.progress || []);
        loadTrack();
      });
  }

  /* ==================== ตั้งค่า ==================== */

  function renderSettings() {
    if (!STATE.user || !STATE.user.isSuperAdmin) return;
    var s = STATE.settings || {};

    fillMembers('roleSupplyOfficer', s.supplyOfficers);
    fillMembers('roleSupplyHead', s.supplyHeads);
    fillMembers('roleSuperAdmin', s.superAdmins);

    $('settingsTbody').innerHTML = (s.raw || []).map(function (row) {
      return '<tr><td>' + esc(row.category) + '</td><td>' + esc(row.label) + '</td><td>' + esc(row.value) + '</td>' +
        '<td><button class="btn btn-danger btn-sm" data-del-setting="' + esc(row.settingId) + '">ลบ</button></td></tr>';
    }).join('') || '<tr><td colspan="4" class="center muted">ไม่มีข้อมูล</td></tr>';

    Array.prototype.forEach.call($('settingsTbody').querySelectorAll('[data-del-setting]'), function (btn) {
      btn.onclick = function () { deleteSetting(btn.getAttribute('data-del-setting')); };
    });

    var def = s.defaults || {};
    $('cfgExportId').value = def.ExportSpreadsheetId || '';
    $('cfgExportPrefix').value = def.ExportSheetPrefix || 'Supply_';
    $('cfgExportKey').value = def.ExportApiKey || '';
    $('cfgNotifyEmail').value = def.NotifyEmail === '1' ? '1' : '0';
  }

  function fillMembers(selectId, members) {
    var selected = (members || []).map(function (m) { return m.userId; });
    $(selectId).innerHTML = STATE.users.map(function (u) {
      return '<option value="' + esc(u.userId) + '"' + (selected.indexOf(u.userId) > -1 ? ' selected' : '') + '>' +
        esc(u.fullName + ' — ' + (u.department || '')) + '</option>';
    }).join('');
  }

  function saveRoleMembers() {
    var jobs = [
      ['SupplyOfficer', 'roleSupplyOfficer'],
      ['SupplyHead', 'roleSupplyHead'],
      ['SuperAdmin', 'roleSuperAdmin']
    ];
    var chain = Promise.resolve();
    jobs.forEach(function (job) {
      chain = chain.then(function () {
        var ids = Array.prototype.filter.call($(job[1]).options, function (o) { return o.selected; })
          .map(function (o) { return o.value; });
        return api('setRoleMembers', { category: job[0], userIds: ids },
          { message: 'กำลังบันทึกสิทธิ ' + job[0] + '...', done: '' })
          .then(function (res) { STATE.settings = res.settings; });
      });
    });
    chain.then(function () { idle('บันทึกรายชื่อผู้มีสิทธิเรียบร้อย'); return reload(); })
      .catch(function () { });
  }

  function saveSetting() {
    var item = { category: $('setCategory').value, label: $('setLabel').value, value: $('setValue').value };
    api('saveSetting', { item: item }, { message: 'กำลังบันทึกตัวเลือก...', done: 'บันทึกตัวเลือกแล้ว' })
      .then(function (res) {
        STATE.settings = res.settings;
        $('setLabel').value = ''; $('setValue').value = '';
        renderSettings(); fillStaticOptions();
      });
  }

  function deleteSetting(settingId) {
    if (!confirm('ยืนยันลบตัวเลือกนี้?')) return;
    api('deleteSetting', { settingId: settingId }, { message: 'กำลังลบ...', done: 'ลบตัวเลือกแล้ว' })
      .then(function (res) { STATE.settings = res.settings; renderSettings(); fillStaticOptions(); });
  }

  function saveExportConfig() {
    var items = [
      { category: 'Default', label: 'ExportSpreadsheetId', value: $('cfgExportId').value.trim() },
      { category: 'Default', label: 'ExportSheetPrefix', value: $('cfgExportPrefix').value.trim() || 'Supply_' },
      { category: 'Default', label: 'ExportApiKey', value: $('cfgExportKey').value.trim() },
      { category: 'Default', label: 'NotifyEmail', value: $('cfgNotifyEmail').value }
    ];
    var existing = (STATE.settings.raw || []);
    var chain = Promise.resolve();
    items.forEach(function (item) {
      chain = chain.then(function () {
        var found = existing.filter(function (r) { return r.category === 'Default' && r.label === item.label; })[0];
        if (found) item.settingId = found.settingId;
        return api('saveSetting', { item: item }, { message: 'กำลังบันทึก ' + item.label + '...', done: '' })
          .then(function (res) { STATE.settings = res.settings; });
      });
    });
    chain.then(function () { idle('บันทึกการตั้งค่าเรียบร้อย'); renderSettings(); }).catch(function () { });
  }

  function syncExport() {
    api('syncExport', {}, { message: 'กำลังส่งข้อมูลไป Sheet ปลายทาง...', done: 'ส่งข้อมูลเรียบร้อย' })
      .then(function (res) { alert(res.message); });
  }

  function loadLogs() {
    if (!STATE.user || !STATE.user.isSuperAdmin) return;
    skeleton($('logsTbody'), 1);
    api('listLogs', { limit: 400 }, { message: 'กำลังโหลดประวัติการใช้งาน...', done: '' })
      .then(function (res) {
        $('logsTbody').innerHTML = (res.logs || []).map(function (l) {
          return '<tr><td class="nowrap small">' + esc(l.timestamp) + '</td><td>' + esc(l.userName) + '</td>' +
            '<td><span class="badge badge-gray">' + esc(l.action) + '</span></td>' +
            '<td class="small">' + esc(l.requestId || '-') + '</td><td class="small">' + esc(l.detail) + '</td></tr>';
        }).join('') || '<tr><td colspan="5" class="center muted">ไม่มีข้อมูล</td></tr>';
      });
  }

  /* ==================== ส่งออก Excel ==================== */

  function exportExcel() {
    busy('กำลังเตรียมข้อมูลและไลบรารี...');
    Promise.all([
      api('exportRows', { filters: currentFilters() }, { message: false }),
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js')
    ]).then(function (results) {
      var data = results[0];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.requests || []), 'คำขอ');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.items || []), 'รายการพัสดุ');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.progress || []), 'ความก้าวหน้า');
      XLSX.writeFile(wb, 'รายงานพัสดุ_' + todayISO() + '.xlsx');
      idle('ส่งออก Excel เรียบร้อย');
    }).catch(function (err) { idle(err.message || 'ส่งออกไม่สำเร็จ', true); });
  }

  /* ==================== พิมพ์เอกสาร ==================== */

  function openPrint() {
    if (!STATE.detail) return;
    STATE.printKind = 'request';
    $('printTitle').textContent = 'แบบขอความเห็นชอบซื้อ/จ้าง';
    $('printArea').innerHTML = renderMemo(STATE.detail);
    $('printModal').classList.remove('hidden');
  }

  function printDashboard() {
    STATE.printKind = 'dashboard';
    $('printTitle').textContent = 'รายงานสรุปเสนอผู้บริหาร';
    $('printArea').innerHTML = renderExecutiveReport();
    $('printModal').classList.remove('hidden');
  }

  function closePrint() {
    $('printModal').classList.add('hidden');
    $('printArea').innerHTML = '';
  }

  function box(v) { return (v == 1 || v === true) ? '☑' : '☐'; }
  function dot(width, value) {
    return '<span class="dotline" style="min-width:' + width + '">' + esc(value || '') + '</span>';
  }

  function renderMemo(data) {
    var r = data.request || {};
    var items = data.items || [];
    var inspectors = data.inspectors || [];
    var sig = data.creatorSignature || '';

    var itemRows = items.map(function (it, i) {
      return '<tr><td class="center">' + thNum(i + 1) + '</td><td>' + esc(it.ItemName) + '</td>' +
        '<td class="right">' + thNum(money(it.PlanBalanceAmount)) + '</td>' +
        '<td class="right">' + thNum(count(it.Quantity)) + '</td>' +
        '<td class="center">' + esc(it.Unit) + '</td>' +
        '<td class="right">' + thNum(money(it.UnitPrice)) + '</td>' +
        '<td class="right">' + thNum(money(it.TotalPrice)) + '</td>' +
        '<td class="right">' + thNum(money(it.LastPrice)) + '</td></tr>';
    }).join('') || '<tr><td colspan="8">&nbsp;</td></tr>';

    var insRows = [0, 1, 2].map(function (i) {
      var ins = inspectors[i] || {};
      return '<div>' + thNum(i + 1) + '. ' + dot('92mm', ins.FullName) + 'ตำแหน่ง' + dot('61mm', ins.Position) + '</div>' +
        '<div>หมายเลขบัตรประชาชน' + dot('58mm', thNum(ins.CID || '')) + ' E-mail : ' + dot('52mm', ins.Email) + '</div>';
    }).join('');

    var attachLine = attachmentTypes().map(function (t) {
      var has = r['Attachment' + t.key] == 1 || splitLines(r['Attachment' + t.key + 'FileIds']).length > 0;
      return box(has) + ' ' + esc(t.label) + ' จำนวน ' + thNum(count(r['Attachment' + t.key + 'Sheets'])) + ' แผ่น';
    }).join(' &nbsp; ');

    var signatureImg = sig
      ? '<img class="signature-img" src="' + esc(sig.indexOf('data:') === 0 ? sig : 'data:image/png;base64,' + sig) + '" alt="">'
      : 'ลงชื่อ................................................ผู้ขอใช้';

    return '<div class="print-page" id="printPage">' +
      '<div style="display:grid;grid-template-columns:30mm 1fr 30mm;align-items:start">' +
      '<div class="garuda-wrap"><img class="garuda-img" src="' + esc(CFG.GARUDA_URL) + '" alt=""></div>' +
      '<div class="memo-title">บันทึกข้อความ</div><div></div></div>' +

      '<div class="memo-row"><span class="bold">ส่วนราชการ</span> ' + dot('102mm', r.Department) +
      '<span class="bold">โทร.</span> ' + dot('38mm', thNum(r.Phone || '')) + '</div>' +
      '<div class="memo-row"><span class="bold">ที่</span> ' + dot('78mm', thNum(r.DocNoText || 'นย')) +
      '<span class="bold">วันที่</span>' + dot('75mm', thNum(thaiDate(r.RequestDate))) + '</div>' +
      '<div class="memo-row"><span class="bold">เรื่อง</span> ขอความเห็นชอบ' + esc(r.PurchaseType || 'ซื้อ/จ้าง') +
      ' <span style="border-bottom:1px dotted #111">' + esc(r.Subject) + '</span></div>' +
      '<hr class="top-rule">' +
      '<div class="memo-row"><span class="bold">เรียน</span> ' + esc(r.To || 'นายแพทย์สาธารณสุขจังหวัดนครนายก') + '</div>' +

      '<div class="memo-row indent">ด้วย' + dot('45mm', r.Department) + 'มีความประสงค์ขอความเห็นชอบ' +
      esc(r.PurchaseType || 'ซื้อ/จ้าง') + ' <span style="border-bottom:1px dotted #111">' + esc(r.Subject) + '</span></div>' +
      '<div class="memo-row">จำนวน ' + thNum(items.length) + ' รายการ โดยมีเหตุผลและความจำเป็น <span style="border-bottom:1px dotted #111">' +
      esc(r.Reason) + '</span></div>' +
      '<div class="memo-row">ซึ่ง ' + box(r.PurposeRegular) + ' ใช้ในงานประจำ ' + box(r.PurposeStock) + ' สำรองคลัง ' +
      box(r.PurposeProject) + ' ใช้ในโครงการ <span style="border-bottom:1px dotted #111">' + esc(r.ProjectName) +
      '</span> (ตามสำเนาที่แนบท้ายมาด้วย) มีรายละเอียดดังนี้</div>' +

      '<table class="print-table">' +
      '<colgroup><col style="width:10mm"><col style="width:44mm"><col style="width:23mm"><col style="width:17mm">' +
      '<col style="width:18mm"><col style="width:23mm"><col style="width:25mm"><col style="width:23mm"></colgroup>' +
      '<thead>' +
      '<tr><th rowspan="2">ลำดับ</th><th rowspan="2">รายการ</th>' +
      '<th rowspan="2">คงเหลือ<br>ยกมาตามแผน<br>(บาท)</th>' +
      '<th colspan="4">ความต้องการ' + esc(r.PurchaseType || 'ซื้อ/จ้าง') + 'ครั้งนี้</th>' +
      '<th rowspan="2">ราคาซื้อ<br>หลังสุด</th></tr>' +
      '<tr><th>จำนวน</th><th>หน่วยนับ</th><th>ราคา/หน่วย</th><th>ราคารวม</th></tr>' +
      '</thead><tbody>' + itemRows + '</tbody>' +
      '<tfoot><tr><th colspan="6" class="right">ราคารวม</th><th class="right">' + thNum(money(r.TotalAmount)) + '</th><th></th></tr></tfoot></table>' +

      '<div class="memo-row print-small">พร้อมนี้ได้แนบ ' + attachLine + '</div>' +
      '<div class="memo-row">และขอแต่งตั้งคณะกรรมการตรวจรับพัสดุ/ผู้ตรวจรับพัสดุ ดังนี้</div>' +
      '<div class="print-small">' + insRows + '</div>' +
      '<div class="memo-row">จึงเรียนมาเพื่อโปรดพิจารณาและเห็นชอบต่อไป</div>' +

      '<table class="sign-table"><tr><td class="sig-left">' +
      '<div class="sig-block">' + signatureImg + '</div>' +
      '<div class="sign-center">( ' + esc(r.CreatedByName) + ' )</div>' +
      '<div class="sign-center">' + esc(r.CreatedByPosition) + '</div>' +
      '<div class="sig-block">ลงชื่อ................................................หัวหน้ากลุ่มงาน</div>' +
      '<div class="sign-center">( ' + esc(r.DeptHeadName) + ' )</div>' +
      '<div class="bold" style="margin-top:6px">ความเห็นของงานแผน/กลุ่มงานยุทธศาสตร์ฯ</div>' +
      '<div>' + box(r.PlanInPlan) + ' ในแผนปี พ.ศ. ' + dot('31mm', thNum(r.PlanYear || '')) + '</div>' +
      '<div>ประเภทงบประมาณ ' + dot('52mm', r.BudgetType) + '</div>' +
      '<div>จัดซื้อด้วยเงิน' + dot('60mm', r.PlanBudgetSource) + '</div>' +
      '<div>จำนวนเงิน' + dot('63mm', thNum(money(r.PlanAmount || r.TotalAmount))) + 'บาท</div>' +
      '<div style="margin-top:3px">' + dot('100%', r.PlanRemark) + '</div>' +
      '</td><td class="sig-right print-small">' +
      '<div class="center bold">ความเห็นของเจ้าหน้าที่/หัวหน้าเจ้าหน้าที่</div>' +
      '<div>' + box(r.OfficerOpinionAnnualUnder100k) + ' เป็นวัสดุสิ้นเปลืองมูลค่าการจัดซื้อทั้งปี ไม่เกิน ๑ แสนบาท</div>' +
      '<div>' + box(r.OfficerOpinionAnnualOver100k) + ' เป็นวัสดุสิ้นเปลืองมูลค่าการจัดซื้อทั้งปี เกิน ๑ แสนบาท</div>' +
      '<div>' + box(r.OfficerMethod === 'เฉพาะเจาะจง') + ' เห็นควรจัดซื้อ/จ้างโดยวิธีเฉพาะเจาะจง</div>' +
      '<div>' + box(r.OfficerMethod === 'คัดเลือก') + ' เห็นควรจัดซื้อ/จ้างโดยวิธีคัดเลือก</div>' +
      '<div>' + box(String(r.OfficerMethod || '').indexOf('e-market') > -1) + ' วิธีตลาดอิเล็กทรอนิกส์ (e-market)</div>' +
      '<div>' + box(String(r.OfficerMethod || '').indexOf('e-bidding') > -1) + ' วิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)</div>' +
      '<div>' + box(r.OfficerMethodInProgress) + ' เฉพาะเจาะจงก่อน เนื่องจากอยู่ระหว่างดำเนินการโดยวิธี ' +
      box(r.OfficerInProgressMethod === 'e-market') + ' e-market ' + box(r.OfficerInProgressMethod === 'e-bidding') + ' e-bidding</div>' +
      '<div>กำหนดแล้วเสร็จประมาณ' + dot('18mm', thNum(count(r.CompletionDays))) + 'วัน นับถัดจากวันที่ได้รับใบสั่งซื้อ/สั่งจ้าง</div>' +
      '<div>' + esc(r.OfficerReason) + '</div>' +
      '<div class="sig-block">ลงชื่อ.......................................เจ้าหน้าที่</div>' +
      '<div class="sign-center">( ' + esc(r.OfficerName) + ' )</div>' +
      '<div class="sig-block">ลงชื่อ.......................................หัวหน้าเจ้าหน้าที่</div>' +
      '<div class="sign-center">( ' + esc(r.DeptHeadName) + ' )</div>' +
      '<div class="approval">เห็นชอบ</div>' +
      '<div class="sig-block">ลงชื่อ.......................................</div>' +
      '<div class="sign-center">( ' + esc(r.ApproverName || '.....................................................') + ' )</div>' +
      '<div class="sign-center">' + esc(r.ApproverPosition || 'นายแพทย์สาธารณสุขจังหวัดนครนายก') + '</div>' +
      '</td></tr></table></div>';
  }

  function renderExecutiveReport() {
    var d = STATE.dashboard || {};
    var dur = d.durations || {};
    var rows = function (list) {
      return (list || []).map(function (r) {
        return '<tr><td>' + esc(r.label) + '</td><td class="right">' + thNum(count(r.count)) + '</td><td class="right">' + thNum(money(r.amount)) + '</td></tr>';
      }).join('') || '<tr><td colspan="3" class="center">ไม่มีข้อมูล</td></tr>';
    };
    var durRow = function (label, v) {
      v = v || {};
      return '<tr><td>' + esc(label) + '</td><td class="right">' + thNum(count(v.count)) + '</td><td class="right">' +
        thNum(count(v.avg)) + '</td><td class="right">' + thNum(count(v.min)) + '</td><td class="right">' + thNum(count(v.max)) + '</td></tr>';
    };

    return '<div class="print-page exec-report" id="printPage">' +
      '<h1>รายงานสรุปการเสนอความต้องการพัสดุ</h1>' +
      '<div class="center">' + esc(CFG.ORG_NAME) + '</div>' +
      '<div class="center">ข้อมูล ณ วันที่ ' + thNum(thaiDate(todayISO())) + '</div>' +
      '<div class="kpi-print">' +
      '<div>คำขอทั้งหมด<b>' + thNum(count(d.total)) + '</b>เรื่อง</div>' +
      '<div>วงเงินรวม<b>' + thNum(money(d.totalAmount)) + '</b>บาท</div>' +
      '<div>อนุมัติแล้ว<b>' + thNum(money(d.approvedAmount)) + '</b>บาท</div>' +
      '<div>แล้วเสร็จ<b>' + thNum(count((d.counters || {}).completed)) + '</b>เรื่อง</div>' +
      '</div>' +
      '<div class="bold">๑. ระยะเวลาดำเนินการ (วัน)</div>' +
      '<table class="print-table"><thead><tr><th>ช่วง</th><th>จำนวนเรื่อง</th><th>เฉลี่ย</th><th>เร็วสุด</th><th>ช้าสุด</th></tr></thead><tbody>' +
      durRow('ยื่นคำขอ → ตรวจสอบเสร็จ', dur.submitToCheck) +
      durRow('ยื่นคำขอ → ได้รับอนุมัติ', dur.submitToApprove) +
      durRow('อนุมัติ → ตรวจรับเสร็จ', dur.approveToComplete) +
      durRow('ยื่นคำขอ → แล้วเสร็จ', dur.submitToComplete) +
      '</tbody></table>' +
      '<div class="bold">๒. แยกตามปีงบประมาณ</div>' +
      '<table class="print-table"><thead><tr><th>ปีงบประมาณ</th><th>จำนวนเรื่อง</th><th>วงเงินรวม</th></tr></thead><tbody>' + rows(d.byYear) + '</tbody></table>' +
      '<div class="bold">๓. แยกตามกลุ่มงาน</div>' +
      '<table class="print-table"><thead><tr><th>กลุ่มงาน</th><th>จำนวนเรื่อง</th><th>วงเงินรวม</th></tr></thead><tbody>' + rows((d.byDepartment || []).slice(0, 20)) + '</tbody></table>' +
      '<div class="bold">๔. แยกตามขั้นตอนของพัสดุ</div>' +
      '<table class="print-table"><thead><tr><th>ขั้นตอน</th><th>จำนวนเรื่อง</th><th>วงเงินรวม</th></tr></thead><tbody>' + rows(d.byStage) + '</tbody></table>' +
      '<div style="margin-top:18mm;text-align:right">ลงชื่อ............................................................ผู้รายงาน</div>' +
      '</div>';
  }

  function downloadPdf() {
    var page = $('printPage');
    if (!page) return;
    busy('กำลังสร้างไฟล์ PDF...');
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js')
      .then(function () {
        return html2pdf().set({
          margin: 0,
          filename: printFileName() + '.pdf',
          image: { type: 'jpeg', quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(page).save();
      })
      .then(function () { idle('บันทึก PDF เรียบร้อย'); })
      .catch(function (err) { idle(err.message || 'สร้าง PDF ไม่สำเร็จ', true); });
  }

  function downloadWord() {
    var html = $('printArea').innerHTML;
    if (!html) return;
    busy('กำลังสร้างไฟล์ Word...');
    var doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' +
      '<head><meta charset="utf-8"><style>' +
      '@page{size:A4 portrait;margin:8.5mm 10.5mm 7mm 10.5mm}' +
      'body{font-family:"TH Sarabun New","Sarabun",Arial,sans-serif;font-size:15.5pt;line-height:1.10;color:#000}' +
      '.print-page{width:100%}.garuda-img{height:14mm;width:auto}' +
      '.memo-title{text-align:center;font-size:26pt;font-weight:bold}' +
      '.dotline{border-bottom:1px dotted #111;display:inline-block}.memo-row{margin:2px 0}' +
      '.print-table{width:100%;border-collapse:collapse;font-size:13pt}' +
      '.print-table th,.print-table td{border:1px solid #000;padding:2px 3px}' +
      '.center{text-align:center}.right{text-align:right}.bold{font-weight:bold}' +
      '.sign-table{width:100%}.sign-table td{border:0;vertical-align:top}' +
      '.sign-center{text-align:center}.print-small{font-size:14pt}' +
      '.sig-block{min-height:12mm;text-align:center}' +
      '</style></head><body>' + html + '</body></html>';
    var blob = new Blob(['﻿', doc], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = printFileName() + '.doc';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); idle('บันทึก Word เรียบร้อย'); }, 800);
  }

  function printFileName() {
    if (STATE.printKind === 'dashboard') return 'รายงานสรุปพัสดุ_' + todayISO();
    var r = (STATE.detail && STATE.detail.request) || {};
    return 'คำขอพัสดุ_' + (r.RequestNo || todayISO());
  }

  function closeModal(id) { $(id).classList.add('hidden'); }

  /* ==================== ผูก API สาธารณะ ==================== */

  window.App = {
    saveEndpoint: saveEndpoint, login: login, logout: logout, showLogin: showLogin,
    viewPublicDashboard: viewPublicDashboard, reload: reload,
    showPage: showPage, toggleSidebar: toggleSidebar,
    applyFilters: applyFilters, clearFilters: clearFilters,
    renderList: renderList, openRequest: openRequest, newRequest: newRequest,
    addItemRow: addItemRow, addInspectorRow: addInspectorRow, syncBudgetType: syncBudgetType,
    saveRequest: saveRequest, review: review, confirmReview: confirmReview,
    openApprovalModal: openApprovalModal, submitApproval: submitApproval,
    toggleLock: toggleLock, cancelRequest: cancelRequest,
    openTrack: openTrack, openTrackFromForm: openTrackFromForm, loadTrack: loadTrack,
    fillTrackSelect: fillTrackSelect, saveProgress: saveProgress, deleteProgress: deleteProgress,
    saveRoleMembers: saveRoleMembers, saveSetting: saveSetting, saveExportConfig: saveExportConfig,
    syncExport: syncExport, loadLogs: loadLogs,
    exportExcel: exportExcel, openPrint: openPrint, printDashboard: printDashboard,
    closePrint: closePrint, downloadPdf: downloadPdf, downloadWord: downloadWord,
    closeModal: closeModal
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
