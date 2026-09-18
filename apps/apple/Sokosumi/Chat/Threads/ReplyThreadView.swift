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
                   messages: (workspaces.displayedThreadParent.map { [$0] } ?? []) + workspaces.displayedThreadReplies,
                   mentions: room.map(MessageMentions.init), channels: workspaces.composerChannels, baseURL: CoreSettings.webBaseURL)
    }

    private var preparedMessages: [Components.Schemas.ChatRoomMessage] {
      guard preparedTranscript?.input.scope == preparationScope else { return [] }
      return preparedTranscript?.input.messages ?? []
    }

    private var readyJump: ThreadSession.JumpTarget? {
      guard let target = workspaces.thread.jumpTarget,
            preparedMessages.contains(where: { $0.id == target.messageId }) else { return nil }
      return target
    }

    // Update the header controls together with prepared replies, including empty final pages.
    @State private var preparedHasMore = false
    @State private var scrollIntent = TimelineScrollIntent()
    @State private var olderBoundaryVisible = false
    @State private var visibleMessageID: String?
    @State private var userIsScrolling = false
    @State private var pendingBottomAlignment = false
    @State private var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    @State private var jumpError: String?
    @State private var quoteFocusRequest: String?

    private func unfurlAction(for message: Components.Schemas.ChatRoomMessage) -> ((String) async throws -> Void)? {
      guard canModifyOwnMessage(message, userId: workspaces.currentUserId) else { return nil }
      return { url in try await workspaces.removeUnfurl(message, url: url, auth: auth) }
    }

    private func reactionAction(for message: Components.Schemas.ChatRoomMessage) -> ((String) async throws -> Bool)? {
      guard canReactToMessage(message) else { return nil }
      return { emoji in try await workspaces.toggleReaction(message, emoji: emoji, auth: auth) }
    }

    private func sendToSelfAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Components.Schemas.ChatRoomMessage)? {
      guard workspaces.canSendToSelf(message) else { return nil }
      return { try await workspaces.sendMessageToSelf(message, auth: auth) }
    }

    private func deletionAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard canModifyOwnMessage(message, userId: workspaces.currentUserId) else { return nil }
      return { try await workspaces.deleteMessage(message, auth: auth) }
    }

    private func mentionRetryAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard workspaces.canRetryMention(message) else { return nil }
      return { try await workspaces.retryMention(message, auth: auth) }
    }

    private func quoteAction(for message: Components.Schemas.ChatRoomMessage) -> (() -> Void)? {
      guard canQuoteMessage(message) else { return nil }
      return {
        pendingQuote = messageQuote(from: message)
        quoteFocusRequest = UUID().uuidString
      }
    }

    var body: some View {
      content
        .alert("Couldn’t load message", isPresented: Binding(get: { jumpError != nil }, set: {
          if !$0 {
            jumpError = nil
          }
        })) {
          Button("OK", role: .cancel) {}
        } message: { Text(jumpError ?? "") }
        .onChange(of: preparationScope) { _, _ in
          scrollIntent = TimelineScrollIntent()
          olderBoundaryVisible = false
          visibleMessageID = nil
          userIsScrolling = false
          pendingBottomAlignment = false
        }
        .onChange(of: workspaces.thread.timeline.hasMore) { _, hasMore in
          if preparedTranscript?.input == preparationInput {
            preparedHasMore = hasMore
          }
        }
        .task(id: preparationInput) {
          let hasMore = workspaces.thread.timeline.hasMore
          guard let prepared = try? await PreparedTranscript.prepare(preparationInput, reusing: preparedTranscript), !Task.isCancelled else { return }
          preparedTranscript = prepared
          preparedHasMore = hasMore
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
                             onQuote: quoteAction(for: parent),
                             onEdit: canModifyOwnMessage(parent, userId: workspaces.currentUserId) ? { workspaces.startEditing(parent) } : nil,
                             onDelete: deletionAction(for: parent),
                             onRemoveUnfurl: unfurlAction(for: parent),
                             onToggleReaction: reactionAction(for: parent),
                             editing: workspaces.messageEditing,
                             onQuoteJump: jumpToQuote,
                             onSendToSelf: sendToSelfAction(for: parent))
                .id(parent.id)
              Divider()
              HStack {
                Text("^[\(parent.threadReplyCount) reply](inflect: true)").foregroundStyle(.secondary)
                Spacer()
                if preparedHasMore {
                  Button("Load older replies") {
                    scrollIntent.readOlder()
                    workspaces.loadThreadPage(.older, auth: auth)
                  }
                  .buttonStyle(.link)
                  .controlSize(.small)
                  .disabled(workspaces.thread.timeline.isLoadingOlder || workspaces.directStream.isBusy)
                  .opacity(workspaces.thread.timeline.isLoadingOlder ? 0 : 1)
                  .overlay {
                    if workspaces.thread.timeline.isLoadingOlder {
                      ProgressView().controlSize(.small)
                    }
                  }
                }
              }
              .font(.caption)
              .frame(minHeight: 24)
              replies(channels: channels, room: currentRoom)
              Color.clear.frame(height: 17).id("thread-bottom")
            }
            .scrollTargetLayout()
            .padding(.horizontal)
            .padding(.top)
          }
          .scrollPosition(id: $visibleMessageID, anchor: .bottom)
          .defaultScrollAnchor(.bottom, for: .initialOffset)
          .defaultScrollAnchor(scrollIntent.followsLatest ? .bottom : nil, for: .sizeChanges)
          .task(id: readyJump) {
            guard let target = readyJump else { return }
            scrollIntent.readOlder()
            pendingBottomAlignment = false
            proxy.scrollTo(target.messageId, anchor: .center)
          }
          .task(id: pendingBottomAlignment && !userIsScrolling && scrollIntent.followsLatest) {
            guard pendingBottomAlignment, !userIsScrolling, scrollIntent.followsLatest else { return }
            pendingBottomAlignment = false
            proxy.scrollTo("thread-bottom", anchor: .bottom)
          }
          .onScrollPhaseChange { _, phase in
            userIsScrolling = phase == .interacting || phase == .decelerating || phase == .tracking
            if phase == .interacting {
              Task { @MainActor in workspaces.thread.clearJump() }
            }
            loadOlderRepliesAutomatically()
          }
          .onScrollGeometryChange(for: TranscriptScrollEdges.self) { TranscriptScrollEdges($0) } action: { oldEdges, edges in
            if oldEdges.offsetY != edges.offsetY, userIsScrolling || oldEdges.nearBottom != edges.nearBottom {
              if scrollIntent.followsLatest != edges.nearBottom {
                scrollIntent.userScrolled(isNearBottom: edges.nearBottom)
                if !edges.nearBottom {
                  pendingBottomAlignment = false
                }
              }
            } else if !oldEdges.hasSameSize(as: edges), scrollIntent.followsLatest, edges.needsBottomAlignment {
              if !pendingBottomAlignment {
                pendingBottomAlignment = true
              }
            }
          }
          .onChange(of: preparedMessages.last?.id) { _, _ in
            if scrollIntent.followsLatest {
              proxy.scrollTo("thread-bottom", anchor: .bottom)
            }
          }
          .overlay(alignment: .bottom) {
            if !scrollIntent.followsLatest {
              JumpToLatestButton {
                workspaces.thread.clearJump()
                if workspaces.thread.timeline.historicalAnchor != nil {
                  workspaces.loadThreadPage(.returnToLatest, auth: auth)
                }
                scrollIntent.followLatest()
                proxy.scrollTo("thread-bottom", anchor: .bottom)
              }
            }
          }
        }
        .scrollEdgeEffectStyle(.soft, for: .bottom)
        .safeAreaInset(edge: .bottom, spacing: 0) {
          ChatComposerView(userId: workspaces.currentUserId, organizationId: workspaces.selection?.workspace.organizationId,
                           roomId: parent.roomId, parentMessageId: parent.id, pendingQuote: $pendingQuote, quoteFocusRequest: quoteFocusRequest,
                           onAccepted: { scrollIntent.followLatest() })
            .id(parent.id)
        }
        .navigationTitle("Thread")
        .onChange(of: parent.id) { _, _ in pendingQuote = nil
          jumpError = nil
        }
      } else {
        ProgressView("Loading replies…").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }

    private func jumpToQuote(_ id: String) {
      Task { @MainActor in
        do {
          if try await workspaces.openMessage(id, auth: auth) == .unavailable {
            jumpError = "This message is no longer available."
          }
        } catch { jumpError = friendlyMessage(for: error) }
      }
    }

    private func loadOlderRepliesAutomatically() {
      let timeline = workspaces.thread.timeline
      guard timeline.errorMessage == nil, workspaces.thread.loadTask == nil,
            scrollIntent.beginAutomaticOlderPage(
              userIsScrolling: userIsScrolling,
              isNearTop: olderBoundaryVisible,
              hasMore: timeline.hasMore,
              isLoading: timeline.isLoading || timeline.isLoadingOlder || workspaces.directStream.isBusy
            ) else { return }
      olderBoundaryVisible = false
      let generation = timeline.generation
      Task { @MainActor in
        guard timeline.generation == generation, workspaces.thread.loadTask == nil else { return }
        workspaces.loadThreadPage(.older, auth: auth)
      }
    }

    @ViewBuilder private func replies(channels: [ComposerChannel], room: Components.Schemas.ChatRoom?) -> some View {
      let timeline = workspaces.thread.timeline
      if timeline.isLoading {
        ProgressView("Loading replies…")
      } else {
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
      let gaps = workspaces.thread.timeline.historyGapMessageIds
      return ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
        let hasGap = gaps.contains(message.id)
        let previous = index > 0 && !hasGap ? messages[index - 1] : nil
        let streaming = message.id.hasPrefix("stream:") && isCoworkerMessage(message)
        let thinking = streaming && message.content.isEmpty && workspaces.directStream.isBusy
        let reasoning = thinking ? (workspaces.directStream.latestThought ?? workspaces.directStream.reasoning) : workspaces.directStream.reasoning
        let outbox = workspaces.thread.outbox
        let shell = outbox.shells.first { $0.id == message.id }
        VStack(alignment: .leading, spacing: 0) {
          if hasGap {
            Button("Load messages in this gap") {
              workspaces.loadThreadPage(.boundary(message.id), auth: auth)
            }
            .buttonStyle(.link)
            .disabled(workspaces.thread.timeline.isRefreshing)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
          }
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
                           onRetryMention: mentionRetryAction(for: message),
                           onQuote: quoteAction(for: message),
                           onEdit: canModifyOwnMessage(message, userId: workspaces.currentUserId) ? { workspaces.startEditing(message) } : nil,
                           isHighlighted: workspaces.thread.jumpTarget?.messageId == message.id,
                           onDelete: deletionAction(for: message),
                           onRemoveUnfurl: unfurlAction(for: message),
                           onToggleReaction: reactionAction(for: message),
                           editing: workspaces.messageEditing,
                           onQuoteJump: jumpToQuote, onSendToSelf: sendToSelfAction(for: message),
                           streamReasoning: streaming ? reasoning : nil, streamThinking: thinking)
          }
        }
        .id(message.id)
        .onScrollVisibilityChange(threshold: 0.1) { visible in
          guard index == 0 else { return }
          olderBoundaryVisible = visible
          loadOlderRepliesAutomatically()
        }
      }
    }
  }
#endif
