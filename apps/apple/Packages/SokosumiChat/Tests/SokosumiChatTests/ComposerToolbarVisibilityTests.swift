import Foundation
import SokosumiChat
import Testing

struct ComposerToolbarVisibilityTests {
  @Test func startsFromTheStoredPreference() throws {
    try withDefaults { preferences, _ in
      #expect(ComposerToolbarVisibility(preferences: preferences).isVisible)
      preferences.toolbarVisible = false
      #expect(!ComposerToolbarVisibility(preferences: preferences).isVisible)
    }
  }

  @Test func theToggleShowsOrHidesTheBarAndStoresIt() throws {
    try withDefaults { preferences, _ in
      var toolbar = ComposerToolbarVisibility(preferences: preferences)
      toolbar.toggle()
      #expect(!toolbar.isVisible)
      #expect(!preferences.toolbarVisible)
      toolbar.toggle()
      #expect(toolbar.isVisible)
      #expect(preferences.toolbarVisible)
    }
  }

  /// Web's `openLinkDialog` sets the bar open without `setFormatToolbarOpenPreference`.
  @Test func revealShowsAHiddenBarWithoutStoringIt() throws {
    try withDefaults { preferences, _ in
      preferences.toolbarVisible = false
      var toolbar = ComposerToolbarVisibility(preferences: preferences)
      toolbar.reveal()
      #expect(toolbar.isVisible)
      #expect(!preferences.toolbarVisible)
      #expect(!ComposerToolbarVisibility(preferences: preferences).isVisible)
    }
  }

  /// With nothing stored the bar is shown; a reveal keeps it shown and still stores nothing.
  @Test func revealLeavesAShownBarShownAndStoresNothing() throws {
    try withDefaults { preferences, stored in
      var toolbar = ComposerToolbarVisibility(preferences: preferences)
      toolbar.reveal()
      #expect(toolbar.isVisible)
      #expect(stored().isEmpty, "A reveal writes no preference.")
    }
  }

  /// After a reveal the toggle hides the bar and stores the hidden state, as web's toggle flips the open bar.
  @Test func theToggleAfterARevealHidesAndStoresHidden() throws {
    try withDefaults { preferences, _ in
      preferences.toolbarVisible = false
      var toolbar = ComposerToolbarVisibility(preferences: preferences)
      toolbar.reveal()
      toolbar.toggle()
      #expect(!toolbar.isVisible)
      #expect(!preferences.toolbarVisible)
    }
  }

  /// Hands the body preferences on a fresh suite and a reader of what that suite has stored.
  private func withDefaults(_ body: (ComposerPreferences, () -> [String: Any]) throws -> Void) throws {
    let suite = "ComposerToolbarVisibilityTests." + UUID().uuidString
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    try body(ComposerPreferences(defaults: defaults)) { defaults.persistentDomain(forName: suite) ?? [:] }
  }
}
