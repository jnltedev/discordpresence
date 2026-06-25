# Discord Rich Presence Local Control Panel

A lightweight background service for managing Discord Rich Presence through a modern web interface.

> **⚠️ Platform Support**
>
> This project has been **developed and tested exclusively on Linux** and is **officially supported only on Linux environments**.
>
> It may work on Windows or macOS, but these platforms have **not been tested** and are **not officially supported**.

## Features

- 🎮 Custom Discord Rich Presence
- 🌙 Modern dark mode interface
- 💾 Persistent server-side configuration
- 🔄 Automatic reconnect after Discord restarts
- 🚀 Background service (browser not required after saving)
- 🐳 Docker support
- 🖼️ Rich Presence image assets
- 🔘 Up to 2 Rich Presence buttons
- 🎭 Multiple activity types
  - Playing
  - Listening
  - Watching
  - Competing

## Preview

![Discord Rich Presence Local Control Panel](/assets/preview.png)

## How It Works

- The web interface is only required when you want to change your Rich Presence.
- Your latest configuration is stored in:

```text
./data/last-presence.json
```

- After saving, the browser can be closed.
- The background service keeps running.
- If Discord starts later or is restarted, the service automatically reconnects and restores the last saved Rich Presence.
- The **Clear** button removes both the active Rich Presence and the saved configuration.

## Requirements

- Linux (officially supported)
- Discord Desktop
- Docker & Docker Compose (optional)
- Node.js 20+ (without Docker)
- A Discord Application with Rich Presence enabled
> You can create a Discord Application in the [Discord Developer Portal](https://discord.com/developers/applications/) and copy its **Application (Client) ID** into `DISCORD_CLIENT_ID`.

## Docker

Copy the example environment file:

```bash
cp .env.example .env
```

Edit the configuration:

```env
DISCORD_CLIENT_ID=your_client_id_here
PORT=3000
AUTO_RESTORE=true
RECONNECT_INTERVAL_MS=1000
DATA_DIR=/app/data
```

Start the service:

```bash
docker compose up -d --build
```

If you're using the legacy Docker Compose (Compose V1), use:

```bash
docker-compose up -d --build
```

Open the Control Panel whenever you want to change your Rich Presence:

```text
http://localhost:3000
```

View logs:

```bash
docker compose logs -f
```

## Running without Docker (Linux)

For local development you can also run the application directly:

```bash
npm install
npm start
```

## License

This project is licensed under the **MIT License**.