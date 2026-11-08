import SwiftUI
import WebKit

@main
struct StayApp: App {
    var body: some Scene {
        WindowGroup {
            StayRoot()
                .preferredColorScheme(.light)
        }
    }
}

private struct Endpoint: Sendable {
    let url: URL
    let secret: String

    static let result: Result<Endpoint, StartupError> = {
        do {
            var storage = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true
            ).appendingPathComponent("Stay", isDirectory: true)
            #if DEBUG
            if let name = ProcessInfo.processInfo.environment["STAY_UI_TEST_FIXTURE"],
               let fixture = UUID(uuidString: name) {
                storage.appendPathComponent("UI Tests/\(fixture.uuidString)", isDirectory: true)
            }
            #endif
            try FileManager.default.createDirectory(at: storage, withIntermediateDirectories: true)
            let secret = UUID().uuidString + UUID().uuidString
            let demo = UserDefaults.standard.bool(forKey: "StayDemoPolicies")
                || ProcessInfo.processInfo.arguments.contains("--demo-policies")
            let details = StayStart(storage.path, secret, demo)
            guard let port = details["port"] as? Int,
                  let url = URL(string: "http://127.0.0.1:\(port)/") else {
                throw StartupError(message: details["error"] as? String ?? "本地服务启动失败。")
            }
            return .success(Endpoint(url: url, secret: secret))
        } catch let error as StartupError {
            return .failure(error)
        } catch {
            return .failure(StartupError(message: error.localizedDescription))
        }
    }()
}

private struct StartupError: Error {
    let message: String
}

private struct StayRoot: View {
    @State private var result: Result<Endpoint, StartupError>?
    @State private var pageError: String?

    var body: some View {
        Group {
            switch result {
            case let .success(endpoint):
                if let pageError {
                    ContentUnavailableView {
                        Label("暂时无法显示页面", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(pageError)
                    } actions: {
                        Button("重新载入") { self.pageError = nil }
                    }
                } else {
                    StayWebView(endpoint: endpoint) { pageError = $0 }
                }
            case let .failure(error):
                ContentUnavailableView(
                    "暂时无法打开栖居", systemImage: "exclamationmark.triangle",
                    description: Text(error.message)
                )
            case nil:
                ProgressView("正在打开栖居 STAY…")
                    .tint(Color(red: 0.09, green: 0.24, blue: 0.21))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.96, green: 0.97, blue: 0.95).ignoresSafeArea())
        .task {
            result = await Task.detached(priority: .userInitiated) { Endpoint.result }.value
        }
    }
}

private struct StayWebView: UIViewRepresentable {
    let endpoint: Endpoint
    let onError: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(endpoint: endpoint, onError: onError) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .onDrag
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        #if DEBUG
        webView.isInspectable = true
        #endif
        context.coordinator.load(webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let endpoint: Endpoint
        let onError: (String) -> Void

        init(endpoint: Endpoint, onError: @escaping (String) -> Void) {
            self.endpoint = endpoint
            self.onError = onError
        }

        func load(_ webView: WKWebView) {
            guard let cookie = HTTPCookie(properties: [
                .name: "stay_ios", .value: endpoint.secret, .domain: "127.0.0.1",
                .path: "/", .discard: "TRUE", HTTPCookiePropertyKey("HttpOnly"): "TRUE"
            ]) else {
                onError("无法建立本地会话。")
                return
            }
            webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
                webView.load(URLRequest(url: self.endpoint.url))
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let target = action.request.url
            let local = target?.scheme == endpoint.url.scheme
                && target?.host == endpoint.url.host && target?.port == endpoint.url.port
            decisionHandler(local ? .allow : .cancel)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            load(webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: any Error) {
            let error = error as NSError
            if error.code != NSURLErrorCancelled {
                onError(error.localizedDescription)
            }
        }
    }
}
