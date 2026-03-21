using System.Collections.Generic;
using UnityEngine;

namespace StreetViewVR
{
    /// <summary>
    /// Central manager for the Street View VR experience.
    ///
    /// Orchestrates the API client, panorama renderer, navigation arrows,
    /// and maintains history for the "go back" feature.
    /// </summary>
    public class StreetViewManager : MonoBehaviour
    {
        [Header("Scene References")]
        [SerializeField] private StreetViewApiClient apiClient;
        [SerializeField] private PanoramaRenderer    panoramaRenderer;
        [SerializeField] private Transform           navigationArrowContainer;
        [SerializeField] private GameObject          navigationArrowPrefab;
        [SerializeField] private LoadingIndicator    loadingIndicator;
        [SerializeField] private LocationSearchUI    locationSearchUI;
        [SerializeField] private Transform           playerRig;

        [Header("Starting Location")]
        [Tooltip("Default latitude when the app first starts.")]
        [SerializeField] private double startLatitude  = 40.7484;  // Empire State Building
        [Tooltip("Default longitude when the app first starts.")]
        [SerializeField] private double startLongitude = -73.9857;

        [Header("Navigation Arrows")]
        [Tooltip("Height above ground at which navigation arrows are placed (metres).")]
        [SerializeField] private float arrowHeight = -1.0f;
        [Tooltip("Distance from sphere centre at which arrows are placed.")]
        [SerializeField] private float arrowDistance = 10f;

        // ---- History ----
        private readonly Stack<string> _history = new Stack<string>();
        private string _currentPanoId;
        private bool   _isLoading;

        // ---- Property ----
        /// <summary>The VR player rig transform (used for snap-turn).</summary>
        public Transform PlayerRig => playerRig;

        // ---------------------------------------------------------
        // Unity lifecycle
        // ---------------------------------------------------------

        private void OnEnable()
        {
            apiClient.OnPanoramaLoaded += HandlePanoramaLoaded;
            apiClient.OnErrorOccurred  += HandleError;
        }

        private void OnDisable()
        {
            apiClient.OnPanoramaLoaded -= HandlePanoramaLoaded;
            apiClient.OnErrorOccurred  -= HandleError;
        }

        private void Start()
        {
            apiClient.LoadPanoramaAtLocation(startLatitude, startLongitude);
            SetLoading(true);
        }

        // ---------------------------------------------------------
        // Public navigation API
        // ---------------------------------------------------------

        /// <summary>Navigate to a panorama by its pano ID.</summary>
        public void NavigateTo(string panoId)
        {
            if (_isLoading || panoId == _currentPanoId) return;

            if (_currentPanoId != null)
                _history.Push(_currentPanoId);

            SetLoading(true);
            apiClient.LoadPanoramaById(panoId);
        }

        /// <summary>Navigate to the nearest panorama at the given address string.</summary>
        public void NavigateToAddress(string address)
        {
            if (_isLoading || string.IsNullOrWhiteSpace(address)) return;
            SetLoading(true);
            apiClient.LoadPanoramaAtAddress(address);
        }

        /// <summary>Navigate to the nearest panorama at explicit coordinates.</summary>
        public void NavigateToLocation(double lat, double lng)
        {
            if (_isLoading) return;
            SetLoading(true);
            apiClient.LoadPanoramaAtLocation(lat, lng);
        }

        /// <summary>Return to the previously visited panorama.</summary>
        public void GoBack()
        {
            if (_isLoading || _history.Count == 0) return;
            string prevPanoId = _history.Pop();
            SetLoading(true);
            apiClient.LoadPanoramaById(prevPanoId);
        }

        // ---------------------------------------------------------
        // Event handlers
        // ---------------------------------------------------------

        private void HandlePanoramaLoaded(PanoramaData data)
        {
            _currentPanoId = data.PanoId;

            panoramaRenderer.DisplayPanorama(data.Panorama);
            SpawnNavigationArrows(data.Links);

            SetLoading(false);
        }

        private void HandleError(string errorMessage)
        {
            SetLoading(false);
            locationSearchUI?.ShowError(errorMessage);
        }

        // ---------------------------------------------------------
        // Navigation arrow management
        // ---------------------------------------------------------

        private void SpawnNavigationArrows(StreetViewApiClient.Link[] links)
        {
            // Clear existing arrows
            foreach (Transform child in navigationArrowContainer)
                Destroy(child.gameObject);

            if (links == null || navigationArrowPrefab == null) return;

            foreach (var link in links)
            {
                float   headingRad = link.heading * Mathf.Deg2Rad;
                Vector3 direction  = new Vector3(Mathf.Sin(headingRad), 0, Mathf.Cos(headingRad));
                Vector3 position   = direction * arrowDistance + Vector3.up * arrowHeight;

                GameObject arrowGO = Instantiate(navigationArrowPrefab,
                                                 navigationArrowContainer);
                arrowGO.transform.localPosition = position;
                arrowGO.transform.LookAt(arrowGO.transform.position + direction);

                NavigationArrow arrow = arrowGO.GetComponent<NavigationArrow>();
                if (arrow != null)
                {
                    arrow.Initialize(link.pano_id, link.description);
                }
            }
        }

        // ---------------------------------------------------------
        // Loading state
        // ---------------------------------------------------------

        private void SetLoading(bool loading)
        {
            _isLoading = loading;
            if (loadingIndicator != null)
                loadingIndicator.SetVisible(loading);
        }
    }
}
