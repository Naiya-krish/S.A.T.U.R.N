# S.A.T.U.R.N. — start backend (:8787) and frontend (:5173) in separate windows.
# Usage:  .\scripts\dev.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$py = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Host "Creating backend virtualenv..."
  python -m venv (Join-Path $root "backend\.venv")
  & $py -m pip install --upgrade pip --quiet
  & $py -m pip install -r (Join-Path $root "backend\requirements.txt") --quiet
}

if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
  Write-Host "Installing frontend dependencies..."
  Push-Location (Join-Path $root "frontend"); npm install --no-audit --no-fund; Pop-Location
}

Write-Host "Starting S.A.T.U.R.N. backend on http://127.0.0.1:8787 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\backend'; & '$py' run.py"

Write-Host "Starting S.A.T.U.R.N. frontend on http://localhost:5173 ..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npm run dev"

Write-Host ""
Write-Host "  UI      -> http://localhost:5173"
Write-Host "  API     -> http://127.0.0.1:8787/api/health"
Write-Host "  Docs    -> http://127.0.0.1:8787/docs"
