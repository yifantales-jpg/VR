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
         ▲  HTTP / WebXR
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

## Quick Start — Web (Quest 3 Browser)

1. **Clone & install:**
   ```bash
   git clone https://github.com/yifantales-jpg/VR.git
   cd VR
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   # → Server running on http://localhost:3000
   ```

3. **Open in Quest 3:**
   - Find your machine's local IP (e.g. `192.168.1.42`).
   - Open the **Meta Browser** on your Quest 3.
   - Navigate to `http://192.168.1.42:3000`.
   - Paste any Google Maps Street View URL into the input box and press **Load**.
   - Press **Enter VR** — the panorama loads on a 360° sphere.
   - Use your **controllers** or **head gaze** to follow the direction arrows and walk through Street View.

   > **Tip:** Your PC and Quest 3 must be on the same Wi-Fi network.

---

## Testing on Quest 3

### Option A — Browser (no build needed, quickest)

1. Run `npm start` on your PC/Mac.
2. Find your machine's LAN IP:
   - **macOS/Linux:** `ifconfig | grep "inet "`
   - **Windows:** `ipconfig` → look for "IPv4 Address"
3. On the Quest 3, open **Meta Browser** and go to `http://<your-LAN-IP>:3000`.
4. Paste a Google Maps Street View URL (e.g. from `maps.google.com` on desktop) and tap **Load**.
5. Tap **Enter VR** to enter immersive mode.

### Option B — Sideloaded APK (Android native shell)

See the [Android App](#android-app) section below for build and install instructions.

> **Note:** WebXR's immersive-vr session works in Meta Browser on Quest 3 without any special flags or developer settings.

---

## Android App

The native Android wrapper launches the web app inside a full-screen `WebView` configured for Quest 3's immersive display.

### Build

1. Open `android/` in **Android Studio**.
2. In `android/local.properties`, set the server URL (your LAN IP while developing, production HTTPS URL when deploying):
   ```properties
   # For Quest 3 on Wi-Fi — use your machine's LAN IP:
   VR_SERVER_URL=http://192.168.1.42:3000
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

- **No API key is used or required.** All requests go to Google's public CBK tile service, the same endpoint used by the Maps SDK.
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

1. Deploy to any HTTPS host (Heroku, Railway, Fly.io, etc.). No environment variables are required — the app uses Google's public CBK tile service with no API key.
2. Update `WEB_APP_URL` in `android/app/src/main/java/com/vrstreetview/StreetViewVRActivity.kt` to your production URL.
3. Rebuild and sideload the APK.

---

## License

MIT
