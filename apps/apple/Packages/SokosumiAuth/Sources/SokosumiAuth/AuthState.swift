import Combine
import Foundation

/// System browser presentation is supplied by the app. This boundary keeps
/// session state testable without a window, AppKit or AuthenticationServices.
@MainActor
public protocol OAuthBrowser: AnyObject {
  func authenticate(url: URL) async throws -> URL
  func cancel()
}

public enum OAuthBrowserError: Error {
  case cancelled
  case couldNotStart
  case missingCallback
}

/// Shared session state for Apple clients. Network and persistence live in
/// OAuthSession; only browser presentation belongs to a platform adapter.
@MainActor
public final class AuthState: ObservableObject {
  public enum Status: Equatable {
    case notConfigured
    case signedOut(message: String?)
    case signingIn
    case signedIn
  }

  @Published public private(set) var status: Status
  @Published public private(set) var signOutError: String?

  public let oauthSession: OAuthSession?
  private let configuration: OAuthConfiguration?
  private let browser: any OAuthBrowser
  private var signInTask: Task<Void, Never>?
  private var signOutTask: Task<Void, Never>?
  private var attemptID: UUID?

  public init(
    configuration: OAuthConfiguration?,
    store: any TokenStore,
    browser: any OAuthBrowser,
    transport: any TokenEndpointTransport = URLSessionTokenTransport(),
    restoreSession: Bool = true
  ) {
    self.configuration = configuration
    self.browser = browser
    if let configuration {
      oauthSession = OAuthSession(configuration: configuration, store: store, transport: transport)
      // Expiry is handled lazily by OAuthSession on the first request.
      status = restoreSession && store.load() != nil ? .signedIn : .signedOut(message: nil)
    } else {
      oauthSession = nil
      status = .notConfigured
    }
  }

  public var isSignedIn: Bool {
    status == .signedIn
  }

  /// Returns the operation so callers/tests can await completion if needed.
  /// A repeated click shares the current attempt rather than opening a second browser.
  @discardableResult
  public func startSignIn() -> Task<Void, Never>? {
    if let signInTask {
      return signInTask
    }
    guard signOutTask == nil, !isSignedIn,
          let configuration, let oauthSession else { return nil }
    let attempt = UUID()
    let verifier = PKCE.generateVerifier()
    let state = UUID().uuidString
    attemptID = attempt
    signOutError = nil
    status = .signingIn
    let task = Task {
      defer {
        if attemptID == attempt {
          attemptID = nil
          signInTask = nil
        }
      }
      do {
        try Task.checkCancellation()
        let url = try configuration.authorizeURL(state: state, codeChallenge: PKCE.challenge(forVerifier: verifier))
        let callback = try await browser.authenticate(url: url)
        try Task.checkCancellation()
        guard attemptID == attempt else { return }
        try await oauthSession.signIn(callbackURL: callback, expectedState: state, codeVerifier: verifier)
        guard attemptID == attempt else { return }
        status = .signedIn
      } catch {
        guard attemptID == attempt else { return }
        if error is CancellationError || (error as? OAuthBrowserError) == .cancelled {
          status = .signedOut(message: nil)
        } else {
          status = .signedOut(message: Self.message(for: error))
        }
      }
    }
    signInTask = task
    return task
  }

  /// Cancellation also clears any tokens committed just before the UI received
  /// the exchange result. Otherwise a cancelled attempt could restore on launch.
  @discardableResult
  public func cancelSignIn() -> Task<Void, Never>? {
    guard signInTask != nil else { return nil }
    return signOut()
  }

  private func stopBrowserAttempt() {
    attemptID = nil
    signInTask?.cancel()
    signInTask = nil
    browser.cancel()
  }

  @discardableResult
  public func signOut(message: String? = nil) -> Task<Void, Never> {
    if let signOutTask {
      return signOutTask
    }
    stopBrowserAttempt()
    let task = Task {
      defer { signOutTask = nil }
      guard let oauthSession else {
        status = .notConfigured
        return
      }
      if await oauthSession.signOut() {
        signOutError = nil
        status = .signedOut(message: message)
      } else {
        // Never claim a durable sign-out if a relaunch could restore tokens.
        signOutError = "Sign out failed. Your session is still on this device — try again."
        if status == .signingIn {
          status = .signedOut(message: signOutError)
        }
      }
    }
    signOutTask = task
    return task
  }

  private static func message(for error: any Error) -> String {
    switch error {
    case OAuthBrowserError.couldNotStart:
      "Sign-in could not open the system browser."
    case OAuthBrowserError.missingCallback:
      "Sign-in returned without an authorization code."
    case OAuthError.needsSignIn:
      "Your session expired. Sign in again."
    case OAuthError.stateMismatch, OAuthError.invalidCallbackURL:
      "Sign-in was interrupted. Try again."
    case let OAuthError.tokenExchangeFailed(_, message, _):
      message.isEmpty ? "Sign-in failed." : message
    case TokenStoreError.encodingFailed, TokenStoreError.writeFailed:
      "Signed in, but your session could not be saved on this device. Try again."
    case let error as URLError where error.code == .notConnectedToInternet:
      "No network connection. Check your connection and try again."
    case let error as URLError:
      "Core is unreachable: \(error.localizedDescription)"
    default:
      "Sign-in failed: \(error.localizedDescription)"
    }
  }
}
