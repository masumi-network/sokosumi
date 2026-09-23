import CoreAPI
import SokosumiChat
import SwiftUI

struct RoomThreadOverviewView: View {
  @ObservedObject var overview: RoomThreadOverview
  let open: (Components.Schemas.ChatRoomMessage) -> Void
  let older: () -> Void
  let markAllRead: () -> Void
  let retry: () -> Void
  let close: () -> Void
  @State private var hoveredId: String?

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Threads").font(.headline)
        Spacer()
        if overview.items.contains(where: { $0.unreadReplyCount > 0 }) {
          Button("Mark all as read", action: markAllRead)
            .disabled(overview.isMarkingRead || overview.isLoading)
        }
        Button("Close threads", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly).buttonStyle(.borderless).help("Close threads")
      }.padding(16)
      Divider()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 4) {
          if overview.isLoading, overview.items.isEmpty {
            ProgressView("Loading threads…").frame(maxWidth: .infinity).padding()
          } else if let failure = overview.failure {
            VStack(alignment: .leading, spacing: 8) {
              Text(friendlyMessage(for: failure)).foregroundStyle(.secondary)
              Button("Retry", action: retry)
            }.padding()
          } else if overview.items.isEmpty {
            Text("No threads yet").foregroundStyle(.secondary).padding()
          }
          ForEach(overview.items, id: \.parentMessage.id) { item in
            Button { open(item.parentMessage) } label: {
              HStack(alignment: .top, spacing: 8) {
                Circle().fill(item.unreadReplyCount > 0 ? Color.accentColor : .clear)
                  .frame(width: 6, height: 6).padding(.top, 6).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                  HStack(alignment: .top) {
                    Text(preview(for: item.parentMessage))
                      .lineLimit(2).fontWeight(item.unreadReplyCount > 0 ? .semibold : .regular)
                    Spacer(minLength: 4)
                    if item.mutedAt != nil {
                      Image(systemName: "bell.slash")
                        .font(.caption).foregroundStyle(.secondary)
                        .help("Muted").accessibilityLabel("Muted")
                    }
                    Text(item.lastReplyAt, format: .relative(presentation: .numeric, unitsStyle: .abbreviated)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                  }
                  Text("Started by \(messageSenderName(item.parentMessage.sender))").font(.caption).lineLimit(1)
                  Text(replyCountLabel(item))
                    .font(.caption).foregroundStyle(.secondary)
                }
              }
              .frame(maxWidth: .infinity, alignment: .leading).padding(10)
              .background(hoveredId == item.parentMessage.id ? Color.primary.opacity(0.1) : item.unreadReplyCount > 0 ? Color.primary.opacity(0.05) : .clear, in: .rect(cornerRadius: 8))
              .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .onHover { hoveredId = $0 ? item.parentMessage.id : nil }
          }
          if overview.nextCursor != nil {
            Button(overview.isLoading ? "Loading…" : "Load older threads", action: older)
              .disabled(overview.isLoading || overview.isMarkingRead)
              .frame(maxWidth: .infinity).padding(8)
          }
        }.padding(8)
      }
    }.font(.callout)
  }

  private func replyCountLabel(_ item: Components.Schemas.ChatRoomThread) -> String {
    if item.unreadReplyCount > 0 {
      return item.unreadReplyCount == 1 ? "1 unread reply" : "\(item.unreadReplyCount) unread replies"
    }
    return item.replyCount == 1 ? "1 reply" : "\(item.replyCount) replies"
  }

  private func preview(for message: Components.Schemas.ChatRoomMessage) -> String {
    guard let text = overview.previews[message.id], !text.isEmpty else { return messageSenderName(message.sender) }
    return text
  }
}
