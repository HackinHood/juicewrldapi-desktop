## JuiceWRLD-API Desktop

**Status**: Beta. Expect rough edges. Please report issues and feedback.

### Overview

JuiceWRLD-API Desktop is a cross‑platform Electron app for managing and playing your audio library with optional background sync and Discord Rich Presence. It runs on macOS, Windows, and Linux.

### Features

- **Account system**: Create and sign in from the Accounts tab.
- **Folder sync**: Choose which folders to sync from Settings; background sync keeps your library up to date.
- **Audio player**: Built‑in player.
- **Discord Rich Presence**: Optional integration to show what you're listening to.
- **Cross‑platform builds**: Native installers for macOS, Windows, and Linux.

### Download

- Use the Releases on GitHub for signed builds when available.
- macOS: DMG or ZIP
- Windows: NSIS installer (EXE)
- Linux: AppImage

### Build from source

Requirements:

- Node.js 18+ and npm

Install and run in dev mode:

```bash
npm install
npm start
```

Create production builds:

```bash
# macOS (universal):
npm run build:mac-universal

# macOS (arm64 or x64):
npm run build:mac-arm64
npm run build:mac-x64

# Windows:
npm run build:win

# Linux:
npm run build:linux
```

Artifacts are placed in `dist-new/`.

### Getting started

1. **Create an account**
   - Open the **Accounts** tab.
   - Create a new account or sign in.

2. **Pick folders to sync**
   - Open **Settings**.
   - Choose the folders you want to sync.
   - Enable **Background Sync** if you want the app to keep your library updated automatically.

3. **Play your music**
   - Use the built‑in **Player** to browse and play your synced files.

### Troubleshooting

- If the app cannot access folders, re‑select them in **Settings** and ensure the OS granted disk access.
- If background sync is not running, check that the toggle is enabled in **Settings** and restart the app.

### Contributing

Issues and pull requests are welcome. Please include your OS, app version, and clear steps to reproduce any problems.

### License

MIT
