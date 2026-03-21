using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace StreetViewVR
{
    /// <summary>
    /// Handles all communication with the Google Street View and Maps APIs.
    /// Supports fetching panorama metadata, tiles, and geocoding locations.
    /// </summary>
    public class StreetViewApiClient : MonoBehaviour
    {
        // ---- Configurable in Inspector ----
        [Header("API Configuration")]
        [Tooltip("Your Google Maps Platform API key. Enable Street View Static API and Geocoding API.")]
        [SerializeField] private string apiKey = "YOUR_GOOGLE_MAPS_API_KEY";

        [Tooltip("Desired tile zoom level for panorama quality (1-4). Higher = better quality but more downloads.")]
        [SerializeField, Range(1, 4)] private int tileZoom = 2;

        // ---- Public events ----
        public event Action<PanoramaData> OnPanoramaLoaded;
        public event Action<string>       OnErrorOccurred;

        // ---- Constants ----
        // Google Street View tile dimensions per zoom level
        // zoom 1 → 2×1, zoom 2 → 4×2, zoom 3 → 8×4, zoom 4 → 16×8
        private const int TileSize = 512;

        // Public endpoint used by the Google Maps web client (no API key needed)
        private const string TileUrlFormat =
            "https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=maps_sv.tactile&panoid={0}&x={1}&y={2}&zoom={3}&nbt=1&fover=2";

        // Metadata endpoint (requires API key)
        private const string MetaUrlFormat =
            "https://maps.googleapis.com/maps/api/streetview/metadata?location={0},{1}&key={2}";

        private const string MetaByPanoIdUrlFormat =
            "https://maps.googleapis.com/maps/api/streetview/metadata?pano={0}&key={1}";

        // Geocoding endpoint (requires API key)
        private const string GeoCodeUrlFormat =
            "https://maps.googleapis.com/maps/api/geocode/json?address={0}&key={1}";

        // ---------------------------------------------------------
        // Public API
        // ---------------------------------------------------------

        /// <summary>
        /// Load a Street View panorama nearest to the given lat/lng.
        /// </summary>
        public void LoadPanoramaAtLocation(double latitude, double longitude)
        {
            StartCoroutine(FetchMetadataAndTiles(latitude, longitude));
        }

        /// <summary>
        /// Load a Street View panorama by its panorama ID directly.
        /// </summary>
        public void LoadPanoramaById(string panoId)
        {
            StartCoroutine(FetchMetadataByPanoId(panoId));
        }

        /// <summary>
        /// Geocode a human-readable address, then load the nearest panorama.
        /// </summary>
        public void LoadPanoramaAtAddress(string address)
        {
            StartCoroutine(GeocodeAndLoad(address));
        }

        // ---------------------------------------------------------
        // Internal coroutines
        // ---------------------------------------------------------

        private IEnumerator GeocodeAndLoad(string address)
        {
            string url = string.Format(GeoCodeUrlFormat,
                UnityWebRequest.EscapeURL(address), apiKey);

            using (var req = UnityWebRequest.Get(url))
            {
                yield return req.SendWebRequest();

                if (req.result != UnityWebRequest.Result.Success)
                {
                    EmitError($"Geocoding failed: {req.error}");
                    yield break;
                }

                GeocodeResponse geo = JsonUtility.FromJson<GeocodeResponse>(req.downloadHandler.text);
                if (geo == null || geo.results == null || geo.results.Length == 0)
                {
                    EmitError($"No geocoding results for: {address}");
                    yield break;
                }

                double lat = geo.results[0].geometry.location.lat;
                double lng = geo.results[0].geometry.location.lng;
                yield return StartCoroutine(FetchMetadataAndTiles(lat, lng));
            }
        }

        private IEnumerator FetchMetadataAndTiles(double latitude, double longitude)
        {
            string url = string.Format(MetaUrlFormat, latitude, longitude, apiKey);
            yield return StartCoroutine(FetchMetadataFromUrl(url));
        }

        private IEnumerator FetchMetadataByPanoId(string panoId)
        {
            string url = string.Format(MetaByPanoIdUrlFormat, panoId, apiKey);
            yield return StartCoroutine(FetchMetadataFromUrl(url));
        }

        private IEnumerator FetchMetadataFromUrl(string metaUrl)
        {
            using (var req = UnityWebRequest.Get(metaUrl))
            {
                yield return req.SendWebRequest();

                if (req.result != UnityWebRequest.Result.Success)
                {
                    EmitError($"Metadata request failed: {req.error}");
                    yield break;
                }

                StreetViewMetadata meta = JsonUtility.FromJson<StreetViewMetadata>(req.downloadHandler.text);
                if (meta == null || meta.status != "OK" || string.IsNullOrEmpty(meta.pano_id))
                {
                    EmitError($"Street View metadata status: {meta?.status ?? "null"}. " +
                              "No panorama available at this location.");
                    yield break;
                }

                yield return StartCoroutine(FetchPanoramaTiles(meta));
            }
        }

        private IEnumerator FetchPanoramaTiles(StreetViewMetadata meta)
        {
            // Tile grid dimensions per zoom level:
            // zoom 1 → 2 cols × 1 row, zoom 2 → 4 cols × 2 rows,
            // zoom 3 → 8 cols × 4 rows, zoom 4 → 16 cols × 8 rows
            int cols = (int)Mathf.Pow(2, tileZoom);         // 2^zoom
            int rows = Mathf.Max(1, (int)Mathf.Pow(2, tileZoom - 1)); // 2^(zoom-1)

            int totalWidth  = cols * TileSize;
            int totalHeight = rows * TileSize;

            Texture2D panorama = new Texture2D(totalWidth, totalHeight, TextureFormat.RGB24, false);

            int totalTiles  = cols * rows;
            int loadedTiles = 0;
            bool hasError   = false;

            for (int y = 0; y < rows && !hasError; y++)
            {
                for (int x = 0; x < cols && !hasError; x++)
                {
                    string tileUrl = string.Format(TileUrlFormat, meta.pano_id, x, y, tileZoom);

                    using (var req = UnityWebRequestTexture.GetTexture(tileUrl))
                    {
                        yield return req.SendWebRequest();

                        if (req.result != UnityWebRequest.Result.Success)
                        {
                            EmitError($"Tile download failed ({x},{y}): {req.error}");
                            hasError = true;
                            break;
                        }

                        Texture2D tile = DownloadHandlerTexture.GetContent(req);

                        // Copy tile into panorama texture (flip Y to match Unity UV convention)
                        int destX = x * TileSize;
                        int destY = (rows - 1 - y) * TileSize;
                        Graphics.CopyTexture(tile, 0, 0, 0, 0, tile.width, tile.height,
                                             panorama, 0, 0, destX, destY);

                        Destroy(tile);
                        loadedTiles++;
                    }
                }
            }

            if (hasError) yield break;

            panorama.Apply();

            var data = new PanoramaData
            {
                PanoId    = meta.pano_id,
                Latitude  = meta.location.lat,
                Longitude = meta.location.lng,
                Copyright = meta.copyright,
                Date      = meta.date,
                Panorama  = panorama,
                Links     = meta.links
            };

            OnPanoramaLoaded?.Invoke(data);
        }

        private void EmitError(string msg)
        {
            Debug.LogError($"[StreetViewApiClient] {msg}");
            OnErrorOccurred?.Invoke(msg);
        }

        // ---------------------------------------------------------
        // JSON Data Models
        // ---------------------------------------------------------

        [Serializable]
        private class StreetViewMetadata
        {
            public string   status;
            public string   pano_id;
            public Location location;
            public string   copyright;
            public string   date;
            public Link[]   links;
        }

        [Serializable]
        public class Location
        {
            public double lat;
            public double lng;
        }

        [Serializable]
        public class Link
        {
            public string  pano_id;
            public float   heading;
            public string  description;
        }

        [Serializable]
        private class GeocodeResponse
        {
            public GeocodeResult[] results;
        }

        [Serializable]
        private class GeocodeResult
        {
            public GeocodeGeometry geometry;
        }

        [Serializable]
        private class GeocodeGeometry
        {
            public GeocodeLocation location;
        }

        [Serializable]
        private class GeocodeLocation
        {
            public double lat;
            public double lng;
        }
    }

    /// <summary>
    /// Holds all data for a loaded Street View panorama.
    /// </summary>
    public class PanoramaData
    {
        public string    PanoId;
        public double    Latitude;
        public double    Longitude;
        public string    Copyright;
        public string    Date;
        public Texture2D Panorama;
        public StreetViewApiClient.Link[] Links;
    }
}
