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
        /* This is the app's permanent identity on Play — it was fixed when the
         * listing was created and can never be changed afterwards. It does not
         * have to match `namespace` above, which only names the generated R and
         * BuildConfig classes and stays with the Kotlin source's own package. */
        applicationId = "com.evroute.app"
        minSdk = 26
        targetSdk = 35
        // Play rejects an upload whose versionCode it has seen before, so this
        // has to go up by at least one for every release you push.
        versionCode = 27
        versionName = "1.3"
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

    /* AdMob ids by build type rather than one pair in strings.xml.
     *
     * Tapping a live ad on your own build is click fraud as far as AdMob is
     * concerned, and it suspends the account rather than warning it — so the
     * one build you actually run on your desk must never carry the live ids.
     * Debug gets Google's public test ids, which always fill and are safe to
     * tap; release gets the real ones. Neither can be selected by accident,
     * and there is no pair to remember to swap back.
     *
     * A blank banner on debug therefore means something is wrong with the app.
     * A blank banner on release, with debug filling, means the ad network has
     * nothing to serve yet — a new unit is empty for hours, sometimes a day. */
    buildTypes {
        debug {
            resValue("string", "admob_app_id",    "ca-app-pub-3940256099942544~3347511713")
            resValue("string", "admob_banner_id", "ca-app-pub-3940256099942544/6300978111")
        }
        release {
            resValue("string", "admob_app_id",    "ca-app-pub-7536334678303309~4946224393")
            resValue("string", "admob_banner_id", "ca-app-pub-7536334678303309/7584830177")
            /* Most of the bundle is androidx, the ads SDK and the Kotlin
             * stdlib, much of it never called — R8 has plenty to remove. It is
             * also low risk here: the only Kotlin is one Activity named in the
             * manifest, which R8 always keeps; the WebView reaches nothing by
             * name (no @JavascriptInterface bridge exists); and play-services
             * ships the keep rules its own reflection needs. */
            isMinifyEnabled = true
            isShrinkResources = true
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
    // banner ad under the planner; ids are set per build type above
    implementation("com.google.android.gms:play-services-ads:23.6.0")
    /* Not used directly — pinned because the ads SDK drags in a fragment
     * version older than 1.3.0, and registerForActivityResult (the location
     * permission prompt) is unsafe on those: FragmentActivity used to skip
     * super.onRequestPermissionsResult() and hand back invalid request codes.
     * Lint fails the release build on it, correctly. */
    implementation("androidx.fragment:fragment-ktx:1.8.5")
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
