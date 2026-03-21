package com.vrstreetview

import android.app.Application

/**
 * Application subclass — lightweight, just for global initialisation hooks.
 */
class VRStreetViewApp : Application() {

    override fun onCreate() {
        super.onCreate()
        // No-op: Google Maps initialises automatically via the manifest meta-data key.
        // Extend here for analytics, crash reporting, etc.
    }
}
