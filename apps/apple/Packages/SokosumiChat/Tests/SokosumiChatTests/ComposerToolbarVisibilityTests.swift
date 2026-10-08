import Foundation
import SokosumiChat
import Testing

struct ComposerToolbarVisibilityTests {
  @Test func startsFromTheStoredPreference() throws {
    try withDefaults { preferences in
      #expect(ComposerToolbarVisibility(preferences: preferences).isVisible)
      preferences.toolbarVisible = false
      #expect(!ComposerToolbarVisibility(preferences: preferences).isVisible)
    }
  }

  @Test func theToggleShowsOrHidesTheBarAndStoresIt() throws {
    try withDefaults { preferences in
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
    try withDefaults { preferences in
      preferences.toolbarVisible = false
      var toolbar = ComposerToolbarVisibility(preferences: preferences)
      toolbar.reveal()
      #expect(toolbar.isVisible)
      #expect(!preferences.toolbarVisible)
      #expect(!ComposerToolbarVisibility(preferences: preferences).isVisible)
    }
  }

  @Test func revealLeavesAShownBarShown() throws {
    try withDefaults { preferences in
      var toolbar = ComposerToolbarVisibility(preferences: preferences)
      toolbar.reveal()
      #expect(toolbar.isVisible)
      #expect(preferences.toolbarVisible)
    }
  }

  /// After a reveal the toggle hides the bar and stores the hidden state, as web's toggle flips the open bar.
  @Test func theToggleAfterARevealHidesAndStoresHidden() throws {
    try withDefaults { preferences in
      preferences.toolbarVisible = false
      var toolbar = ComposerToolbarVisibility(preferences: preferences)
      toolbar.reveal()
      toolbar.toggle()
      #expect(!toolbar.isVisible)
      #expect(!preferences.toolbarVisible)
    }
  }

  private func withDefaults(_ body: (ComposerPreferences) throws -> Void) throws {
    let suite = "ComposerToolbarVisibilityTests." + UUID().uuidString
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    try body(ComposerPreferences(defaults: defaults))
  }
}
