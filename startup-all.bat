@echo off
title Alfred + Whisper + Lavalink
color 0B

echo ================================================
echo      Iniciando Sistema Completo (Bot + IA + Lavalink)
echo ================================================
echo.

:: 1. Iniciar Lavalink (servidor de audio Java)
echo [1/3] Iniciando Lavalink (servidor de audio)
start "Lavalink" cmd /c "lavalink\start-lavalink.bat || pause"

:: Aguardar 12 segundos para Lavalink subir
timeout /t 12 /nobreak > nul

:: 2. Iniciar Servidor Whisper Local
echo [2/3] Iniciando Servidor Whisper (Local AI)
start "Whisper AI" cmd /c "python scripts/whisper-server.py || pause"

:: Aguardar 10 segundos para o modelo medium carregar na GPU
timeout /t 10 /nobreak > nul

:: 3. Iniciar Discord Bot
echo [3/3] Iniciando Discord Bot
echo.
npm start

pause
