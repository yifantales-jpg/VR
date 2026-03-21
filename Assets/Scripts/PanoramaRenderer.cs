using UnityEngine;

namespace StreetViewVR
{
    /// <summary>
    /// Renders an equirectangular Street View panorama texture on an inverted sphere,
    /// creating the illusion of standing inside the panorama.
    ///
    /// Attach this component to a GameObject that has a MeshRenderer and a MeshFilter.
    /// The sphere mesh should have inverted normals (inside-out sphere) so that the
    /// texture is visible from inside.
    /// </summary>
    [RequireComponent(typeof(MeshRenderer))]
    [RequireComponent(typeof(MeshFilter))]
    public class PanoramaRenderer : MonoBehaviour
    {
        [Header("Sphere Settings")]
        [Tooltip("Radius of the panorama sphere in metres. Should enclose the player rig.")]
        [SerializeField] private float sphereRadius = 50f;

        [Tooltip("Horizontal resolution segments of the sphere mesh.")]
        [SerializeField, Range(64, 256)] private int longitudeSegments = 128;

        [Tooltip("Vertical resolution segments of the sphere mesh.")]
        [SerializeField, Range(32, 128)] private int latitudeSegments = 64;

        [Header("Fade")]
        [Tooltip("Duration in seconds for the panorama cross-fade transition.")]
        [SerializeField] private float fadeDuration = 0.5f;

        // ---- Shader property IDs (cached for performance) ----
        private static readonly int MainTexPropId   = Shader.PropertyToID("_MainTex");
        private static readonly int ColorPropId     = Shader.PropertyToID("_Color");

        private MeshRenderer  _meshRenderer;
        private MeshFilter    _meshFilter;
        private Material      _material;
        private Texture2D     _currentTexture;
        private bool          _isFading;
        private Texture2D     _pendingTexture; // queued while a fade is in progress

        // ---------------------------------------------------------
        // Unity lifecycle
        // ---------------------------------------------------------

        private void Awake()
        {
            _meshRenderer = GetComponent<MeshRenderer>();
            _meshFilter   = GetComponent<MeshFilter>();

            BuildInsideOutSphereMesh();
            CreateMaterial();
        }

        // ---------------------------------------------------------
        // Public API
        // ---------------------------------------------------------

        /// <summary>
        /// Display a new panorama texture with a smooth cross-fade.
        /// </summary>
        public void DisplayPanorama(Texture2D panorama)
        {
            if (_isFading)
            {
                // Queue the latest request; it will be applied when the fade ends
                _pendingTexture = panorama;
                return;
            }

            if (_currentTexture != null)
                StartCoroutine(FadeTransition(panorama));
            else
                ApplyTexture(panorama);
        }

        // ---------------------------------------------------------
        // Mesh construction
        // ---------------------------------------------------------

        /// <summary>
        /// Creates an inside-out UV sphere so the equirectangular texture maps
        /// correctly when viewed from inside.
        /// </summary>
        private void BuildInsideOutSphereMesh()
        {
            Mesh mesh = new Mesh { name = "InsideOutSphere" };
            mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;

            int vertCount = (latitudeSegments + 1) * (longitudeSegments + 1);
            Vector3[] vertices = new Vector3[vertCount];
            Vector2[] uvs      = new Vector2[vertCount];
            Vector3[] normals  = new Vector3[vertCount];

            int v = 0;
            for (int lat = 0; lat <= latitudeSegments; lat++)
            {
                float theta    = lat * Mathf.PI / latitudeSegments;    // 0 → π
                float sinTheta = Mathf.Sin(theta);
                float cosTheta = Mathf.Cos(theta);

                for (int lon = 0; lon <= longitudeSegments; lon++)
                {
                    float phi    = lon * 2 * Mathf.PI / longitudeSegments; // 0 → 2π
                    float sinPhi = Mathf.Sin(phi);
                    float cosPhi = Mathf.Cos(phi);

                    float x = cosPhi * sinTheta;
                    float y = cosTheta;
                    float z = sinPhi * sinTheta;

                    vertices[v] = new Vector3(x, y, z) * sphereRadius;
                    uvs[v]      = new Vector2((float)lon / longitudeSegments,
                                             1f - (float)lat / latitudeSegments);
                    // Invert normals → visible from inside
                    normals[v]  = -new Vector3(x, y, z);
                    v++;
                }
            }

            // Build triangles with inverted winding order
            int triCount = latitudeSegments * longitudeSegments * 6;
            int[] triangles = new int[triCount];
            int t = 0;
            for (int lat = 0; lat < latitudeSegments; lat++)
            {
                for (int lon = 0; lon < longitudeSegments; lon++)
                {
                    int first  = lat * (longitudeSegments + 1) + lon;
                    int second = first + longitudeSegments + 1;

                    // Inverted winding
                    triangles[t++] = first;
                    triangles[t++] = first + 1;
                    triangles[t++] = second;

                    triangles[t++] = second;
                    triangles[t++] = first + 1;
                    triangles[t++] = second + 1;
                }
            }

            mesh.vertices  = vertices;
            mesh.uv        = uvs;
            mesh.normals   = normals;
            mesh.triangles = triangles;

            _meshFilter.sharedMesh = mesh;
        }

        // ---------------------------------------------------------
        // Material / texture helpers
        // ---------------------------------------------------------

        private void CreateMaterial()
        {
            // Use Unlit/Texture so the panorama is not affected by scene lighting
            Shader shader = Shader.Find("Unlit/Texture");
            if (shader == null)
            {
                Debug.LogWarning("[PanoramaRenderer] 'Unlit/Texture' shader not found. " +
                                 "Falling back to Standard.");
                shader = Shader.Find("Standard");
            }

            _material = new Material(shader) { name = "PanoramaMaterial" };
            _meshRenderer.sharedMaterial = _material;

            // Disable backface culling so the inside surface renders
            _material.SetInt("_Cull", (int)UnityEngine.Rendering.CullMode.Off);
        }

        private void ApplyTexture(Texture2D tex)
        {
            _currentTexture = tex;
            _material.SetTexture(MainTexPropId, tex);
        }

        private System.Collections.IEnumerator FadeTransition(Texture2D newTex)
        {
            _isFading = true;

            // Fade out
            float elapsed = 0f;
            while (elapsed < fadeDuration)
            {
                elapsed += Time.deltaTime;
                float alpha = 1f - Mathf.Clamp01(elapsed / fadeDuration);
                _material.SetColor(ColorPropId, new Color(1, 1, 1, alpha));
                yield return null;
            }

            // Swap texture
            ApplyTexture(newTex);

            // Fade in
            elapsed = 0f;
            while (elapsed < fadeDuration)
            {
                elapsed += Time.deltaTime;
                float alpha = Mathf.Clamp01(elapsed / fadeDuration);
                _material.SetColor(ColorPropId, new Color(1, 1, 1, alpha));
                yield return null;
            }

            _material.SetColor(ColorPropId, Color.white);
            _isFading = false;

            // Apply any panorama that arrived while we were fading
            if (_pendingTexture != null)
            {
                Texture2D next = _pendingTexture;
                _pendingTexture = null;
                StartCoroutine(FadeTransition(next));
            }
        }
    }
}
