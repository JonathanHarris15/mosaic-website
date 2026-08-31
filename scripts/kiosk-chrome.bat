@echo off
REM ===========================================================================
REM  Start the check-in kiosk with printing that does not stop to ask.
REM  MS-320. See docs/plans/ms-317-zebra-label-printing.md.
REM
REM  Chrome has no setting for "print without the dialog" — it is a switch you
REM  pass when you start it: --kiosk-printing, which Chromium's own source
REM  describes as "automatically pressing the print button in print preview".
REM  So the preview still opens and still flashes for about a second; nobody
REM  has to click it. That flash is a known Chromium annoyance, not a fault
REM  here, and there is no way to remove it.
REM
REM  TWO THINGS THIS SCRIPT DOES ON PURPOSE:
REM
REM  1. IT USES ITS OWN PROFILE. A Chrome that is ALREADY RUNNING ignores the
REM     switch — the new window just joins the old process, which was started
REM     without it, and the dialog waits for a click as before. Its own
REM     --user-data-dir guarantees a separate process that really has the
REM     switch. The side effect is a separate set of bookmarks and logins,
REM     which for a foyer machine is the point.
REM
REM  2. IT PRINTS TO THE WINDOWS DEFAULT PRINTER. The dialog is answered before
REM     anyone can change the destination, so whatever Windows calls the
REM     default is what gets the label. SET THE ZEBRA AS THE DEFAULT PRINTER on
REM     this machine, or the tags go to Microsoft Print to PDF and no one finds
REM     out until the foyer is full.
REM ===========================================================================

set "URL=https://mosaicmanagercstx.com/kiosk.html"
set "PROFILE=%LOCALAPPDATA%\MosaicKiosk\chrome-profile"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
    echo Could not find Chrome. Edit the CHROME line in this file to point at chrome.exe.
    pause
    exit /b 1
)

start "" "%CHROME%" --kiosk-printing --user-data-dir="%PROFILE%" --app="%URL%"
