import CoreAPI
import SokosumiChat
import SwiftUI

#if os(macOS)
  struct MessageReactionsView: View {
    let reactions: [Components.Schemas.ChatRoomMessageReaction]
    var toggle: ((String) -> Void)?

    var body: some View {
      WrappingRow(spacing: 6) {
        ForEach(reactions, id: \.emoji) { reaction in
          Group {
            if let toggle {
              Button { toggle(reaction.emoji) } label: { chip(reaction) }
                .buttonStyle(.plain)
            } else {
              // Web's `aria-disabled` chip: drawn as usual and still says who reacted, but takes no tap (a
              // Read-only Direct, or a message that cannot take Reactions yet).
              chip(reaction)
                .accessibilityElement(children: .ignore)
            }
          }
          .help(reaction.whoReacted ?? "")
          .accessibilityLabel("\(reaction.emoji), ^[\(reaction.count) reaction](inflect: true)")
          .accessibilityValue(reaction.reactedByCurrentUser ? "You reacted" : "You have not reacted")
          .accessibilityHint(reaction.whoReacted ?? "")
        }
      }
    }

    private func chip(_ reaction: Components.Schemas.ChatRoomMessageReaction) -> some View {
      HStack(spacing: 4) {
        Text(reaction.emoji)
        Text(reaction.count, format: .number).font(.caption)
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(reaction.reactedByCurrentUser ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.12), in: .capsule)
      .overlay(Capsule().strokeBorder(reaction.reactedByCurrentUser ? Color.accentColor : Color.secondary.opacity(0.3)))
      .contentShape(.capsule)
    }
  }
#endif
