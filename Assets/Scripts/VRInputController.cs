using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;
using UnityEngine.XR.Interaction.Toolkit;

namespace StreetViewVR
{
    /// <summary>
    /// Handles all Quest 3 controller input for the Street View VR experience.
    ///
    /// Controls:
    ///   Right Trigger    → Select / confirm (navigate to highlighted arrow)
    ///   Left  Thumbstick → Turn camera (snap rotation)
    ///   Right Thumbstick → Navigate forward to the next panorama link
    ///   B / Y button     → Go back to previous panorama
    ///   A button         → Toggle the location search UI
    ///   Menu button      → Show/hide the HUD
    /// </summary>
    public class VRInputController : MonoBehaviour
    {
        [Header("References")]
        [SerializeField] private StreetViewManager streetViewManager;
        [SerializeField] private LocationSearchUI  locationSearchUI;
        [SerializeField] private GameObject        hud;

        [Header("Snap Turn")]
        [Tooltip("Angle in degrees for each snap turn step.")]
        [SerializeField] private float snapAngle = 30f;
        [Tooltip("Dead-zone threshold for thumbstick snap turn.")]
        [SerializeField] private float thumbstickDeadZone = 0.7f;

        [Header("Gaze Navigation")]
        [Tooltip("Transform used as the gaze ray origin (usually the Main Camera).")]
        [SerializeField] private Transform gazeOrigin;
        [Tooltip("Layer mask for navigation arrow colliders.")]
        [SerializeField] private LayerMask navigationArrowLayer;
        [Tooltip("Maximum gaze distance in metres.")]
        [SerializeField] private float gazeDistance = 50f;
        [Tooltip("How long (seconds) the user must gaze at an arrow before auto-navigating.")]
        [SerializeField] private float gazeDwellTime = 2f;

        // ---- XR Input devices ----
        private InputDevice _rightController;
        private InputDevice _leftController;

        // ---- State tracking ----
        private bool  _prevRightTrigger;
        private bool  _prevLeftSnapTriggered;
        private bool  _prevRightSnapTriggered;
        private bool  _prevBButton;
        private bool  _prevAButton;
        private bool  _prevMenuButton;
        private bool  _hudVisible = true;

        // Gaze dwell
        private NavigationArrow _gazeTarget;
        private float           _gazeTimer;

        // ---------------------------------------------------------
        // Unity lifecycle
        // ---------------------------------------------------------

        private void OnEnable()
        {
            InputDevices.deviceConnected    += OnDeviceConnected;
            InputDevices.deviceDisconnected += OnDeviceDisconnected;
            TryInitDevices();
        }

        private void OnDisable()
        {
            InputDevices.deviceConnected    -= OnDeviceConnected;
            InputDevices.deviceDisconnected -= OnDeviceDisconnected;
        }

        private void Update()
        {
            HandleSnapTurn();
            HandleNavigationButtons();
            HandleGazeDwell();
        }

        // ---------------------------------------------------------
        // Input device management
        // ---------------------------------------------------------

        private void TryInitDevices()
        {
            var rightDevices = new List<InputDevice>();
            var leftDevices  = new List<InputDevice>();

            InputDevices.GetDevicesWithCharacteristics(
                InputDeviceCharacteristics.Right | InputDeviceCharacteristics.Controller,
                rightDevices);

            InputDevices.GetDevicesWithCharacteristics(
                InputDeviceCharacteristics.Left | InputDeviceCharacteristics.Controller,
                leftDevices);

            if (rightDevices.Count > 0) _rightController = rightDevices[0];
            if (leftDevices.Count  > 0) _leftController  = leftDevices[0];
        }

        private void OnDeviceConnected(InputDevice device) => TryInitDevices();
        private void OnDeviceDisconnected(InputDevice device) => TryInitDevices();

        // ---------------------------------------------------------
        // Snap turn
        // ---------------------------------------------------------

        private void HandleSnapTurn()
        {
            if (!_leftController.isValid) return;

            _leftController.TryGetFeatureValue(CommonUsages.primary2DAxis, out Vector2 thumbstick);

            bool snapLeft  = thumbstick.x < -thumbstickDeadZone;
            bool snapRight = thumbstick.x >  thumbstickDeadZone;

            if (snapLeft && !_prevLeftSnapTriggered)
                SnapTurn(-snapAngle);

            if (snapRight && !_prevRightSnapTriggered)
                SnapTurn(snapAngle);

            _prevLeftSnapTriggered  = snapLeft;
            _prevRightSnapTriggered = snapRight;
        }

        private void SnapTurn(float angle)
        {
            // Rotate the player rig around the Y axis
            Transform rig = streetViewManager.PlayerRig;
            if (rig == null) return;
            rig.Rotate(Vector3.up, angle, Space.World);
        }

        // ---------------------------------------------------------
        // Navigation buttons
        // ---------------------------------------------------------

        private void HandleNavigationButtons()
        {
            if (_rightController.isValid)
            {
                // Right trigger → navigate to gaze target
                _rightController.TryGetFeatureValue(CommonUsages.triggerButton, out bool triggerPressed);
                if (triggerPressed && !_prevRightTrigger && _gazeTarget != null)
                    streetViewManager.NavigateTo(_gazeTarget.LinkedPanoId);
                _prevRightTrigger = triggerPressed;

                // A button → toggle location search UI
                _rightController.TryGetFeatureValue(CommonUsages.primaryButton, out bool aPressed);
                if (aPressed && !_prevAButton)
                    locationSearchUI?.ToggleVisibility();
                _prevAButton = aPressed;
            }

            if (_leftController.isValid)
            {
                // B / Y button → go back
                _leftController.TryGetFeatureValue(CommonUsages.primaryButton, out bool bPressed);
                if (bPressed && !_prevBButton)
                    streetViewManager.GoBack();
                _prevBButton = bPressed;

                // Menu button → toggle HUD
                _leftController.TryGetFeatureValue(CommonUsages.menuButton, out bool menuPressed);
                if (menuPressed && !_prevMenuButton)
                {
                    _hudVisible = !_hudVisible;
                    if (hud != null) hud.SetActive(_hudVisible);
                }
                _prevMenuButton = menuPressed;
            }
        }

        // ---------------------------------------------------------
        // Gaze / dwell navigation
        // ---------------------------------------------------------

        private void HandleGazeDwell()
        {
            if (gazeOrigin == null) return;

            Ray ray = new Ray(gazeOrigin.position, gazeOrigin.forward);
            if (Physics.Raycast(ray, out RaycastHit hit, gazeDistance, navigationArrowLayer))
            {
                NavigationArrow arrow = hit.collider.GetComponent<NavigationArrow>();
                if (arrow != null)
                {
                    if (arrow == _gazeTarget)
                    {
                        _gazeTimer += Time.deltaTime;
                        arrow.SetGazeProgress(_gazeTimer / gazeDwellTime);

                        if (_gazeTimer >= gazeDwellTime)
                        {
                            _gazeTimer = 0f;
                            streetViewManager.NavigateTo(arrow.LinkedPanoId);
                        }
                    }
                    else
                    {
                        _gazeTarget?.SetGazeProgress(0f);
                        _gazeTarget = arrow;
                        _gazeTimer  = 0f;
                    }
                    return;
                }
            }

            // No arrow under gaze
            _gazeTarget?.SetGazeProgress(0f);
            _gazeTarget = null;
            _gazeTimer  = 0f;
        }
    }
}
