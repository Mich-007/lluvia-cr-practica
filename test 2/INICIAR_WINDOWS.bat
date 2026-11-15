@echo off
rem Abre Phyllobytes con el servidor de Python. Funciona desde cualquier carpeta.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 ( py INICIAR_PHYLLOBYTES.py & goto fin )
where python >nul 2>nul
if %errorlevel%==0 ( python INICIAR_PHYLLOBYTES.py & goto fin )
echo No encontre Python en este equipo.
echo No hace falta: abra el archivo Phyllobytes.html con doble clic.
:fin
echo.
pause
