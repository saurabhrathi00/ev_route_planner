import UIKit
import WebKit

/// The planner itself lives in Resources/index.html — the same file that runs in
/// a browser and inside the Android WebView, so there is one implementation to
/// keep correct rather than three. This controller supplies the window,
/// persistent storage and sane link handling, mirroring MainActivity.kt.
final class WebHostViewController: UIViewController {

    private var web: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        let cfg = WKWebViewConfiguration()
        // the default store is on disk, so localStorage — the trip log, cached
        // terrain and saved keys — survives the app being closed
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true

        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.allowsBackForwardNavigationGestures = true   // edge-swipe goes back a view
        web.scrollView.bounces = false                   // the layout is fixed; rubber-banding fights it
        web.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { web.isInspectable = true }

        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        // the page paints its own background; matching it here stops a white
        // flash before first paint and while rubber-banding
        view.backgroundColor = UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0.059, green: 0.078, blue: 0.075, alpha: 1)   // --paper dark
                : UIColor(red: 0.906, green: 0.918, blue: 0.886, alpha: 1)   // --paper light
        }
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.scrollView.backgroundColor = view.backgroundColor

        load()
    }

    private func load() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html") else {
            assertionFailure("index.html missing from the bundle")
            return
        }
        // read access is granted to the containing directory so the page can
        // reach anything shipped alongside it
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    /// The web app drives the status bar colour through its own theme, and the
    /// page is edge to edge, so follow the system appearance.
    override var preferredStatusBarStyle: UIStatusBarStyle { .default }
}

extension WebHostViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {

        guard let url = navigationAction.request.url else {
            decisionHandler(.allow); return
        }

        // charger entries point at Google Maps or OSM: hand them to the real
        // browser rather than stranding the user inside the app
        if url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        NSLog("Route Section: navigation failed — %@", error.localizedDescription)
    }
}
