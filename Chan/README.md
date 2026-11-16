# Kuroba Lite

A lightweight, minimalist, Chrome-based imageboard thin-client web application for **Windows, macOS, and Linux**, inspired by [Kuroba-Experimental](https://github.com/K1rakishou/Kuroba-Experimental).

## Features
- **All Major Chans with Toggles**: 4chan, Lainchan, 8kun, 2ch.hk (Dvach), Arisuchan, Sushigirl, Wizardchan, and Kohlchan — toggle any site ON/OFF in Settings (`⚙`).
- **Searchable Boards Dropdown**: Instant board search with `/code/`, title, and `NSFW` indicators.
- **NSFW Filter**: One-click `SFW` / `NSFW` toggle in the top bar to hide NSFW boards and optionally blur NSFW media until hovered.
- **Media Downloads**:
  - Per-file download button on every post & inside the media lightbox.
  - **Download All (.zip)** in any thread to package all thread images/videos into a single ZIP archive in-browser.
- **Kuroba-Style Browsing**: Catalog Grid/List views, sorting (Bump, Replies, Images, Newest), live thread/post search, interactive `>>123456` quote hover previews & backlinks, lightbox (images + WebM/MP4), bookmarks, auto-refresh, and Dark / AMOLED / Light themes.

---

## Option 1: Chrome Thin-Client App (Windows, Mac & Linux)

Requires **Python 3** (no `pip` packages needed). Starts a tiny local static server + allowlisted CORS proxy and opens Chrome in frameless `--app` window mode:

- **Windows**: Double-click `launch.bat` (or run `python server.py`)
- **macOS / Linux**:
  ```bash
  chmod +x launch.sh
  ./launch.sh
  ```
  Or directly: `python3 server.py`

You can also install it as a Chrome PWA (`Install Kuroba Lite`) from Chrome's address bar when visiting `http://127.0.0.1:8787`.

## Option 2: Zero-Server Chrome Extension (Windows, Mac & Linux)

No Python or server required:
1. Open `chrome://extensions` in Chrome (or Brave/Edge/Chromium).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the **Kuroba Lite** icon in your Chrome toolbar to launch.
