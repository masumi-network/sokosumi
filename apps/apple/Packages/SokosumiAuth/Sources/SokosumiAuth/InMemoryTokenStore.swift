import Foundation

/// In-memory `TokenStore` for tests. Live clients use Keychain.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
  public private(set) var saved: OAuthTokens?
  public var saveError: (any Error)?

  public init() {}

  public func load() -> OAuthTokens? {
    saved
  }

  public func save(_ tokens: OAuthTokens) throws {
    if let saveError {
      throw saveError
    }
    saved = tokens
  }

  @discardableResult
  public func clear() -> Bool {
    saved = nil
    return true
  }
}
