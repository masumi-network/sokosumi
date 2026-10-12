import Foundation

/// One composer's formatting bar (web's `formatToolbarOpen` in `room-composer.tsx`). It starts from the stored
/// preference, read once when the composer is created; only the toggle writes the preference back. Opening the
/// link editor reveals the bar for this composer alone and stores nothing, so the next composer starts from the
/// preference again (row 11a).
public struct ComposerToolbarVisibility {
  private let preferences: ComposerPreferences
  public private(set) var isVisible: Bool

  public init(preferences: ComposerPreferences = ComposerPreferences()) {
    self.preferences = preferences
    isVisible = preferences.toolbarVisible
  }

  /// The bar's Show/Hide formatting button.
  public mutating func toggle() {
    isVisible.toggle()
    preferences.toolbarVisible = isVisible
  }

  /// ⌘K or the bar's link control: shows the bar without storing it.
  public mutating func reveal() {
    isVisible = true
  }
}
