import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  import AppKit

  /// Web's presence activity events (`pointerdown`, `keydown`, `wheel`,
  /// `touchstart`) as one app-wide local event monitor. Window focus and
  /// visibility already flow through `setWindowVisible`. The monitor never
  /// consumes events; it only refreshes `lastActiveAt` on the shared throttle.
  @MainActor
  final class PresenceActivityMonitor {
    static let shared = PresenceActivityMonitor()
    private var monitor: Any?

    /// Installs once for the app lifetime; later calls keep the first handler.
    func start(_ onActivity: @escaping @MainActor () -> Void) {
      guard monitor == nil else { return }
      monitor = NSEvent.addLocalMonitorForEvents(
        matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown, .scrollWheel]
      ) { event in
        onActivity()
        return event
      }
    }
  }
#endif

/// Org presence lifecycle hooks the app owes the coordinator: user activity
/// while running, and leaving presence before the process exits.
struct PresenceLifecycleModifier: ViewModifier {
  @EnvironmentObject private var workspaces: WorkspaceState

  func body(content: Content) -> some View {
    #if os(macOS)
      content
        .onAppear {
          // The monitor outlives this view; hold the coordinator weakly through a local so the capture is explicit.
          let coordinator = workspaces
          PresenceActivityMonitor.shared.start { [weak coordinator] in
            coordinator?.recordPresenceActivity()
          }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
          workspaces.prepareForTermination()
        }
    #else
      content
    #endif
  }
}
