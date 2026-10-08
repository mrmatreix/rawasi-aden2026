@echo off
setlocal enableextensions enabledelayedexpansion
title Rawasi Aden System - Launcher
color 0A

echo =====================================================================
echo           RAWASI ADEN SYSTEM - NETHAM RAWASI ADEN
echo       نظام رواسي عدن للهندسة والمقاولات - التشغيل السريع
echo =====================================================================
echo.

REM 1. Check Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed on this computer!
    echo [خطأ] لم يتم العثور على Node.js في هذا الجهاز.
    echo Please download and install it from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM 2. Install dependencies if node_modules missing
if not exist "node_modules\" (
    echo [*] Installing dependencies / جاري تثبيت الحزم المطلوبة لأول مرة...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

REM 3. Seed database if not present
if not exist "server\database\rawasi_aden.db" (
    echo [*] Initializing database / جاري تهيئة قاعدة البيانات...
    call npm run seed
)

echo.
echo =====================================================================
echo  [OK] Server is starting on: http://localhost:5500
echo  [OK] Default Login Credentials:
echo       Username: admin
echo       Password: admin123
echo =====================================================================
echo.

REM 4. Open Default Browser
start http://localhost:5500

REM 5. Start Express Server
npm start

pause
