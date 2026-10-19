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
      private static let configuration = OAuthConfiguration(issuerBaseURL: URL(string: "https://example.com/auth")!,
                                                            clientID: "test")

      private static func auth(browser: any OAuthBrowser = WaitingBrowser()) -> AuthState {
        AuthState(configuration: configuration, store: InMemoryTokenStore(), browser: browser, restoreSession: false)
      }

      /// Light beside dark, recorded as one attachment; the words each appearance exposes.
      private static func render(named name: String, _ auth: AuthState, size: NSSize) async throws -> [[String]] {
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
        Self.expect(texts, contain: ["Log in", "Waiting for your browser", "Cancel"], lack: ["Continue in browser"])
      }

      @Test func anUnconfiguredBuildSaysSo() async throws {
        let auth = AuthState(configuration: nil, store: InMemoryTokenStore(), browser: WaitingBrowser())
        let texts = try await Self.render(named: "sign-in-not-configured", auth, size: Self.narrow)
        Self.expect(texts, contain: ["Sign-in is not configured."], lack: ["Continue in browser"])
      }
    }
  }
#endif
