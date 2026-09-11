import Foundation
import SokosumiChat
import Testing

struct ComposerPreferencesTests {
  @Test func defaultsToVisibleAndPersistsUserChoice() throws {
    let suite = "ComposerPreferencesTests." + UUID().uuidString
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let preferences = ComposerPreferences(defaults: defaults)
    #expect(preferences.toolbarVisible)
    preferences.toolbarVisible = false
    #expect(!ComposerPreferences(defaults: defaults).toolbarVisible)
    preferences.toolbarVisible = true
    #expect(ComposerPreferences(defaults: defaults).toolbarVisible)
  }
}
