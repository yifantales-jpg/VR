package com.vrstreetview

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import com.vrstreetview.databinding.ActivityMainBinding

/**
 * MainActivity — 2-D launcher screen.
 *
 * Displays a location search field and quick-access buttons, then launches
 * [StreetViewVRActivity] when the user selects a destination.
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

        setupQuickLinks()
        setupSearchButton()
    }

    // ── UI setup ──────────────────────────────────────────────────────────

    private fun setupQuickLinks() {
        val locations = mapOf(
            binding.btnEiffelTower    to "Eiffel Tower, Paris",
            binding.btnTimesSquare    to "Times Square, New York",
            binding.btnShibuya        to "Shibuya Crossing, Tokyo",
            binding.btnColosseum      to "Colosseum, Rome",
            binding.btnGrandCanyon    to "Grand Canyon, Arizona",
            binding.btnSydneyOpera    to "Sydney Opera House, Australia",
        )

        locations.forEach { (button, location) ->
            button.setOnClickListener { launchVR(location) }
        }
    }

    private fun setupSearchButton() {
        binding.btnSearch.setOnClickListener {
            val query = binding.etLocation.text.toString().trim()
            if (query.isNotEmpty()) {
                launchVR(query)
            } else {
                binding.etLocation.error = getString(R.string.error_empty_location)
            }
        }

        // Also launch on keyboard Enter.
        binding.etLocation.setOnEditorActionListener { _, _, _ ->
            binding.btnSearch.performClick()
            true
        }
    }

    // ── Navigation ────────────────────────────────────────────────────────

    /**
     * Launch the immersive Street View VR activity with the given location query.
     *
     * @param location Human-readable address or place name.
     */
    private fun launchVR(location: String) {
        val intent = Intent(this, StreetViewVRActivity::class.java).apply {
            putExtra(StreetViewVRActivity.EXTRA_LOCATION, location)
        }
        startActivity(intent)
    }
}
