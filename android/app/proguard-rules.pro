# ProGuard rules for VR Street View.
# Keep Google Maps classes
-keep class com.google.android.gms.maps.** { *; }
-keep interface com.google.android.gms.maps.** { *; }

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }

# Keep the JavaScript interface bridge
-keepclassmembers class com.vrstreetview.StreetViewVRActivity$AndroidBridge {
    public *;
}
