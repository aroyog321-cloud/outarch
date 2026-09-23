plugins { id("com.android.application") }

android {
  namespace = "dev.missioncontrol.companion"
  compileSdk = 36
  defaultConfig {
    applicationId = "dev.missioncontrol.companion"
    minSdk = 33
    targetSdk = 36
    versionCode = 1
    versionName = "1.0.0"
  }
  buildTypes { release { isMinifyEnabled = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") } }
}
