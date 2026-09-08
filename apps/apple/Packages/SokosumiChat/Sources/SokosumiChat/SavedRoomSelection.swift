import CoreAPI
import Foundation

/// Persists the selected room across launches (per Mac, via UserDefaults).
/// The saved id wins when the room still exists, otherwise the first room
/// applies. Sign-out must `clear()` so a shared Mac does not hand the next
/// account the previous user's room.
public struct SavedRoomSelection {
  private let defaults: UserDefaults
  private let key = "sokosumi.selectedRoomId"

  /// `suiteName` isolates tests from real preferences.
  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func save(_ id: String) {
    defaults.set(id, forKey: key)
  }

  public func load() -> String? {
    defaults.string(forKey: key)
  }

  public func clear() {
    defaults.removeObject(forKey: key)
  }
}
