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

## 5) Deploy on Render.com

Render runs this as a **Web Service**: Node binds to **`PORT`** (set by Render) and serves **GET /** and **GET /ping** with plain text `ok` so uptime monitors can hit your URL. The Discord bot runs in the same process.

### Option A — Blueprint (`render.yaml`)

1. Push this repo to GitHub (or GitLab / Bitbucket).
2. In [Render Dashboard](https://dashboard.render.com): **New** → **Blueprint**.
3. Connect the repository and select the branch. Render reads `render.yaml`.
4. When prompted, add **`DISCORD_TOKEN`** (your bot token). Do not wrap it in quotes.
5. Create / deploy. After the first deploy, confirm under the service **Environment** that `DISCORD_TOKEN` is present.

### Option B — Web Service (manual)

1. **New** → **Web Service** → connect the repo.
2. **Runtime:** Node  
   **Build command:** `npm install`  
   **Start command:** `npm start`  
   **Instance type:** Free (if you use the free plan).
3. **Environment** → **Add environment variable**:
   - Key: `DISCORD_TOKEN`  
   - Value: paste the token from the Discord Developer Portal (no quotes).
4. Optional but recommended: add **`NODE_VERSION`** = `20` so Render matches `package.json` (`>=18`).
5. Deploy. Open the service URL in a browser; you should see `ok` on `/` or `/ping`.

### Troubleshooting: “Exited with status 1”

Check the **Logs** tab on the service:

| Log message | What to do |
|-------------|------------|
| `Missing DISCORD_TOKEN` | Add **`DISCORD_TOKEN`** in Render **Environment** (exact name). Redeploy. |
| `Discord login failed` | Token wrong, reset in Discord portal, or extra spaces — paste again without quotes. |
| `HTTP keep-alive server error` / `EADDRINUSE` | Rare; redeploy or change service — usually a platform glitch. |

Render does **not** read a `.env` file from the repo for secrets; only dashboard (or blueprint) env vars count.

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

The **`render.yaml`** in this repo is the optional blueprint for Option A above.
