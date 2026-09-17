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
/// does not expose the failure reason, so the label stays generic; a rejected
/// retry (403/409/404) surfaces Core's message in an alert.
struct CoworkerMentionFailedView: View {
  let onRetry: (() async throws -> Void)?
  @State private var isRetrying = false
  @State private var retryError: String?
  @State private var showsRetryError = false

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
      if onRetry != nil {
        Button("Retry", action: retry)
          .buttonStyle(.borderless)
          .font(.caption)
          .disabled(isRetrying)
      }
    }
    .alert("Couldn’t retry the mention", isPresented: $showsRetryError) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(retryError ?? "Try again.")
    }
  }

  private func retry() {
    guard !isRetrying, let onRetry else { return }
    isRetrying = true
    Task { @MainActor in
      defer { isRetrying = false }
      do { try await onRetry() } catch {
        retryError = friendlyMessage(for: error)
        showsRetryError = true
      }
    }
  }
}
