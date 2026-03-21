using TMPro;
using UnityEngine;

namespace StreetViewVR
{
    /// <summary>
    /// Visual 3D arrow placed inside the panorama sphere that indicates a navigable direction.
    ///
    /// Uses a simple gaze-progress ring animation to give the player feedback
    /// before auto-navigating on dwell (when triggered by VRInputController).
    /// </summary>
    public class NavigationArrow : MonoBehaviour
    {
        [Header("UI")]
        [SerializeField] private TextMeshPro  labelText;
        [SerializeField] private GameObject   gazeRingObject;
        [SerializeField] private MeshRenderer gazeRingRenderer;

        [Header("Visuals")]
        [SerializeField] private Color normalColor   = new Color(1f, 1f, 1f, 0.8f);
        [SerializeField] private Color highlightColor = new Color(0.3f, 0.8f, 1f, 1f);

        private static readonly int ProgressPropId = Shader.PropertyToID("_Progress");
        private static readonly int ColorPropId    = Shader.PropertyToID("_Color");

        private string _linkedPanoId;
        private float  _gazeProgress;
        private MeshRenderer _bodyRenderer; // cached to avoid per-frame GetComponent calls

        /// <summary>The panorama ID this arrow links to.</summary>
        public string LinkedPanoId => _linkedPanoId;

        // ---------------------------------------------------------
        // Public API
        // ---------------------------------------------------------

        /// <summary>Set the pano ID and optional street label for this arrow.</summary>
        public void Initialize(string panoId, string streetName)
        {
            _linkedPanoId = panoId;

            if (labelText != null)
                labelText.text = string.IsNullOrEmpty(streetName) ? "→" : streetName;
        }

        /// <summary>
        /// Called each frame by VRInputController with the current gaze progress (0–1).
        /// Drives the visual ring fill and colour highlight.
        /// </summary>
        public void SetGazeProgress(float progress)
        {
            _gazeProgress = Mathf.Clamp01(progress);

            bool isGazed = _gazeProgress > 0f;

            if (gazeRingObject != null)
                gazeRingObject.SetActive(isGazed);

            if (gazeRingRenderer != null && gazeRingRenderer.material != null)
                gazeRingRenderer.material.SetFloat(ProgressPropId, _gazeProgress);

            // Highlight the arrow body when gazed at
            if (_bodyRenderer != null)
                _bodyRenderer.material.SetColor(ColorPropId, isGazed ? highlightColor : normalColor);
        }

        // ---------------------------------------------------------
        // Subtle floating animation
        // ---------------------------------------------------------

        private Vector3 _basePosition;
        private float   _animOffset;

        private void Start()
        {
            _basePosition = transform.localPosition;
            _animOffset   = Random.Range(0f, Mathf.PI * 2f);

            // Cache the arrow body renderer (any MeshRenderer that isn't the gaze ring)
            foreach (var mr in GetComponentsInChildren<MeshRenderer>())
            {
                if (mr != gazeRingRenderer)
                {
                    _bodyRenderer = mr;
                    break;
                }
            }

            // Start with normal colour
            SetGazeProgress(0f);
        }

        private void Update()
        {
            // Gentle up/down hover
            float hover = Mathf.Sin(Time.time * 1.2f + _animOffset) * 0.08f;
            transform.localPosition = _basePosition + Vector3.up * hover;
        }
    }
}
