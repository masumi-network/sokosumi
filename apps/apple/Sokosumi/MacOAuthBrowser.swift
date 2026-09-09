#if os(macOS)
  import AppKit
  import AuthenticationServices
  import SokosumiAuth

  /// AppKit is limited to selecting the window anchoring the system browser.
  /// Authentication, tokens and observable session state remain in SokosumiAuth.
  @MainActor
  final class MacOAuthBrowser: NSObject, OAuthBrowser, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, any Error>?
    private var attemptID: UUID?

    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
      NSApp.keyWindow ?? NSApp.mainWindow ?? NSWindow()
    }

    func authenticate(url: URL) async throws -> URL {
      cancel()
      let attempt = UUID()
      attemptID = attempt
      return try await withCheckedThrowingContinuation { continuation in
        self.continuation = continuation
        let session = ASWebAuthenticationSession(
          url: url,
          callbackURLScheme: OAuthConfiguration.callbackScheme
        ) { [weak self] callbackURL, error in
          Task { @MainActor in
            self?.handleCallback(attempt: attempt, callbackURL: callbackURL, error: error)
          }
        }
        session.presentationContextProvider = self
        // Preserve the existing fresh-login behavior on shared computers.
        session.prefersEphemeralWebBrowserSession = true
        self.session = session
        if !session.start() {
          finish(.failure(OAuthBrowserError.couldNotStart))
        }
      }
    }

    private func handleCallback(attempt: UUID, callbackURL: URL?, error: (any Error)?) {
      guard attemptID == attempt else { return }
      if let error {
        if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
          finish(.failure(OAuthBrowserError.cancelled))
        } else {
          finish(.failure(error))
        }
      } else if let callbackURL {
        finish(.success(callbackURL))
      } else {
        finish(.failure(OAuthBrowserError.missingCallback))
      }
    }

    func cancel() {
      let activeSession = session
      finish(.failure(OAuthBrowserError.cancelled))
      activeSession?.cancel()
    }

    private func finish(_ result: Result<URL, any Error>) {
      let pending = continuation
      continuation = nil
      session = nil
      attemptID = nil
      pending?.resume(with: result)
    }
  }
#endif
