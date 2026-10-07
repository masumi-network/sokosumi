import Foundation
@testable import Sokosumi
import Testing

@MainActor
struct MacOAuthBrowserTests {
  /// The system delivers the HTTPS callback on an XPC queue, not the main
  /// thread. A handler isolated to the main actor traps there: that crashed
  /// the first signed build the moment the browser returned.
  ///
  /// The capture below compiles only while the handler is `@Sendable`, which
  /// is what keeps it off the main actor.
  @Test func completionHandlerRunsOffTheMainThread() async throws {
    let browser = MacOAuthBrowser()
    let attempt = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000001"))
    let handler = browser.completionHandler(attempt: attempt)

    await withCheckedContinuation { continuation in
      DispatchQueue.global().async {
        handler(nil, nil)
        continuation.resume()
      }
    }
  }
}
