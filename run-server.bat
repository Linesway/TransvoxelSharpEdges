@echo off
cd /d "%~dp0"
echo.
echo  >>>  Open in browser:  http://127.0.0.1:3344/  <<<
echo  >>>  Keep this window open.  <<<
echo.
python -m http.server 3344
pause
