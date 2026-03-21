using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace StreetViewVR.Editor
{
    /// <summary>
    /// Editor utility for building the Street View VR APK for Meta Quest 3.
    /// Run via the menu: StreetViewVR → Build Quest 3 APK
    /// Or from the command line:
    ///   Unity -batchmode -quit -executeMethod StreetViewVR.Editor.QuestBuildScript.BuildQuestAPK
    /// </summary>
    public static class QuestBuildScript
    {
        [MenuItem("StreetViewVR/Build Quest 3 APK")]
        public static void BuildQuestAPK()
        {
            Debug.Log("[QuestBuild] Starting Quest 3 APK build...");

            // Configure build target
            EditorUserBuildSettings.SwitchActiveBuildTarget(
                BuildTargetGroup.Android, BuildTarget.Android);

            PlayerSettings.Android.minSdkVersion    = AndroidSdkVersions.AndroidApiLevel29;
            PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel32;

            // ARM64 for Quest 3
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;

            // IL2CPP scripting backend for performance
            PlayerSettings.SetScriptingBackend(
                BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);

            // Set app identifier
            PlayerSettings.applicationIdentifier = "com.defaultcompany.streetviewvr";
            PlayerSettings.productName           = "Street View VR";

            string[] scenes = { "Assets/Scenes/StreetViewVR.unity" };

            var buildOptions = new BuildPlayerOptions
            {
                scenes      = scenes,
                locationPathName = "Build/StreetViewVR.apk",
                target      = BuildTarget.Android,
                options     = BuildOptions.None
            };

            BuildReport  report  = BuildPipeline.BuildPlayer(buildOptions);
            BuildSummary summary = report.summary;

            if (summary.result == BuildResult.Succeeded)
            {
                Debug.Log($"[QuestBuild] Build succeeded. APK: {buildOptions.locationPathName} " +
                          $"({summary.totalSize / 1024 / 1024} MB)");
            }
            else
            {
                Debug.LogError($"[QuestBuild] Build FAILED with {summary.totalErrors} error(s).");
            }
        }

        [MenuItem("StreetViewVR/Install APK to Connected Quest")]
        public static void InstallAPK()
        {
            string adbPath = GetAdbPath();
            if (string.IsNullOrEmpty(adbPath))
            {
                Debug.LogError("[QuestBuild] ADB not found. Check Android SDK path in Preferences.");
                return;
            }

            string apkPath = "Build/StreetViewVR.apk";
            if (!System.IO.File.Exists(apkPath))
            {
                Debug.LogError("[QuestBuild] APK not found. Build first.");
                return;
            }

            var process = new System.Diagnostics.Process
            {
                StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName               = adbPath,
                    Arguments              = $"install -r \"{apkPath}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError  = true,
                    UseShellExecute        = false,
                    CreateNoWindow         = true
                }
            };

            process.Start();
            string output = process.StandardOutput.ReadToEnd();
            string error  = process.StandardError.ReadToEnd();
            process.WaitForExit();

            if (process.ExitCode == 0)
                Debug.Log($"[QuestBuild] APK installed successfully.\n{output}");
            else
                Debug.LogError($"[QuestBuild] ADB install failed:\n{error}");
        }

        private static string GetAdbPath()
        {
            string androidSdkPath = EditorPrefs.GetString("AndroidSdkRoot");
            if (string.IsNullOrEmpty(androidSdkPath)) return null;

            string adb = System.IO.Path.Combine(androidSdkPath, "platform-tools",
                Application.platform == RuntimePlatform.WindowsEditor ? "adb.exe" : "adb");

            return System.IO.File.Exists(adb) ? adb : null;
        }
    }
}
