import Foundation

/// First-party public OAuth client against Core's Better Auth oauth provider.
///
/// Redirect URI is the RFC 8252 private-use form `com.sokosumi.app:/auth`
/// (one slash, no host): Better Auth rejects `com.sokosumi.app://auth`.
/// The `ASWebAuthenticationSession` callback scheme is `com.sokosumi.app`.
public struct OAuthConfiguration: Sendable {
  public static let redirectURI = "com.sokosumi.app:/auth"
  public static let callbackScheme = "com.sokosumi.app"
  public static let defaultScopes = ["openid", "sokosumi:api", "offline_access"]

  /// e.g. `https://api.sokosumi.com/auth` (Core origin + `/auth`, no `/v1`).
  public var issuerBaseURL: URL
  public var clientID: String
  public var scopes: [String]

  public init(
    issuerBaseURL: URL,
    clientID: String,
    scopes: [String] = OAuthConfiguration.defaultScopes
  ) {
    self.issuerBaseURL = issuerBaseURL
    self.clientID = clientID
    self.scopes = scopes
  }

  /// Path of the fixed redirect URI (`/auth`). Callbacks must land here,
  /// not just anywhere under the callback scheme.
  public static var redirectPath: String {
    URLComponents(string: OAuthConfiguration.redirectURI)?.path ?? "/auth"
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

  public var authorizeEndpoint: URL {
    issuerBaseURL.appendingPathComponent("oauth2/authorize")
  }

  public var tokenEndpoint: URL {
    issuerBaseURL.appendingPathComponent("oauth2/token")
  }

  /// System-browser authorize URL for a public PKCE client (no client secret).
  public func authorizeURL(state: String, codeChallenge: String) throws -> URL {
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

public enum OAuthError: Error, Equatable {
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
