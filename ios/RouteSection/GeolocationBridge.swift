import CoreLocation
import WebKit

/// `navigator.geolocation`, for a page loaded from `file://`.
///
/// The Start field has a crosshair that fills itself in from the device's own
/// position, and on Android the WebView answers that call itself once the
/// permission is granted. WKWebView will not: it gates geolocation on a secure
/// origin, and a page loaded off disk does not have one — the call neither
/// succeeds nor reports why, which from the planner's side is indistinguishable
/// from a device with no GPS.
///
/// So the API is replaced rather than argued with. A script injected before the
/// page runs defines `navigator.geolocation` in terms of a message to here;
/// CoreLocation answers, and the result is handed back to the waiting promise.
/// The planner is untouched by any of this and cannot tell the difference,
/// which is the point — it is one file across three platforms.
final class GeolocationBridge: NSObject {

    static let handlerName = "evrouteGeo"

    private weak var web: WKWebView?
    private let manager = CLLocationManager()

    /// Requests that have been asked for and not yet answered. Keyed by the id
    /// the injected script generates, because more than one can be outstanding
    /// — a tap while a fix is still coming in is a second, separate promise.
    private var pending: [Int] = []

    init(web: WKWebView) {
        self.web = web
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// Injected at document start so the planner sees the replacement rather
    /// than the real one, whichever WebKit would have offered.
    static var userScript: WKUserScript {
        let js = """
        (function(){
          var seq = 0, waiting = {};

          window.__evrouteGeoOk = function(id, lat, lng, acc, ts){
            var w = waiting[id]; if(!w) return; delete waiting[id];
            clearTimeout(w.timer);
            w.ok({ coords:{ latitude:lat, longitude:lng, accuracy:acc,
                            altitude:null, altitudeAccuracy:null,
                            heading:null, speed:null },
                   timestamp: ts });
          };

          window.__evrouteGeoFail = function(id, code, message){
            var w = waiting[id]; if(!w) return; delete waiting[id];
            clearTimeout(w.timer);
            // the shape the W3C API promises: PERMISSION_DENIED 1,
            // POSITION_UNAVAILABLE 2, TIMEOUT 3
            w.fail({ code:code, message:message,
                     PERMISSION_DENIED:1, POSITION_UNAVAILABLE:2, TIMEOUT:3 });
          };

          function getCurrentPosition(ok, fail, opts){
            var id = ++seq;
            var ms = (opts && opts.timeout) || 20000;
            waiting[id] = {
              ok: ok || function(){},
              fail: fail || function(){},
              /* The native side has no timeout of its own — a location fix
                 that never arrives would otherwise leave the button spinning
                 for the rest of the session. */
              timer: setTimeout(function(){
                var w = waiting[id]; if(!w) return; delete waiting[id];
                w.fail({ code:3, message:'Timed out waiting for a location',
                         PERMISSION_DENIED:1, POSITION_UNAVAILABLE:2, TIMEOUT:3 });
              }, ms)
            };
            try{
              window.webkit.messageHandlers.\(handlerName).postMessage({ id:id });
            }catch(e){
              window.__evrouteGeoFail(id, 2, 'Location is unavailable in this build');
            }
          }

          Object.defineProperty(navigator, 'geolocation', {
            configurable: true,
            value: {
              getCurrentPosition: getCurrentPosition,
              /* Nothing in the planner watches a position — it asks once, when
                 the crosshair is tapped. Answering once and stopping is closer
                 to honest than pretending to stream. */
              watchPosition: function(ok, fail, opts){
                getCurrentPosition(ok, fail, opts); return 0;
              },
              clearWatch: function(){}
            }
          });
        })();
        """
        return WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    private func call(_ js: String) {
        DispatchQueue.main.async { self.web?.evaluateJavaScript(js, completionHandler: nil) }
    }

    private func fail(_ code: Int, _ message: String) {
        let ids = pending; pending.removeAll()
        for id in ids {
            call("window.__evrouteGeoFail(\(id), \(code), \(jsString(message)));")
        }
    }

    /// Quote for embedding in a JS call. Messages are ours, not user input,
    /// but a stray quote would break the call silently and that is a poor way
    /// to find out.
    private func jsString(_ s: String) -> String {
        let escaped = s
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
        return "\"\(escaped)\""
    }

    private func start() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()      // the delegate resumes this
        case .restricted, .denied:
            fail(1, "Location permission was refused — you can allow it in Settings")
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        @unknown default:
            fail(2, "Location is unavailable")
        }
    }
}

extension GeolocationBridge: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == Self.handlerName,
              let body = message.body as? [String: Any],
              let id = body["id"] as? Int else { return }
        pending.append(id)
        start()
    }
}

extension GeolocationBridge: CLLocationManagerDelegate {

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !pending.isEmpty else { return }          // nobody is waiting
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        case .restricted, .denied:
            fail(1, "Location permission was refused — you can allow it in Settings")
        default: break                                   // still undecided
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        let ids = pending; pending.removeAll()
        let ts = Int(l.timestamp.timeIntervalSince1970 * 1000)
        /* horizontalAccuracy is negative when the fix is invalid; the planner
           refuses anything looser than 5 km, so hand it a number it can judge
           rather than a negative one it would read as perfect. */
        let acc = l.horizontalAccuracy >= 0 ? l.horizontalAccuracy : 100_000
        for id in ids {
            call("window.__evrouteGeoOk(\(id), \(l.coordinate.latitude), \(l.coordinate.longitude), \(acc), \(ts));")
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        fail(2, "No location fix available right now")
    }
}
