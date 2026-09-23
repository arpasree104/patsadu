/**
 * สร้างโครงเอกสาร PDF ของ "แบบขอความเห็นชอบซื้อ/จ้าง" สำหรับ pdfmake
 * แยกเป็นไฟล์ต่างหากเพื่อให้ทดสอบการวางหน้าได้โดยไม่ต้องเปิดเบราว์เซอร์
 *
 * ขนาดทั้งหมดเป็นหน่วย point (1 pt = 1/72 นิ้ว) — A4 = 595.28 x 841.89 pt
 * ฟอนต์ Sarabun ไม่มีอักขระช่องติ๊ก (U+2610/U+2611) จึงวาดด้วย canvas แทน
 */
(function (global) {
  'use strict';

  var PAGE_MARGIN = [56.7, 34, 42.5, 28.35]; // ซ้าย บน ขวา ล่าง (2 / 1.2 / 1.5 / 1 ซม.)
  var CONTENT_WIDTH = 595.28 - PAGE_MARGIN[0] - PAGE_MARGIN[2];
  var DOT = { dash: { length: 1.2, space: 1.3 } };

  // ช่วงอักขระไทยที่ต้องเกาะกับพยัญชนะตัวหน้า (สระบน-ล่าง วรรณยุกต์) และสระหน้า
  var THAI_COMBINING = /[ัิ-ฺ็-๎]/;
  var THAI_LEAD_VOWEL = /[เ-ไ]/;
  var THAI_CHAR = /[ก-๛]/;

  /**
   * pdfmake ตัดบรรทัดภาษาไทยไม่ได้เพราะไม่มีช่องว่างคั่นคำ ข้อความยาวจึงล้นขอบกระดาษ
   * จึงแทรก zero-width space ระหว่างพยางค์ เพื่อให้มีจุดตัดบรรทัดโดยสระและวรรณยุกต์ไม่หลุดจากพยัญชนะ
   */
  function thaiBreak(value) {
    var s = String(value === null || value === undefined ? '' : value);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], next = s[i + 1];
      out += ch;
      if (!next) continue;
      if (ch === '@' && /[A-Za-z0-9]/.test(next)) { out += '​'; continue; }
      if (/[._\-\/]/.test(ch) && /[A-Za-z]/.test(next)) { out += '​'; continue; }
      if (!THAI_CHAR.test(ch) || !THAI_CHAR.test(next)) continue;
      if (THAI_COMBINING.test(next) || THAI_LEAD_VOWEL.test(ch)) continue;
      out += '​';
    }
    return out;
  }

  /** เดินทั้งโครงเอกสารแล้วใส่จุดตัดบรรทัดให้ทุกข้อความ (รวมถึงข้อความที่เป็น run หลายชิ้นในอาร์เรย์ text: [...]) */
  function applyThaiBreak(node) {
    if (Array.isArray(node)) { node.forEach(applyThaiBreak); return node; }
    if (!node || typeof node !== 'object') return node;
    if (typeof node.text === 'string') node.text = thaiBreak(node.text);
    else if (Array.isArray(node.text)) applyThaiBreak(node.text);
    ['columns', 'stack', 'content', 'table'].forEach(function (key) {
      if (node[key]) applyThaiBreak(node[key]);
    });
    if (node.body) applyThaiBreak(node.body);
    return node;
  }

  function truthy(v) {
    if (v === true) return true;
    var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
    return !!s && s !== '0' && s !== 'false';
  }

  /** ช่องติ๊กวาดด้วยเส้น ให้หน้าตาเหมือนแบบฟอร์มและไม่ขึ้นกับฟอนต์ */
  function cb(checked, size) {
    var s = size || 8.5;
    var top = size ? 3 : 4;
    var shapes = [{ type: 'rect', x: 0, y: top, w: s, h: s, lineWidth: 0.7, lineColor: '#000' }];
    if (truthy(checked)) {
      shapes.push(
        { type: 'line', x1: s * 0.2, y1: top + s * 0.5, x2: s * 0.42, y2: top + s * 0.78, lineWidth: 1.1 },
        { type: 'line', x1: s * 0.42, y1: top + s * 0.78, x2: s * 0.84, y2: top + s * 0.18, lineWidth: 1.1 }
      );
    }
    return { width: s + 2.5, canvas: shapes };
  }

  /** ช่องเติมข้อความที่มีเส้นประอยู่ใต้บรรทัด — ใช้กับฟิลด์สั้นๆ ที่วางเป็นคอลัมน์คงที่เท่านั้น */
  function uline(text, width, options) {
    options = options || {};
    return {
      width: width || '*',
      table: {
        widths: ['*'],
        body: [[{
          text: text === null || text === undefined || text === '' ? ' ' : String(text),
          alignment: options.alignment || 'left',
          noWrap: !!options.noWrap,
          fontSize: options.fontSize
        }]]
      },
      layout: {
        hLineWidth: function (i) { return i === 1 ? 0.7 : 0; },
        vLineWidth: function () { return 0; },
        hLineStyle: function () { return DOT; },
        paddingLeft: function () { return 3; },
        paddingRight: function () { return 3; },
        paddingTop: function () { return 0; },
        paddingBottom: function () { return 0; }
      }
    };
  }

  /**
   * เติมค่าใน run ข้อความที่ไหลเป็นคอลัมน์เดียว (ตัดบรรทัดได้เอง ไม่ล้นขอบกระดาษ)
   * ใช้ตัวหนาเน้นค่าที่กรอก แทนขีดเส้นใต้ เพราะ decoration:'underline' ของ pdfmake ลากเส้นเลอะ
   * ไปทับข้อความ run อื่นที่อยู่บรรทัดเดียวกันโดยไม่ตั้งใจ (ตรวจสอบแล้วด้วยการเรนเดอร์จริง)
   */
  function fillRun(text) {
    return { text: (text === null || text === undefined || text === '' ? ' ' : String(text)), bold: true };
  }

  function label(text) {
    return { width: 'auto', text: text, bold: true, fontSize: 16, noWrap: true };
  }

  function plain(text, options) {
    options = options || {};
    return {
      width: options.width || 'auto',
      text: text,
      noWrap: true,
      fontSize: options.fontSize,
      alignment: options.alignment
    };
  }

  function row(columns, marginBottom) {
    return { columns: columns, columnGap: 3, margin: [0, 0, 0, marginBottom === undefined ? 2 : marginBottom] };
  }

  /** บรรทัดลงนาม: ลงชื่อ …เส้นประ… ตำแหน่ง */
  function signLine(role, fontSize) {
    return {
      columns: [
        plain('ลงชื่อ', { fontSize: fontSize }),
        uline('', '*', { fontSize: fontSize }),
        plain(role, { fontSize: fontSize })
      ],
      columnGap: 2,
      margin: [0, 0, 0, 1]
    };
  }

  function nameLine(name, fontSize, marginBottom) {
    return {
      text: '( ' + (name || '                                        ') + ' )',
      alignment: 'center',
      fontSize: fontSize,
      margin: [0, 0, 0, marginBottom === undefined ? 10 : marginBottom]
    };
  }

  var ITEM_LAYOUT = {
    hLineWidth: function () { return 0.8; },
    vLineWidth: function () { return 0.8; },
    paddingLeft: function () { return 3; },
    paddingRight: function () { return 3; },
    paddingTop: function () { return 1; },
    paddingBottom: function () { return 1; }
  };

  /**
   * @param {object} data ผลลัพธ์จาก action getRequest ( { request, items, inspectors, permissions } )
   * @param {object} fmt  ตัวช่วยจัดรูปแบบ { thNum, money, count, thaiDate }
   * @param {string} garudaDataUrl รูปครุฑเป็น data URL (ไม่มีก็เว้นช่องว่างไว้)
   */
  function buildMemoDoc(data, fmt, garudaDataUrl) {
    var r = (data && data.request) || {};
    var items = (data && data.items) || [];
    var inspectors = (data && data.inspectors) || [];
    var official = ((data && data.permissions) || {}).isOfficialCopy;

    var thNum = fmt.thNum, money = fmt.money, count = fmt.count, thaiDate = fmt.thaiDate;
    var SM = 11.5; // ขนาดตัวอักษรคอลัมน์ความเห็นเจ้าหน้าที่
    var IF = 11.5; // ขนาดตัวอักษรรายชื่อกรรมการตรวจรับ

    var sheets = function (key) { return thNum(count(r['Attachment' + key + 'Sheets'])); };
    var has = function (key) {
      return r['Attachment' + key] == 1 || String(r['Attachment' + key + 'FileIds'] || '').trim() !== '';
    };

    /* ---------- ตารางรายการพัสดุ ---------- */
    var body = [
      [
        { text: 'ลำดับ', rowSpan: 2, alignment: 'center', bold: true, margin: [0, 9, 0, 0] },
        { text: 'รายการ', rowSpan: 2, alignment: 'center', bold: true, margin: [0, 9, 0, 0] },
        { text: 'คงเหลือ\nยกมาตามแผน\n(บาท)', rowSpan: 2, alignment: 'center', bold: true },
        { text: 'ความต้องการซื้อ/จ้างครั้งนี้', colSpan: 4, alignment: 'center', bold: true }, {}, {}, {},
        { text: 'ราคาซื้อ\nหลังสุด', rowSpan: 2, alignment: 'center', bold: true, margin: [0, 5, 0, 0] }
      ],
      [
        {}, {}, {},
        { text: 'จำนวน', alignment: 'center', bold: true },
        { text: 'หน่วยนับ', alignment: 'center', bold: true },
        { text: 'ราคา/หน่วย', alignment: 'center', bold: true },
        { text: 'ราคารวม', alignment: 'center', bold: true },
        {}
      ]
    ];

    items.forEach(function (it, i) {
      body.push([
        { text: thNum(i + 1), alignment: 'center' },
        { text: String(it.ItemName || '') },
        { text: thNum(money(it.PlanBalanceAmount)), alignment: 'right' },
        { text: thNum(count(it.Quantity)), alignment: 'right' },
        { text: String(it.Unit || ''), alignment: 'center' },
        { text: thNum(money(it.UnitPrice)), alignment: 'right' },
        { text: thNum(money(it.TotalPrice)), alignment: 'right' },
        { text: thNum(money(it.LastPrice)), alignment: 'right' }
      ]);
    });
    for (var blank = items.length; blank < 3; blank++) {
      body.push([' ', '', '', '', '', '', '', '']);
    }
    body.push([
      { text: 'ราคารวม', colSpan: 6, alignment: 'right', bold: true }, {}, {}, {}, {}, {},
      { text: thNum(money(r.TotalAmount)), alignment: 'right', bold: true },
      { text: '' }
    ]);

    /* ---------- รายชื่อกรรมการตรวจรับ — คอลัมน์เดียว หนึ่งชื่อต่อหนึ่งบรรทัด ไหลตามความยาวข้อความจริง ---------- */
    var inspectorRows = [];
    [0, 1, 2].forEach(function (i) {
      var ins = inspectors[i] || {};
      inspectorRows.push({
        text: [
          { text: thNum(i + 1) + '. ' },
          fillRun(ins.FullName),
          { text: '   ตำแหน่ง ' },
          fillRun(ins.Position)
        ],
        fontSize: IF,
        margin: [0, 0, 0, 0]
      });
      inspectorRows.push({
        text: [
          { text: 'หมายเลขบัตรประชาชน ' },
          fillRun(thNum(ins.CID || '')),
          { text: '   E-mail address : ' },
          fillRun(ins.Email)
        ],
        fontSize: IF,
        margin: [16, 0, 0, 4]
      });
    });

    /* ---------- ช่องลงนาม 2 คอลัมน์ ---------- */
    var colWidth = (CONTENT_WIDTH - 18) / 2;

    var leftStack = [
      { text: 'จึงเรียนมาเพื่อโปรดพิจารณาและเห็นชอบต่อไป', margin: [10, 0, 0, 14] },
      signLine('ผู้ขอใช้'),
      nameLine(r.CreatedByName, undefined, 14),
      signLine('หัวหน้ากลุ่มงาน'),
      nameLine(r.DeptHeadName, undefined, 10),
      { text: 'ความเห็นของงานแผน/กลุ่มงานยุทธศาสตร์ฯ', bold: true, margin: [0, 0, 0, 3] },
      row([cb(r.PlanInPlan), plain('ในแผนปี พ.ศ.'), uline(thNum(r.PlanYear || ''), '*', { noWrap: true })]),
      row([cb(r.PlanOther), plain('อื่นๆ'), uline(r.PlanOther, '*')]),
      row([cb(r.PlanBudgetSource), plain('จัดซื้อด้วยเงิน'), uline(r.PlanBudgetSource, '*')]),
      row([plain('   จำนวนเงิน'), uline(thNum(money(r.PlanAmount || r.TotalAmount)), '*', { alignment: 'right', noWrap: true }), plain('บาท')], 14),
      row([uline('', '*'), plain('/'), uline('', '*')], 0)
    ];

    var opt = function (checked, text) {
      return {
        columns: [cb(checked, 8), { width: '*', text: text, fontSize: SM }],
        columnGap: 3,
        margin: [0, 0, 0, 1]
      };
    };

    var rightStack = [
      {
        text: 'ความเห็นของเจ้าหน้าที่/หัวหน้าเจ้าหน้าที่',
        bold: true, alignment: 'center', decoration: 'underline', fontSize: 12, margin: [0, 0, 0, 3]
      },
      opt(r.OfficerOpinionAnnualUnder100k, 'เป็นวัสดุสิ้นเปลืองมูลค่าการจัดซื้อทั้งปี ไม่เกิน ๑ แสนบาท'),
      opt(r.OfficerOpinionAnnualOver100k, 'เป็นวัสดุสิ้นเปลืองมูลค่าการจัดซื้อทั้งปี เกิน ๑ แสนบาท'),
      opt(r.OfficerMethod === 'เฉพาะเจาะจง', 'เห็นควรจัดซื้อ/จ้างโดยวิธีเฉพาะเจาะจง'),
      opt(r.OfficerMethod === 'คัดเลือก', 'เห็นควรจัดซื้อ/จ้างโดยวิธีคัดเลือก'),
      opt(String(r.OfficerMethod || '').indexOf('e-market') > -1, 'เห็นควรจัดซื้อโดยวิธีตลาดอิเล็กทรอนิกส์ (e-market)'),
      opt(String(r.OfficerMethod || '').indexOf('e-bidding') > -1, 'เห็นควรจัดซื้อ/จ้างโดยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)'),
      opt(r.OfficerMethodInProgress, 'เห็นควรจัดซื้อโดยวิธีเฉพาะเจาะจงก่อน เนื่องจากอยู่ระหว่าง'),
      {
        columns: [
          { width: 8 + 2.5, text: '' },
          plain('ดำเนินการจัดซื้อ/จ้างโดยวิธี', { fontSize: SM })
        ],
        columnGap: 3,
        margin: [0, 0, 0, 1]
      },
      {
        columns: [
          { width: 8 + 2.5, text: '' },
          cb(r.OfficerInProgressMethod === 'e-market', 8),
          plain('e-market', { fontSize: SM }),
          cb(r.OfficerInProgressMethod === 'e-bidding', 8),
          plain('e-bidding', { fontSize: SM })
        ],
        columnGap: 3
      },
      {
        columns: [
          plain('กำหนดแล้วเสร็จประมาณ', { fontSize: SM }),
          uline(thNum(count(r.CompletionDays)), 30, { alignment: 'center', fontSize: SM, noWrap: true }),
          plain('วัน นับถัดจากวันที่', { fontSize: SM })
        ],
        columnGap: 3
      },
      { text: 'ผู้ขาย/ผู้รับจ้างได้รับใบสั่งซื้อ/สั่งจ้าง', fontSize: SM },
      {
        text: r.OfficerReason || 'เนื่องจากมีความจำเป็นต้องใช้ในงานราชการของ สสจ.นครนายก',
        fontSize: SM, margin: [0, 0, 0, 10]
      },
      signLine('เจ้าหน้าที่', 12),
      nameLine(r.OfficerName, 12, 10),
      signLine('หัวหน้าเจ้าหน้าที่', 12),
      nameLine(r.DeptHeadName, 12, 4),
      { text: 'เห็นชอบ', bold: true, alignment: 'center', margin: [0, 0, 0, 22] },
      nameLine(r.ApproverName, undefined, 0),
      { text: r.ApproverPosition || 'นายแพทย์สาธารณสุขจังหวัดนครนายก', alignment: 'center' }
    ];

    /* ---------- หัวกระดาษ ---------- */
    // เลขที่หนังสือบางรายการพิมพ์ "นย" นำหน้ามาแล้ว จึงตัดออกไม่ให้ซ้ำกับแบบฟอร์ม
    var docNo = String(r.DocNoText || '').trim().replace(/^นย\s*/, '');

    var content = [
      {
        columns: [
          garudaDataUrl ? { width: 88, image: 'garuda', height: 42 } : { width: 88, text: ' ' },
          { width: '*', text: 'บันทึกข้อความ', bold: true, fontSize: 23, alignment: 'center' },
          { width: 88, text: ' ' }
        ],
        margin: [0, 0, 0, 3]
      },
      row([label('ส่วนราชการ'), uline(r.Department, '*'), label('โทร.'), uline(thNum(r.Phone || ''), 92, { noWrap: true })]),
      row([label('ที่'), plain('นย'), uline(thNum(docNo), '*', { noWrap: true }), label('วันที่'), uline(thNum(thaiDate(r.RequestDate)), 126, { noWrap: true })]),
      row([label('เรื่อง'), plain('ขอความเห็นชอบซื้อ/จ้าง'), uline(r.Subject, '*')], 0),
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 1 }],
        margin: [0, 4, 0, 6]
      },
      row([label('เรียน'), plain(r.To || 'นายแพทย์สาธารณสุขจังหวัดนครนายก')], 5),
      // ย่อหน้าบรรยายเดียวไหลต่อเนื่อง (คอลัมน์เดียว) แทนการตัดเป็นหลายแถวคงที่ — แก้ไข/ตัดบรรทัดตามความยาวข้อความจริงได้เอง
      {
        text: [
          { text: 'ด้วย ' }, fillRun(r.Department),
          { text: ' มีความประสงค์ขอความเห็นชอบซื้อ/จ้าง ' }, fillRun(r.Subject),
          { text: ' จำนวน ' }, fillRun(thNum(items.length)),
          { text: ' รายการ โดยมีเหตุผลและความจำเป็น ' }, fillRun(r.Reason)
        ],
        margin: [0, 0, 0, 4]
      },
      {
        columns: [
          plain('ซึ่ง', { width: 20 }),
          cb(r.PurposeRegular), plain('ใช้ในงานประจำ', { width: 62 }),
          cb(r.PurposeStock), plain('สำรองคลัง', { width: 52 }),
          cb(r.PurposeProject), plain('ใช้ในโครงการ'),
          uline(r.ProjectName, '*')
        ],
        columnGap: 3,
        margin: [0, 0, 0, 5]
      },
      { text: '(ตามสำเนาที่แนบท้ายมาด้วย) มีรายละเอียดดังนี้', margin: [0, 0, 0, 5] },
      {
        table: { headerRows: 2, widths: [26, '*', 44, 30, 40, 54, 76, 48], body: body },
        layout: ITEM_LAYOUT,
        fontSize: 12,
        margin: [0, 0, 0, 6]
      },
      row([
        plain('พร้อมนี้ได้แนบ', { width: 78, alignment: 'right' }),
        cb(has('Tor') || has('Spec')),
        plain('รายละเอียดคุณลักษณะเฉพาะ/ร่างขอบเขตงาน จำนวน'),
        uline(sheets(has('Tor') ? 'Tor' : 'Spec'), 28, { alignment: 'center', noWrap: true }),
        plain('แผ่น')
      ]),
      row([
        cb(has('Quote')), plain('ใบเสนอราคา จำนวน'), uline(sheets('Quote'), 28, { alignment: 'center', noWrap: true }), plain('แผ่น'),
        cb(has('BudgetPlan')), plain('แผนการใช้งบประมาณ จำนวน'), uline(sheets('BudgetPlan'), 28, { alignment: 'center', noWrap: true }), plain('แผ่น')
      ]),
      row([
        cb(has('Project')), plain('โครงการ จำนวน'), uline(sheets('Project'), 28, { alignment: 'center', noWrap: true }), plain('แผ่น'),
        uline('', '*')
      ]),
      { text: 'และขอแต่งตั้งคณะกรรมการตรวจรับพัสดุ/ผู้ตรวจรับพัสดุ ดังนี้', margin: [0, 0, 0, 3] }
    ].concat(inspectorRows).concat([
      {
        columns: [
          { width: colWidth, stack: leftStack },
          { width: 18, text: ' ' },
          { width: colWidth, stack: rightStack }
        ],
        margin: [0, 8, 0, 0]
      }
    ]);

    if (!official) {
      content.push({
        text: 'ฉบับร่าง — ยังไม่ผ่านการตรวจสอบของเจ้าหน้าที่พัสดุ',
        alignment: 'center', color: '#b91c1c', bold: true, fontSize: 11, margin: [0, 10, 0, 0]
      });
    }

    var doc = {
      pageSize: 'A4',
      pageMargins: PAGE_MARGIN,
      defaultStyle: { font: 'Sarabun', fontSize: 13, lineHeight: 1 },
      content: content
    };
    if (garudaDataUrl) doc.images = { garuda: garudaDataUrl };
    applyThaiBreak(doc.content);
    return doc;
  }

  global.PatsaduPdf = { buildMemoDoc: buildMemoDoc, PAGE_MARGIN: PAGE_MARGIN, CONTENT_WIDTH: CONTENT_WIDTH };
})(typeof window !== 'undefined' ? window : globalThis);
