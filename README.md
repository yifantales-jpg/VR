# VR Street View — Meta Quest 3

Immersive Google Street View experience for Meta Quest 3, built with **A-Frame WebXR** and a **Node.js proxy server**, wrapped in a native **Android app** shell optimised for Quest 3.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Meta Quest 3                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Android App (VRStreetViewApp)                                │  │
│  │  ┌──────────────────┐   ┌─────────────────────────────────┐  │  │
│  │  │  MainActivity    │──▶│  StreetViewVRActivity           │  │  │
│  │  │  (location UI)   │   │  (full-screen WebView)          │  │  │
│  │  └──────────────────┘   │  ┌───────────────────────────┐  │  │  │
│  │                         │  │  A-Frame 1.5 WebXR Scene  │  │  │  │
│  │                         │  │  • <a-sky> panorama sphere │  │  │  │
│  │                         │  │  • Nav arrows (6DoF walk)  │  │  │  │
│  │                         │  │  • Controller raycasting   │  │  │  │
│  │                         │  └───────────────────────────┘  │  │  │
│  │                         └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         ▲  HTTPS / WebXR
         │
┌────────┴────────────────────────────────────────────────────────────┐
│  Node.js Server (server.js)                                         │
│  • Serves the A-Frame web app (public/)                             │
│  • Proxies Street View tile requests (avoids CORS)                  │
│  • Proxies CBK panorama metadata requests (no API key required)    │
└─────────────────────────────────────────────────────────────────────┘
         ▲
         │  Google Maps Platform APIs
┌────────┴────────────────────────────────────────────────────────────┐
│  Google Street View  (panorama tiles + metadata via CBK)            │
└─────────────────────────────────────────────────────────────────────┘
```

### Components

| Path | Purpose |
|------|---------|
| `public/index.html` | A-Frame VR scene — panorama sphere, nav arrows, camera rig |
| `public/js/street-view-service.js` | Google Maps URL parser, CBK panorama fetch, equirectangular tile stitching |
| `public/js/panorama-components.js` | Custom A-Frame components (`nav-arrow`, `street-view-scene`, etc.) |
| `public/js/app.js` | UI logic — search, location loading, scene transitions |
| `public/css/style.css` | Dark-theme UI styling |
| `server.js` | Express server — static files + Street View tile/metadata proxy |
| `android/` | Native Quest 3 Android app shell |

---

## Prerequisites

- **Node.js 18+** (for the server)
- *(For Android build)* Android Studio Hedgehog or later + Android SDK 34

> **No Google Maps API key required.** The app fetches panorama tiles and metadata directly from Google's public CBK tile service (`cbk0.google.com`), which is the same service used by the Maps SDK itself.

---

## Configuration

### Environment variables

Copy `.env.example` to `.env` and edit the values:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `META_AI_API_KEY` | No (Yes for AI Facts) | — | Llama API key — see below |
| `PORT` | No | `3000` | HTTP port |
| `HTTPS_PORT` | No | `3443` | HTTPS port |
| `SSL_CERT_FILE` | No | *(auto-generated)* | Path to PEM certificate file |
| `SSL_KEY_FILE` | No | *(auto-generated)* | Path to PEM private key file |

### Getting a Llama API key (`META_AI_API_KEY`)

The **"Discover Facts"** feature sends a snapshot of the current panorama to the [Meta Llama API](https://api.llama.com) to generate interesting location facts. To enable it:

1. Visit **<https://llama.developer.meta.com/>** and sign in with a Meta account.
2. Create a new application / project in the developer dashboard.
3. Copy the **API key** displayed in the dashboard.
4. Paste it into your `.env` file:
   ```
   META_AI_API_KEY=your_llama_api_key_here
   ```

> **Note:** Without `META_AI_API_KEY` the server still runs and Street View works normally — only the AI Facts endpoint (`POST /api/ai-facts`) will return HTTP 503.

---

## Quick Start — Web (Quest 3 Browser)

1. **Clone & install:**
   ```bash
   git clone https://github.com/yifantales-jpg/VR.git
   cd VR
   npm install
   ```

2. **Configure environment variables** (optional for basic use):
   ```bash
   cp .env.example .env
   # Edit .env and set META_AI_API_KEY if you want the AI Facts feature
   ```

3. **Start the server:**
   ```bash
   npm start
   # → HTTP  server running on http://localhost:3000
   # → HTTPS server running on https://localhost:3443
   ```

4. **Open in Quest 3:**
   - Find your machine's local IP (e.g. `192.168.1.42`).
   - Open the **Meta Browser** on your Quest 3.
   - Navigate to `https://192.168.1.42:3443`.
   - The browser will show a **security warning** about the self-signed certificate — tap **Advanced → Accept** to proceed (this is expected for local development).
   - Paste any Google Maps Street View URL into the input box and press **Load**.
   - Press **Enter VR** — the panorama loads on a 360° sphere.
   - Use your **controllers** or **head gaze** to follow the direction arrows and walk through Street View.

   > **Tip:** Your PC and Quest 3 must be on the same Wi-Fi network. HTTPS is required for WebXR immersive sessions.

---

## Testing on Quest 3

### Option A — Browser (no build needed, quickest)

1. Run `npm start` on your PC/Mac.
2. Find your machine's LAN IP:
   - **macOS/Linux:** `ifconfig | grep "inet "`
   - **Windows:** `ipconfig` → look for "IPv4 Address"
3. On the Quest 3, open **Meta Browser** and go to `https://<your-LAN-IP>:3443`.
4. Accept the self-signed certificate warning (tap **Advanced → Accept**).
5. Paste a Google Maps Street View URL (e.g. from `maps.google.com` on desktop) and tap **Load**.
6. Tap **Enter VR** to enter immersive mode.

### Option B — Sideloaded APK (Android native shell)

See the [Android App](#android-app) section below for build and install instructions.

> **Why HTTPS?** WebXR's `immersive-vr` session requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). The server automatically generates a self-signed certificate so you don't need to configure anything for local testing.

---

## Android App

The native Android wrapper launches the web app inside a full-screen `WebView` configured for Quest 3's immersive display.

### Build

1. Open `android/` in **Android Studio**.
2. In `android/local.properties`, set the server URL (use the HTTPS port for local development, production HTTPS URL when deploying):
   ```properties
   # For Quest 3 on Wi-Fi — use your machine's LAN IP with HTTPS port:
   VR_SERVER_URL=https://192.168.1.42:3443
   # For production (WebXR requires HTTPS):
   # VR_SERVER_URL=https://your-deployment.example.com
   ```
3. Connect your Quest 3 via USB with **Developer Mode** enabled.
4. Select **Run → Run 'app'**.

### Key Android files

| File | Description |
|------|-------------|
| `AndroidManifest.xml` | Declares `android.hardware.vr.high_performance` and Quest VR category |
| `MainActivity.kt` | Location search UI, launches `StreetViewVRActivity` |
| `StreetViewVRActivity.kt` | Full-screen WebView in immersive mode; exposes `AndroidBridge` JS interface |

### Sideloading (without Play Store)

```bash
# Build release APK
cd android
./gradlew assembleRelease

# Install on connected Quest 3
adb install app/build/outputs/apk/release/app-release.apk
```

---

## How It Works

### Panorama Tile Stitching

Google Street View stores panoramas as a grid of tiles at multiple zoom levels:

```
zoom=2 → 4 columns × 2 rows  (2048×1024 px — fast, lower quality)
zoom=3 → 8 columns × 4 rows  (4096×2048 px — default, good quality)
zoom=4 → 16 columns × 8 rows (8192×4096 px — high quality, slower)
```

The app fetches all tiles in parallel (via the `/api/tile` proxy), draws them onto a `<canvas>`, then applies the canvas as the texture of A-Frame's `<a-sky>` sphere. The equirectangular projection of the stitched canvas maps perfectly to the inside of the sphere, creating an immersive 360° view.

### VR Navigation

Navigation arrows appear on the ground plane at the compass headings of adjacent Street View panoramas. Users can:
- **Gaze** at an arrow (fuse timer: 1.5 s) to travel to the next panorama.
- **Point a controller** at an arrow and **pull the trigger** to navigate.
- Walking physically in your play area also moves the camera (Quest 3 room-scale).

### Security

- **No Google API key required.** Street View tiles and metadata are fetched from Google's public CBK tile service, the same endpoint used by the Maps SDK.
- **Llama API key** (`META_AI_API_KEY`) is only needed for the optional AI Facts feature. It is kept server-side and never exposed to the browser.
- The tile proxy validates all parameters (pano ID format, zoom/x/y bounds) before making upstream requests.
- Content Security Policy headers are set via `helmet`.

---

## Running Tests

```bash
npm test
```

Tests cover:
- Server route validation (tile params, geocode inputs, CSP)
- `StreetViewService` constructor options, URL building, data normalisation
- SPA fallback routing

---

## Deployment

For production deployment (HTTPS required for WebXR):

1. Deploy to any HTTPS host (Heroku, Railway, Fly.io, etc.). No Google API keys are required.
   - Set `META_AI_API_KEY` as an environment variable (or secret) in your hosting provider's dashboard to enable the AI Facts feature.
   - The server auto-generates a self-signed certificate when `SSL_CERT_FILE` / `SSL_KEY_FILE` are not set (suitable for local testing).
   - On a managed host, TLS is typically terminated at the reverse proxy — point `VR_SERVER_URL` to the `https://` address.
   - For self-hosted deployments, supply a real certificate via environment variables:
     ```bash
     SSL_CERT_FILE=/etc/letsencrypt/live/example.com/fullchain.pem
     SSL_KEY_FILE=/etc/letsencrypt/live/example.com/privkey.pem
     HTTPS_PORT=443 npm start
     ```
2. Update `VR_SERVER_URL` in `android/local.properties` to your production `https://` URL.
3. Rebuild and sideload the APK.

---

## License

MIT
