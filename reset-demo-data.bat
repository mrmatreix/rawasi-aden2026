@echo off
setlocal enableextensions
title Reset Demo Data - Rawasi Aden
color 0E

echo =====================================================================
echo           RAWASI ADEN SYSTEM - RESET DEMO DATA
echo        إعادة ضبط البيانات التجريبية لنظام رواسي عدن
echo =====================================================================
echo.
echo WARNING: This will reset the database to initial demo values.
echo تحذير: سيتم إعادة تعيين قاعدة البيانات وإرجاع بيانات المشاريع والسندات الأصلية.
echo.
set /p confirm=Are you sure you want to proceed? (y/n): 
if /i "%confirm%" neq "y" (
    echo [INFO] Operation cancelled. / تم الإلغاء.
    pause
    exit /b 0
)

echo.
echo [*] Resetting database / جاري إعادة بذر البيانات...
call npm run seed
echo.
echo [OK] Database reset successfully! / تم إعادة ضبط البيانات بنجاح!
pause
