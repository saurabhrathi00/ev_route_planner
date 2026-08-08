package com.routesection.evplanner

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.ump.ConsentDebugSettings
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import android.webkit.JavascriptInterface
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The planner itself lives in assets/index.html — the same file that runs in a
 * browser, so there is one implementation to keep correct rather than two.
 * This activity supplies the window, persistent storage, sane link handling,
 * the location permission the Start field asks for, and the banner ad.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private var ad: AdView? = null

    private lateinit var consent: ConsentInformation
    private var adSlot: LinearLayout? = null
    /** MobileAds.initialize is not idempotent in any way worth relying on. */
    private val adsStarted = AtomicBoolean(false)

    /**
     * The WebView asks for location on its own schedule — whenever the user
     * taps the crosshair in the Start field — and wants an answer through a
     * callback it hands us at that moment. Android's permission dialog answers
     * later, on another turn of the loop, so the callback has to wait here in
     * between. One at a time: a second tap while the dialog is up would be the
     * same question.
     */
    private var pendingOrigin: String? = null
    private var pendingGeo: GeolocationPermissions.Callback? = null

    private val askLocation =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            pendingGeo?.invoke(pendingOrigin, granted, false)
            pendingGeo = null
            pendingOrigin = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        /* Consent before advertising.
         *
         * The app asked for none. It shipped the advertising ID and the Privacy
         * Sandbox permissions — the ads SDK merges them into the manifest — and
         * then served personalised ads to whoever opened it. In India nobody
         * stops you. In the EEA and the UK Google requires a certified consent
         * platform before a personalised ad is served, and in California and a
         * dozen other American states the law requires an opt-out of sharing
         * for targeted advertising. Going global without this is not a revenue
         * question, it is a compliance one.
         *
         * The platform that does it was already inside play-services-ads and
         * had never been called — R8 was stripping it as unused code.
         *
         * The order matters: gather consent, then start the SDK, and only then
         * ask for a banner. Starting the SDK first is what leaks a request
         * before anyone has agreed to it. */
        consent = UserMessagingPlatform.getConsentInformation(this)
        consent.requestConsentInfoUpdate(
            this,
            consentParams(),
            {
                UserMessagingPlatform.loadAndShowConsentFormIfRequired(this) { formError ->
                    if (formError != null) Log.w(ADS, "consent form: ${formError.message}")
                    startAdsIfAllowed()
                    tellPageAboutPrivacyOptions()
                }
            },
            { requestError ->
                /* No answer from the consent service — offline, most likely.
                 * canRequestAds is false until it succeeds, so no ad is
                 * requested and the app simply carries on without one. */
                Log.w(ADS, "consent update: ${requestError.message}")
                startAdsIfAllowed()
            }
        )
        /* A returning reader who already answered does not wait for the network
         * to say so again. */
        startAdsIfAllowed()

        web = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f)
            settings.apply {
                javaScriptEnabled = true
                // localStorage: the trip log, cached terrain and settings depend on it
                domStorageEnabled = true
                databaseEnabled = true
                loadWithOverviewMode = true
                useWideViewPort = true
                cacheMode = WebSettings.LOAD_DEFAULT
                // the layout is already responsive; system font scaling would fight it
                textZoom = 100
                // the Start field's crosshair; the prompt below still gates it
                setGeolocationEnabled(true)
            }
            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(
                    origin: String, callback: GeolocationPermissions.Callback
                ) {
                    val fine = Manifest.permission.ACCESS_FINE_LOCATION
                    if (ContextCompat.checkSelfPermission(this@MainActivity, fine)
                        == PackageManager.PERMISSION_GRANTED
                    ) {
                        callback.invoke(origin, true, false)
                        return
                    }
                    if (pendingGeo != null) {           // a dialog is already up
                        callback.invoke(origin, false, false)
                        return
                    }
                    pendingOrigin = origin
                    pendingGeo = callback
                    askLocation.launch(fine)
                }
            }
            /* The one thing the page cannot do for itself.
             *
             * Everything else in this app happens in the WebView; this cannot,
             * because a statement about which app is running has to come from
             * outside the app. Play Integrity is an Android API, so the page
             * asks through here and gets an answer back the same way.
             *
             * The interface is deliberately one method wide. addJavascriptInterface
             * exposes whatever it is given to whatever the WebView has loaded,
             * which is why it has a reputation — here the page is our own file
             * on disk, and the only thing reachable is "please attest this
             * nonce", which is useless to anyone who is not us. */
            addJavascriptInterface(Attest(), "SafarNative")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView, request: WebResourceRequest
                ): Boolean {
                    val url = request.url
                    /* The page needs a way to reopen the consent form, and a
                     * link is a smaller hole in the wall than a JavaScript
                     * bridge: nothing is exposed to the page except the ability
                     * to ask for this one thing. */
                    if (url.scheme == "evroute" && url.host == "privacy-options") {
                        UserMessagingPlatform.showPrivacyOptionsForm(this@MainActivity) { e ->
                            if (e != null) Log.w(ADS, "privacy options: ${e.message}")
                        }
                        return true
                    }
                    // charger entries point at Google Maps or OSM: hand them to the real browser
                    if (url.scheme == "http" || url.scheme == "https") {
                        return try {
                            startActivity(Intent(Intent.ACTION_VIEW, url)); true
                        } catch (e: ActivityNotFoundException) {
                            false
                        }
                    }
                    return false
                }
            }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
            addView(web)
        }
        setContentView(root)

        /* The banner goes below the WebView rather than over it. The planner
         * has its own fixed bar at the foot of the page — the Plan button —
         * and an overlaid ad would cover exactly that. Shortening the WebView
         * instead keeps every control reachable. */
        val slot = LinearLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
        }
        root.addView(slot)
        adSlot = slot
        slot.post { startAdsIfAllowed() }

        if (savedInstanceState == null) {
            web.loadUrl("file:///android_asset/index.html")
        } else {
            web.restoreState(savedInstanceState)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    /**
     * An anchored adaptive banner rather than a fixed 320x50: it is sized from
     * the real width it has to fill, so it goes edge to edge on a tablet
     * instead of floating in the middle of a grey band, and it fills and pays
     * better for it.
     *
     * The slot's own width is preferred, but it is not relied on. post() only
     * promises to run after the view is attached, not after it has been
     * measured, so slot.width can still be zero here — and an early return on
     * that would mean no AdView is ever created and the banner silently never
     * appears. The window width is the same number in every layout this app
     * has, so fall back to it rather than give up.
     */
    /**
     * Where the consent platform should think we are.
     *
     * The form only appears where the law asks for one, which from here is
     * nowhere — so on a debug build the SDK is told to behave as though the
     * phone were in the EEA. Without this the whole flow is untestable from
     * India: it would go to review unseen, and the first person to find out
     * whether it works would be a reviewer in Berlin.
     *
     * A release build gets none of it. The debug pathway is chosen from the
     * package's own debuggable flag rather than a constant someone has to
     * remember to flip.
     *
     * The device has to be named as a test device, and its id is a hash the SDK
     * prints to logcat the first time it sees one it does not know:
     *
     *     adb logcat | grep "addTestDeviceHashedId"
     *
     * Paste that into TEST_DEVICE and the form comes up on this phone.
     */
    private fun consentParams(): ConsentRequestParameters {
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (!debuggable) return ConsentRequestParameters.Builder().build()
        val debug = ConsentDebugSettings.Builder(this)
            .setDebugGeography(ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA)
            .apply { if (TEST_DEVICE.isNotEmpty()) addTestDeviceHashedId(TEST_DEVICE) }
            .build()
        Log.i(ADS, "debug build: asking for consent as though in the EEA")
        return ConsentRequestParameters.Builder().setConsentDebugSettings(debug).build()
    }

    /**
     * Starts the ads SDK and asks for a banner, but only once consent allows it
     * and only once. Called from several places — the consent callbacks, the
     * returning-user path, and the moment the slot is laid out — because
     * whichever of those happens last is the one that has everything it needs.
     */
    private fun startAdsIfAllowed() {
        if (!consent.canRequestAds()) return
        val slot = adSlot ?: return
        if (adsStarted.getAndSet(true)) {
            if (ad == null) attachBanner(slot)
            return
        }
        /* Initialising touches the disk and the network; on the main thread it
         * stalls the first frame. Nothing waits on it — loadAd queues. */
        Thread { MobileAds.initialize(this) }.start()
        attachBanner(slot)
    }

    /** Tells the page whether there is a consent choice worth offering. */
    private fun tellPageAboutPrivacyOptions() {
        val required = consent.privacyOptionsRequirementStatus ==
            ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        web.evaluateJavascript(
            "window.__privacyOptions = $required;" +
                "window.dispatchEvent(new Event('privacyoptions'));", null
        )
    }

    private fun attachBanner(slot: LinearLayout) {
        val px = if (slot.width > 0) slot.width else resources.displayMetrics.widthPixels
        val widthDp = (px / resources.displayMetrics.density).toInt()
        if (widthDp <= 0) return

        val view = AdView(this).apply {
            adUnitId = getString(R.string.admob_banner_id)
            setAdSize(
                AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(this@MainActivity, widthDp)
            )
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
            /* A banner that does not appear looks identical whether the request
             * failed, went unfilled, or was never made. Say which, so the next
             * person does not go looking through the layout for a bug that is
             * really an empty ad network. */
            adListener = object : AdListener() {
                override fun onAdLoaded() {
                    Log.i(ADS, "banner loaded")
                }
                override fun onAdFailedToLoad(e: LoadAdError) {
                    Log.w(ADS, "banner failed: code=${e.code} ${e.message}")
                }
            }
        }
        ad = view
        slot.addView(view)
        view.loadAd(AdRequest.Builder().build())
    }

    private companion object {
        const val ADS = "SafarAds"
        const val ATTEST = "SafarAttest"
        /** From logcat on the phone you want to test on; debug builds only. */
        const val TEST_DEVICE = ""
    }

    override fun onPause() {
        ad?.pause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        ad?.resume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        ad?.destroy()
        web.destroy()
        super.onDestroy()
    }

    /* The bridge, and all of it.
     *
     * The page hands over a nonce it was given by our service and gets back
     * Google's signed statement about this app: package name, signing
     * certificate, whether Play installed it, whether it has been tampered
     * with. The service checks that statement with Google before answering
     * anything that costs money, so a repackaged copy of this app — which by
     * definition carries a different signing certificate — gets a refusal
     * instead of our Google quota.
     *
     * Failure is reported, not swallowed. The page falls back to the open
     * charger sources when attestation does not arrive, and it can only do that
     * if it is told.
     */
    private inner class Attest {
        @JavascriptInterface
        fun request(nonce: String, callbackId: String) {
            try {
                val manager = IntegrityManagerFactory.create(applicationContext)
                manager.requestIntegrityToken(
                    IntegrityTokenRequest.builder().setNonce(nonce).build()
                ).addOnSuccessListener { response ->
                    reply(callbackId, response.token(), null)
                }.addOnFailureListener { e ->
                    /* The error codes worth knowing are transient ones — no
                     * network, Play Services updating, the per-app rate limit.
                     * None of them mean "this is a clone", so none of them are
                     * treated as fatal here; the page simply carries on without
                     * Google until the next attempt. */
                    Log.w(ATTEST, "integrity: ${e.message}")
                    reply(callbackId, null, e.message ?: "integrity unavailable")
                }
            } catch (e: Exception) {
                Log.w(ATTEST, "integrity: ${e.message}")
                reply(callbackId, null, e.message ?: "integrity unavailable")
            }
        }

        private fun reply(callbackId: String, token: String?, error: String?) {
            val js = "window.__attestDone && window.__attestDone(" +
                quote(callbackId) + "," + quote(token) + "," + quote(error) + ")"
            runOnUiThread { web.evaluateJavascript(js, null) }
        }

        /* JSON string quoting by hand, because the alternative is dragging in a
         * JSON library to escape three values that this class produced itself.
         * Google's token is base64 and the ids are ours, but the error message
         * comes from a Play Services exception and can contain anything. */
        private fun quote(v: String?): String =
            if (v == null) "null"
            else "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", " ").replace("\r", " ") + "\""
    }
}
