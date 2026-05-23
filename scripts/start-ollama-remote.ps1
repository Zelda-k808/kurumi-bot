# Start Cloudflare quick tunnel to local Ollama and save the public URL for Render.
# Keep this running (or run at logon). Render OLLAMA_HOST must match the saved URL.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$urlFile = Join-Path $root "data\ollama-tunnel-url.txt"
$renderFile = Join-Path $root "data\render-ollama-env.txt"
$logFile = Join-Path $root "data\ollama-tunnel.log"

New-Item -ItemType Directory -Force -Path (Split-Path $urlFile) | Out-Null

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Write-Host "Install cloudflared: winget install Cloudflare.cloudflared" -ForegroundColor Red
  exit 1
}

try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 5
} catch {
  Write-Host "Ollama is not running on 127.0.0.1:11434 — start the Ollama app first." -ForegroundColor Red
  exit 1
}

Write-Host "Starting tunnel to Ollama (logs: $logFile)..." -ForegroundColor Cyan
$proc = Start-Process -FilePath $cf.Source -ArgumentList "tunnel", "--url", "http://127.0.0.1:11434", "--http-host-header", "127.0.0.1:11434" `
  -RedirectStandardOutput $logFile -RedirectStandardError "${logFile}.err" -PassThru -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(90)
$url = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  if (-not $proc.HasExited) {
    $text = ""
    if (Test-Path $logFile) { $text += Get-Content $logFile -Raw -ErrorAction SilentlyContinue }
    if (Test-Path "${logFile}.err") { $text += Get-Content "${logFile}.err" -Raw -ErrorAction SilentlyContinue }
    if ($text -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
      $url = $Matches[1]
      break
    }
  } else {
    Write-Host "cloudflared exited early. See $logFile" -ForegroundColor Red
    exit 1
  }
}

if (-not $url) {
  Write-Host "Timed out waiting for tunnel URL. Check $logFile" -ForegroundColor Red
  exit 1
}

$url | Set-Content -Path $urlFile -Encoding utf8 -NoNewline
@"
# Paste into Render → Environment (then redeploy)
OLLAMA_ENABLED=1
OLLAMA_HOST=$url
OLLAMA_MODEL=kurumi
OLLAMA_TIMEOUT_MS=120000
"@ | Set-Content -Path $renderFile -Encoding utf8

Write-Host ""
Write-Host "Tunnel URL: $url" -ForegroundColor Green
Write-Host "Saved: $urlFile" -ForegroundColor Green
Write-Host "Render env block: $renderFile" -ForegroundColor Green
Write-Host "cloudflared PID: $($proc.Id) — leave running for Render to use the LLM." -ForegroundColor Yellow

# Quick probe
$env:OLLAMA_HOST = $url
Push-Location $root
npm run ollama:probe
$code = $LASTEXITCODE
Pop-Location
exit $code
