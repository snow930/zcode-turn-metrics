@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"F:wendangZCODEplugins	urn-metricsscriptsenable-live-ui.ps1\"'"
endlocal
