import SokosumiChat
import SwiftUI

#if os(macOS)
  /// Web's `TranscriptBoundaryRow`: where the transcript has history missing,
  /// above the oldest loaded range or between two ranges a jump left apart.
  /// One button, so a click on the label or on the error text lands too.
  struct TranscriptBoundaryRow: View {
    /// Between two loaded ranges, as opposed to above the oldest one.
    let isGap: Bool
    let status: TranscriptBoundaryStatus
    let load: () -> Void

    private static let failureText = "Couldn’t load messages."

    private var isLoading: Bool {
      status == .loading
    }

    var body: some View {
      Button(action: load) {
        VStack(spacing: 2) {
          if status == .failed {
            Text(Self.failureText)
              .foregroundStyle(.red)
          } else if isGap {
            Text("Messages are missing here")
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
      .accessibilityIdentifier(isGap ? "transcript-gap-row" : "transcript-oldest-row")
      // Web's failure is a `role="alert"` span, announced when it appears. Once per
      // transition into failed, not on every redraw and not for loading or idle.
      .onChange(of: status) { _, status in
        if status == .failed {
          AccessibilityNotification.Announcement(Self.failureText).post()
        }
      }
    }

    /// What the focused row reads: the failure or the gap text, then the action.
    private var accessibilityLabel: String {
      if status == .failed {
        return "\(Self.failureText) \(actionLabel)"
      }
      return isGap ? "Messages are missing here. \(actionLabel)" : actionLabel
    }

    private var actionLabel: String {
      switch (status, isGap) {
      case (.failed, _):
        "Try again"
      case (.loading, true):
        "Loading missing messages…"
      case (.idle, true):
        "Load missing messages"
      case (.loading, false):
        "Loading older messages…"
      case (.idle, false):
        "Load older messages"
      }
    }
  }
#endif
