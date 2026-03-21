package com.vrstreetview

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import com.vrstreetview.databinding.ActivityMainBinding

/**
 * MainActivity — 2-D launcher screen.
 *
 * Displays a URL input field where the user can paste a Google Maps Street View
 * URL, then launches [StreetViewVRActivity] with that URL.
 *
 * On Quest 3, this screen is shown in the flat-panel app window before the
 * user enters immersive VR mode via the "Enter VR" button.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep the screen on while the launcher is open.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupLoadButton()
    }

    // ── UI setup ──────────────────────────────────────────────────────────

    private fun setupLoadButton() {
        binding.btnLoad.setOnClickListener {
            val mapsUrl = binding.etMapsUrl.text.toString().trim()
            if (mapsUrl.isNotEmpty()) {
                launchVR(mapsUrl)
            } else {
                binding.etMapsUrl.error = getString(R.string.error_empty_url)
            }
        }

        // Also launch on keyboard Enter.
        binding.etMapsUrl.setOnEditorActionListener { _, _, _ ->
            binding.btnLoad.performClick()
            true
        }
    }

    // ── Navigation ────────────────────────────────────────────────────────

    /**
     * Launch the immersive Street View VR activity with the given Google Maps URL.
     *
     * @param mapsUrl Google Maps Street View URL pasted by the user.
     */
    private fun launchVR(mapsUrl: String) {
        val intent = Intent(this, StreetViewVRActivity::class.java).apply {
            putExtra(StreetViewVRActivity.EXTRA_MAPS_URL, mapsUrl)
        }
        startActivity(intent)
    }
}
