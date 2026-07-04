@echo off
title Alfred Lavalink Server
color 0A
cd /d "%~dp0"

echo ========================================
echo   Alfred Lavalink Server
echo ========================================
echo.

set "JAVA=C:\Program Files\Eclipse Adoptium\jdk-17.0.15.6-hotspot\bin\java.exe"

if not exist "%JAVA%" (
    echo [ERRO] Java nao encontrado em:
    echo %JAVA%
    echo.
    echo Verifique se OpenJDK 17 Temurin esta instalado.
    pause
    exit /b 1
)

if not exist "Lavalink.jar" (
    echo [ERRO] Lavalink.jar nao encontrado em %~dp0
    echo Baixe de: https://github.com/lavalink-devs/Lavalink/releases
    pause
    exit /b 1
)

if not exist "application.yml" (
    echo [ERRO] application.yml nao encontrado em %~dp0
    pause
    exit /b 1
)

echo [OK] Java: %JAVA%
echo [OK] Diretorio: %CD%
echo.
echo Host: 127.0.0.1
echo Port: 2333
echo.
echo Pressione Ctrl+C para parar o servidor.
echo ========================================
echo.

"%JAVA%" -Xmx512M -jar Lavalink.jar
