import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* Signing details live in keystore.properties, which is gitignored. Without
 * that file the project still builds and the debug APK still works — only the
 * release build comes out unsigned, which is the safe default for a repo that
 * anyone can clone. See RELEASE.md for how to create the keystore. */
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}
val hasSigning = keystoreProps.getProperty("storeFile") != null

android {
    namespace = "com.routesection.evplanner"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.routesection.evplanner"
        minSdk = 26
        targetSdk = 35
        // Play rejects an upload whose versionCode it has seen before, so this
        // has to go up by at least one for every release you push.
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        create("release") {
            if (hasSigning) {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // The planner is one HTML asset and two small Kotlin files; there is
            // nothing for R8 to shrink that would pay for the risk of it
            // rewriting something the WebView reaches by name.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasSigning) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // the built file is named for the app rather than the module, so what lands
    // in Downloads reads as evroute-debug.apk, not app-debug.apk
    applicationVariants.all {
        outputs.all {
            (this as com.android.build.gradle.internal.api.BaseVariantOutputImpl)
                .outputFileName = "evroute-${buildType.name}.apk"
        }
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
}

/* A loud reminder rather than a silent unsigned artifact. */
tasks.matching { it.name == "bundleRelease" || it.name == "assembleRelease" }.configureEach {
    doFirst {
        if (!hasSigning) {
            logger.warn("")
            logger.warn("!!  No keystore.properties — this build will be UNSIGNED and Play will reject it.")
            logger.warn("!!  See RELEASE.md to create the keystore first.")
            logger.warn("")
        }
    }
}
