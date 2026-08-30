@echo off
if "%~1"=="" (
    echo Drag a MIDI file onto this BAT file.
    pause
    exit /b
)

py "%~dp0midi_to_oscmid.py" "%~1"

pause