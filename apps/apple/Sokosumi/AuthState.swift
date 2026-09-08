import AppKit
import AuthenticationServices
import Combine
import CoreAPI
import SokosumiAuth
import SokosumiChat

/// True when this process hosts a test run (`xcodebuild test`, Xcode ⌘U):
/// the runner injects XCTest into the host app, so its classes resolve.
/// No import needed — `NSClassFromString` just yields nil in a normal launch.
private var isRunningTests: Bool {
  NSClassFromString("XCTestCase") != nil
}

/// Presentation anchor for the system-browser sign-in sheet.
private final class SignInPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
    NSApp.keyWindow ?? NSApp.mainWindow ?? NSWindow()
  }
}

/// Owns the human session for the Mac window: restore-on-launch from
/// Keychain (no prompt), system-browser sign-in, menu sign-out.
///
/// A dead refresh token surfaces as `.signedOut` (message, not a spinner);
/// callers resolve failures to this state via `runAuthenticated(_:)`.
@MainActor
final class AuthState: ObservableObject {
  enum Status: Equatable {
    case notConfigured
    case signedOut(message: String?)
    case signingIn
    case signedIn
  }

  @Published private(set) var status: Status = .signingIn
  /// Set when sign-out could not durably delete the Keychain item: the
  /// session is still on this Mac, so the UI must not claim otherwise.
  @Published private(set) var signOutError: String?

  private let store: any TokenStore
  private var session: OAuthSession?
  private var configuration: OAuthConfiguration?
  private var pendingVerifier = ""
  private var pendingState = ""
  private var activeBrowserSession: ASWebAuthenticationSession?
  private let presentationContext = SignInPresentationContext()

  init(store: any TokenStore = KeychainTokenStore()) {
    self.store = store
    guard let configuration = AuthConfig.makeConfiguration() else {
      status = .notConfigured
      return
    }
    self.configuration = configuration
    session = AuthConfig.makeSession(store: store, configuration: configuration)
    // Synchronous launch restore: Keychain tokens exist → signed in, no prompt.
    // Expiry/refresh resolves lazily on the first Core call. Skipped under a
    // test runner: the host app launches to host the test bundle, and a fresh
    // ad-hoc signature never matches the stored item's ACL — so every test
    // launch would pop a Keychain prompt (and depend on login state).
    if isRunningTests {
      status = .signedOut(message: nil)
    } else {
      status = store.load() == nil ? .signedOut(message: nil) : .signedIn
    }
  }

  var isSignedIn: Bool {
    status == .signedIn
  }

  func startSignIn() {
    guard let configuration else {
      status = .notConfigured
      return
    }
    pendingVerifier = PKCE.generateVerifier()
    pendingState = UUID().uuidString
    let challenge = PKCE.challenge(forVerifier: pendingVerifier)
    let url: URL
    do {
      url = try configuration.authorizeURL(state: pendingState, codeChallenge: challenge)
    } catch {
      status = .signedOut(message: "Could not start sign-in: \(error.localizedDescription)")
      return
    }
    status = .signingIn
    // Retained for the round-trip: a released ASWebAuthenticationSession
    // never delivers its callback and the window would spin forever.
    let authSession = ASWebAuthenticationSession(
      url: url,
      callbackURLScheme: OAuthConfiguration.callbackScheme
    ) { [weak self] callbackURL, error in
      Task { @MainActor in
        await self?.finishSignIn(callbackURL: callbackURL, error: error)
      }
    }
    authSession.presentationContextProvider = presentationContext
    // Sterile cookie jar per attempt: no shared browser session can silently
    // re-authorize a previous user, so every sign-in is a fresh login.
    // Cost: no SSO convenience, and the system consent alert on each sign-in.
    authSession.prefersEphemeralWebBrowserSession = true
    activeBrowserSession = authSession
    if !authSession.start() {
      activeBrowserSession = nil
      status = .signedOut(message: "Sign-in could not open the system browser.")
    }
  }

  func signOut(message: String? = nil) {
    activeBrowserSession?.cancel()
    activeBrowserSession = nil
    Task {
      guard let session else {
        status = .notConfigured
        return
      }
      if await session.signOut() {
        signOutError = nil
        status = .signedOut(message: message)
      } else {
        // Deletion unconfirmed: the next launch could restore .signedIn, so
        // claiming sign-out here would strand a live session on a shared Mac.
        signOutError = "Sign out failed. Your session is still on this Mac — try again."
      }
    }
  }

  /// Generated Core client with the session's Bearer middleware attached.
  /// Nil when the OAuth client ID is not configured.
  func coreClient() -> Client? {
    guard let session else {
      return nil
    }
    return Client.connecting(
      to: CoreSettings.baseURL,
      middlewares: [
        BearerAuthMiddleware(session: session),
        ExplicitNullPreferredOrganizationMiddleware()
      ]
    )
  }

  private func finishSignIn(callbackURL: URL?, error: Error?) async {
    activeBrowserSession = nil
    if error != nil {
      // User cancelled or the browser failed: visible, not blank.
      if case .signingIn = status {
        status = .signedOut(message: nil)
      }
      return
    }
    guard let callbackURL else {
      status = .signedOut(message: "Sign-in returned without an authorization code.")
      return
    }
    do {
      try await session?.signIn(
        callbackURL: callbackURL,
        expectedState: pendingState,
        codeVerifier: pendingVerifier
      )
      status = .signedIn
    } catch {
      status = .signedOut(message: friendlyMessage(for: error))
    }
  }

  private func friendlyMessage(for error: Error) -> String {
    switch error {
    case OAuthError.needsSignIn:
      "Your session expired. Sign in again."
    case OAuthError.stateMismatch, OAuthError.invalidCallbackURL:
      "Sign-in was interrupted. Try again."
    case let OAuthError.tokenExchangeFailed(_, message, _):
      message.isEmpty ? "Sign-in failed." : message
    case TokenStoreError.encodingFailed, TokenStoreError.writeFailed:
      "Signed in, but your session could not be saved on this Mac. Try again."
    case let error as URLError where error.code == .notConnectedToInternet:
      "No network connection. Check your connection and try again."
    case let error as URLError:
      "Core is unreachable: \(error.localizedDescription)"
    default:
      "Sign-in failed: \(error.localizedDescription)"
    }
  }
}
