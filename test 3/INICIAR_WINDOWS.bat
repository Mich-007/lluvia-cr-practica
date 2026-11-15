@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py -3 INICIAR_PHYLLOBYTES.py) || (python INICIAR_PHYLLOBYTES.py)
pause
