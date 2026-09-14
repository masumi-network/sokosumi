import CoreAPI
import SokosumiAuth
import SokosumiChat
import SwiftUI

#if os(macOS)
  /// Wall-clock HH:mm in the local timezone, like web `formatMessageTime`.
  private let messageTimeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.timeStyle = .short
    formatter.dateStyle = .none
    return formatter
  }()

  /// Delivery mark in the header or continuation gutter; retains the header clock until needed.
  private struct DeliveryFeedback: View {
    let pendingSince: Date?
    let sentAt: Date?
    var timestamp: Date?
    @State private var showSending = false

    var body: some View {
      HStack(spacing: 4) {
        if pendingSince != nil, showSending {
          ProgressView().controlSize(.mini)
            .accessibilityLabel("Sending")
            .help("Sending…")
        } else if sentAt != nil {
          Image(systemName: "checkmark")
            .accessibilityLabel("Sent")
            .help("Sent")
        } else if let timestamp {
          Text(messageTimeFormatter.string(from: timestamp))
        }
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      .task(id: pendingSince) {
        showSending = false
        guard let pendingSince else { return }
        let remaining = max(0, 0.5 - Date().timeIntervalSince(pendingSince))
        do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
        showSending = true
      }
    }
  }

  struct MessageRowView: View {
    /// Avatar edge: web uses 32px, but that reads oversized next to the
    /// native sidebar (28pt "me" avatar), so the transcript matches in-app.
    static let avatarDiameter: CGFloat = 28

    var channels: [ComposerChannel] = []
    var room: Components.Schemas.ChatRoom?
    let message: Components.Schemas.ChatRoomMessage
    let isContinuation: Bool
    let outbound: OutboundShell?
    var sentAt: Date?
    let onRetry: (() -> Void)?
    let onRemove: (() -> Void)?
    var onReply: (() -> Void)?
    var onQuote: (() -> Void)?
    var onEdit: (() -> Void)?
    var onDelete: (() async throws -> Void)?
    var editing: MessageEditing?
    var onQuoteJump: ((String) -> Void)?
    var horizontalInset: CGFloat = 0
    var streamReasoning: String?
    var streamThinking = false
    @State private var confirmsDeletion = false
    @State private var isDeleting = false
    @State private var deletionError: String?
    @State private var showsDeletionError = false
    @State private var isHovered = false
    @State private var isReplyHovered = false
    @ScaledMetric(relativeTo: .body) private var replyActionHeight: CGFloat = 28
    @FocusState private var focusedAction: MessageAction?

    private enum MessageAction: Hashable {
      case quote, reply, edit, more
    }

    private func deleteMessage() {
      guard !isDeleting, let onDelete else { return }
      isDeleting = true
      Task { @MainActor in
        defer { isDeleting = false }
        do { try await onDelete() } catch {
          deletionError = friendlyMessage(for: error)
          showsDeletionError = true
        }
      }
    }

    var body: some View {
      HStack(alignment: .top, spacing: 14) {
        if isContinuation {
          DeliveryFeedback(pendingSince: pendingSince, sentAt: sentAt)
            .frame(width: Self.avatarDiameter)
            .frame(minHeight: 16)
        } else {
          ParticipantProfileButton(sender: message.sender) { avatarView }
        }
        // Header-to-body rhythm mirrors web: space-y-1.5 (6pt) under the
        // header, and gap-x-2.5 (10pt) between name and time.
        VStack(alignment: .leading, spacing: 6) {
          if !isContinuation {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              ParticipantProfileButton(sender: message.sender) {
                Text(messageSenderName(message.sender))
                  .fontWeight(.semibold)
                  .foregroundStyle(.primary)
                  .lineLimit(1)
              }
              DeliveryFeedback(pendingSince: pendingSince, sentAt: sentAt,
                               timestamp: message.createdAt)
              if message.editedAt != nil, message.deletedAt == nil {
                Text("Edited").help(message.editedAt?.formatted(date: .abbreviated, time: .shortened) ?? "")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
            }
          }
          if isCoworkerMessage(message), message.deletedAt == nil {
            CoworkerThoughtView(thought: CoworkerThought(message: message, streamedText: streamReasoning),
                                working: streamThinking, startedAt: message.createdAt)
          }
          if message.deletedAt != nil {
            Text("This message was deleted")
              .italic()
              .foregroundStyle(.secondary)
          } else {
            if let quote = message.quote {
              MessageQuoteView(quote: quote, room: room, channels: channels, jump: onQuoteJump)
                .id(quote.messageId + quote.snippet)
            }
            if let editing, editing.source?.id == message.id {
              MessageEditComposer(editing: editing).id(message.id)
            } else {
              MessageMarkdownView(source: message.content, room: room, channels: channels)
            }
            if isContinuation, message.editedAt != nil {
              Text("Edited").help(message.editedAt?.formatted(date: .abbreviated, time: .shortened) ?? "").font(.caption).foregroundStyle(.secondary)
            }
          }
          if let onReply, message.threadReplyCount > 0 {
            Button("^[\(message.threadReplyCount) reply](inflect: true)", action: onReply)
              .buttonStyle(.borderless)
              .font(.caption)
          }
          if let outbound, outbound.status == .failed {
            if let error = outbound.errorMessage, !error.isEmpty {
              Text(error)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
              if let onRetry {
                Button("Retry", action: onRetry)
              }
              if let onRemove {
                Button("Remove", role: .destructive, action: onRemove)
              }
            }
            .buttonStyle(.borderless)
            .font(.caption)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.vertical, 4)
      .padding(.horizontal, horizontalInset)
      .contentShape(.rect)
      .background((isHovered || isReplyHovered) && (onReply != nil || onQuote != nil || onEdit != nil || onDelete != nil) ? Color.primary.opacity(0.04) : .clear)
      .overlay(alignment: .topTrailing) {
        if message.deletedAt == nil, onReply != nil || onQuote != nil || onEdit != nil || onDelete != nil {
          HStack(spacing: 0) {
            if onDelete != nil {
              Menu {
                Button("Delete message", systemImage: "trash", role: .destructive) { confirmsDeletion = true }
              } label: {
                Image(systemName: "ellipsis").frame(width: replyActionHeight, height: replyActionHeight)
              }
              .menuStyle(.borderlessButton)
              .menuIndicator(.hidden)
              .focused($focusedAction, equals: .more)
              .disabled(isDeleting)
              .help(isDeleting ? "Deleting message…" : "More message actions")
              .accessibilityLabel("More message actions")
            }
            if let onEdit {
              messageAction("Edit", symbol: "pencil", focus: .edit, action: onEdit)
            }
            if let onQuote {
              messageAction("Quote", symbol: "quote.opening", focus: .quote, action: onQuote)
            }
            if let onReply {
              messageAction("Reply", symbol: "text.bubble", focus: .reply, action: onReply)
            }
          }
          .fixedSize()
          .background(.regularMaterial, in: .rect(cornerRadius: 8))
          .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.secondary.opacity(0.25)))
          .onHover { isReplyHovered = $0 }
          .opacity(isHovered || isReplyHovered || focusedAction != nil ? 1 : 0)
          .allowsHitTesting(isHovered || isReplyHovered || focusedAction != nil)
          .padding(.trailing, horizontalInset)
          .offset(y: -replyActionHeight / 2)
        }
      }
      // Track the complete row, including its action overlay. The toolbar
      // must not change the hover region when it becomes interactive.
      .onContinuousHover { phase in
        let hovering = switch phase {
        case .active: true
        case .ended: false
        }
        if isHovered != hovering {
          isHovered = hovering
        }
      }
      .alert("Delete message?", isPresented: $confirmsDeletion) {
        Button("Cancel", role: .cancel) {}
        Button("Delete", role: .destructive) { deleteMessage() }
      } message: {
        Text("This message will be deleted for everyone. This cannot be undone.")
      }
      .alert("Couldn’t delete message", isPresented: $showsDeletionError) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(deletionError ?? "Try again.")
      }
      .contextMenu {
        if onDelete != nil, message.deletedAt == nil {
          Button(isDeleting ? "Deleting…" : "Delete message", systemImage: "trash", role: .destructive) { confirmsDeletion = true }
            .disabled(isDeleting)
          Divider()
        }
        if let onEdit {
          Button("Edit message", systemImage: "pencil", action: onEdit)
        }
        if let onQuote {
          Button("Quote message", systemImage: "quote.opening", action: onQuote)
        }
        if let onReply, message.deletedAt == nil {
          Button("Reply in thread", systemImage: "bubble.right", action: onReply)
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityActions {
        if onDelete != nil, !isDeleting, message.deletedAt == nil {
          Button("Delete message", role: .destructive) { confirmsDeletion = true }
        }
        if let onEdit {
          Button("Edit message", action: onEdit)
        }
        if let onQuote {
          Button("Quote message", action: onQuote)
        }
        if let onReply, message.deletedAt == nil {
          Button("Reply in thread", action: onReply)
        }
      }
      // Sender-group separation is outside the consistently padded hover row.
      .padding(.top, isContinuation ? 0 : 8)
    }

    private func messageAction(_ title: String, symbol: String, focus: MessageAction, action: @escaping () -> Void) -> some View {
      Button(action: action) {
        Label(title, systemImage: symbol)
          .font(.caption)
          .lineLimit(1)
          .fixedSize()
          .padding(.horizontal, 10)
          .frame(height: replyActionHeight)
          .contentShape(.rect)
      }
      .buttonStyle(.borderless)
      .focused($focusedAction, equals: focus)
      .help(title == "Reply" ? "Reply in thread" : "Quote message")
    }

    private var pendingSince: Date? {
      outbound?.status == .pending ? outbound?.createdAt : nil
    }

    private var avatarView: some View {
      ParticipantAvatar(
        imageURL: avatarURLString,
        name: messageSenderName(message.sender),
        size: Self.avatarDiameter
      )
    }

    private var avatarURLString: String? {
      switch message.sender {
      case let .case1(user): user.user.image
      case let .case2(coworker): coworker.coworker.image
      case let .case3(bot): bot.sokoBot.image
      case .case4: nil
      }
    }
  }

  #if DEBUG
    private func previewMessage(
      id: String,
      content: String,
      name: String,
      minutesAfterNoon: Int,
      edited: Bool = false
    ) -> Components.Schemas.ChatRoomMessage {
      // Base is 2026-09-08T12:00:00Z, so the name matches the clock.
      let createdAt = Date(timeIntervalSince1970: 1_788_868_800 + Double(minutesAfterNoon * 60))
      return .init(
        id: id,
        roomId: "room_1",
        parentMessageId: nil,
        content: content,
        createdAt: createdAt,
        deletedAt: nil,
        editedAt: edited ? createdAt : nil,
        sender: .case1(.init(
          _type: .user,
          user: .init(id: "user_2", name: name, email: "ada@example.com", presence: .offline)
        )),
        mentions: [],
        reactions: [],
        threadReplyCount: 0,
        threadLastReplyAt: nil,
        metadata: nil,
        quote: nil,
        membership: nil,
        unfurls: nil
      )
    }

    #Preview("Message rows") {
      VStack(alignment: .leading, spacing: 0) {
        DaySeparatorRow(label: "Today")
        MessageRowView(
          message: previewMessage(id: "m1", content: "Morning all — the tracer renders web-style rows now.", name: "Ada", minutesAfterNoon: 0),
          isContinuation: false,
          outbound: nil,
          onRetry: nil,
          onRemove: nil
        )
        MessageRowView(
          message: previewMessage(id: "m2", content: "Same burst, so no second header.", name: "Ada", minutesAfterNoon: 1),
          isContinuation: true,
          outbound: nil,
          onRetry: nil,
          onRemove: nil
        )
        MessageRowView(
          message: previewMessage(id: "m3", content: "Edited after the fact.", name: "Ada", minutesAfterNoon: 30, edited: true),
          isContinuation: false,
          outbound: nil,
          onRetry: nil,
          onRemove: nil
        )
        MembershipStatusRow(text: "Bob joined")
      }
      .padding()
    }
  #endif

#endif

func isCoworkerMessage(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
  if case .case2 = message.sender {
    return true
  }
  return false
}
