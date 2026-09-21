import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

struct PinnedMessagesView: View {
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState
  @ObservedObject var pins: PinnedMessages
  let room: Components.Schemas.ChatRoom
  let jump: (String) async throws -> MessageNavigationResult
  let close: () -> Void
  @State private var jumpingId: String?
  @State private var actionError: String?

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Label("Pinned messages", systemImage: "pin")
          .font(.headline)
        Spacer()
        Button("Close pinned messages", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly).buttonStyle(.borderless)
          .help("Close pinned messages")
      }
      .padding(16)
      Divider()
      ScrollView {
        LazyVStack(spacing: 12) {
          if pins.isLoading {
            ProgressView("Loading pinned messages…").padding(.vertical, 16)
          }
          if let error = actionError ?? pins.errorMessage {
            VStack(spacing: 8) {
              Text(error).foregroundStyle(.secondary)
              Button("Retry") { Task { await load() } }
            }
          }
          if !pins.isLoading, pins.items.isEmpty, pins.errorMessage == nil, actionError == nil {
            Text("No pinned messages yet").foregroundStyle(.secondary).padding(.vertical, 24)
          }
          ForEach(pins.items, id: \.messageId) { item in
            PinnedMessageCard(item: item, room: room, channels: workspaces.composerChannels,
                              isJumping: jumpingId == item.messageId,
                              isUpdating: workspaces.isUpdatingPin(item.messageId),
                              jump: { performJump(item.messageId) },
                              unpin: { Task {
                                do {
                                  try await workspaces.setPinned(false, messageId: item.messageId, auth: auth)
                                } catch { actionError = friendlyMessage(for: error) }
                              } })
                              .disabled(jumpingId != nil)
          }
          if pins.nextCursor != nil {
            Button("Load older pins") { Task { await load(older: true) } }
              .disabled(pins.isLoading)
              .frame(maxWidth: .infinity)
          }
        }
        .padding(12)
      }
    }
    .font(.callout)
    .task(id: pins.revision) { await load() }
  }

  private func load(older: Bool = false) async {
    actionError = nil
    do {
      try await workspaces.loadPins(auth: auth, older: older)
    } catch {
      if !Task.isCancelled {
        actionError = friendlyMessage(for: error)
      }
    }
  }

  private func performJump(_ id: String) {
    jumpingId = id
    actionError = nil
    Task { @MainActor in
      defer { jumpingId = nil }
      do {
        switch try await jump(id) {
        case .opened:
          close()
        case .unavailable:
          actionError = "This message is no longer available."
        case .superseded:
          break
        }
      } catch { actionError = friendlyMessage(for: error) }
    }
  }
}

struct PinnedMessageCard: View {
  let item: Components.Schemas.ChatRoomPinnedMessageListItem
  let room: Components.Schemas.ChatRoom
  let channels: [ComposerChannel]
  let isJumping: Bool
  let isUpdating: Bool
  let jump: () -> Void
  let unpin: () -> Void
  @State private var isHovered = false
  @ScaledMetric(relativeTo: .callout) private var previewHeight = 120.0

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      if let message = item.message {
        Button(action: jump) {
          VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(messageSenderName(message.sender)).fontWeight(.medium).lineLimit(1)
              if isJumping {
                ProgressView().controlSize(.small)
              } else {
                Text(message.createdAt, style: .relative).font(.caption).foregroundStyle(.secondary).lineLimit(1)
              }
            }
            let preview = PinnedMessagePreview(message)
            if let author = preview.quotedAuthor {
              // A quote can be the whole message; show what was quoted, in the block quotes are drawn in.
              MessageQuoteBlock {
                VStack(alignment: .leading, spacing: 4) {
                  if !author.isEmpty {
                    Text(author).fontWeight(.semibold).lineLimit(1).truncationMode(.tail)
                  }
                  if !preview.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    markdown(preview.source).foregroundStyle(.secondary)
                  }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
              }
              .accessibilityElement(children: .ignore)
              .accessibilityLabel(preview.accessibilityLabel ?? "")
            } else {
              markdown(preview.source)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help("Go to pinned message")
      } else {
        Text("This message is no longer available.").foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      Button("Unpin message", systemImage: "pin.slash", action: unpin)
        .labelStyle(.iconOnly).buttonStyle(.borderless)
        .frame(width: 28, height: 28)
        .disabled(isUpdating)
        .help("Unpin message")
    }
    .padding(12)
    .background(isHovered ? Color.primary.opacity(0.06) : .clear, in: .rect(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.primary.opacity(0.12)))
    .onHover { isHovered = $0 }
  }

  private func markdown(_ source: String) -> some View {
    MessageMarkdownView(source: source, room: room, channels: channels)
      .lineLimit(6)
      .frame(maxHeight: previewHeight, alignment: .top)
      .fixedSize(horizontal: false, vertical: true)
      .clipped()
      .allowsHitTesting(false)
  }
}
