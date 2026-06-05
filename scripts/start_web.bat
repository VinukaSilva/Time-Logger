@echo off
cd /d "%~dp0.."
if exist .venv\Scripts\python.exe (
    start "" .venv\Scripts\python.exe run_web.py
) else (
    start "" python run_web.py
)
timeout /t 2 >nul
start "" http://127.0.0.1:5000/
