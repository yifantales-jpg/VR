# Street View VR for Meta Quest 3

Immersive Google Street View viewer for the Meta Quest 3 headset. Walk the
streets of any city on Earth from inside your VR headset — look around in 360°,
navigate between panoramas using your gaze or controllers, and jump to any
location in the world.

---

## Features

| Feature | Detail |
|---|---|
| **Immersive 360° panoramas** | Equirectangular Street View tiles rendered on an inside-out sphere at 50 m radius |
| **High-quality imagery** | Configurable tile zoom (1–4) fetches up to 4096 × 2048 px panoramas from Google's CDN |
| **Smooth transitions** | Cross-fade between panoramas with configurable fade duration |
| **Quest 3 controller input** | Snap-turn, trigger-to-navigate, back-button history, A-button location search |
| **Gaze / dwell navigation** | Look at a directional arrow for 2 seconds to auto-navigate — no button needed |
| **Location search** | Type any address or landmark; geocoded via Google Maps API |
| **5 quick-access presets** | Times Square, Eiffel Tower, Shibuya, Colosseum, Sydney Opera House |
| **Back button** | Retrace your steps through a navigation history stack |
| **Single-pass instanced stereo** | Optimised for Quest 3's GPU with multiview rendering |
| **Meta XR SDK 60** | Hand tracking, foveated rendering, phase sync enabled by default |

---

## Project Structure

```
VR/
├── Assets/
│   ├── Editor/
│   │   └── QuestBuildScript.cs       # One-click APK build + ADB install menu
│   ├── Plugins/
│   │   └── Android/
│   │       ├── AndroidManifest.xml   # Quest 3 permissions & VR category
│   │       └── res/xml/
│   │           └── network_security_config.xml
│   ├── Resources/
│   │   └── Shaders/
│   │       └── PanoramaSphere.shader # Custom HLSL shader (single-pass stereo)
│   ├── Scenes/
│   │   └── StreetViewVR.unity        # Main VR scene
│   └── Scripts/
│       ├── StreetViewApiClient.cs    # Google Maps API + tile downloading
│       ├── StreetViewManager.cs      # Orchestrator (history, navigation, arrows)
│       ├── PanoramaRenderer.cs       # Inside-out sphere mesh + texture display
│       ├── VRInputController.cs      # Quest 3 controller + gaze input
│       ├── NavigationArrow.cs        # 3D arrow with gaze-progress ring
│       ├── LocationSearchUI.cs       # World-space location search panel
│       └── LoadingIndicator.cs       # Spinner overlay during tile downloads
├── Packages/
│   └── manifest.json                 # Unity package dependencies
├── ProjectSettings/
│   ├── ProjectSettings.asset         # Android/Quest 3 build target
│   ├── XRGeneralSettings.asset       # OpenXR + Oculus loader
│   ├── OculusSettings.asset          # Quest 3 perf settings
│   ├── EditorBuildSettings.asset     # Scene list
│   └── TagManager.asset              # NavigationArrow layer (layer 8)
└── README.md
```

---

## Prerequisites

| Requirement | Version / Notes |
|---|---|
| Unity | **2022.3 LTS** (tested) or 2023.x |
| Meta XR SDK | 60.0.0 (installed via scoped registry) |
| Android Build Support | Install via Unity Hub → Add Modules |
| Meta Quest Developer Hub (MQDH) | For sideloading the APK |
| Google Maps Platform account | Street View Static API + Geocoding API enabled |
| Quest 3 headset | Developer mode enabled |

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/yifantales-jpg/VR.git
cd VR
```

### 2. Open in Unity

Open **Unity Hub**, click **Open**, and select the cloned folder.  
Unity will resolve packages automatically (may take a few minutes on first open).

### 3. Add your Google Maps API key

1. In the **Hierarchy**, select **StreetViewVR_Manager → StreetViewApiClient**.
2. In the **Inspector**, replace `YOUR_GOOGLE_MAPS_API_KEY` with your key.

> **Required APIs** (enable in Google Cloud Console):
> - Street View Static API
> - Geocoding API

### 4. Configure Meta XR

1. Open **Meta → Tools → OVR Project Setup Tool**.
2. Click **Fix All** to apply recommended Quest 3 settings.
3. Go to **Edit → Project Settings → XR Plug-in Management** and ensure
   **Oculus** is checked under the Android tab.

### 5. Build & sideload

#### Option A — Unity menu
```
StreetViewVR → Build Quest 3 APK
```
The APK is saved to `Build/StreetViewVR.apk`.

#### Option B — Command line (CI/CD)
```bash
Unity -batchmode -quit \
  -projectPath /path/to/VR \
  -executeMethod StreetViewVR.Editor.QuestBuildScript.BuildQuestAPK \
  -logFile build.log
```

#### Sideload via MQDH
Drag `Build/StreetViewVR.apk` onto the **Meta Quest Developer Hub** app list,
or use the Unity menu:
```
StreetViewVR → Install APK to Connected Quest
```

---

## Controls

| Input | Action |
|---|---|
| **Left thumbstick** ← / → | Snap-turn 30° left / right |
| **Right trigger** | Navigate to the gazed arrow |
| **Gaze at arrow (2 sec)** | Auto-navigate (dwell navigation) |
| **A button** (right) | Toggle location search panel |
| **B / Y button** (left) | Go back to previous panorama |
| **Menu button** (left) | Toggle HUD |

---

## Architecture Overview

```
VRInputController
      │
      ▼  (navigate / snap turn / search)
StreetViewManager
      │                    │
      ▼                    ▼
StreetViewApiClient   PanoramaRenderer
 (fetch metadata      (build inside-out
  + tiles)             sphere, display
      │                 texture, fade)
      │
      ▼
 Google Maps API
  - metadata endpoint  → pano_id, lat/lng, links[]
  - tile CDN           → 512×512 JPEG tiles
  - geocoding endpoint → lat/lng from address
```

### Panorama tile stitching

1. Fetch Street View **metadata** (pano ID, lat/lng, navigable links).
2. Download all tiles for the chosen zoom level:
   - zoom 1 → 2 × 1 tiles (1024 × 512 total)
   - zoom 2 → 4 × 2 tiles (2048 × 1024 total) ← default
   - zoom 3 → 8 × 4 tiles (4096 × 2048 total)
   - zoom 4 → 16 × 8 tiles (8192 × 4096 total)
3. Copy tiles into a single `Texture2D` using `Graphics.CopyTexture`.
4. Apply the texture to the `PanoramaSphere` material.

### Inside-out sphere

`PanoramaRenderer` procedurally generates a sphere mesh at runtime with:
- **Inverted normals** → visible from inside
- **Inverted triangle winding** → correct backface visibility
- **32-bit index format** → supports 128 × 64 segment resolution

### Navigation arrows

`StreetViewManager` spawns `NavigationArrow` prefabs at positions calculated
from each link's `heading` value (degrees from north). `VRInputController`
casts a gaze ray each frame and drives a per-arrow gaze-progress ring UI.

---

## Performance Tips for Quest 3

- Use **tile zoom level 2** (default) for a good quality/performance balance.
- Enable **Fixed Foveated Rendering** level 2 in `OculusSettings.asset`.
- Enable **Phase Sync** to reduce latency.
- Build with **IL2CPP + ARM64** for maximum native performance.
- Keep the panorama sphere at **50 m radius** to minimise overdraw.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Black sphere on startup | Check API key is set and Street View Static API is enabled |
| "No panorama available" error | The location has no Street View coverage; try a nearby address |
| Tiles fail to download on device | Confirm device has internet; check `network_security_config.xml` |
| Controllers not detected | Ensure Oculus XR Plugin is enabled under Android in XR Plug-in Management |
| Build fails with IL2CPP errors | Install NDK r23b via Unity Hub → Add Modules |

---

## License

MIT © 2024 Street View VR Contributors
