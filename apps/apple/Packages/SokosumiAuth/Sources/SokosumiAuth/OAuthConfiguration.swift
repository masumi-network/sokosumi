import Foundation

/// First-party public OAuth client against Core's Better Auth oauth provider.
///
/// Redirect URI is a claimed HTTPS link (RFC 8252 section 7.2), not a custom
/// scheme: any app can register a scheme, but only an app the host vouches
/// for in its `apple-app-site-association` file receives this link. That is
/// what lets the client skip the consent screen (ADR 0046).
///
/// The host is fixed, whichever Core the app talks to: the app's Associated
/// Domains entitlement names it, and an entitlement cannot follow a setting.
public struct OAuthConfiguration: Sendable {
  public static let callbackHost = "app.sokosumi.com"
  public static let callbackPath = "/auth/apple/callback"
  static let redirectURI = "https://\(callbackHost)\(callbackPath)"
  private static let defaultScopes = ["openid", "sokosumi:api", "offline_access"]

  /// e.g. `https://api.sokosumi.com/auth` (Core origin + `/auth`, no `/v1`).
  public var issuerBaseURL: URL
  public var clientID: String
  private let scopes: [String]

  public init(issuerBaseURL: URL, clientID: String) {
    self.issuerBaseURL = issuerBaseURL
    self.clientID = clientID
    self.scopes = Self.defaultScopes
  }

  /// Core's auth base shares the Core API origin: strip `/v1`, append `/auth`.
  public static func issuerBaseURL(coreAPIBaseURL: URL) -> URL {
    var components = URLComponents(url: coreAPIBaseURL, resolvingAgainstBaseURL: false)!
    var segments = components.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    if segments.last == "v1" {
      segments.removeLast()
    }
    segments.append("auth")
    components.path = "/" + segments.joined(separator: "/")
    return components.url!
  }

  private var authorizeEndpoint: URL {
    issuerBaseURL.appendingPathComponent("oauth2/authorize")
  }

  var tokenEndpoint: URL {
    issuerBaseURL.appendingPathComponent("oauth2/token")
  }

  /// System-browser authorize URL for a public PKCE client (no client secret).
  func authorizeURL(state: String, codeChallenge: String) throws -> URL {
    var components = URLComponents(url: authorizeEndpoint, resolvingAgainstBaseURL: false)!
    components.queryItems = [
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "client_id", value: clientID),
      URLQueryItem(name: "redirect_uri", value: OAuthConfiguration.redirectURI),
      URLQueryItem(name: "scope", value: scopes.joined(separator: " ")),
      URLQueryItem(name: "code_challenge", value: codeChallenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "state", value: state)
    ]
    guard let url = components.url else {
      throw OAuthError.invalidAuthorizeURL
    }
    return url
  }
}

enum OAuthError: Error, Equatable {
  case invalidAuthorizeURL
  case invalidCallbackURL
  case stateMismatch
  case tokenExchangeFailed(status: Int, message: String, code: String?)
  case needsSignIn

  /// The authorization server definitively rejected the grant
  /// (`invalid_grant`: revoked, rotated, or malformed). Only this clears
  /// the stored session; other error codes, transport failures, and 5xx
  /// never do — a `400 invalid_client` must not wipe a good session.
  var isInvalidGrant: Bool {
    if case let .tokenExchangeFailed(_, _, code) = self {
      return code == "invalid_grant"
    }
    return false
  }
}
