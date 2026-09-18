import CoreAPI
import SokosumiAuth
import SokosumiChat
import SwiftUI

#if os(macOS)
  import AppKit

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
    var preparedDocument: MessageMarkdown?
    let message: Components.Schemas.ChatRoomMessage
    let isContinuation: Bool
    let outbound: OutboundShell?
    var sentAt: Date?
    let onRetry: (() -> Void)?
    let onRemove: (() -> Void)?
    /// Mentioner-only retry of a failed coworker mention shell.
    var onRetryMention: (() async throws -> Void)?
    var onReply: (() -> Void)?
    var onQuote: (() -> Void)?
    var onEdit: (() -> Void)?
    var isHighlighted = false
    var isPinned = false
    var isUpdatingPin = false
    var onTogglePin: (() async throws -> Void)?
    var onDelete: (() async throws -> Void)?
    var onRemoveUnfurl: ((String) async throws -> Void)?
    var onToggleReaction: ((String) async throws -> Void)?
    var pendingReactionEmoji: Set<String> = []
    var editing: MessageEditing?
    var onQuoteJump: ((String) -> Void)?
    /// Send to yourself. Absent inside the Self Direct and for rows that are not durable.
    var onSendToSelf: (() async throws -> Components.Schemas.ChatRoomMessage)?
    var horizontalInset: CGFloat = 0
    var streamReasoning: String?
    var streamThinking = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @State private var quickReactions = ReactionEmojiHistory.defaultQuickReactions
    @State private var showsReactionPicker = false
    @State private var pinError: String?
    @State private var showsPinError = false
    @State private var reactionError: String?
    @State private var showsReactionError = false
    @State private var confirmsDeletion = false
    @State private var isDeleting = false
    @State private var deletionError: String?
    @State private var showsDeletionError = false
    @State private var isRetryingMention = false
    @State private var mentionRetryError: String?
    @State private var showsMentionRetryError = false
    @State private var isSendingToSelf = false
    @State private var sentToSelf: Components.Schemas.ChatRoomMessage?
    @State private var sendToSelfError: String?
    @State private var isHovered = false
    @State private var isReplyHovered = false
    @State private var hoveredAction: MessageAction?
    @ScaledMetric(relativeTo: .body) private var replyActionHeight: CGFloat = 28
    @ScaledMetric(relativeTo: .callout) private var actionIconSize: CGFloat = 16
    @FocusState private var focusedAction: MessageAction?

    private enum MessageAction: Hashable {
      case quote, reply, more, react
      case quickReaction(Int)
    }

    private var showsActions: Bool {
      isHovered || isReplyHovered || focusedAction != nil || showsReactionPicker
    }

    /// Persisted mention shell (thinking or failed); nil for ordinary rows.
    private var mentionShell: CoworkerMentionShell? {
      CoworkerMentionShell(message: message)
    }

    /// Web `isDurableRoomMessage`: no link while the shell is still thinking.
    private var canCopyMessageLink: Bool {
      message.deletedAt == nil
        && !isOutboundLocalMessage(message)
        && !message.id.hasPrefix("stream:")
        && mentionShell?.isThinking != true
    }

    /// Hop badge on a message one assistant wrote to another; web shows it in the hover pill.
    private var sokoBotChain: SokoBotChainMetadata? {
      SokoBotChainMetadata(message: message)
    }

    private var showsActionChrome: Bool {
      message.deletedAt == nil
        && mentionShell?.isThinking != true
        && (onReply != nil || onQuote != nil || onEdit != nil || onDelete != nil
          || onTogglePin != nil || onToggleReaction != nil || canCopyMessageLink || onSendToSelf != nil || sokoBotChain != nil)
    }

    private var reactionAction: ((String) -> Void)? {
      guard onToggleReaction != nil else { return nil }
      return { emoji in toggleReaction(emoji) }
    }

    private func toggleReaction(_ emoji: String) {
      guard let onToggleReaction else { return }
      // Match web: adding teaches quick reactions; removing does not.
      let isAdding = !message.reactions.contains { $0.emoji == emoji && $0.reactedByCurrentUser }
      Task { @MainActor in
        do {
          try await onToggleReaction(emoji)
          if isAdding {
            ReactionEmojiHistory().record(emoji)
          }
        } catch {
          reactionError = friendlyMessage(for: error)
          showsReactionError = true
        }
      }
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

    /// Retry state lives on the row: optimistic thinking unmounts the failed
    /// shell, and a child alert would die with it.
    private func retryMention() {
      guard !isRetryingMention, let onRetryMention else { return }
      isRetryingMention = true
      Task { @MainActor in
        defer { isRetryingMention = false }
        do { try await onRetryMention() } catch {
          mentionRetryError = friendlyMessage(for: error)
          showsMentionRetryError = true
        }
      }
    }

    private var mentionRetryHandler: (() -> Void)? {
      guard onRetryMention != nil else { return nil }
      return retryMention
    }

    private var failedMentionView: some View {
      CoworkerMentionFailedView(onRetry: mentionRetryHandler, isRetrying: isRetryingMention)
    }

    private var pinnedLabel: some View {
      Label {
        Text("Pinned", tableName: "ChatPins", comment: "A channel message that is pinned.")
      } icon: {
        Image(systemName: "pin.fill")
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      .fixedSize()
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
          if isContinuation, isPinned, message.deletedAt == nil {
            pinnedLabel
          }
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
              if isPinned, message.deletedAt == nil {
                pinnedLabel
              }
            }
          }
          let mentionShell = mentionShell
          if case .failed? = mentionShell {
            failedMentionView
          } else if isCoworkerMessage(message), message.deletedAt == nil {
            // A persisted mention shell keeps the live Thought header until Core
            // fills the answer; its clock starts at `thought_timing_ms.start`.
            CoworkerThoughtView(thought: CoworkerThought(message: message, streamedText: streamReasoning),
                                working: streamThinking || mentionShell != nil,
                                startedAt: mentionShell?.startedAt ?? message.createdAt)
          }
          if message.deletedAt != nil {
            Text("This message was deleted")
              .italic()
              .foregroundStyle(.secondary)
          } else {
            if let quote = message.quote {
              MessageQuoteView(quote: quote, room: room, channels: channels, jump: quoteJump(for: quote))
                .id(quote.messageId + quote.snippet)
            }
            if let editing, editing.source?.id == message.id {
              MessageEditComposer(editing: editing).id(message.id)
            } else if mentionShell == nil, message.quote == nil || !message.content.isEmpty {
              // Mention shells render their own state; Send to yourself posts only a quote, so there is no body to render.
              MessageMarkdownView(source: message.content, room: room, channels: channels, preparedDocument: preparedDocument)
            }
            if outbound == nil, mentionShell == nil {
              ForEach(message.unfurls ?? [], id: \.url) { preview in
                MessageUnfurlView(preview: preview, remove: onRemoveUnfurl.map { action in { try await action(preview.url) } })
                  .id(preview.url + (preview.imageUrl ?? ""))
              }
              // Web renders the Soko Bot footer only once the turn's answer is in the row.
              if let turn = SokoBotTurnMetadata(message: message) {
                SokoBotMessageFooterView(turn: turn)
              }
            }
            if isContinuation, message.editedAt != nil {
              Text("Edited").help(message.editedAt?.formatted(date: .abbreviated, time: .shortened) ?? "").font(.caption).foregroundStyle(.secondary)
            }
          }
          if message.deletedAt == nil, outbound == nil, !message.reactions.isEmpty {
            MessageReactionsView(reactions: message.reactions, pendingEmoji: pendingReactionEmoji, toggle: reactionAction)
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
      .background {
        if isHighlighted {
          Color.accentColor.opacity(0.12)
        } else if isHovered || isReplyHovered, showsActionChrome {
          Color.primary.opacity(0.04)
        }
      }
      .overlay(alignment: .topTrailing) {
        if showsActionChrome {
          ViewThatFits(in: .horizontal) {
            actionControls(compact: false)
            actionControls(compact: true)
          }
          .popover(isPresented: $showsReactionPicker, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
            ReactionEmojiPicker { emoji in
              showsReactionPicker = false
              toggleReaction(emoji)
            }
          }
          .padding(3)
          .background(.regularMaterial, in: .rect(cornerRadius: 9))
          .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(.primary.opacity(0.12)))
          .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
          .onHover { isReplyHovered = $0 }
          .opacity(showsActions ? 1 : 0)
          .allowsHitTesting(showsActions)
          .padding(.trailing, horizontalInset)
          .offset(y: -(replyActionHeight + 6) / 2)
        }
      }
      .onChange(of: showsActions) { _, visible in
        // Read history only on entry. Keep targets stable while hovering,
        // keyboard-focused, or choosing from the picker.
        if visible {
          quickReactions = ReactionEmojiHistory().quickReactions
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
      .alert("Couldn’t update pin", isPresented: $showsPinError) {
        Button("OK", role: .cancel) {}
      } message: { Text(pinError ?? "Try again.") }
      .alert("Couldn’t update reaction", isPresented: $showsReactionError) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(reactionError ?? "Try again.")
      }
      .alert("Sent to yourself", isPresented: Binding(get: { sentToSelf != nil }, set: {
        if !$0 {
          sentToSelf = nil
        }
      }), presenting: sentToSelf) { saved in
        Button("Open") { openSavedMessage(saved) }
        Button("OK", role: .cancel) {}
      }
      .alert("Couldn’t send to yourself", isPresented: Binding(get: { sendToSelfError != nil }, set: {
        if !$0 {
          sendToSelfError = nil
        }
      })) {
        Button("OK", role: .cancel) {}
      } message: { Text(sendToSelfError ?? "Try again.") }
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
      .alert("Couldn’t retry the mention", isPresented: $showsMentionRetryError) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(mentionRetryError ?? "Try again.")
      }
      .contextMenu {
        if onTogglePin != nil {
          pinButton
        }
        if canCopyMessageLink {
          copyLinkButton
        }
        if onSendToSelf != nil {
          sendToSelfButton
        }
        if onToggleReaction != nil, message.deletedAt == nil {
          Button("Add reaction", systemImage: "face.smiling") { showsReactionPicker = true }
        }
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
        if canCopyMessageLink {
          Button("Copy link", action: copyMessageLink)
        }
        if onSendToSelf != nil, !isSendingToSelf {
          Button("Send to yourself", action: sendToSelf)
        }
        if onToggleReaction != nil, message.deletedAt == nil {
          Button("Add reaction") { showsReactionPicker = true }
        }
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

    private func actionControls(compact: Bool) -> some View {
      HStack(spacing: 2) {
        if let sokoBotChain {
          SokoBotChainBadge(chain: sokoBotChain)
            .padding(.horizontal, 4)
        }
        if onToggleReaction != nil {
          ForEach(Array(quickReactions.enumerated()), id: \.element.id) { index, emoji in
            quickReactionButton(emoji, position: index)
          }
          messageAction("React", symbol: "face.smiling", focus: .react, compact: compact) { showsReactionPicker = true }
        }
        if let onReply {
          messageAction("Reply", symbol: "text.bubble", focus: .reply, compact: compact, action: onReply)
        }
        if let onQuote {
          messageAction("Quote", symbol: "quote.opening", focus: .quote, compact: compact, action: onQuote)
        }
        if onEdit != nil || onDelete != nil || onTogglePin != nil || canCopyMessageLink || onSendToSelf != nil {
          moreActions
        }
      }
      .fixedSize()
    }

    private var moreActions: some View {
      Menu {
        if onTogglePin != nil {
          pinButton
        }
        if canCopyMessageLink {
          copyLinkButton
        }
        if onSendToSelf != nil {
          sendToSelfButton
        }

        if let onEdit {
          Button("Edit message", systemImage: "pencil", action: onEdit)
        }
        if onEdit != nil, onDelete != nil {
          Divider()
        }
        if onDelete != nil {
          Button("Delete message", systemImage: "trash", role: .destructive) { confirmsDeletion = true }
        }
      } label: {
        Image(systemName: "ellipsis")
          .font(.callout)
          .frame(width: actionIconSize, height: actionIconSize)
      }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .frame(width: replyActionHeight, height: replyActionHeight)
      .foregroundStyle(hoveredAction == .more ? .primary : .secondary)
      .background(hoveredAction == .more ? Color.primary.opacity(0.1) : .clear, in: .rect(cornerRadius: 5))
      .contentShape(.rect)
      .onHover { hoveredAction = $0 ? .more : nil }
      .focused($focusedAction, equals: .more)
      .disabled(isDeleting)
      .help(isDeleting ? "Deleting message…" : "More message actions")
      .accessibilityLabel("More message actions")
    }

    private func quickReactionButton(_ emoji: ReactionEmoji, position: Int) -> some View {
      let focus = MessageAction.quickReaction(position)
      let reacted = message.reactions.contains { $0.emoji == emoji.emoji && $0.reactedByCurrentUser }
      return Button { toggleReaction(emoji.emoji) } label: {
        Text(emoji.emoji)
          .font(.title3)
          .scaleEffect(!reduceMotion && hoveredAction == focus ? 1.15 : 1)
          .animation(reduceMotion ? nil : .easeOut(duration: 0.1), value: hoveredAction == focus)
          .frame(width: replyActionHeight, height: replyActionHeight)
          .background(reacted ? Color.accentColor.opacity(0.18) : .clear, in: .rect(cornerRadius: 5))
          .background(hoveredAction == focus ? Color.primary.opacity(0.1) : .clear, in: .rect(cornerRadius: 5))
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .disabled(pendingReactionEmoji.contains(emoji.emoji))
      .onHover { hoveredAction = $0 ? focus : nil }
      .focused($focusedAction, equals: focus)
      .help(":\(emoji.name):")
      .accessibilityLabel("Toggle \(emoji.emoji) reaction")
      .accessibilityValue(reacted ? "You reacted" : "You have not reacted")
      .accessibilityAddTraits(reacted ? .isSelected : [])
    }

    private func messageAction(_ title: String, symbol: String, focus: MessageAction, compact: Bool, action: @escaping () -> Void) -> some View {
      Button(action: action) {
        actionLabel(title, symbol: symbol, action: focus, compact: compact)
      }
      .buttonStyle(.plain)
      .onHover { hoveredAction = $0 ? focus : nil }
      .focused($focusedAction, equals: focus)
      .help(title == "Reply" ? "Reply in thread" : title)
      .accessibilityLabel(title)
    }

    private func actionLabel(_ title: String, symbol: String, action: MessageAction, compact: Bool) -> some View {
      HStack(spacing: 5) {
        Image(systemName: symbol)
          .font(.callout)
          .frame(width: actionIconSize, height: actionIconSize)
        if !compact {
          Text(title).font(.callout).lineLimit(1)
        }
      }
      .padding(.horizontal, 8)
      .frame(height: replyActionHeight)
      .foregroundStyle(hoveredAction == action ? .primary : .secondary)
      .background(hoveredAction == action ? Color.primary.opacity(0.1) : .clear, in: .rect(cornerRadius: 5))
      .contentShape(.rect)
    }

    private var pendingSince: Date? {
      outbound?.status == .pending ? outbound?.createdAt : nil
    }

    private var copyLinkButton: some View {
      Button("Copy link", systemImage: "link", action: copyMessageLink)
    }

    private func copyMessageLink() {
      guard let url = ChatLink.href(roomId: message.roomId, messageId: message.id, webBaseURL: CoreSettings.webBaseURL) else {
        return
      }
      NSPasteboard.general.clearContents()
      _ = NSPasteboard.general.setString(url.absoluteString, forType: .string)
    }

    private var sendToSelfButton: some View {
      Button("Send to yourself", systemImage: "paperplane", action: sendToSelf)
        .disabled(isSendingToSelf)
    }

    private func sendToSelf() {
      guard let onSendToSelf, !isSendingToSelf else { return }
      isSendingToSelf = true
      Task { @MainActor in
        defer { isSendingToSelf = false }
        do {
          sentToSelf = try await onSendToSelf()
        } catch {
          sendToSelfError = friendlyMessage(for: error)
        }
      }
    }

    private func openSavedMessage(_ saved: Components.Schemas.ChatRoomMessage) {
      if let url = ChatLink.href(roomId: saved.roomId, messageId: saved.id, webBaseURL: CoreSettings.webBaseURL) {
        openURL(url)
      }
    }

    /// A quote sent to yourself from another room follows its Message link; same-room quotes scroll.
    private func quoteJump(for quote: Components.Schemas.ChatRoomMessageQuote) -> ((String) -> Void)? {
      guard let url = quoteSourceURL(quote, inRoom: message.roomId, webBaseURL: CoreSettings.webBaseURL) else {
        return onQuoteJump
      }
      return { _ in openURL(url) }
    }

    private var pinButton: some View {
      Button(isPinned ? "Unpin message" : "Pin message", systemImage: isPinned ? "pin.slash" : "pin") {
        Task { @MainActor in
          do {
            try await onTogglePin?()
          } catch { pinError = friendlyMessage(for: error)
            showsPinError = true
          }
        }
      }
      .disabled(isUpdatingPin)
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
