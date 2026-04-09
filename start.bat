@echo off
setlocal
echo ===================================================
echo     Synapse IDE - Development Server Startup
echo ===================================================
echo.

:: Check for root node_modules
if not exist "node_modules\" (
    echo [1/3] Installing root dependencies...
    call npm install
) else (
    echo [1/3] Root dependencies found.
)

:: Check for server node_modules
if not exist "server\node_modules\" (
    echo [2/3] Installing backend dependencies...
    pushd server
    call npm install
    popd
) else (
    echo [2/3] Backend dependencies found.
)

:: Check for client node_modules
if not exist "client\node_modules\" (
    echo [3/3] Installing frontend dependencies...
    pushd client
    call npm install
    popd
) else (
    echo [3/3] Frontend dependencies found.
)

echo.
echo ===================================================
echo Starting Synapse Servers (Frontend + Backend)...
echo The frontend will be at http://localhost:5173
echo The backend will be at http://localhost:5000
echo ===================================================
echo.

:: Run the dev script (uses concurrently to run both)
call npm run dev

pause
