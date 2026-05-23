# Pull base model and build the Kurumi Ollama model from ollama/Modelfile.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
  Write-Host "Ollama not found. Install: winget install Ollama.Ollama" -ForegroundColor Yellow
  exit 1
}

Write-Host "Pulling llama3.2:3b (base model)..."
& ollama pull llama3.2:3b

Write-Host "Creating kurumi model from ollama/Modelfile..."
& ollama create kurumi -f (Join-Path $root "ollama\Modelfile")

Write-Host "Done. Set in .env: OLLAMA_ENABLED=1  OLLAMA_MODEL=kurumi" -ForegroundColor Green
& ollama list
