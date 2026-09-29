import SokosumiChat
import SwiftUI

/// The row where a paged list goes on: web's `TranscriptBoundaryRow` in the transcript and
/// `ThreadListLoadMore` in the thread overview, which share one shape. One button, so a click on the
/// label or on the error text lands too; while loading it shows a spinner and is disabled, and a failure
/// stays on the row with a retry.
struct PageBoundaryRow: View {
  /// The row's words in each state.
  struct Copy {
    /// Shown over the action while idle or loading, as the transcript gap's "Messages are missing here".
    var context: String?
    var load: String
    var loading: String
    var failure: String
    var retry: String
    var accessibilityIdentifier: String
  }

  let copy: Copy
  let status: PageBoundaryStatus
  let load: () -> Void

  private var isLoading: Bool {
    status == .loading
  }

  var body: some View {
    Button(action: load) {
      VStack(spacing: 2) {
        if status == .failed {
          Text(copy.failure)
            .foregroundStyle(.red)
        } else if let context = copy.context {
          Text(context)
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 6) {
          if isLoading {
            ProgressView()
              .controlSize(.small)
          }
          Text(actionLabel)
            .foregroundStyle(isLoading ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
        }
      }
      .font(.callout)
      .multilineTextAlignment(.center)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 8)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(isLoading)
    .accessibilityLabel(accessibilityLabel)
    .accessibilityIdentifier(copy.accessibilityIdentifier)
    // Web's failure is a `role="alert"` span, announced when it appears. Once per
    // transition into failed, not on every redraw and not for loading or idle.
    .onChange(of: status) { _, status in
      if status == .failed {
        AccessibilityNotification.Announcement(copy.failure).post()
      }
    }
  }

  /// What the focused row reads: the failure or the context, then the action.
  private var accessibilityLabel: String {
    if status == .failed {
      return "\(copy.failure) \(actionLabel)"
    }
    return copy.context.map { "\($0). \(actionLabel)" } ?? actionLabel
  }

  private var actionLabel: String {
    switch status {
    case .failed: copy.retry
    case .loading: copy.loading
    case .idle: copy.load
    }
  }
}

extension PageBoundaryRow.Copy {
  /// Web's `TranscriptBoundaryRow`: between two loaded ranges (`isGap`) or above the oldest one.
  static func transcript(isGap: Bool) -> Self {
    Self(
      context: isGap ? "Messages are missing here" : nil,
      load: isGap ? "Load missing messages" : "Load older messages",
      loading: isGap ? "Loading missing messages…" : "Loading older messages…",
      failure: "Couldn’t load messages.",
      retry: "Try again",
      accessibilityIdentifier: isGap ? "transcript-gap-row" : "transcript-oldest-row"
    )
  }

  /// Web's `ThreadListLoadMore` in the room's thread overview (`UnreadThreads.*`): a failed page reads
  /// "Could not load threads. Try again." and retries with the idle label.
  static let olderThreads = Self(
    context: nil,
    load: "Load older threads",
    loading: "Loading threads…",
    failure: "Could not load threads. Try again.",
    retry: "Load older threads",
    accessibilityIdentifier: "thread-list-load-more"
  )

  /// Web's `ThreadListLoadMore` under the Threads view's Unread group (`ThreadsView.*`).
  static let unreadThreads = Self(
    context: nil,
    load: "Show more",
    loading: "Loading threads…",
    failure: "Could not load unread threads.",
    retry: "Try again",
    accessibilityIdentifier: "unread-threads-load-more"
  )

  /// Web's `ThreadListLoadMore` under the Threads view's Earlier group.
  static let earlierThreads = Self(
    context: nil,
    load: "Load older threads",
    loading: "Loading threads…",
    failure: "Could not load threads. Try again.",
    retry: "Try again",
    accessibilityIdentifier: "earlier-threads-load-more"
  )
}

extension View {
  /// Web's `useLoadWhenVisible` on a paging row: asks for the next page as soon as any of the row is in view,
  /// once per arming. It re-arms when the row goes idle again or the last loaded row changes, even when the
  /// row never left the screen; a failed page stays disarmed until the reader retries.
  func loadsWhenVisible(armed: Bool, boundaryKey: String?, load: @escaping () -> Void) -> some View {
    modifier(LoadWhenVisible(armed: armed, boundaryKey: boundaryKey, load: load))
  }
}

private struct LoadWhenVisible: ViewModifier {
  private struct Arming: Equatable {
    let visible: Bool
    let armed: Bool
    let boundaryKey: String?
  }

  let armed: Bool
  let boundaryKey: String?
  let load: () -> Void
  @State private var visible = false

  func body(content: Content) -> some View {
    content
      .onScrollVisibilityChange(threshold: 0.01) { visible = $0 }
      .onDisappear { visible = false }
      .onChange(of: Arming(visible: visible, armed: armed, boundaryKey: boundaryKey), initial: true) { _, arming in
        guard arming.visible, arming.armed else { return }
        Task { @MainActor in load() }
      }
  }
}
