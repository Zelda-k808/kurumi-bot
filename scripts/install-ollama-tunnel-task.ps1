# Register a logon task to start the Ollama Cloudflare tunnel (for Render LLM).
# Run once: powershell -ExecutionPolicy Bypass -File scripts/install-ollama-tunnel-task.ps1
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$script = Join-Path $root "scripts\start-ollama-remote.ps1"
$taskName = "KurumiBot-OllamaTunnel"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Scheduled task $taskName registered (runs at logon)." -ForegroundColor Green
Write-Host "Tunnel URL: data/ollama-tunnel-url.txt - update Render when it changes." -ForegroundColor Yellow
