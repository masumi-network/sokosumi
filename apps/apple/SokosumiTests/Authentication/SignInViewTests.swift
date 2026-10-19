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

      private struct Render {
        var texts: [[String]]
        var redInk: [Bool]
      }

      private static func auth(browser: any OAuthBrowser = WaitingBrowser()) -> AuthState {
        AuthState(configuration: configuration, store: InMemoryTokenStore(), browser: browser, restoreSession: false)
      }

      /// Light beside dark, recorded as one attachment. Waits until `until` is an accessibility label, then reads
      /// the hosted words. `sampleRed` looks for the failed-attempt red; `inspect` runs on the light window only.
      private static func render(named name: String, _ auth: AuthState, size: NSSize, until: String, sampleRed: Bool = false,
                                 inspect: ((NSView) async throws -> Void)? = nil) async throws -> Render {
        var columns: [[CGImage]] = []
        var texts: [[String]] = []
        var redInk: [Bool] = []
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
          _ = try await ComposerSkillsTests.waitForText(until, in: host)
          await ComposerSkillsTests.settle(host)
          if !dark, let inspect {
            try await inspect(host)
          }
          let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
          host.cacheDisplay(in: host.bounds, to: bitmap)
          if sampleRed {
            redInk.append(Self.hasRedInk(bitmap))
          }
          try columns.append([#require(bitmap.cgImage)])
          await texts.append(hostedTexts(in: host))
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "\(name).png")
        return Render(texts: texts, redInk: redInk)
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

      /// Link targets the hosted view exposes, keyed by accessible name.
      private static func links(in host: NSView) async -> [String: URL] {
        _ = await hostedTexts(in: host)
        var found: [String: URL] = [:]
        var seen: Set<ObjectIdentifier> = []
        func walk(_ element: Any) {
          guard let object = element as? NSObject, seen.insert(ObjectIdentifier(object)).inserted else { return }
          if object.responds(to: NSSelectorFromString("accessibilityLabel")),
             let label = object.value(forKey: "accessibilityLabel") as? String,
             let url = object.accessibilityURL() {
            found[label] = url
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
        return found
      }

      /// `label`'s frame in `host` coordinates.
      private static func frame(of label: String, in host: NSView) async throws -> CGRect {
        let node = try #require(await ComposerSkillsTests.element(containing: label, in: host))
        let window = try #require(host.window)
        return host.convert(window.convertFromScreen(node.object.accessibilityFrame()), from: nil)
      }

      private static func hasRedInk(_ bitmap: NSBitmapImageRep) -> Bool {
        var hits = 0
        for y in stride(from: 0, to: bitmap.pixelsHigh, by: 3) {
          for x in stride(from: 0, to: bitmap.pixelsWide, by: 3) {
            guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { continue }
            if color.redComponent > 0.75, color.greenComponent < 0.4, color.blueComponent < 0.4 {
              hits += 1
              if hits > 6 { return true }
            }
          }
        }
        return false
      }

      @Test func thePrimaryActionUsesWebsBrandColor() {
        #expect(SignInBrand.light.red == 43.0 / 255)
        #expect(SignInBrand.light.green == 92.0 / 255)
        #expect(SignInBrand.light.blue == 120.0 / 255)
        #expect(SignInBrand.dark.red == 51.0 / 255)
        #expect(SignInBrand.dark.green == 109.0 / 255)
        #expect(SignInBrand.dark.blue == 143.0 / 255)
      }

      @Test func theHeroIsOneOfWebsFivePhotos() {
        #expect(SignInView.heroImageNames == ["AuthHero1", "AuthHero2", "AuthHero3", "AuthHero4", "AuthHero5"])
        for name in SignInView.heroImageNames {
          #expect(NSImage(named: NSImage.Name(name)) != nil, "Missing catalog image \(name)")
        }
      }

      @Test func termsNoticeUnderlinesTheLegalLinks() {
        let notice = SignInLinks.termsNotice
        var urls: [String] = []
        for run in notice.runs {
          guard let link = run.link else { continue }
          urls.append(link.absoluteString)
          #expect(run[AttributeScopes.SwiftUIAttributes.UnderlineStyleAttribute.self] == .single)
        }
        #expect(urls == [SignInLinks.terms, SignInLinks.privacy])
      }

      @Test func signedOutMatchesWebLogIn() async throws {
        let render = try await Self.render(named: "sign-in-wide", Self.auth(), size: Self.wide, until: "Continue in browser") { host in
          let links = await Self.links(in: host)
          #expect(links["Register"] == CoreSettings.signUpURL)
          #expect(links["Imprint"]?.absoluteString == SignInLinks.imprint)
          #expect(links["Acceptable Use"]?.absoluteString == SignInLinks.acceptableUse)
          #expect(links["Privacy Policy"]?.absoluteString == SignInLinks.privacy)
        }
        Self.expect(render.texts, contain: [
          "Sokosumi", "Log in", "Hire agents on our platform", "Continue in browser", "Don't have an account?", "Register",
          "By creating an account, you agree to the", "Terms of Service", "Privacy Policy", "Imprint",
          "Acceptable Use", "AI coworkers", "for marketing", "Specialized AI coworker built for marketing.",
          "Built for small and large marketing teams.", "Works with the tools you already use."
        ])
      }

      @Test func aNarrowWindowDropsThePhotoPanel() async throws {
        let render = try await Self.render(named: "sign-in-narrow", Self.auth(), size: Self.narrow, until: "Continue in browser")
        Self.expect(render.texts, contain: ["Sokosumi", "Log in", "Continue in browser"], lack: ["AI coworkers"])
      }

      @Test func theLegalFooterStaysInsideTheMinimumWindow() async throws {
        _ = try await Self.render(named: "sign-in-minimum", Self.auth(), size: Self.minimum, until: "Acceptable Use") { host in
          let use = try await Self.frame(of: "Acceptable Use", in: host)
          let imprint = try await Self.frame(of: "Imprint", in: host)
          #expect(use.minX >= -1 && use.maxX <= host.bounds.width + 1, "Acceptable Use is clipped: \(use) in \(host.bounds)")
          #expect(use.minY > imprint.minY + 4, "Acceptable Use stays on the Imprint row: \(use) vs \(imprint)")
        }
      }

      @Test func aFailedAttemptShowsItsReasonAboveTheAction() async throws {
        let auth = Self.auth(browser: FailingBrowser())
        await auth.startSignIn()?.value
        let render = try await Self.render(named: "sign-in-error", auth, size: Self.narrow, until: "Continue in browser", sampleRed: true)
        Self.expect(render.texts, contain: ["Sign-in could not open the system browser.", "Continue in browser"])
        #expect(render.redInk == [true, true])
      }

      @Test func signingInWaitsForTheBrowserAndOffersCancel() async throws {
        let auth = Self.auth()
        auth.startSignIn()
        defer { auth.cancelSignIn() }
        let render = try await Self.render(named: "sign-in-waiting", auth, size: Self.narrow, until: "Cancel")
        Self.expect(render.texts, contain: [
          "Log in", "Waiting for your browser", "Cancel", "Register", "By creating an account, you agree to the"
        ], lack: ["Continue in browser", "Server (Debug build)"])
      }

      @Test func anUnconfiguredBuildSaysSo() async throws {
        let auth = AuthState(configuration: nil, store: InMemoryTokenStore(), browser: WaitingBrowser())
        let render = try await Self.render(named: "sign-in-not-configured", auth, size: Self.narrow,
                                            until: "Sign-in is not configured.", sampleRed: true)
        Self.expect(render.texts, contain: ["Sign-in is not configured."], lack: ["Continue in browser"])
        #expect(render.redInk == [false, false])
      }
    }
  }
#endif
