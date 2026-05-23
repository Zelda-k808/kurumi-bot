# Make the Ollama *server* listen on all interfaces (LAN / Tailscale).
# Restart the Ollama app from the system tray after running this.
$ErrorActionPreference = "Stop"

$bind = "0.0.0.0:11434"
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", $bind, "User")

Write-Host "Set User OLLAMA_HOST=$bind for the Ollama application." -ForegroundColor Green
Write-Host "Quit Ollama from the tray, then start it again." -ForegroundColor Yellow
Write-Host ""
Write-Host "Bot on Render should use your Tailscale/VPS URL, for example:" -ForegroundColor Cyan
Write-Host "  OLLAMA_HOST=http://100.x.x.x:11434" -ForegroundColor White
Write-Host "See docs/ollama-remote.md" -ForegroundColor Cyan
