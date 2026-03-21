using TMPro;
using UnityEngine;

namespace StreetViewVR
{
    /// <summary>
    /// Displays a loading spinner and status message while a panorama is being fetched.
    ///
    /// Renders as a World-Space element locked to the bottom of the player's view.
    /// </summary>
    public class LoadingIndicator : MonoBehaviour
    {
        [Header("UI Elements")]
        [SerializeField] private GameObject      spinnerRoot;
        [SerializeField] private Transform       spinnerIcon;
        [SerializeField] private TextMeshProUGUI statusLabel;

        [Header("Spinner")]
        [SerializeField] private float spinSpeed = 180f; // degrees per second

        private bool _visible;

        // ---------------------------------------------------------
        // Unity lifecycle
        // ---------------------------------------------------------

        private void Update()
        {
            if (!_visible || spinnerIcon == null) return;

            spinnerIcon.Rotate(Vector3.forward, -spinSpeed * Time.deltaTime, Space.Self);
        }

        // ---------------------------------------------------------
        // Public API
        // ---------------------------------------------------------

        public void SetVisible(bool visible)
        {
            _visible = visible;
            if (spinnerRoot != null)
                spinnerRoot.SetActive(visible);
        }

        public void SetStatus(string message)
        {
            if (statusLabel != null)
                statusLabel.text = message;
        }
    }
}
