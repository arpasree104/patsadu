/**
 * ตั้งค่าการเชื่อมต่อ API
 *
 * 1) Deploy โปรเจกต์ Apps Script (code.gs) เป็น Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 2) คัดลอก URL ที่ได้ (ลงท้ายด้วย /exec) มาใส่ที่ API_URL ด้านล่าง
 * 3) commit + push ขึ้น GitHub แล้ว Vercel จะ deploy ให้อัตโนมัติ
 *
 * หมายเหตุ: ถ้ายังไม่ได้ตั้งค่า ระบบจะขึ้นหน้าให้กรอก URL เองและจำไว้ในเครื่อง
 */
window.APP_CONFIG = {
  API_URL: '',
  APP_TITLE: 'ระบบเสนอความต้องการพัสดุ',
  ORG_NAME: 'สำนักงานสาธารณสุขจังหวัดนครนายก',
  GARUDA_URL: 'https://img1.pic.in.th/images/310f1c8dc44d07e2888f3e0c3f416701.png',
  SESSION_KEY: 'patsadu_session_v2',
  ENDPOINT_KEY: 'patsadu_endpoint_v2'
};
