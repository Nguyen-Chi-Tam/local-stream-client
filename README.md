
# LocalStream Client

## Purpose

LocalStream Client is a web UI for the LocalStream app that lets you stream your personal music library from a LocalStream server running on your own network. You point the client at your LocalStream server URL, then browse and play your albums, artists, and tracks directly in the browser — no cloud upload required.

<img src="public/localstream.png" alt="LocalStream client – connect screen" width="50%" />

You can also try the hosted version at: https://lsclient.qzz.io

## How to Use

### 1. Install and run LocalStream

- Install the LocalStream app on the device that will host your media library (desktop or phone).
- Open the app and start the server.
- In the LocalStream app, find the **Main Server URL** (for example: `http://192.168.1.11:8080`).

<img src="public/start-server-on-your-device.jpg" alt="LocalStream app – server URLs" width="50%" />

> Download LocalStream for Android: https://play.google.com/store/apps/details?id=com.jeet_studio.localstream4k&hl=en

### 2. Run the LocalStream Client locally (optional)

From this project folder:

1. Install dependencies:
   - `npm install`
2. Start the development server:
   - `npm run dev`
3. Open the URL shown in the terminal (by default `http://localhost:5173`) in your browser.

Or, to run the Node proxy server (if configured):

- `npm start`

### 3. Connect the client to your LocalStream server

1. Open the LocalStream Client (either the hosted version or your local dev server).
2. On the **Connect** page, copy the **Main Server URL** from the LocalStream app.
3. Paste that URL into the **LocalStream server address** field.
4. Click **Continue to my music**.
5. The app will remember this URL in your browser so you don’t need to enter it again next time.

<img src="public/type-the-server-address.png" alt="Paste the server address" width="50%" />

### 4. Browse and play your music

- Use the search bar and sort options to quickly find tracks.
- Click a track to start playback.
- Control playback with play/pause, previous/next, shuffle, and repeat.
- Album art is loaded from your LocalStream server, with a sensible default image when artwork isn’t available.

<img src="public/start-music-streaming.png" alt="Browse and play your music" width="50%" />

# Keyboard Controls

You can control music playback using the following keyboard shortcuts:

<img src="public/control-music-by-keyboard.jpg" alt="Music control keys" />

- **Space**: Play/Pause
- **C**: Previous track
- **M**: Next track
- **V**: Rewind 10 seconds
- **N**: Fast forward 10 seconds
- **B**: Restart current song


## Platform Support

- Audio (music) streaming is supported today.
- **Video & photo support will be available in Summer 2026.**

## Important note about connectivity & security

Right now, the hosted client at **https://lsclient.qzz.io** has a limitation:

- Modern browsers block secure (HTTPS) websites from directly talking to insecure (HTTP) servers on private networks.
- Because LocalStream servers currently run over plain HTTP on LAN addresses (for example `http://192.168.x.x:8080`), the hosted client may not work reliably on all devices unless extra networking steps (like local hosting or a reverse‑proxy / tunnel) are used.

I am sorry for this inconvenience and for any confusion it may cause. I am actively exploring safer, more user‑friendly options (such as better local hosting guidance and secure reverse‑proxy setups) so that you can connect to your own LocalStream server without exposing your library unnecessarily. This README will be updated as soon as a more robust solution is available.
