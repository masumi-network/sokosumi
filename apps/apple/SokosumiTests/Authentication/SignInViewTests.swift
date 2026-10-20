#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SwiftUI
  import Testing

  /// Never answers until the attempt is cancelled, so sign-in stays in progress while the view is drawn.
  @MainActor private final class WaitingBrowser: OAuthBrowser {
    func authenticate(url _: URL) async throws -> URL {
      try await Task.sleep(for: .seconds(3600))
      throw OAuthBrowserError.cancelled
    }

    func cancel() {}
  }

  @MainActor private final class FailingBrowser: OAuthBrowser {
    func authenticate(url _: URL) async throws -> URL {
      throw OAuthBrowserError.couldNotStart
    }

    func cancel() {}
  }

  extension NativeWindowTests {
    /// Web's Log in page (`apps/web/src/app/(auth)`): wordmark, "Log in" over its subtitle, one primary action,
    /// the Register line, the terms notice and the legal footer, with the photo panel beside it on a wide window.
    /// Each state is the real view, hosted in light and dark and recorded as a render; words come from the
    /// hosted view, never from the pixels.
    @MainActor struct SignInViewTests {
      private static let wide = NSSize(width: 1100, height: 720)
      private static let narrow = NSSize(width: 520, height: 720)
      private static let minimum = NSSize(width: 420, height: 720)
      private static let configuration = OAuthConfiguration(issuerBaseURL: URL(string: "https://example.com/auth")!,
                                                            clientID: "test")

      private static func auth(browser: any OAuthBrowser = WaitingBrowser()) -> AuthState {
        AuthState(configuration: configuration, store: InMemoryTokenStore(), browser: browser, restoreSession: false)
      }

      /// Light beside dark, recorded as one attachment; the words each appearance exposes.
      private static func render(named name: String, _ auth: AuthState, size: NSSize,
                                 inspect: ((NSView) async throws -> Void)? = nil) async throws -> [[String]] {
        var columns: [[CGImage]] = []
        var texts: [[String]] = []
        for dark in [false, true] {
          let host = NSHostingView(rootView: SignInView()
            .environmentObject(auth)
            .frame(width: size.width, height: size.height)
            .background(.background)
            .environment(\.locale, Locale(identifier: "en_US"))
            .environment(\.colorScheme, dark ? .dark : .light))
          let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered,
                                defer: false)
          window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
          window.ignoresMouseEvents = true
          window.contentView = host
          window.orderFront(nil)
          defer { window.orderOut(nil) }
          for _ in 0 ..< 10 {
            host.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(40))
          }
          let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
          host.cacheDisplay(in: host.bounds, to: bitmap)
          try columns.append([#require(bitmap.cgImage)])
          await texts.append(hostedTexts(in: host))
          if !dark, let inspect {
            try await inspect(host)
          }
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "\(name).png")
        return texts
      }

      private static func expect(_ appearances: [[String]], contain fragments: [String], lack absent: [String] = []) {
        for texts in appearances {
          let joined = texts.joined(separator: "\n")
          for fragment in fragments {
            #expect(joined.contains(fragment), "Missing \(fragment) in \(texts)")
          }
          for fragment in absent {
            #expect(!joined.contains(fragment), "Unexpected \(fragment) in \(texts)")
          }
        }
      }

      @Test func signedOutMatchesWebLogIn() async throws {
        let texts = try await Self.render(named: "sign-in-wide", Self.auth(), size: Self.wide)
        Self.expect(texts, contain: [
          "Log in", "Hire agents on our platform", "Continue in browser", "Don't have an account?", "Register",
          "By creating an account, you agree to the", "Terms of Service", "Privacy Policy", "Imprint",
          "Acceptable Use", "AI coworkers", "for marketing", "Specialized AI coworker built for marketing.",
          "Built for small and large marketing teams.", "Works with the tools you already use."
        ])
      }

      @Test func aNarrowWindowDropsThePhotoPanel() async throws {
        let texts = try await Self.render(named: "sign-in-narrow", Self.auth(), size: Self.narrow)
        Self.expect(texts, contain: ["Log in", "Continue in browser"], lack: ["AI coworkers"])
      }

      @Test func aFailedAttemptShowsItsReasonAboveTheAction() async throws {
        let auth = Self.auth(browser: FailingBrowser())
        await auth.startSignIn()?.value
        let texts = try await Self.render(named: "sign-in-error", auth, size: Self.narrow)
        Self.expect(texts, contain: ["Sign-in could not open the system browser.", "Continue in browser"])
      }

      @Test func signingInWaitsForTheBrowserAndOffersCancel() async throws {
        let auth = Self.auth()
        auth.startSignIn()
        defer { auth.cancelSignIn() }
        let texts = try await Self.render(named: "sign-in-waiting", auth, size: Self.narrow)
        Self.expect(texts, contain: ["Log in", "Waiting for your browser", "Cancel", "Register", "By creating an account, you agree to the"],
                    lack: ["Continue in browser", "Server (Debug build)"])
      }

      /// Web's footer wraps (`flex-wrap justify-center`); at the window's 420pt minimum every link stays whole and apart.
      @Test func theLegalFooterFitsTheMinimumWindow() async throws {
        let titles = ["Terms of Service", "Privacy Policy", "Imprint", "Acceptable Use"]
        _ = try await Self.render(named: "sign-in-minimum", Self.auth(), size: Self.minimum) { host in
          var frames: [CGRect] = []
          for title in titles {
            let frame = try #require(await Self.lowestFrame(labelled: title, in: host), "No \(title) link")
            #expect(frame.minX >= -1 && frame.maxX <= host.bounds.width + 1, "\(title) is clipped: \(frame) in \(host.bounds)")
            frames.append(frame)
          }
          for (index, frame) in frames.enumerated() {
            for other in frames[(index + 1)...] {
              #expect(!frame.insetBy(dx: 1, dy: 1).intersects(other), "Footer links overlap: \(frame) and \(other)")
            }
          }
        }
      }

      /// The frame, in `host` coordinates, of the lowest node labelled exactly `label`: the terms notice above the
      /// footer exposes its own "Terms of Service" and "Privacy Policy" links.
      private static func lowestFrame(labelled label: String, in host: NSView) async -> CGRect? {
        _ = await hostedTexts(in: host)
        guard let window = host.window else { return nil }
        var frames: [CGRect] = []
        var seen: Set<ObjectIdentifier> = []
        func walk(_ element: Any) {
          guard let object = element as? NSObject, seen.insert(ObjectIdentifier(object)).inserted else { return }
          if object.responds(to: NSSelectorFromString("accessibilityLabel")),
             object.value(forKey: "accessibilityLabel") as? String == label,
             let screen = (object.value(forKey: "accessibilityFrame") as? NSValue)?.rectValue, screen.height > 1 {
            frames.append(host.convert(window.convertFromScreen(screen), from: nil))
          }
          if object.responds(to: NSSelectorFromString("accessibilityChildren")) {
            for child in (object.value(forKey: "accessibilityChildren") as? [Any]) ?? [] {
              walk(child)
            }
          }
          for subview in (object as? NSView)?.subviews ?? [] {
            walk(subview)
          }
        }
        walk(host)
        return host.isFlipped ? frames.max { $0.minY < $1.minY } : frames.min { $0.minY < $1.minY }
      }

      @Test func anUnconfiguredBuildSaysSo() async throws {
        let auth = AuthState(configuration: nil, store: InMemoryTokenStore(), browser: WaitingBrowser())
        let texts = try await Self.render(named: "sign-in-not-configured", auth, size: Self.narrow)
        Self.expect(texts, contain: ["Sign-in is not configured."], lack: ["Continue in browser"])
      }
    }
  }
#endif
