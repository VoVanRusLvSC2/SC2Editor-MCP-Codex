@echo off
setlocal
set "SC2_MCP_PROFILE=cutscene-preview"
call "%~dp0SC2-MCP.cmd" "%~1"
exit /b %errorlevel%
