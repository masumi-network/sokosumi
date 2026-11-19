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
              // Web stacks the whole trace's paragraphs without a gap and clamps the stack
              // to three lines, so the reader sees its start.
              Text(thought.steps.joined(separator: "\n"))
                .textSelection(.enabled)
                .lineLimit(3)
            }
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(thought.text.isEmpty ? "Thinking…" : "Thinking… \(thought.text)")
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
      if working {
        // Web `reasoning.thinking` ("Thinking..."), with the typographic ellipsis.
        Text("Thinking…")
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
        // Web `reasoning.expandSteps`: a disclosure without timing.
        Text("Show thought")
      }
    }
  }
}

/// Settled Thought header on a failed mention shell plus the mentioner-only
/// Retry (web failed Thought header + `FailedMentionActions`). Core
/// does not expose the failure reason for generic failures, so the label stays generic. The row
/// owns the POST and the rejection alert: this view unmounts while retry
/// flips the shell to thinking.
struct CoworkerMentionFailedView: View {
  var onRetry: (() -> Void)?
  var isRetrying = false
  let aiBudgetExceeded: Bool
  let isSokoBot: Bool
  let isCancelled: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Image(systemName: "exclamationmark.circle")
          .foregroundStyle(.tertiary)
          .accessibilityHidden(true)
        Text("Failed to reply")
      }
      .font(.callout)
      .foregroundStyle(.secondary)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Failed to reply")
      if isCancelled || aiBudgetExceeded || isSokoBot {
        sokoBotFailureText(aiBudgetExceeded: aiBudgetExceeded, isCancelled: isCancelled)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      if let onRetry {
        Button("Retry", action: onRetry)
          .buttonStyle(.borderless)
          .font(.caption)
          .disabled(isRetrying)
      }
    }
  }
}

private func sokoBotFailureText(aiBudgetExceeded: Bool, isCancelled: Bool = false) -> Text {
  if isCancelled {
    Text(
      "The reply stopped before it finished.",
      tableName: "ChatSokoBot",
      comment: "Below a cancelled assistant reply."
    )
  } else if aiBudgetExceeded {
    Text(
      "Your assistant has reached its usage limit. It can respond again when the limit is raised or resets.",
      tableName: "ChatSokoBot",
      comment: "Below a failed assistant reply when the assistant has hit its usage limit."
    )
  } else {
    Text(
      "Something went wrong on our side. Try again. If it keeps happening, contact support.",
      tableName: "ChatSokoBot",
      comment: "Below a failed assistant reply or background run with an unclassified error."
    )
  }
}

struct SokoBotBackgroundFailureView: View {
  let title: String
  let kind: SokoBotBackgroundFailureKind

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if kind == .deadline {
        Text(
          "Background run \"\(title)\" ran out of time before it could report.",
          tableName: "ChatSokoBot",
          comment: "Shown when a background run reached its deadline. %@ is the name of the run."
        )
      } else {
        Text(
          "Background run \"\(title)\" failed before it could report.",
          tableName: "ChatSokoBot",
          comment: "Heading for a failed background run. %@ is the name of the run."
        )
        sokoBotFailureText(aiBudgetExceeded: kind == .budget)
      }
    }
  }
}
