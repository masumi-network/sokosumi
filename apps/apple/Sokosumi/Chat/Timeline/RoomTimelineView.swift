import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  /// Transcript pane: avatar rail with Slack-style continuation grouping,
  /// day separator pills, membership status rows, and a native composer.
  struct RoomTimelineView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    /// Eager first layout can report near-top before the bottom anchor
    /// lands. Require a trip away from the top before auto-loading.
    @State private var transcriptWasAwayFromTop = false
    @State private var scrollIntent = TimelineScrollIntent()
    @State private var userIsScrolling = false
    @State private var pendingBottomAlignment = false
    @State private var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    @State private var highlightedId: String?
    @State private var jumpError: String?
    @State private var jumpCompletion: CheckedContinuation<Bool, Never>?
    @State private var quoteTarget: String?
    @State private var scrollPosition = ScrollPosition(idType: String.self)
    @State private var quoteFocusRequest: String?

    @State private var preparedTranscript: PreparedTranscript?

    private var preparationScope: [String] {
      [workspaces.currentUserId, workspaces.selectionId ?? "", roomId, String(workspaces.timeline.generation)]
    }

    private var preparationInput: PreparedTranscript.Input {
      .init(scope: preparationScope,
            messages: workspaces.displayedTranscript, mentions: room.map(MessageMentions.init),
            channels: workspaces.composerChannels, baseURL: CoreSettings.webBaseURL)
    }

    private var preparedMessages: [Components.Schemas.ChatRoomMessage] {
      guard let prepared = preparedTranscript, prepared.input.scope == preparationScope else { return [] }
      return prepared.overlaying(workspaces.displayedTranscript)
    }

    let roomId: String

    private var room: Components.Schemas.ChatRoom? {
      workspaces.rooms.first { $0.id == roomId }
    }

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

    var body: some View {
      transcriptBody
        .task(id: preparationInput) {
          guard let prepared = try? await PreparedTranscript.prepare(preparationInput, reusing: preparedTranscript), !Task.isCancelled else { return }
          preparedTranscript = prepared
        }
        .scrollEdgeEffectStyle(.soft, for: .bottom)
        .safeAreaInset(edge: .bottom, spacing: 0) {
          ChatComposerView(
            userId: workspaces.currentUserId,
            organizationId: workspaces.selection?.workspace.organizationId,
            roomId: roomId, pendingQuote: $pendingQuote, quoteFocusRequest: quoteFocusRequest
          )
          .id([workspaces.currentUserId, workspaces.selectionId ?? "", roomId])
        }
        .modifier(RoomToolsModifier(roomId: roomId, jump: { try await jumpToMessage($0) }))
        .task(id: workspaces.messageJump) {
          guard let target = workspaces.messageJump, target.roomId == roomId else { return }
          scrollIntent.readOlder()
          quoteTarget = target.messageId
          workspaces.consumeMessageJump(target.requestId)
        }
        .task(id: roomId) {
          if room?.kind == .channel {
            try? await workspaces.loadPins(auth: auth)
          }
        }
        .alert("Couldn’t load message", isPresented: Binding(get: { jumpError != nil }, set: {
          if !$0 {
            jumpError = nil
          }
        })) {
          Button("OK", role: .cancel) {}
        } message: { Text(jumpError ?? "") }
        .onChange(of: workspaces.timeline.historicalAnchor) { old, new in
          if old != nil, new == nil {
            scrollIntent.followLatest()
            highlightedId = nil
          }
        }
        .onDisappear { jumpCompletion?.resume(returning: false)
          jumpCompletion = nil
        }
        .onChange(of: roomId) { _, _ in
          highlightedId = nil
          jumpCompletion?.resume(returning: false)
          jumpCompletion = nil
          pendingQuote = nil
          quoteTarget = nil
          scrollPosition = ScrollPosition(idType: String.self)
          transcriptWasAwayFromTop = false
          scrollIntent = TimelineScrollIntent()
          pendingBottomAlignment = false
        }
    }

    @ViewBuilder
    private var transcriptBody: some View {
      if workspaces.transcriptRoomId != roomId || workspaces.transcriptLoading {
        ProgressView("Loading messages…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if workspaces.displayedTranscript.isEmpty {
        if let error = workspaces.transcriptError {
          transcriptError(error, retryOlder: false)
        } else {
          ContentUnavailableView(
            "No messages yet",
            systemImage: "bubble.left",
            description: Text("New messages will appear here.")
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else if preparedMessages.isEmpty {
        ProgressView("Loading messages…").frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        messageList
      }
    }

    private var messageList: some View {
      // Realize nearby rows only: laying out every rich message makes each
      // scroll event expensive. Keep each message unary and anchored by ID.
      let transcriptRoom = room
      let channels = workspaces.composerChannels
      return ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            if workspaces.transcriptHasMore {
              Button("Load older messages") {
                scrollIntent.readOlder()
                workspaces.loadOlderMessages(auth: auth)
              }
              .disabled(workspaces.transcriptLoadingOlder || workspaces.transcriptRefreshing)
              .buttonStyle(.link)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 8)
            }
            if workspaces.transcriptLoadingOlder {
              ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            if let error = workspaces.transcriptError {
              inlineError(error)
                .padding(.horizontal, 12)
            }
            if workspaces.directStream.parentMessageId == nil, let error = workspaces.directStream.errorMessage {
              Text(error)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
            }
            let messages = preparedMessages
            let gaps = workspaces.timeline.historyGapMessageIds
            ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
              let previous = index > 0 ? messages[index - 1] : nil
              let hasGap = gaps.contains(message.id)
              // Unary row: a top-level if (day pill) plus the bubble made the
              // lazy path reserve blank slots. One container per message id.
              VStack(alignment: .leading, spacing: 0) {
                if hasGap {
                  Button("Load missing messages") {
                    Task {
                      do {
                        try await workspaces.loadHistoryGap(before: message.id, auth: auth)
                      } catch { jumpError = friendlyMessage(for: error) }
                    }
                  }
                  .buttonStyle(.link)
                  .disabled(workspaces.transcriptRefreshing || workspaces.transcriptLoadingOlder)
                  .frame(maxWidth: .infinity)
                  .padding(.vertical, 8)
                }
                if let label = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt) {
                  DaySeparatorRow(label: label)
                }
                if let status = membershipStatusText(message) {
                  MembershipStatusRow(text: status)
                    .padding(.horizontal, 12)
                } else {
                  let outbound = workspaces.outboundShells.first { $0.id == message.id }
                  MessageRowView(channels: channels, room: transcriptRoom, preparedDocument: preparedTranscript?.documents[message.id],
                                 message: message,
                                 isContinuation: isMessageContinuation(previous: hasGap ? nil : previous, current: message),
                                 outbound: outbound,
                                 sentAt: workspaces.outbox.sentAt[message.id],
                                 onRetry: outbound.map { shell in
                                   { workspaces.retryOutbound(clientTurnId: shell.clientTurnId) }
                                 },
                                 onRemove: outbound.map { shell in
                                   { workspaces.removeOutbound(clientTurnId: shell.clientTurnId) }
                                 },
                                 onRetryMention: mentionRetryAction(for: message),
                                 // Web hides the thread button on stream overlays and mention shells (`shouldShowChatRoomThreadButton`).
                                 onReply: outbound == nil && !message.id.hasPrefix("stream:") && CoworkerMentionShell(message: message) == nil
                                   ? { workspaces.openThread(message, auth: auth) } : nil,
                                 onQuote: canQuoteMessage(message) ? { pendingQuote = messageQuote(from: message)
                                   quoteFocusRequest = UUID().uuidString
                                 } : nil,
                                 onEdit: canModifyOwnMessage(message, userId: workspaces.currentUserId) ? { workspaces.startEditing(message) } : nil,
                                 isHighlighted: highlightedId == message.id,
                                 isPinned: workspaces.canUsePins && workspaces.isPinned(message),
                                 isUpdatingPin: workspaces.isUpdatingPin(message.id),
                                 onTogglePin: pinAction(for: message),
                                 onDelete: deletionAction(for: message),
                                 onRemoveUnfurl: unfurlAction(for: message),
                                 onToggleReaction: reactionAction(for: message),
                                 editing: workspaces.messageEditing,
                                 onQuoteJump: { id in Task {
                                   do {
                                     if try await workspaces.openMessage(id, auth: auth) == .unavailable {
                                       jumpError = "This message is no longer available."
                                     }
                                   } catch { jumpError = friendlyMessage(for: error) }
                                 } },
                                 onSendToSelf: sendToSelfAction(for: message),
                                 horizontalInset: 12,
                                 streamReasoning: streamReasoning(for: message),
                                 streamThinking: isLiveCoworkerOverlay(message) && ComposerContent(message.content).text.isEmpty && workspaces.directStream.isBusy)
                }
              }
              .background {
                if quoteTarget == message.id {
                  Color.clear.onScrollVisibilityChange(threshold: 0.01) { visible in
                    if visible {
                      completeVisibleJump(message.id)
                    }
                  }
                }
              }
              .id(message.id)
            }
            // Bottom anchor doubles as the trailing breathing room (1pt anchor
            // plus the 8pt the stack used to pad outside). Padding below the
            // anchor would park every scrollTo 8pt short of the true bottom.
            Color.clear.frame(height: 9).id("timeline-bottom")
          }
          .scrollTargetLayout()
          .padding(.top, 8)
        }
        .task {
          // Position after the lazy list mounts. A default initial bottom
          // anchor can leave the viewport unrealized on macOS 27.
          guard workspaces.timeline.historicalAnchor == nil, quoteTarget == nil else { return }
          proxy.scrollTo("timeline-bottom", anchor: .bottom)
        }
        .scrollPosition($scrollPosition)
        .defaultScrollAnchor(scrollIntent.followsLatest ? .bottom : nil, for: .sizeChanges)
        .onChange(of: preparedMessages.contains(where: { $0.id == quoteTarget }) ? quoteTarget : nil, initial: true) { _, target in
          guard let target else { return }
          guard workspaces.displayedTranscript.contains(where: { $0.id == target }) else {
            quoteTarget = nil
            jumpCompletion?.resume(returning: false)
            jumpCompletion = nil
            return
          }
          scrollIntent.readOlder()
          scrollPosition.scrollTo(id: target, anchor: .center)
        }
        .task(id: pendingBottomAlignment && !userIsScrolling && scrollIntent.followsLatest && workspaces.timeline.historicalAnchor == nil) {
          guard pendingBottomAlignment, !userIsScrolling, scrollIntent.followsLatest, workspaces.timeline.historicalAnchor == nil else { return }
          pendingBottomAlignment = false
          proxy.scrollTo("timeline-bottom", anchor: .bottom)
        }
        .onScrollPhaseChange { _, phase in
          userIsScrolling = phase == .interacting || phase == .decelerating || phase == .tracking
          if phase == .interacting || phase == .tracking {
            highlightedId = nil
          }
        }
        .onChange(of: preparedMessages.last?.id) { _, _ in
          if scrollIntent.followsLatest, workspaces.timeline.historicalAnchor == nil {
            proxy.scrollTo("timeline-bottom", anchor: .bottom)
          }
        }
        .overlay(alignment: .bottom) {
          if !scrollIntent.followsLatest || workspaces.timeline.historicalAnchor != nil {
            JumpToLatestButton {
              Task { @MainActor in
                do {
                  if try await workspaces.returnToLatest(auth: auth) {
                    scrollPosition = ScrollPosition(idType: String.self)
                    scrollIntent.followLatest()
                    highlightedId = nil
                    proxy.scrollTo("timeline-bottom", anchor: .bottom)
                  }
                } catch { jumpError = friendlyMessage(for: error) }
              }
            }
          }
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.containerSize.width } action: { old, new in
          // Closing Pins widens and reflows rich text. Restore the acknowledged
          // target after that layout change, until the reader starts scrolling.
          if old != new, let highlightedId, !userIsScrolling {
            scrollPosition.scrollTo(id: highlightedId, anchor: .center)
            proxy.scrollTo(highlightedId, anchor: .center)
          }
        }
        .onScrollGeometryChange(for: TranscriptScrollEdges.self) { TranscriptScrollEdges($0) } action: { oldEdges, edges in
          if workspaces.timeline.historicalAnchor == nil,
             oldEdges.offsetY != edges.offsetY,
             userIsScrolling || oldEdges.nearBottom != edges.nearBottom {
            if scrollIntent.followsLatest != edges.nearBottom {
              scrollIntent.userScrolled(isNearBottom: edges.nearBottom)
              if !edges.nearBottom {
                pendingBottomAlignment = false
              }
            }
          } else if !oldEdges.hasSameSize(as: edges), scrollIntent.followsLatest, edges.needsBottomAlignment, workspaces.timeline.historicalAnchor == nil {
            if !pendingBottomAlignment {
              pendingBottomAlignment = true
            }
          }
          let isNearTop = edges.nearTop
          if !isNearTop {
            if !transcriptWasAwayFromTop {
              transcriptWasAwayFromTop = true
            }
            return
          }
          var nextIntent = scrollIntent
          guard transcriptWasAwayFromTop, workspaces.transcriptError == nil,
                nextIntent.beginAutomaticOlderPage(
                  userIsScrolling: userIsScrolling,
                  isNearTop: isNearTop,
                  hasMore: workspaces.transcriptHasMore,
                  isLoading: workspaces.transcriptLoading || workspaces.transcriptLoadingOlder
                ) else { return }
          if nextIntent != scrollIntent {
            scrollIntent = nextIntent
          }
          Task { @MainActor in
            workspaces.loadOlderMessages(auth: auth)
          }
        }
      }
    }

    private func pinAction(for message: Components.Schemas.ChatRoomMessage) -> (() async throws -> Void)? {
      guard workspaces.canUsePins, message.parentMessageId == nil, canReactToMessage(message) else { return nil }
      return { try await workspaces.setPinned(!workspaces.isPinned(message), messageId: message.id, auth: auth) }
    }

    private func completeVisibleJump(_ target: String) {
      guard quoteTarget == target else { return }
      highlightedId = target
      quoteTarget = nil
      jumpCompletion?.resume(returning: true)
      jumpCompletion = nil
    }

    private func jumpToMessage(_ id: String) async throws -> MessageNavigationResult {
      let expectedRoom = roomId
      scrollIntent.readOlder()
      let result = try await workspaces.openMessage(id, auth: auth)
      guard result == .opened, workspaces.transcriptRoomId == expectedRoom else {
        return result == .opened ? .superseded : result
      }
      jumpCompletion?.resume(returning: false)
      let landed = await withCheckedContinuation { completion in
        jumpCompletion = completion
        quoteTarget = id
      }
      return landed ? .opened : .superseded
    }

    private func transcriptError(_ error: String, retryOlder: Bool) -> some View {
      errorBanner(error) {
        if retryOlder {
          workspaces.loadOlderMessages(auth: auth)
        } else if let room {
          workspaces.openRoom(room, auth: auth)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Banner variant for failures above loaded history: no `maxHeight`, which
    /// is illegal inside the scroll view.
    private func inlineError(_ error: String) -> some View {
      errorBanner(error) {
        if workspaces.timeline.failedPage == .older {
          scrollIntent.readOlder()
          workspaces.loadOlderMessages(auth: auth)
        } else {
          workspaces.refreshTranscript(auth: auth)
        }
      }
      .frame(maxWidth: .infinity)
    }

    private func errorBanner(_ error: String, retry: @escaping () -> Void) -> some View {
      VStack(spacing: 8) {
        Text(error)
          .foregroundStyle(.secondary)
        Button("Retry", action: retry)
      }
    }

    private func isLiveCoworkerOverlay(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
      message.id.hasPrefix("stream:") && isCoworkerMessage(message)
    }

    private func streamReasoning(for message: Components.Schemas.ChatRoomMessage) -> String? {
      guard isLiveCoworkerOverlay(message) else { return nil }
      if ComposerContent(message.content).text.isEmpty, workspaces.directStream.isBusy {
        return workspaces.directStream.latestThought ?? workspaces.directStream.reasoning
      }
      return workspaces.directStream.reasoning
    }
  }

#endif
