import Foundation

/// Tokens minted for the public Mac OAuth client. Stored via a `TokenStore`
/// (Keychain in the app; in-memory in tests). Never logged.
public struct OAuthTokens: Codable, Sendable, Equatable {
  public var accessToken: String
  public var refreshToken: String?
  public var expiresAt: Date
  public var scope: String?

  public init(accessToken: String, refreshToken: String?, expiresAt: Date, scope: String?) {
    self.accessToken = accessToken
    self.refreshToken = refreshToken
    self.expiresAt = expiresAt
    self.scope = scope
  }

  /// Treat tokens expiring within the leeway as expired so a slow Core call
  /// never races a dead access token.
  public func isExpired(now: Date = Date(), leeway: TimeInterval = 60) -> Bool {
    now.addingTimeInterval(leeway) >= expiresAt
  }
}

/// Token persistence boundary. Keychain lives in the Mac app target (it needs
/// the `Security` framework); the package only sees this protocol.
/// Thrown when tokens cannot be persisted. Sign-in and refresh propagate
/// this instead of reporting an authenticated session that a relaunch
/// would immediately forget.
public enum TokenStoreError: Error, Equatable {
  case encodingFailed
  case writeFailed
}

public protocol TokenStore: Sendable {
  func load() -> OAuthTokens?
  func save(_ tokens: OAuthTokens) throws
  /// Deletes stored tokens. Returns true only when absence is confirmed
  /// (deleted or already absent) — never on an unreadable store, so callers
  /// cannot mistake "could not verify" for "signed out".
  @discardableResult
  func clear() -> Bool
}

/// Token-endpoint HTTP boundary (`POST application/x-www-form-urlencoded`).
/// `URLSessionTokenTransport` is the live implementation; tests stub this.
public protocol TokenEndpointTransport: Sendable {
  func postForm(_ fields: [(name: String, value: String)], to url: URL) async throws -> (Data, Int)
}

public struct URLSessionTokenTransport: TokenEndpointTransport {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func postForm(_ fields: [(name: String, value: String)], to url: URL) async throws -> (Data, Int) {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = Data(
      fields
        .map { "\($0.name.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? $0.name)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? $0.value)" }
        .joined(separator: "&")
        .utf8
    )
    let (data, response) = try await session.data(for: request)
    return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
  }
}

extension CharacterSet {
  static let urlQueryValueAllowed: CharacterSet = {
    var set = CharacterSet.urlQueryAllowed
    set.remove(charactersIn: "&=+")
    return set
  }()
}
