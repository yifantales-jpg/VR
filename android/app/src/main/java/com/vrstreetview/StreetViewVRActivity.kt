package com.vrstreetview

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.vrstreetview.databinding.ActivityStreetviewVrBinding

/**
 * StreetViewVRActivity
 *
 * Hosts a full-screen [WebView] that loads the A-Frame WebXR application.
 * On Meta Quest 3, the WebView supports WebXR (immersive-vr), which allows
 * the A-Frame scene to enter stereoscopic 6DoF VR mode when the user clicks
 * "Enter VR".
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  StreetViewVRActivity                                           │
 *   │  ┌─────────────────────────────────────────────────────────┐   │
 *   │  │  WebView  (full-screen, hardware-accelerated)           │   │
 *   │  │  ┌──────────────────────────────────────────────────┐   │   │
 *   │  │  │  A-Frame 1.5 WebXR scene (index.html)            │   │   │
 *   │  │  │  • <a-sky> — equirectangular panorama sphere      │   │   │
 *   │  │  │  • Nav arrows — adjacent panorama navigation      │   │   │
 *   │  │  │  • Controller / gaze interaction                  │   │   │
 *   │  │  └──────────────────────────────────────────────────┘   │   │
 *   │  └─────────────────────────────────────────────────────────┘   │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * The web app calls back into Kotlin via [AndroidBridge] to report status
 * or request the Google Maps API key at runtime.
 */
class StreetViewVRActivity : AppCompatActivity() {

    companion object {
        /** Intent extra key — pass the initial location query as a String. */
        const val EXTRA_LOCATION = "extra_location"

        /**
         * Base URL of the VR Street View web server.
         *
         * Configured via the `VR_SERVER_URL` property in `local.properties`:
         *   VR_SERVER_URL=https://your-deployment.example.com
         *
         * Defaults to the Android emulator localhost alias (10.0.2.2:3000) which
         * only works when running in the emulator. For a physical Quest 3, set
         * VR_SERVER_URL to your machine's LAN IP or a public HTTPS URL.
         *
         * Example local.properties for Quest 3 on Wi-Fi:
         *   VR_SERVER_URL=http://192.168.1.42:3000
         */
        private val WEB_APP_URL: String = BuildConfig.VR_SERVER_URL
    }

    private lateinit var binding: ActivityStreetviewVrBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Full-screen, keep screen on.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableImmersiveMode()

        binding = ActivityStreetviewVrBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupWebView()

        val location = intent.getStringExtra(EXTRA_LOCATION) ?: ""
        loadVRApp(location)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableImmersiveMode()
    }

    // ── WebView setup ─────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webView = binding.webView

        webView.settings.apply {
            javaScriptEnabled          = true
            domStorageEnabled          = true
            allowContentAccess         = true
            allowFileAccess            = false          // not loading local files
            mixedContentMode           = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = false    // allow auto-play in VR
            cacheMode                  = WebSettings.LOAD_DEFAULT
            loadWithOverviewMode       = true
            useWideViewPort            = true
            setSupportZoom(false)

            // Enable WebGL and WebXR
            setRenderPriority(WebSettings.RenderPriority.HIGH)
        }

        // Expose a Kotlin bridge so the JS app can call Android APIs.
        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                // Only allow navigation within our own origin.
                val host = request.url.host ?: return true
                val allowed = listOf("10.0.2.2", "localhost", "127.0.0.1")
                return host !in allowed
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                // Hide the native loading overlay once the page is ready.
                binding.loadingOverlay.visibility = View.GONE
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Grant WebXR / camera / microphone permissions automatically.
            override fun onPermissionRequest(request: PermissionRequest) {
                val allowed = arrayOf(
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE,
                    PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID,
                )
                request.grant(allowed.filter { it in request.resources }.toTypedArray())
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                // Forward JS console messages to Logcat for debugging.
                val tag = "[VR-WebView]"
                when (consoleMessage.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR ->
                        android.util.Log.e(tag, consoleMessage.message())
                    ConsoleMessage.MessageLevel.WARNING ->
                        android.util.Log.w(tag, consoleMessage.message())
                    else ->
                        android.util.Log.d(tag, consoleMessage.message())
                }
                return true
            }
        }
    }

    // ── Loading ───────────────────────────────────────────────────────────

    /**
     * Load the web app and pass the initial location as a URL fragment so
     * the JavaScript app can auto-start the Street View search.
     *
     * e.g. http://10.0.2.2:3000/#location=Eiffel%20Tower%2C%20Paris
     */
    private fun loadVRApp(location: String) {
        val encodedLocation = android.net.Uri.encode(location)
        val url = if (location.isNotEmpty()) {
            "$WEB_APP_URL/#location=$encodedLocation"
        } else {
            WEB_APP_URL
        }
        binding.webView.loadUrl(url)
    }

    // ── Immersive mode ────────────────────────────────────────────────────

    @Suppress("DEPRECATION")
    private fun enableImmersiveMode() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
    }

    // ── Android ↔ JavaScript bridge ────────────────────────────────────────

    /**
     * Methods in this class are callable from JavaScript via:
     *   window.AndroidBridge.methodName(args)
     *
     * All methods run on a background thread — use runOnUiThread if touching Views.
     */
    inner class AndroidBridge {

        /**
         * Called by the web app to retrieve the Google Maps API key stored
         * in the Android app's BuildConfig / resources (set via Gradle manifest
         * placeholder). This avoids hard-coding the key in the web bundle.
         *
         * @return The API key string, or empty string if not configured.
         */
        @JavascriptInterface
        fun getApiKey(): String {
            return try {
                val appInfo = packageManager.getApplicationInfo(
                    packageName, android.content.pm.PackageManager.GET_META_DATA
                )
                appInfo.metaData?.getString("com.google.android.geo.API_KEY") ?: ""
            } catch (e: Exception) {
                android.util.Log.e("[VR-Bridge]", "Failed to read API key", e)
                ""
            }
        }

        /**
         * Called by the web app when a panorama has been loaded successfully.
         * Can be used for analytics or to update native UI.
         *
         * @param panoId      Panorama ID.
         * @param description Human-readable location name.
         */
        @JavascriptInterface
        fun onPanoramaLoaded(panoId: String, description: String) {
            android.util.Log.i("[VR-Bridge]", "Panorama loaded: $description ($panoId)")
        }

        /**
         * Called by the web app when an error occurs.
         *
         * @param message Error message.
         */
        @JavascriptInterface
        fun onError(message: String) {
            android.util.Log.e("[VR-Bridge]", "Error: $message")
            runOnUiThread {
                binding.tvError.text = message
                binding.tvError.visibility = View.VISIBLE
            }
        }
    }
}
