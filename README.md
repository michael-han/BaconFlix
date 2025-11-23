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
```
