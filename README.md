# BaconFlix

A Discord bot that lets people on your server request movies for your Plex library. Requests go straight to [Radarr](https://radarr.video/), which handles searching, downloading, and importing. From there your existing automations take over.

## How it works

```
/request query:"Dune"
   │
   ├─ permission check (optional role / server allowlists)
   ├─ rate limit (default: 3 searches per user per 10 minutes)
   ├─ disk space check on the Radarr root folder
   └─ Radarr lookup ──► results shown privately to the requester
          │
          ├─ 0 matches   → "No results"
          ├─ 1 match     → movie card + [Confirm Request]   (or "already on the server")
          └─ 2+ matches  → dropdown to pick the right one → movie card + [Confirm Request]
                                   │
                                   ▼
                    Radarr adds the movie and starts searching
                    The channel gets a public "@user requested Dune (2021)" announcement
```

The search, picker, and any errors are only visible to the person who ran the command, so the channel only sees requests that were actually made. The bot keeps no database: each step carries the movie's TMDB ID in the Discord button or menu and asks Radarr for fresh data.

## Setup

### 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Copy the **Application ID** (General Information) → `DISCORD_CLIENT_ID`.
3. Under **Bot**, reset and copy the token → `DISCORD_TOKEN`. No privileged intents are needed.
4. Under **OAuth2 → URL Generator**, select the `bot` and `applications.commands` scopes and the **Send Messages** and **Embed Links** permissions. Open the generated URL to invite the bot to your server.

### 2. Gather your Radarr settings

- **URL**, e.g. `http://192.168.1.10:7878` → `RADARR_URL`
- **API key**: Settings → General → Security → `RADARR_API_KEY`
- **Quality profile ID**: Settings → Profiles. If you're not sure, start the bot: it logs the available profile IDs when the configured one doesn't exist.
- **Root folder**: Settings → Media Management → Root Folders, e.g. `/data/media/movies` → `RADARR_ROOT_FOLDER`

### 3. Configure

Copy `.env.example` to `.env` and fill it in. All variables:

| Variable                    | Required | Default   | Description                                                            |
| --------------------------- | -------- | --------- | ---------------------------------------------------------------------- |
| `DISCORD_TOKEN`             | yes      |           | Bot token                                                              |
| `DISCORD_CLIENT_ID`         | yes      |           | Application ID                                                         |
| `DISCORD_GUILD_ID`          |          |           | Register `/request` to one server only (updates instantly)             |
| `RADARR_URL`                | yes      |           | Radarr base URL, without `/api`                                        |
| `RADARR_API_KEY`            | yes      |           | Radarr API key                                                         |
| `RADARR_QUALITY_PROFILE_ID` |          | `1`       | Quality profile for new movies                                         |
| `RADARR_ROOT_FOLDER`        |          | `/movies` | Root folder for new movies; must exist in Radarr                       |
| `ALLOWED_GUILD_IDS`         |          | everyone  | Comma-separated server IDs where requests are allowed                  |
| `ALLOWED_ROLE_IDS`          |          | everyone  | Comma-separated role IDs allowed to make requests                      |
| `RATE_LIMIT_MAX`            |          | `3`       | Searches per user per window (`0` disables)                            |
| `RATE_LIMIT_WINDOW_MINUTES` |          | `10`      | Rate limit window                                                      |
| `DISK_SPACE_MIN_GB`         |          | `1024`    | Pause requests when the root folder has less free space (`0` disables) |
| `HTTP_TIMEOUT_MS`           |          | `15000`   | Timeout for Radarr calls                                               |
| `INSECURE_TLS`              |          | `false`   | Skip certificate checks for an `https` Radarr with a self-signed cert  |
| `LOG_LEVEL`                 |          | `info`    | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`        |

The bot checks its configuration at startup and exits with a list of anything missing or invalid. Once connected, it also checks the quality profile and root folder against Radarr and logs a warning if either doesn't match.

### 4. Register the slash command

Run this once, and again whenever the command definition changes:

```sh
npm run deploy-commands
# or, with Docker:
docker compose run --rm baconflix-bot node src/deploy-commands.js
```

Global commands can take a while to appear in Discord. Set `DISCORD_GUILD_ID` to register to a single server instantly.

### 5. Run it

**Docker Compose** (recommended). Put your `.env` next to [`docker-compose.yml`](docker-compose.yml), then:

```sh
docker compose up -d
docker compose logs -f
```

**Locally** (Node.js 22 or newer):

```sh
npm install
npm start
```

## Usage

```
/request query:Dune
/request query:tmdb:438631
/request query:imdb:tt1160419
```

## Logging

Logs are human-readable when run locally and JSON in Docker (`NODE_ENV=production`). Every request step is logged with the user, server, and movie, giving you an audit trail:

| Event                  | Meaning                                          |
| ---------------------- | ------------------------------------------------ |
| `request.searched`     | A user searched; includes query and result count |
| `request.added`        | A movie was added to Radarr                      |
| `request.exists`       | The movie was already in the library             |
| `request.denied`       | Blocked by the server/role allowlist             |
| `request.rate_limited` | Blocked by the rate limit                        |
| `request.low_disk`     | Blocked by the disk space check                  |
| `request.failed`       | Something went wrong; includes the full error    |

## Troubleshooting

| Symptom                                    | Fix                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `/request` doesn't show up                 | Run `deploy-commands`. Global commands can take a while; use `DISCORD_GUILD_ID` to test.                      |
| "Radarr rejected the API key"              | Check `RADARR_API_KEY`.                                                                                       |
| "Radarr is unreachable"                    | Check `RADARR_URL` is reachable from where the bot runs (inside Docker, `localhost` is the container itself). |
| "TLS certificate couldn't be verified"     | Use `http://`, a valid certificate, or set `INSECURE_TLS=true`.                                               |
| "The root folder … isn't set up in Radarr" | `RADARR_ROOT_FOLDER` must exactly match a root folder in Radarr.                                              |
| "This request has expired"                 | The button came from an old message; run `/request` again.                                                    |

## Development

```sh
npm run dev            # restart on file changes
npm test               # unit tests (node:test)
npm run format         # format with Prettier
```

CI runs the format check and tests on every pull request. Pushes to `main` also build and publish the Docker image to `ghcr.io/michael-han/baconflix`.

## Future enhancements

- **TV shows via Sonarr.** `src/radarr.js` is self-contained, so a matching `sonarr.js` client can be added alongside it.
- **"Your request is ready" notifications** using Radarr's webhook on import.
- **Persistent rate limits** that survive restarts.
