import CoreAPI
import Foundation

/// Persists the selected room per account and workspace across launches.
/// The saved id wins when the room still exists, otherwise the first room
/// applies. Account/workspace keys prevent cross-account restoration.
public struct SavedRoomSelection {
  private let defaults: UserDefaults
  private func key(userId: String, organizationId: String?) -> String {
    let parts = [userId, organizationId == nil ? "personal" : "organization", organizationId ?? ""]
    return "sokosumi.selectedRoom.v2." + parts.map { "\($0.utf8.count):\($0)" }.joined()
  }

  /// `suiteName` isolates tests from real preferences.
  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func save(_ id: String, userId: String, organizationId: String?) {
    defaults.set(id, forKey: key(userId: userId, organizationId: organizationId))
  }

  public func load(userId: String, organizationId: String?) -> String? {
    defaults.string(forKey: key(userId: userId, organizationId: organizationId))
  }
}
