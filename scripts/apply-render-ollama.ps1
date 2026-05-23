# Push OLLAMA_* env vars to Render via API (optional automation).
# Requires: RENDER_API_KEY from https://dashboard.render.com/u/settings#api-keys
#           RENDER_SERVICE_ID from service URL (srv-xxxxxxxx) or dashboard
param(
  [string]$ServiceId = $env:RENDER_SERVICE_ID,
  [string]$ApiKey = $env:RENDER_API_KEY,
  [string]$TunnelUrlFile = (Join-Path (Split-Path -Parent $PSScriptRoot) "data\ollama-tunnel-url.txt")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $ApiKey) {
  Write-Host "Set RENDER_API_KEY (Render dashboard → Account Settings → API Keys)" -ForegroundColor Yellow
  exit 1
}
if (-not $ServiceId) {
  Write-Host "Set RENDER_SERVICE_ID (e.g. srv-abc123 from your service URL)" -ForegroundColor Yellow
  exit 1
}

$url = $null
if (Test-Path $TunnelUrlFile) {
  $url = (Get-Content $TunnelUrlFile -Raw).Trim()
}
if (-not $url) {
  Write-Host "No tunnel URL. Run: npm run ollama:remote" -ForegroundColor Red
  exit 1
}

$headers = @{
  Authorization = "Bearer $ApiKey"
  "Content-Type"  = "application/json"
}

Write-Host "Updating Render service $ServiceId ..." -ForegroundColor Cyan
$existing = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$ServiceId/env-vars?limit=100" -Headers $headers
$envList = @()
foreach ($item in $existing) {
  $envList += @{ key = $item.envVar.key; value = $item.envVar.value }
}
$ollamaKeys = @("OLLAMA_ENABLED", "OLLAMA_HOST", "OLLAMA_MODEL", "OLLAMA_TIMEOUT_MS")
$envList = @($envList | Where-Object { $ollamaKeys -notcontains $_.key })
$envList += @(
  @{ key = "OLLAMA_ENABLED"; value = "1" },
  @{ key = "OLLAMA_HOST"; value = $url },
  @{ key = "OLLAMA_MODEL"; value = "kurumi" },
  @{ key = "OLLAMA_TIMEOUT_MS"; value = "120000" }
)
$body = $envList | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Put -Uri "https://api.render.com/v1/services/$ServiceId/env-vars" -Headers $headers -Body $body | Out-Null
Write-Host "  OLLAMA_* set (host: $url)" -ForegroundColor Green

$deploy = Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/services/$ServiceId/deploys" -Headers $headers -Body "{}"
Write-Host "Deploy started: $($deploy.id) ($($deploy.status))" -ForegroundColor Green
