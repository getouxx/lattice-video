@echo off
REM folia lattice lyric video renderer - one-click entry.
REM Usage: render.cmd "song.mp3" "lyrics.lrc" [optional 3rd arg = output mp4 path]
REM Optional PowerShell-style params: -Output x.mp4 -Fps 60 -Width 1920 -Height 1080 -Cover cover.jpg
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0render.ps1" %*
