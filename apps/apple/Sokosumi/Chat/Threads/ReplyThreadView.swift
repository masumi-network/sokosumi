import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  struct ReplyThreadView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @State private var preparedTranscript: PreparedTranscript?

    private var preparationScope: [String] {
      [workspaces.currentUserId, workspaces.selectionId ?? "", workspaces.transcriptRoomId ?? "", workspaces.thread.parent?.id ?? "", String(workspaces.thread.timeline.generation)]
    }

    private var preparationInput: PreparedTranscript.Input {
      let room = workspaces.rooms.first { $0.id == workspaces.transcriptRoomId }
      return .init(scope: preparationScope,
                   messages: (workspaces.thread.parent.map { [$0] } ?? []) + workspaces.displayedThreadReplies,
                   mentions: room.map(MessageMentions.init), channels: workspaces.composerChannels, baseURL: CoreSettings.webBaseURL)
    }

    private var preparedMessages: [Components.Schemas.ChatRoomMessage] {
      guard preparedTranscript?.input.scope == preparationScope else { return [] }
      return preparedTranscript?.input.messages ?? []
    }

    @State private var followsLatest = true
    @State private var userIsScrolling = false
    @State private var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    @State private var quoteTarget: String?
    @State private var quoteFocusRequest: String?

    private func unfurlAction(for message: Components.Schemas.ChatRoomMessage) -> ((String) async throws -> Void)? {
      guard canModifyOwnMessage(message, userId: workspaces.currentUserId) else { return nil }
      return { url in try await workspaces.removeUnfurl(message, url: url, auth: auth) }
    }

    private func reactionAction(for message: Components.Schemas.ChatRoomMessage) -> ((String) async throws -> Void)? {
      guard canReactToMessage(message) else { return nil }
      return { emoji in try await workspaces.toggleReaction(message, emoji: emoji, auth: auth) }
    }

    private func deletionAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard canModifyOwnMessage(message, userId: workspaces.currentUserId) else { return nil }
      return { try await workspaces.deleteMessage(message, auth: auth) }
    }

    var body: some View {
      content
        .task(id: preparationInput) {
          guard let prepared = try? await PreparedTranscript.prepare(preparationInput, reusing: preparedTranscript), !Task.isCancelled else { return }
          preparedTranscript = prepared
        }
    }

    @ViewBuilder private var content: some View {
      if let parent = preparedMessages.first {
        let currentRoom = workspaces.rooms.first { $0.id == workspaces.transcriptRoomId }
        let channels = workspaces.composerChannels
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
              MessageRowView(channels: channels, room: currentRoom, preparedDocument: preparedTranscript?.documents[parent.id], message: parent, isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                             onQuote: canQuoteMessage(parent) ? { pendingQuote = messageQuote(from: parent)
                               quoteFocusRequest = UUID().uuidString
                             } : nil,
                             onEdit: canModifyOwnMessage(parent, userId: workspaces.currentUserId) ? { workspaces.startEditing(parent) } : nil,
                             onDelete: deletionAction(for: parent),
                             onRemoveUnfurl: unfurlAction(for: parent),
                             onToggleReaction: reactionAction(for: parent),
                             pendingReactionEmoji: workspaces.pendingReactionEmoji(for: parent.id),
                             editing: workspaces.messageEditing,
                             onQuoteJump: { quoteTarget = $0 })
                .id(parent.id)
              Divider()
              Text("^[\(parent.threadReplyCount) reply](inflect: true)").font(.caption).foregroundStyle(.secondary)
              replies(channels: channels, room: currentRoom)
              Color.clear.frame(height: 17).id("thread-bottom")
            }
            .padding(.horizontal)
            .padding(.top)
          }
          .defaultScrollAnchor(.bottom, for: .initialOffset)
          .defaultScrollAnchor(.bottom, for: .sizeChanges)
          .onChange(of: quoteTarget) { _, target in
            guard let target else { return }
            quoteTarget = nil
            guard parent.id == target || workspaces.displayedThreadReplies.contains(where: { $0.id == target }) else { return }
            followsLatest = false
            proxy.scrollTo(target, anchor: .center)
          }
          .onScrollPhaseChange { _, phase in
            userIsScrolling = phase == .interacting || phase == .decelerating || phase == .tracking
          }
          .onScrollGeometryChange(for: TranscriptScrollEdges.self) { TranscriptScrollEdges($0) } action: { _, edges in
            if userIsScrolling {
              followsLatest = edges.nearBottom
            } else if followsLatest, edges.needsBottomAlignment {
              proxy.scrollTo("thread-bottom", anchor: .bottom)
            }
          }
          .onChange(of: preparedMessages.last?.id) { _, _ in
            if followsLatest {
              proxy.scrollTo("thread-bottom", anchor: .bottom)
            }
          }
          .overlay(alignment: .bottom) {
            if !followsLatest {
              JumpToLatestButton {
                followsLatest = true
                proxy.scrollTo("thread-bottom", anchor: .bottom)
              }
            }
          }
        }
        .scrollEdgeEffectStyle(.soft, for: .bottom)
        .safeAreaBar(edge: .bottom, spacing: 0) {
          ChatComposerView(userId: workspaces.currentUserId, organizationId: workspaces.selection?.workspace.organizationId,
                           roomId: parent.roomId, parentMessageId: parent.id, pendingQuote: $pendingQuote, quoteFocusRequest: quoteFocusRequest,
                           onAccepted: { followsLatest = true })
            .id(parent.id)
        }
        .navigationTitle("Thread")
        .onChange(of: parent.id) { _, _ in pendingQuote = nil
          quoteTarget = nil
        }
      } else {
        ProgressView("Loading replies…").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }

    @ViewBuilder private func replies(channels: [ComposerChannel], room: Components.Schemas.ChatRoom?) -> some View {
      let timeline = workspaces.thread.timeline
      if timeline.isLoading {
        ProgressView("Loading replies…")
      } else {
        if timeline.hasMore {
          Button("Load older replies") {
            followsLatest = false
            workspaces.loadThreadPage(.older, auth: auth)
          }
          .disabled(timeline.isLoadingOlder || workspaces.directStream.isBusy)
        }
        if timeline.isLoadingOlder {
          ProgressView()
        }
        if let error = timeline.errorMessage {
          Text(error).foregroundStyle(.secondary)
          Button("Retry") { workspaces.loadThreadPage(timeline.failedPage ?? .initial, auth: auth) }
        }
        if workspaces.directStream.parentMessageId == workspaces.thread.parent?.id,
           let error = workspaces.directStream.errorMessage {
          Text(error).foregroundStyle(.secondary)
        }
        let messages = Array(preparedMessages.dropFirst())
        if messages.isEmpty, timeline.errorMessage == nil {
          Text("No replies yet.").foregroundStyle(.secondary)
        }
        replyRows(messages: messages, channels: channels, room: room)
      }
    }

    private func replyRows(
      messages: [Components.Schemas.ChatRoomMessage],
      channels: [ComposerChannel],
      room: Components.Schemas.ChatRoom?
    ) -> some View {
      ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
        let previous = index > 0 ? messages[index - 1] : nil
        let streaming = message.id.hasPrefix("stream:") && isCoworkerMessage(message)
        let thinking = streaming && message.content.isEmpty && workspaces.directStream.isBusy
        let reasoning = thinking ? (workspaces.directStream.latestThought ?? workspaces.directStream.reasoning) : workspaces.directStream.reasoning
        let outbox = workspaces.thread.outbox
        let shell = outbox.shells.first { $0.id == message.id }
        VStack(alignment: .leading, spacing: 0) {
          if let label = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt) {
            DaySeparatorRow(label: label)
          }
          if let status = membershipStatusText(message) {
            MembershipStatusRow(text: status)
          } else {
            MessageRowView(channels: channels, room: room, preparedDocument: preparedTranscript?.documents[message.id], message: message, isContinuation: isMessageContinuation(previous: previous, current: message),
                           outbound: shell, sentAt: outbox.sentAt[message.id],
                           onRetry: shell.map { item in { outbox.retry(item.clientTurnId) } },
                           onRemove: shell.map { item in { outbox.remove(item.clientTurnId) } },
                           onQuote: canQuoteMessage(message) ? { pendingQuote = messageQuote(from: message)
                             quoteFocusRequest = UUID().uuidString
                           } : nil,
                           onEdit: canModifyOwnMessage(message, userId: workspaces.currentUserId) ? { workspaces.startEditing(message) } : nil,
                           onDelete: deletionAction(for: message),
                           onRemoveUnfurl: unfurlAction(for: message),
                           onToggleReaction: reactionAction(for: message),
                           pendingReactionEmoji: workspaces.pendingReactionEmoji(for: message.id),
                           editing: workspaces.messageEditing,
                           onQuoteJump: { quoteTarget = $0 },
                           streamReasoning: streaming ? reasoning : nil, streamThinking: thinking)
          }
        }
        .id(message.id)
      }
    }
  }
#endif
