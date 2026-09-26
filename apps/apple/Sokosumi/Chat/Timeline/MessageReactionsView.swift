import CoreAPI
import SwiftUI

#if os(macOS)
  struct MessageReactionsView: View {
    let reactions: [Components.Schemas.ChatRoomMessageReaction]
    var toggle: ((String) -> Void)?

    var body: some View {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), alignment: .leading)], alignment: .leading, spacing: 6) {
        ForEach(reactions, id: \.emoji) { reaction in
          Button { toggle?(reaction.emoji) } label: {
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
          .buttonStyle(.plain)
          .disabled(toggle == nil)
          .help(participants(reaction))
          .accessibilityLabel("\(reaction.emoji), ^[\(reaction.count) reaction](inflect: true)")
          .accessibilityValue(reaction.reactedByCurrentUser ? "You reacted" : "You have not reacted")
          .accessibilityHint(participants(reaction))
        }
      }
    }

    private func participants(_ reaction: Components.Schemas.ChatRoomMessageReaction) -> String {
      let names = reaction.reactors.map(\.name).joined(separator: ", ")
      let remaining = max(0, reaction.count - reaction.reactors.count)
      guard remaining > 0 else { return names }
      return names.isEmpty ? "\(remaining) more" : "\(names), and \(remaining) more"
    }
  }
#endif
