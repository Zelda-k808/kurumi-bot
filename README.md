# Discord Voice Keeper Bot

A Discord bot that can:
- join the voice channel of the user who runs `/join`
- stay connected and muted
- leave with `/leave`

It only requires **your bot token** in `.env`.

## 1) Create bot in Discord Developer Portal

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create an application -> Bot -> Add Bot
3. Copy token and put it in `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
```

4. In Bot settings, enable these Privileged Gateway Intents:
   - **Server Members Intent** (optional, safe to keep off here)
   - **Message Content Intent** (not required for this bot)
   - **Presence Intent** (not required)

This bot only needs:
- `Guilds`
- `GuildVoiceStates`

## 2) Invite bot to any server

In OAuth2 -> URL Generator:
- Scopes: `bot`, `applications.commands`
- Bot Permissions: `Connect`, `View Channels`, `Speak` (Speak is optional if you keep it muted)

Open generated URL and invite it to any server where you have permission.

## 3) Run locally

```bash
npm install
npm start
```

Global slash commands may take a short time to appear after first startup.

## 4) Commands

- `/join` -> bot joins your current voice channel and self-mutes
- `/leave` -> bot leaves channel in that server
- `/status` -> shows connection state in that server
- `/ping` -> Discord latency check (for fun/debug only)

## 5) Host on Render.com (free web service)

1. Push this repo to GitHub (or connect Render to your repo).
2. New **Web Service** → pick the repo.
3. **Build command:** `npm install`  
   **Start command:** `npm start`
4. Add environment variable **`DISCORD_TOKEN`** (same value as in `.env`).
5. Deploy. Render sets **`PORT`** automatically; the bot starts a tiny HTTP server on that port.

### Keep the service from sleeping (important)

On Render’s **free** plan, the web service can **spin down** when it gets no HTTP traffic for a while. When it sleeps, the **whole Node process** stops, so the bot leaves Discord until the next request wakes it.

**What actually keeps Render awake:** something on the internet must **HTTP GET** your app regularly, for example:

- `https://YOUR-SERVICE.onrender.com/ping`  
- or `https://YOUR-SERVICE.onrender.com/`

Use a free uptime monitor (e.g. [UptimeRobot](https://uptimerobot.com/) or [cron-job.org](https://cron-job.org)) and ping that URL every **5–14 minutes**. The Discord `/ping` command does **not** hit Render; only HTTP pings do.

## 6) Free 24/7 hosting (realistic options)

Truly free and always-on hosting is limited. Best practical options:

1. **Oracle Cloud Always Free VM** (most reliable free 24/7)
2. **Free-tier platforms** (often sleep, limited hours, or change policy)

### Oracle VM quick steps

1. Create free VM (Ubuntu).
2. Install Node.js 18+.
3. Upload this project to VM.
4. Create `.env` with your token.
5. Run:

```bash
npm install
npm start
```

6. Keep it alive with `pm2`:

```bash
npm install -g pm2
pm2 start src/index.js --name kurumi-voice-bot
pm2 save
pm2 startup
```

This gives near-true 24/7 on free tier.

`render.yaml` in this repo is optional: you can connect the repo in Render and it may pick up the blueprint, or set build/start commands manually as above.
