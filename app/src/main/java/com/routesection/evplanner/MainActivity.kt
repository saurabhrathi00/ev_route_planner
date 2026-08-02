package com.routesection.evplanner

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
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
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.MobileAds

/**
 * The planner itself lives in assets/index.html — the same file that runs in a
 * browser, so there is one implementation to keep correct rather than two.
 * This activity supplies the window, persistent storage, sane link handling,
 * the location permission the Start field asks for, and the banner ad.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private var ad: AdView? = null

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

        /* Initialising the ads SDK touches the disk and the network, and doing
         * it on the main thread stalls the first frame. Nothing below waits on
         * it — AdView.loadAd queues until initialisation lands. */
        Thread { MobileAds.initialize(this) }.start()

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
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView, request: WebResourceRequest
                ): Boolean {
                    val url = request.url
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
        slot.post { attachBanner(slot) }

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
     * the real width of the slot, so it fills the screen edge to edge on a
     * tablet instead of floating in the middle of a grey band, and it fills and
     * pays better. The width is only known once the slot has been laid out,
     * which is why this runs from a post().
     */
    private fun attachBanner(slot: LinearLayout) {
        val widthDp = (slot.width / resources.displayMetrics.density).toInt()
        if (widthDp <= 0) return
        val view = AdView(this).apply {
            adUnitId = getString(R.string.admob_banner_id)
            setAdSize(
                AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(this@MainActivity, widthDp)
            )
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
        }
        ad = view
        slot.addView(view)
        view.loadAd(AdRequest.Builder().build())
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
}
