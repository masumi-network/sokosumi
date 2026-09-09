import Foundation
@testable import Sokosumi
import Testing

struct CoreSettingsTests {
  @Test func environmentOverridesPlistAndFallback() {
    #expect(
      CoreSettings.url(
        environment: "https://local.core.sokosumi.localhost/v1",
        plist: "https://api.sokosumi.com/v1",
        fallback: "https://unused.example/v1"
      ) == URL(string: "https://local.core.sokosumi.localhost/v1")
    )
    #expect(
      CoreSettings.url(
        environment: nil,
        plist: "https://plist.example/v1",
        fallback: "https://unused.example/v1"
      ) == URL(string: "https://plist.example/v1")
    )
    #expect(
      CoreSettings.url(
        environment: nil,
        plist: nil,
        fallback: "https://app.sokosumi.com"
      ) == URL(string: "https://app.sokosumi.com")
    )
    #expect(
      CoreSettings.url(
        environment: "",
        plist: "https://plist.example",
        fallback: "https://unused.example"
      ) == URL(string: "https://plist.example")
    )
  }

  @Test func setupURLAppendsPathToWebOrigin() throws {
    let local = try #require(URL(string: "https://3877.web.sokosumi.localhost"))
    #expect(CoreSettings.setupURL(from: local).absoluteString == "https://3877.web.sokosumi.localhost/setup")
    let production = try #require(URL(string: "https://app.sokosumi.com"))
    #expect(CoreSettings.setupURL(from: production).absoluteString == "https://app.sokosumi.com/setup")
  }
}
