# Test OLLAMA_HOST from env (same check Render will use).
param(
  [string]$Url = $env:OLLAMA_HOST
)

if (-not $Url) {
  Write-Host "Usage: .\scripts\test-ollama-url.ps1 -Url http://100.x.x.x:11434" -ForegroundColor Yellow
  Write-Host "   or: `$env:OLLAMA_HOST='http://...'; npm run ollama:probe" -ForegroundColor Yellow
  exit 1
}

$env:OLLAMA_HOST = $Url.Trim().TrimEnd("/")
Write-Host "Probing $env:OLLAMA_HOST ..." -ForegroundColor Cyan
npm run ollama:probe
exit $LASTEXITCODE
