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
            /* 91% of the bundle is androidx and the Kotlin stdlib, most of it
             * never called — R8 has plenty to remove. It is also low risk here:
             * the only Kotlin is one Activity named in the manifest, which R8
             * always keeps, and the WebView reaches nothing by name (no
             * @JavascriptInterface bridge exists). */
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
