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

  /// Transient delivery status shown below a message.
  private struct DeliveryFeedback: View {
    let pendingSince: Date?
    let sentAt: Date?
    @State private var showSending = false

    var body: some View {
      HStack(spacing: 4) {
        if pendingSince != nil, showSending {
          HStack(spacing: 4) {
            ProgressView().controlSize(.mini)
            Text("Sending…")
          }
          .accessibilityElement(children: .combine)
        } else if sentAt != nil {
          Label("Sent", systemImage: "checkmark")
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
    var horizontalInset: CGFloat = 0
    var streamReasoning: String?
    var streamThinking = false
    @State private var isHovered = false
    @State private var isReplyHovered = false
    @ScaledMetric(relativeTo: .body) private var replyActionHeight: CGFloat = 28
    @FocusState private var replyFocused: Bool

    var body: some View {
      HStack(alignment: .top, spacing: 14) {
        if isContinuation {
          Color.clear
            .frame(width: Self.avatarDiameter, height: 0)
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
              Text(messageTimeFormatter.string(from: message.createdAt))
                .font(.caption)
                .foregroundStyle(.secondary)
              if message.editedAt != nil {
                Text("Edited")
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
            MessageMarkdownView(source: message.content, room: room, channels: channels)
            if isContinuation, message.editedAt != nil {
              Text("Edited").font(.caption).foregroundStyle(.secondary)
            }
          }
          if outbound?.status == .pending || sentAt != nil {
            DeliveryFeedback(pendingSince: outbound?.status == .pending ? outbound?.createdAt : nil,
                             sentAt: sentAt)
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
      .background((isHovered || isReplyHovered) && onReply != nil ? Color.primary.opacity(0.04) : .clear)
      .overlay(alignment: .topTrailing) {
        if let onReply, message.deletedAt == nil {
          Button(action: onReply) {
            HStack(spacing: 4) {
              Image(systemName: "text.bubble")
                .font(.body)
              Text("Reply")
                .font(.caption)
            }
            .padding(.horizontal, 10)
            .frame(height: replyActionHeight)
            .background(isReplyHovered ? Color.primary.opacity(0.12) : .clear,
                        in: .rect(cornerRadius: 8))
            .contentShape(.rect(cornerRadius: 8))
          }
          .buttonStyle(.borderless)
          .background(.regularMaterial, in: .rect(cornerRadius: 8))
          .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.secondary.opacity(0.25)))
          .onContinuousHover { phase in
            let hovering = switch phase {
            case .active: true
            case .ended: false
            }
            if isReplyHovered != hovering {
              isReplyHovered = hovering
            }
          }
          .focused($replyFocused)
          .help("Reply in thread")
          .accessibilityLabel("Reply in thread")
          .opacity(isHovered || isReplyHovered || replyFocused ? 1 : 0)
          .allowsHitTesting(isHovered || isReplyHovered || replyFocused)
          .padding(.trailing, horizontalInset)
          // Move the rendered button by exactly half its height. An alignment
          // guide inside this conditional overlay does not reposition it.
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
      .contextMenu {
        if let onReply, message.deletedAt == nil {
          Button("Reply in thread", systemImage: "bubble.right", action: onReply)
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityActions {
        if let onReply, message.deletedAt == nil {
          Button("Reply in thread", action: onReply)
        }
      }
      // Sender-group separation is outside the consistently padded hover row.
      .padding(.top, isContinuation ? 0 : 8)
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
