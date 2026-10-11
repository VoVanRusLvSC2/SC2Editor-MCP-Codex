@echo off
setlocal
if not "%~1"=="" set "SC2_UI_ROOT=%~f1"
if not defined SC2_UI_ROOT set "SC2_UI_ROOT=%CD%"
if not defined SC2_MCP_PROFILE set "SC2_MCP_PROFILE=all"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0app\dist\index.js"
) else (
  node.exe "%~dp0app\dist\index.js"
)
exit /b %errorlevel%
