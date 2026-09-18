import Foundation

/// Whether the OS lets this app show notifications (web `Notification.permission`).
public enum ChatNotificationAuthorization: Equatable, Sendable {
  case notDetermined
  case denied
  case authorized
}

/// The app-side adapter that performs what the portable model decides. The
/// Mac app backs it with `UNUserNotificationCenter`; tests inject a fake.
@MainActor
public protocol ChatNotificationPresenting: AnyObject {
  /// Last known OS answer; the adapter re-reads it when the app activates.
  var authorization: ChatNotificationAuthorization { get }
  /// Web `document.hasFocus()`: the app is frontmost.
  var isAppActive: Bool { get }
  /// Asks the OS once; an answered prompt returns the stored answer.
  func requestAuthorization() async -> ChatNotificationAuthorization
  /// Replaces any standing banner with the same identifier.
  func show(_ banner: ChatNotificationBanner)
  func dismiss(identifier: String)
  func dismissAll()
}

/// Decides what one notification event does to the room banners (web
/// `NotificationToastListener`). Pure: focus and OS permission come in.
public struct ChatNotificationBanners: Sendable {
  public enum Action: Equatable, Sendable {
    case none
    case show(ChatNotificationBanner)
    case dismiss(identifier: String)
  }

  private var standing: [String: ChatNotificationTarget] = [:]

  public init() {}

  public mutating func handle(_ event: ChatNotificationEvent, isFocused: Bool, authorization: ChatNotificationAuthorization) -> Action {
    // A row that arrives already read was read elsewhere: another device, web
    // or the room itself. Before the gates below, because every one of them
    // turns a read row away and would leave the stale banner standing.
    if event.isRead {
      guard let banner = standing[event.bannerIdentifier] else { return .none }
      // A newer arrival can stand by the time an old read event lands. Equal
      // timestamps cannot order different rows; a missing one only identifies the cleared row itself.
      var covered = banner.id == event.id
      if let shownAt = banner.createdAt, let readAt = event.readAt, shownAt < readAt {
        covered = true
      }
      guard covered else { return .none }
      standing[event.bannerIdentifier] = nil
      return .dismiss(identifier: event.bannerIdentifier)
    }
    guard event.osBanner, authorization == .authorized, !isFocused else { return .none }
    let banner = event.banner
    standing[banner.identifier] = banner.target
    return .show(banner)
  }

  /// The reader opened or cleared the banner; nothing stands for that room any more.
  public mutating func forget(roomId: String) {
    standing = standing.filter { $0.value.roomId != roomId }
  }

  public mutating func removeAll() {
    standing = [:]
  }
}
