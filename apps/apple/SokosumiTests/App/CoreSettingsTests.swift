import Foundation
@testable import Sokosumi
import Testing

struct CoreSettingsTests {
  @Test func choiceTakesHTTPURLsAndGivesABareCoreOriginItsAPIPath() {
    let preview = ServerChoice(core: " https://core-pr-6398.preview.sokosumi.com ", web: "https://pr-6398.preview.sokosumi.com")
    #expect(preview?.core.absoluteString == "https://core-pr-6398.preview.sokosumi.com/v1")
    #expect(preview?.web.absoluteString == "https://pr-6398.preview.sokosumi.com")
    let local = ServerChoice(core: "http://core.sokosumi.localhost/v1", web: "http://web.sokosumi.localhost")
    #expect(local?.core.absoluteString == "http://core.sokosumi.localhost/v1")
    #expect(ServerChoice(core: "https://api.sokosumi.com/", web: "https://app.sokosumi.com") == .production)
  }

  @Test(arguments: [
    ("", "https://app.sokosumi.com"),
    ("api.sokosumi.com/v1", "https://app.sokosumi.com"),
    ("ftp://api.sokosumi.com/v1", "https://app.sokosumi.com"),
    ("https://api.sokosumi.com/v1", "https://"),
    ("https://api.sokosumi.com/v1", "not a url")
  ])
  func choiceRejectsAnythingButHTTPURLsWithAHost(core: String, web: String) {
    #expect(ServerChoice(core: core, web: web) == nil)
  }

  @Test func savedChoiceSurvivesARelaunchUntilCleared() throws {
    let suite = "CoreSettingsTests." + UUID().uuidString
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    #expect(ServerChoice.saved(in: defaults) == nil)
    let preview = try #require(ServerChoice(core: "https://core.preview.example", web: "https://web.preview.example"))
    preview.save(to: defaults)
    let relaunched = try #require(UserDefaults(suiteName: suite))
    #expect(ServerChoice.saved(in: relaunched) == preview)
    ServerChoice.clear(in: defaults)
    #expect(ServerChoice.saved(in: defaults) == nil)
  }

  @Test func onlyDebugBuildsHonourASavedChoice() throws {
    let preview = try #require(ServerChoice(core: "https://core.preview.example", web: "https://web.preview.example"))
    #expect(CoreSettings.resolve(saved: preview, allowsOverride: true) == preview)
    #expect(CoreSettings.resolve(saved: nil, allowsOverride: true) == .production)
    #expect(CoreSettings.resolve(saved: preview, allowsOverride: false) == .production)
    #expect(ServerChoice.production.core.absoluteString == "https://api.sokosumi.com/v1")
    #expect(ServerChoice.production.web.absoluteString == "https://app.sokosumi.com")
  }

  @Test func setupURLAppendsPathToWebOrigin() throws {
    let local = try #require(URL(string: "https://3877.web.sokosumi.localhost"))
    #expect(CoreSettings.setupURL(from: local).absoluteString == "https://3877.web.sokosumi.localhost/setup")
    let production = try #require(URL(string: "https://app.sokosumi.com"))
    #expect(CoreSettings.setupURL(from: production).absoluteString == "https://app.sokosumi.com/setup")
  }

  @Test func signUpURLAppendsPathToWebOrigin() throws {
    let local = try #require(URL(string: "https://3877.web.sokosumi.localhost"))
    #expect(CoreSettings.signUpURL(from: local).absoluteString == "https://3877.web.sokosumi.localhost/signup")
    let production = try #require(URL(string: "https://app.sokosumi.com"))
    #expect(CoreSettings.signUpURL(from: production).absoluteString == "https://app.sokosumi.com/signup")
  }
}
