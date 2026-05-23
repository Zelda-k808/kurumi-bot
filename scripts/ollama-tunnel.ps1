# Expose local Ollama via Cloudflare quick tunnel (HTTPS URL for Render OLLAMA_HOST).
$ErrorActionPreference = "Stop"

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Write-Host "cloudflared not found. Install:" -ForegroundColor Yellow
  Write-Host "  winget install Cloudflare.cloudflared" -ForegroundColor White
  exit 1
}

Write-Host "Tunneling http://127.0.0.1:11434 — copy the https:// URL into Render as OLLAMA_HOST" -ForegroundColor Cyan
Write-Host "Keep this window open while Render uses the LLM." -ForegroundColor Yellow
& cloudflared tunnel --url http://127.0.0.1:11434 --http-host-header 127.0.0.1:11434
