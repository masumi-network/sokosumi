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
