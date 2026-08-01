plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.routesection.evplanner"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.routesection.evplanner"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // the built file is named for the app rather than the module, so what lands
    // in Downloads reads as ev-route-planner-debug.apk, not app-debug.apk
    applicationVariants.all {
        outputs.all {
            (this as com.android.build.gradle.internal.api.BaseVariantOutputImpl)
                .outputFileName = "ev-route-planner-${buildType.name}.apk"
        }
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
}
