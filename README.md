# BaconFlix 

 A Discord bot to request new additions to Plex servers using Servarr applications. 

## Usage with Docker Compose

You can run BaconFlix as a container using Docker Compose. This setup uses environment variables from your host system (not a .env file).

### Example `docker-compose.yml`
```yaml
version: '3.8'
services:
  baconflix-bot:
    image: ghcr.io/michael-han/baconflix:latest
    restart: unless-stopped
    environment:
      DISCORD_TOKEN: ${DISCORD_TOKEN}
      DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      RADARR_API_KEY: ${RADARR_API_KEY}
      RADARR_URL: ${RADARR_URL}
      DISCORD_GUILD_ID: ${DISCORD_GUILD_ID}
```

### Running the Bot

Set the required environment variables in your shell before running Docker Compose:

```pwsh
$env:DISCORD_TOKEN="your_discord_token"
$env:DISCORD_CLIENT_ID="your_client_id"
$env:RADARR_API_KEY="your_radarr_api_key"
$env:RADARR_URL="http://your_radarr_host:7878"
$env:DISCORD_GUILD_ID="your_guild_id"

# Then start the bot

docker-compose up -d
```

### Stopping the Bot
```pwsh
docker-compose down
```
