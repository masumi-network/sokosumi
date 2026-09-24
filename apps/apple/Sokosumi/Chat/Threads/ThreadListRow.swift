import SokosumiChat
import SwiftUI

/// One thread row, web's `ThreadListRowContent` inside `threadListRowClassName`: shared by the room's thread
/// overview and the chat-level Threads view, as web shares it (SOK-1158, SOK-1159), so the two cannot drift.
/// The mark, the thread's name over its details, the time on the right. An unread row is the one place a
/// list spends the accent, deepening on hover; a read row only shows the neutral hover.
struct ThreadListRow: View {
  let isUnread: Bool
  let label: String
  /// When the newest reply (the newest unread one, where there is one) came.
  let time: Date
  /// Leads the second line of an unread row, "2 new", in the tint.
  var newReplies: Int?
  /// The rest of the second line: who started the thread, or which room it is in.
  let meta: String
  /// Unread replies naming the reader: the `@` mark and pill.
  var mentionCount = 0
  /// The 24b muted marker beside the time.
  var isMuted = false
  let open: () -> Void
  @State private var isHovered = false

  var body: some View {
    Button(action: open) {
      HStack(alignment: .top, spacing: 10) {
        ThreadListMark(tone: isUnread ? .attention : .read, namesReader: mentionCount > 0)
        VStack(alignment: .leading, spacing: 4) {
          HStack(alignment: .top) {
            Text(label)
              .lineLimit(2)
              .fontWeight(isUnread ? .semibold : .regular)
              .foregroundStyle(isUnread ? HierarchicalShapeStyle.primary : .secondary)
            Spacer(minLength: 4)
            if isMuted {
              Image(systemName: "bell.slash")
                .font(.caption).foregroundStyle(.secondary)
                .help("Muted").accessibilityLabel("Muted")
            }
            Text(time, format: .relative(presentation: .numeric, unitsStyle: .abbreviated))
              .font(.caption).fontWeight(isUnread ? .medium : .regular).monospacedDigit().lineLimit(1)
              .foregroundStyle(isUnread ? Color.accentColor : Color.secondary)
          }
          HStack(spacing: 6) {
            Group {
              if let newReplies {
                // What is new leads, tinted; the rest drops to a trailing name.
                Text("\(Text(threadNewRepliesLabel(newReplies)).fontWeight(.medium).foregroundStyle(.tint)) · \(Text(verbatim: meta))")
              } else {
                Text(verbatim: meta)
              }
            }
            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            if mentionCount > 0 {
              Spacer(minLength: 4)
              ThreadMentionPill(count: mentionCount)
            }
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading).padding(10)
      .background(rowBackground, in: .rect(cornerRadius: 8))
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .onHover { isHovered = $0 }
  }

  private var rowBackground: Color {
    if isUnread {
      return Color.accentColor.opacity(isHovered ? 0.15 : 0.08)
    }
    return isHovered ? Color.primary.opacity(0.1) : .clear
  }
}

/// Web's `UnreadThreads.newReplies`: "1 new", "2 new".
func threadNewRepliesLabel(_ count: Int) -> String {
  "\(max(0, count)) new"
}

/// Web's `Thread.replyCount`: "1 reply", "2 replies".
func threadRepliesLabel(_ count: Int) -> String {
  count == 1 ? "1 reply" : "\(count) replies"
}

/// A group heading in a thread list, read as a heading by VoiceOver like web's `h3`. A count above zero is
/// drawn as a tinted pill, capped like the room counts and hidden from VoiceOver, as on web: the rows under it
/// say how many.
struct ThreadGroupHeading: View {
  let title: LocalizedStringKey
  var threadCount = 0

  var body: some View {
    HStack(spacing: 6) {
      Text(title)
        .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
        .accessibilityAddTraits(.isHeader)
      if threadCount > 0 {
        Text(roomCountLabel(threadCount))
          .font(.caption2.weight(.semibold)).monospacedDigit().foregroundStyle(.tint)
          .padding(.horizontal, 6).padding(.vertical, 1)
          .background(Color.accentColor.opacity(0.15), in: .capsule)
          .accessibilityHidden(true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 2)
  }
}

/// The leading thread mark, web's `ThreadIconCircle`: the accent tint in a circle while the thread has
/// unread replies (`attention`), a neutral circle for the sidebar's plain unread Thread (`quiet`, so a list
/// under a room stays quiet), a bare secondary glyph once read; an `@` in place of the bubble for a thread
/// that names the reader. Hidden from VoiceOver; the row says it in words.
struct ThreadListMark: View {
  enum Tone {
    case attention, quiet, read
  }

  let tone: Tone
  let namesReader: Bool
  /// Web's `md` on a thread list row; the sidebar's inset rows use `sm`, 18 pt.
  var diameter: CGFloat = 22

  var body: some View {
    Image(systemName: namesReader ? "at" : "bubble.left")
      .font(diameter < 22 ? .caption2 : .caption)
      .foregroundStyle(tone == .attention ? Color.accentColor : Color.secondary)
      .frame(width: diameter, height: diameter)
      .background(circle, in: .circle)
      .accessibilityHidden(true)
  }

  private var circle: AnyShapeStyle {
    switch tone {
    case .attention: AnyShapeStyle(Color.accentColor.opacity(0.15))
    case .quiet: AnyShapeStyle(.quaternary)
    case .read: AnyShapeStyle(.clear)
    }
  }
}

/// Web's `MentionCountPill` at the end of a thread row's second line: `@` and the count, capped at "9+",
/// in the tint. VoiceOver hears web's words for it instead, "1 mention" / "N mentions".
private struct ThreadMentionPill: View {
  let count: Int

  var body: some View {
    HStack(spacing: 1) {
      Image(systemName: "at").imageScale(.small)
      Text(count > 9 ? "9+" : String(count)).monospacedDigit()
    }
    .font(.caption2.weight(.semibold)).foregroundStyle(.tint)
    .padding(.horizontal, 4).padding(.vertical, 1)
    .background(Color.accentColor.opacity(0.15), in: .capsule)
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(count == 1 ? "1 mention" : "\(count) mentions")
  }
}
