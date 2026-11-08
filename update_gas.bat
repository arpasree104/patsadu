@echo off
chcp 65001 >nul
setlocal
REM ============================================================
REM  อัปเดต Apps Script ระบบพัสดุ จาก code.gs ในโฟลเดอร์นี้
REM  - ใช้ Web App URL เดิม (ไม่ต้องแก้ assets\config.js)
REM  - ต้องติดตั้ง Node.js และ clasp ก่อน:  npm install -g @google/clasp
REM  - ครั้งแรกต้องล็อกอิน:  clasp login   (และเปิด Apps Script API ที่ script.google.com/home/usersettings)
REM ============================================================
set SCRIPT_ID=1NRQcJ4iMQYNClu2AyEkldv5arli_nmonn_SAyMLW9d2UeVzrVKzjrGbY
set DEPLOYMENT_ID=AKfycbzhsgXqwNoxLfmFw_J4oZzsI5tR_QRELzfZs90Hl9OKKfxuCsN5SiY4slmyivIPjulW

set SRC=%~dp0
set WORK=%SRC%.gas_deploy

if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"
pushd "%WORK%"

echo [1/4] ดึงโปรเจกต์เดิมจาก Google (เพื่อคง appsscript.json และไฟล์อื่น)...
call clasp clone %SCRIPT_ID% || goto :fail

echo [2/4] คัดลอก code.gs ใหม่ทับ...
copy /y "%SRC%code.gs" "%WORK%\code.js" >nul
if exist "%WORK%\code.gs" del "%WORK%\code.gs"
if not exist "%WORK%\code.js" goto :fail

echo [3/4] อัปโหลดโค้ด...
call clasp push -f || goto :fail

echo [4/4] อัปเดต Web App เดิมเป็นเวอร์ชันใหม่...
call clasp deploy -i %DEPLOYMENT_ID% -d "update %DATE% %TIME%" || goto :fail

popd
rmdir /s /q "%WORK%"
echo.
echo เสร็จเรียบร้อย — กด Ctrl+F5 ที่หน้าเว็บเพื่อล้างแคช
pause
exit /b 0

:fail
popd
echo.
echo เกิดข้อผิดพลาด ดูข้อความด้านบน (ตรวจว่า clasp login แล้ว และเปิด Apps Script API แล้ว)
pause
exit /b 1
