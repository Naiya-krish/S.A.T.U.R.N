# Stop S.A.T.U.R.N. dev servers listening on 8787 (backend) and 5173 (frontend).
foreach ($port in 8787, 5173) {
  $pids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
  foreach ($p in $pids) {
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Write-Host "stopped pid $p on port $port" }
  }
}
