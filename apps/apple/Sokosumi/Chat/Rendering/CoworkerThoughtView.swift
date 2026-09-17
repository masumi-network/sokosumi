import SokosumiChat
import SwiftUI

struct CoworkerThoughtView: View {
  let thought: CoworkerThought
  let working: Bool
  let startedAt: Date

  var body: some View {
    if working || !thought.text.isEmpty {
      Group {
        if working {
          VStack(alignment: .leading, spacing: 4) {
            header
            if !thought.text.isEmpty {
              Text(thought.text)
                .textSelection(.enabled)
                .lineLimit(3)
            }
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(thought.text.isEmpty ? "Thinking" : "Thinking, \(thought.text)")
        } else {
          DisclosureGroup {
            Text(thought.text).textSelection(.enabled)
          } label: {
            header
          }
        }
      }
      .font(.callout)
      .foregroundStyle(.secondary)
    }
  }

  private var header: some View {
    HStack(spacing: 6) {
      Image(systemName: "sparkle").accessibilityHidden(true)
      if working {
        Text("Thinking")
        TimelineView(.periodic(from: .now, by: 0.1)) { context in
          let elapsed = max(0, context.date.timeIntervalSince(startedAt))
          if elapsed < 10 {
            Text("\(elapsed, specifier: "%.1f")s").monospacedDigit()
          } else {
            Text(CoworkerThought.durationLabel(seconds: Int(elapsed))).monospacedDigit()
          }
        }
        .accessibilityHidden(true)
      } else if let duration = thought.durationSeconds {
        Text("Thought for \(CoworkerThought.durationLabel(seconds: duration))")
      } else {
        Text("Thought")
      }
    }
  }
}

/// Settled Thought header on a failed mention shell plus the mentioner-only
/// Retry (web `CoworkerFailedThoughtSparkle` + `FailedMentionActions`). Core
/// does not expose the failure reason, so the label stays generic. The row
/// owns the POST and the rejection alert: this view unmounts while retry
/// flips the shell to thinking.
struct CoworkerMentionFailedView: View {
  var onRetry: (() -> Void)?
  var isRetrying = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Image(systemName: "sparkle")
          .foregroundStyle(.tertiary)
          .accessibilityHidden(true)
        Text("Failed to reply")
      }
      .font(.callout)
      .foregroundStyle(.secondary)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Failed to reply")
      if let onRetry {
        Button("Retry", action: onRetry)
          .buttonStyle(.borderless)
          .font(.caption)
          .disabled(isRetrying)
      }
    }
  }
}
