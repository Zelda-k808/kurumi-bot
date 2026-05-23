# Remote Ollama for Render (PC or VPS)

Render runs your Discord bot in the cloud. It **cannot** call `http://127.0.0.1:11434` on your laptop — that is the bot container’s own loopback, not your PC.

You need a **reachable URL** for Ollama and set it on Render as **`OLLAMA_HOST`**.

## Naming (easy to mix up)

| Where | Variable | Example | Meaning |
|-------|----------|---------|---------|
| **Ollama app** (PC/VPS) | `OLLAMA_HOST` | `0.0.0.0:11434` | Address Ollama **listens** on |
| **Discord bot** (Render / `.env`) | `OLLAMA_HOST` | `http://100.x.x.x:11434` | URL the bot **calls** |

The bot only uses the second one.

---

## Option A — VPS on Tailscale or LAN (bot on Render)

Use a **VPS** (or always-on machine) that runs Ollama and has an address Render can reach:

- **Public VPS IP** → Option C below (`OLLAMA_HOST=http://VPS_IP:11434`)
- **Tailscale IP** → only works if something on the **public internet** can route to it (e.g. you run the Discord bot on that same Tailscale node, not on stock Render). **Render does not join your tailnet.**

For **Render + Ollama on your home PC**, use **Option B** (Cloudflare tunnel) or run Ollama on a **VPS with a public port**.

---

## Option B — Cloudflare quick tunnel (home PC → Render)

Good when Render must reach your home PC without Tailscale on Render.

1. PC: Ollama running, `npm run ollama:setup`.
2. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/).
3. Start a tunnel (must use host header so Ollama accepts requests):

   ```powershell
   npm run ollama:remote
   ```

   This saves the URL to `data/ollama-tunnel-url.txt` and `data/render-ollama-env.txt`.

   Or interactively: `npm run ollama:tunnel` (same flags; copy the `https://….trycloudflare.com` URL).

4. **Render → Environment**:

   | Key | Value |
   |-----|--------|
   | `OLLAMA_ENABLED` | `1` |
   | `OLLAMA_HOST` | `https://xxxx.trycloudflare.com` |
   | `OLLAMA_MODEL` | `kurumi` |

5. Redeploy. Logs should show `[local-llm] ready · https://…`.

**Note:** Quick tunnel URLs change when you restart `cloudflared`. For production, use a named Cloudflare Tunnel or a VPS.

---

## Option C — VPS with public port 11434 (best for 24/7 Render)

1. Install Ollama on Ubuntu, then:

   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   sudo systemctl enable ollama
   ```

2. Listen on all interfaces:

   ```bash
   sudo mkdir -p /etc/systemd/system/ollama.service.d
   printf '%s\n' '[Service]' 'Environment="OLLAMA_HOST=0.0.0.0:11434"' | sudo tee /etc/systemd/system/ollama.service.d/override.conf
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

3. Copy `ollama/Modelfile` to the VPS and run `ollama pull llama3.2:3b && ollama create kurumi -f Modelfile`.

4. Firewall: allow **TCP 11434** only from trusted IPs if possible. Ollama has **no built-in auth** — exposing it worldwide lets anyone run models on your GPU.

5. Render:

   | Key | Value |
   |-----|--------|
   | `OLLAMA_HOST` | `http://YOUR_VPS_PUBLIC_IP:11434` |

---

## Test before redeploying Render

From your dev machine (PowerShell), set the same URL you will use on Render:

```powershell
$env:OLLAMA_HOST = "https://xxxx.trycloudflare.com"   # or http://VPS_IP:11434
npm run ollama:probe
```

Or: `powershell -File scripts/test-ollama-url.ps1 -Url "https://…"`

Exit code `0` and `{ ok: true }` means Render should be able to reach it (if firewalls allow Render egress — they usually do).

---

## Render environment checklist

- [ ] `DISCORD_TOKEN` — set
- [ ] `OLLAMA_ENABLED` — `1`
- [ ] `OLLAMA_HOST` — **not** `localhost` / `127.0.0.1`
- [ ] `OLLAMA_MODEL` — `kurumi`
- [ ] Ollama machine is on and model pulled
- [ ] Redeploy after changing env vars

If LLM is unreachable, chat still works via **persona fallback**; logs show `[local-llm] offline — …`.

---

## Security

- Do not expose Ollama on `0.0.0.0:11434` to the open internet without a VPN, tunnel access rules, or reverse proxy + auth.
- Optional: put nginx/Caddy in front with a bearer token and set `OLLAMA_API_KEY` on Render to match.
