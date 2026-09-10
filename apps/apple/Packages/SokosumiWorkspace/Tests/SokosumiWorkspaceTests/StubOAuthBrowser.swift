import Foundation
import SokosumiAuth

@MainActor
final class StubOAuthBrowser: OAuthBrowser {
  func authenticate(url _: URL) async throws -> URL {
    throw OAuthBrowserError.couldNotStart
  }

  func cancel() {}
}
