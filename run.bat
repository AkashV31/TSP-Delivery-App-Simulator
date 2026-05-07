@echo off
echo ==============================================
echo   Mumbai TSP Delivery App - Startup Script
echo ==============================================
echo.

echo Compiling BackendController...
javac src\BackendController.java

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Java Compilation Failed.
    pause
    exit /b %ERRORLEVEL%
)

echo Starting Java Server on port 4567...
echo Open your browser to http://localhost:4567
echo.
java -cp . src.BackendController

pause
