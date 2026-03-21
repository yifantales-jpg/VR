using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace StreetViewVR
{
    /// <summary>
    /// VR-native location search panel.
    ///
    /// Renders as a World-Space Canvas so it floats in front of the player.
    /// The player can type an address (via a physical or virtual keyboard) and
    /// press "Go" to navigate to the nearest Street View panorama.
    ///
    /// Attach this script to a World-Space Canvas GameObject.
    /// </summary>
    public class LocationSearchUI : MonoBehaviour
    {
        [Header("References")]
        [SerializeField] private StreetViewManager streetViewManager;

        [Header("UI Elements")]
        [SerializeField] private TMP_InputField addressInputField;
        [SerializeField] private Button         goButton;
        [SerializeField] private Button         closeButton;
        [SerializeField] private TextMeshProUGUI errorLabel;
        [SerializeField] private TextMeshProUGUI coordinatesLabel;

        [Header("Panel Behaviour")]
        [Tooltip("How far in front of the camera to position the panel.")]
        [SerializeField] private float panelDistance = 1.5f;

        [Tooltip("Width of the UI panel in world units.")]
        [SerializeField] private float panelWidth = 0.8f;

        [Tooltip("Height of the UI panel in world units.")]
        [SerializeField] private float panelHeight = 0.4f;

        [Header("Quick Access Locations")]
        [SerializeField] private Button[] quickLocationButtons;
        [SerializeField] private string[] quickLocationAddresses = {
            "Times Square, New York",
            "Eiffel Tower, Paris",
            "Shibuya Crossing, Tokyo",
            "Colosseum, Rome",
            "Sydney Opera House, Australia"
        };

        private Transform _cameraTransform;

        // ---------------------------------------------------------
        // Unity lifecycle
        // ---------------------------------------------------------

        private void Awake()
        {
            // Cache the main camera early to avoid repeated FindGameObjectsWithTag lookups
            Camera cam = Camera.main;
            if (cam != null)
                _cameraTransform = cam.transform;

            if (goButton != null)
                goButton.onClick.AddListener(OnGoPressed);

            if (closeButton != null)
                closeButton.onClick.AddListener(() => SetVisible(false));

            // Wire quick location buttons
            for (int i = 0; i < quickLocationButtons.Length && i < quickLocationAddresses.Length; i++)
            {
                int idx = i; // Capture for closure
                quickLocationButtons[i].onClick.AddListener(() =>
                {
                    addressInputField.text = quickLocationAddresses[idx];
                    OnGoPressed();
                });
            }

            SetVisible(false);
        }

        private void Start()
        {
            // Fallback: try to get camera if not set in Awake (e.g. camera activates late)
            if (_cameraTransform == null)
            {
                Camera cam = Camera.main;
                if (cam != null)
                    _cameraTransform = cam.transform;
            }
        }

        // ---------------------------------------------------------
        // Public API
        // ---------------------------------------------------------

        /// <summary>Show or hide the location search panel.</summary>
        public void SetVisible(bool visible)
        {
            gameObject.SetActive(visible);

            if (visible)
            {
                RepositionInFrontOfPlayer();
                ClearError();

                if (addressInputField != null)
                    addressInputField.Select();
            }
        }

        /// <summary>Toggle visibility.</summary>
        public void ToggleVisibility()
        {
            SetVisible(!gameObject.activeSelf);
        }

        /// <summary>Display an error message in the panel.</summary>
        public void ShowError(string message)
        {
            if (errorLabel == null) return;

            errorLabel.text = message;
            errorLabel.gameObject.SetActive(true);
            SetVisible(true);
        }

        /// <summary>Update the coordinates display label.</summary>
        public void UpdateCoordinatesDisplay(double lat, double lng)
        {
            if (coordinatesLabel == null) return;
            coordinatesLabel.text = $"📍 {lat:F5}, {lng:F5}";
        }

        // ---------------------------------------------------------
        // Button handlers
        // ---------------------------------------------------------

        private void OnGoPressed()
        {
            if (streetViewManager == null) return;

            string address = addressInputField != null
                ? addressInputField.text.Trim()
                : string.Empty;

            if (string.IsNullOrEmpty(address)) return;

            ClearError();
            SetVisible(false);
            streetViewManager.NavigateToAddress(address);
        }

        // ---------------------------------------------------------
        // Helpers
        // ---------------------------------------------------------

        private void ClearError()
        {
            if (errorLabel != null)
                errorLabel.gameObject.SetActive(false);
        }

        private void RepositionInFrontOfPlayer()
        {
            if (_cameraTransform == null) return;

            // Place in front of camera, slightly below eye level
            Vector3 forward = _cameraTransform.forward;
            forward.y = 0f;
            forward.Normalize();

            transform.position = _cameraTransform.position
                                 + forward * panelDistance
                                 + Vector3.down * 0.1f;

            // Face the player
            transform.rotation = Quaternion.LookRotation(forward);
            transform.localScale = new Vector3(panelWidth, panelHeight, 1f);
        }
    }
}
