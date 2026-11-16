@echo off
cd /d "%~dp0"
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    python server.py
) else (
    where py >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        py -3 server.py
    ) else (
        echo Python 3 is required for the local proxy server.
        echo Alternatively, load this folder as an unpacked Chrome Extension at chrome://extensions
        pause
    )
)
