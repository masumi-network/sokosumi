import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI
import UserNotifications

#if os(macOS)
  import AppKit
#endif

/// `UNUserNotificationCenter` behind `ChatNotificationPresenting`: the
/// packages decide what to show or take down, this performs it. Local
/// notifications only; nothing here registers for push (ADR 0022 / 0023).
@MainActor
final class ChatNotificationCenter: NSObject, ChatNotificationPresenting {
  static let shared = ChatNotificationCenter()
  private(set) var authorization: ChatNotificationAuthorization = .notDetermined
  private var onOpen: (@MainActor (ChatNotificationTarget) -> Void)?
  private var center: UNUserNotificationCenter {
    .current()
  }

  var isAppActive: Bool {
    #if os(macOS)
      NSApplication.shared.isActive
    #else
      true
    #endif
  }

  /// Installs the delegate once; later calls only replace the open handler.
  /// Banners left by an earlier process describe a session that is over.
  func start(onOpen: @escaping @MainActor (ChatNotificationTarget) -> Void) {
    let first = self.onOpen == nil
    self.onOpen = onOpen
    guard first else { return }
    center.delegate = self
    center.removeAllDeliveredNotifications()
    Task { await refreshAuthorization() }
  }

  /// Web re-reads `Notification.permission` on focus; the reader may have changed it in System Settings.
  func refreshAuthorization() async {
    authorization = await Self.map(center.notificationSettings().authorizationStatus)
  }

  func requestAuthorization() async -> ChatNotificationAuthorization {
    await refreshAuthorization()
    guard authorization == .notDetermined else { return authorization }
    _ = try? await center.requestAuthorization(options: [.alert])
    await refreshAuthorization()
    return authorization
  }

  func show(_ banner: ChatNotificationBanner) {
    let content = UNMutableNotificationContent()
    content.title = banner.title
    content.body = banner.body
    content.threadIdentifier = banner.identifier
    content.userInfo = banner.target.userInfo
    // The same identifier replaces the standing banner for that room.
    center.add(UNNotificationRequest(identifier: banner.identifier, content: content, trigger: nil))
  }

  func dismiss(identifier: String) {
    center.removeDeliveredNotifications(withIdentifiers: [identifier])
    center.removePendingNotificationRequests(withIdentifiers: [identifier])
  }

  func dismissAll() {
    center.removeAllDeliveredNotifications()
    center.removeAllPendingNotificationRequests()
  }

  private static func map(_ status: UNAuthorizationStatus) -> ChatNotificationAuthorization {
    switch status {
    case .notDetermined: .notDetermined
    case .denied: .denied
    default: .authorized
    }
  }
}

extension ChatNotificationCenter: UNUserNotificationCenterDelegate {
  /// The coordinator already applied the unfocused rule, so a banner it asked for is shown even while the app is frontmost
  /// (Settings key, no chat window active).
  nonisolated func userNotificationCenter(
    _: UNUserNotificationCenter, willPresent _: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .list]
  }

  nonisolated func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
          let target = ChatNotificationTarget(userInfo: response.notification.request.content.userInfo) else { return }
    await MainActor.run { onOpen?(target) }
  }
}

/// Wires the adapter to the coordinator for the app lifetime and routes an opened banner like a chat link.
struct ChatNotificationLifecycleModifier: ViewModifier {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  @State private var openError: String?
  @State private var openTask: Task<Void, Never>?

  func body(content: Content) -> some View {
    content
      .onAppear {
        Task { @MainActor in
          workspaces.notificationPresenter = ChatNotificationCenter.shared
          ChatNotificationCenter.shared.start { target in open(target) }
        }
      }
    #if os(macOS)
      .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
        Task { await ChatNotificationCenter.shared.refreshAuthorization() }
      }
    #endif
      .alert("Couldn’t open notification", isPresented: Binding(get: { openError != nil }, set: {
        if !$0 {
          openError = nil
        }
      })) {
        Button("OK", role: .cancel) {}
      } message: { Text(openError ?? "") }
  }

  private func open(_ target: ChatNotificationTarget) {
    openTask?.cancel()
    openTask = Task { @MainActor in
      do {
        if try await workspaces.openNotification(target, auth: auth) == .unavailable, !Task.isCancelled {
          openError = "This message or conversation is no longer available."
        }
      } catch {
        if !Task.isCancelled {
          openError = friendlyMessage(for: error)
        }
      }
    }
  }
}
