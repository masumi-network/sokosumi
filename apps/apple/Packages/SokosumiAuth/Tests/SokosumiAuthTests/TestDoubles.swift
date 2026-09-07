import Foundation
import SokosumiAuth

/// Canned token-endpoint answers; records the last form POST for assertions.
final class StubTokenTransport: TokenEndpointTransport, @unchecked Sendable {
  struct Request: Sendable {
    var url: URL
    var contentType: String?
    var fields: [(name: String, value: String)]
  }

  enum Response: Sendable {
    case success(status: Int, json: String)
    case failure(Error)
  }

  var response: Response
  private(set) var lastRequest: Request?

  init(response: Response) {
    self.response = response
  }

  func postForm(_ fields: [(name: String, value: String)], to url: URL) async throws -> (Data, Int) {
    lastRequest = Request(
      url: url,
      contentType: "application/x-www-form-urlencoded",
      fields: fields
    )
    switch response {
    case .success(let status, let json):
      return (Data(json.utf8), status)
    case .failure(let error):
      throw error
    }
  }
}

final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
  private(set) var saved: OAuthTokens?
  var saveError: (any Error)?

  func load() -> OAuthTokens? { saved }

  func save(_ tokens: OAuthTokens) throws {
    if let saveError {
      throw saveError
    }
    saved = tokens
  }

  @discardableResult
  func clear() -> Bool {
    saved = nil
    return true
  }
}

/// Store whose deletion never confirms (unreadable Keychain): tokens stay.
final class FailingClearStore: TokenStore, @unchecked Sendable {
  private(set) var saved: OAuthTokens?

  func load() -> OAuthTokens? { saved }

  func save(_ tokens: OAuthTokens) { saved = tokens }

  func clear() -> Bool { false }
}

struct UnreachableError: Error {}
