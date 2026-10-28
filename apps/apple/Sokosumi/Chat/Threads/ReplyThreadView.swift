import CoreAPI
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

#if os(macOS)
  private func threadPreparationScope(_ workspaces: WorkspaceState) -> [String] {
    [workspaces.currentUserId, workspaces.selectionId ?? "", workspaces.openRoom.room.timeline.roomId ?? "",
     workspaces.openRoom.thread.parent?.id ?? "", String(workspaces.openRoom.thread.transcript.timeline.generation)]
  }

  struct ReplyThreadView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @State private var preparedTranscript: PreparedTranscript?
    /// Publish the page controls with prepared replies, including empty final pages.
    @State private var preparedHasMore = false

    private var preparationInput: PreparedTranscript.Input {
      let room = workspaces.rooms.first { $0.id == workspaces.openRoom.room.timeline.roomId }
      return .init(scope: threadPreparationScope(workspaces),
                   messages: (workspaces.openRoom.displayedThreadParent.map { [$0] } ?? []) + workspaces.openRoom.displayedThreadReplies,
                   mentions: room.map(MessageMentions.init), channels: workspaces.composerChannels, baseURL: CoreSettings.webBaseURL)
    }

    var body: some View {
      let input = preparationInput
      let prepared = preparedTranscript.flatMap { $0.input.scope == input.scope ? $0 : nil }
      // The parent leads the list, so the replies overlay apart from it: an older page of replies is then the prefix
      // that waits for its Markdown, as the room's does. Shown at once, its rows drew a loading line, then grew by a
      // line just above the reader, and the list's correction for that growth at times left the text 16 or 32 pt off.
      let messages = prepared.map { Array(input.messages.prefix(1)) + $0.overlaying(Array(input.messages.dropFirst())) } ?? []
      ReplyThreadContent(messages: messages, preparedTranscript: prepared,
                         preparationScope: input.scope, preparedHasMore: preparedHasMore)
        .modifier(ComposerAttachmentPane(userId: workspaces.currentUserId, organizationId: workspaces.draftOrganizationId(roomId: workspaces.openRoom.room.timeline.roomId ?? ""), formerOrganizationId: workspaces.selection?.workspace.organizationId, roomId: workspaces.openRoom.room.timeline.roomId ?? "", parentMessageId: workspaces.openRoom.thread.parent?.id))
        .id([workspaces.currentUserId, workspaces.selectionId ?? "", workspaces.openRoom.room.timeline.roomId ?? "", workspaces.openRoom.thread.parent?.id ?? ""])
        .onChange(of: workspaces.openRoom.thread.transcript.timeline.hasMore) { _, hasMore in
          if preparedTranscript?.input == input {
            preparedHasMore = hasMore
          }
        }
        .task(id: input) {
          let hasMore = workspaces.openRoom.thread.transcript.timeline.hasMore
          guard let prepared = try? await PreparedTranscript.prepare(input, reusing: preparedTranscript), !Task.isCancelled else { return }
          preparedTranscript = prepared
          preparedHasMore = hasMore
        }
    }
  }

  struct ReplyThreadContent: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @Environment(\.jumpMarkClock) private var jumpMarkClock
    let messages: [Components.Schemas.ChatRoomMessage]
    let preparedTranscript: PreparedTranscript?
    let preparationScope: [String]
    let preparedHasMore: Bool

    private func readyJump(in messages: [Components.Schemas.ChatRoomMessage]) -> TranscriptSession.JumpTarget? {
      guard let target = workspaces.openRoom.thread.transcript.jumpTarget,
            messages.contains(where: { $0.id == target.messageId }) else { return nil }
      return target
    }

    @State private var scroll = TranscriptScroll()
    @State private var olderBoundaryVisible = false
    @State private var visibleMessageID: String?
    @State private var scrollActivity = TranscriptScrollActivity()
    @State private var pendingQuote: Components.Schemas.ChatRoomMessageQuote?
    @State private var jumpError: String?
    @State private var quoteFocusRequest: String?

    private var room: Components.Schemas.ChatRoom? {
      workspaces.rooms.first { $0.id == workspaces.openRoom.room.timeline.roomId }
    }

    /// The Thread's answer to its rows: its outbox, its composer for quotes, its jump alert.
    private var rowActions: TranscriptRowActions {
      TranscriptRowActions(workspaces: workspaces, transcript: workspaces.openRoom.thread.transcript, quote: { message in
        pendingQuote = messageQuote(from: message)
        quoteFocusRequest = UUID().uuidString
      }, jumpFailed: { jumpError = $0 })
    }

    private var userIsScrolling: Bool {
      scrollActivity.isScrolling
    }

    /// The Thread shows a jumped-to page; read live, never stored, so a page change and its anchor arrive together.
    private var anchored: Bool {
      workspaces.openRoom.thread.transcript.timeline.historicalAnchor != nil
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
          scroll = TranscriptScroll()
          olderBoundaryVisible = false
          visibleMessageID = nil
          scrollActivity.update(for: .idle)
        }
    }

    @ViewBuilder private var content: some View {
      if preparationScope == threadPreparationScope(workspaces),
         let parent = messages.first {
        let jumpTarget = readyJump(in: messages)
        let currentRoom = room
        let channels = workspaces.composerChannels
        let rowContext = TranscriptContext(
          room: currentRoom, viewerId: workspaces.currentUserId, allowsPins: false, allowsThreads: false,
          outbound: workspaces.openRoom.thread.transcript.outbox.shells, editingMessageId: workspaces.openRoom.messageEditing.source?.id
        )
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
              MessageRowView(channels: channels, room: currentRoom, preparedDocument: preparedTranscript?.document(for: parent), message: parent,
                             row: MessageRow(parent, in: rowContext, previous: nil, isNewest: false),
                             outbound: nil,
                             perform: { rowActions.perform($0, on: parent) },
                             editing: workspaces.openRoom.messageEditing,
                             onSendToSelf: { try await workspaces.sendMessageToSelf(parent) },
                             sokoBotFeedback: workspaces.sokoBotFeedback(for: parent),
                             loadResultPreviews: { try await workspaces.messageResultPreviews(parent) })
                .jumpSpotlightRow(messageId: parent.id)
                .id(parent.id)
              Divider()
              HStack {
                Text("^[\(parent.threadReplyCount) reply](inflect: true)").foregroundStyle(.secondary)
                Spacer()
                if preparedHasMore {
                  Button("Load older replies") {
                    scroll.readOlder()
                    workspaces.openRoom.loadThreadPage(.older)
                  }
                  .buttonStyle(.link)
                  .controlSize(.small)
                  .disabled(workspaces.openRoom.thread.transcript.timeline.isLoadingOlder || workspaces.openRoom.directStream.isBusy)
                  .opacity(workspaces.openRoom.thread.transcript.timeline.isLoadingOlder ? 0 : 1)
                  .overlay {
                    if workspaces.openRoom.thread.transcript.timeline.isLoadingOlder {
                      ProgressView().controlSize(.small)
                    }
                  }
                }
              }
              .font(.caption)
              .frame(minHeight: 24)
              replies(messages: Array(messages.dropFirst()), channels: channels, room: currentRoom, rowContext: rowContext)
              Color.clear.frame(height: 17).id("thread-bottom")
            }
            .scrollTargetLayout()
            .environment(\.transcriptScrollActivity, scrollActivity)
            .padding(.horizontal)
            .padding(.top)
          }
          // Row 25b2: the other rows, the parent too, step back while the Thread's mark holds.
          .jumpSpotlight(for: jumpTarget?.mark)
          .scrollPosition(id: $visibleMessageID, anchor: .bottom)
          .defaultScrollAnchor(.bottom, for: .initialOffset)
          .defaultScrollAnchor(scroll.followsLatest ? .bottom : nil, for: .sizeChanges)
          // Keyed by the request: a reader scroll changes the target's mark, and must not scroll back to it.
          .task(id: jumpTarget?.requestId) {
            guard let target = jumpTarget else { return }
            scroll.jumped()
            proxy.scrollTo(target.messageId, anchor: .center)
            workspaces.openRoom.thread.transcript.landJump(target.requestId)
          }
          .task(id: workspaces.openRoom.thread.transcript.jumpTarget?.mark) {
            guard let mark = workspaces.openRoom.thread.transcript.jumpTarget?.mark else { return }
            try? await jumpMarkClock.sleep(until: mark.endsAt)
            guard !Task.isCancelled else { return }
            workspaces.openRoom.thread.transcript.endJumpIfMarkEnded()
          }
          .task(id: scroll.alignsToBottom(userIsScrolling: userIsScrolling, anchored: anchored)) {
            if scroll.takeBottomAlignment(userIsScrolling: userIsScrolling, anchored: anchored) {
              proxy.scrollTo("thread-bottom", anchor: .bottom)
            }
          }
          .onScrollPhaseChange { _, phase in
            scrollActivity.update(for: phase)
            if phase.endsJumpMark {
              Task { @MainActor in workspaces.openRoom.thread.transcript.readerScrolled() }
            }
            loadOlderRepliesAutomatically()
          }
          .onScrollGeometryChange(for: TranscriptScrollEdges.self) { TranscriptScrollEdges($0) } action: { oldEdges, edges in
            var next = scroll
            next.edgesChanged(from: oldEdges, to: edges, userIsScrolling: userIsScrolling, anchored: anchored)
            if next != scroll {
              scroll = next
            }
          }
          .onChange(of: workspaces.openRoom.thread.transcript.timeline.historicalAnchor) { old, new in
            if old != nil, new == nil {
              scroll.followLatest()
              Task { @MainActor in workspaces.openRoom.thread.transcript.clearJump() }
            }
          }
          .onChange(of: messages.last?.id) { _, _ in
            if scroll.followsNewMessages(anchored: anchored) {
              proxy.scrollTo("thread-bottom", anchor: .bottom)
            }
          }
          .overlay(alignment: .bottom) {
            if scroll.showsJumpToLatest(anchored: anchored) {
              JumpToLatestButton {
                Task { @MainActor in
                  do {
                    if try await workspaces.openRoom.thread.transcript.returnToLatest() {
                      scroll.followLatest()
                      workspaces.openRoom.thread.transcript.clearJump()
                      proxy.scrollTo("thread-bottom", anchor: .bottom)
                    }
                  } catch { jumpError = friendlyMessage(for: error) }
                }
              }
            }
          }
        }
        .scrollEdgeEffectStyle(.hard, for: .top)
        .scrollEdgeEffectStyle(.soft, for: .bottom)
        .safeAreaInset(edge: .bottom, spacing: 0) {
          if let notice = ReadOnlyDirectNotice(room: currentRoom) {
            ReadOnlyDirectNoticeView(notice: notice)
          } else {
            ChatComposerView(userId: workspaces.currentUserId, organizationId: workspaces.draftOrganizationId(roomId: parent.roomId),
                             formerOrganizationId: workspaces.selection?.workspace.organizationId,
                             roomId: parent.roomId, parentMessageId: parent.id, pendingQuote: $pendingQuote, quoteFocusRequest: quoteFocusRequest,
                             onAccepted: { scroll.followLatest() })
              .id(parent.id)
          }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
          if let failure = workspaces.openRoom.thread.mute?.failure {
            ThreadMuteFailureRow(message: failure.message) { workspaces.openRoom.thread.dismissMuteFailure() }
          }
        }
        .navigationTitle("Thread")
        .toolbar {
          if let mute = workspaces.openRoom.thread.mute, let isMuted = mute.isMuted {
            ToolbarItem {
              ThreadMuteToggle(isMuted: isMuted, isPending: mute.isPending) {
                Task { await workspaces.toggleThreadMute() }
              }
            }
          }
        }
        // Stored replies only. A pending shell reads too early (404) and the stored row that replaces it
        // does not change the displayed count, so the bell would never appear.
        .task(id: [parent.id, String(liveThreadReplyCount(messages))]) {
          await workspaces.readThreadMuteIfNeeded()
        }
        .onChange(of: parent.id) { _, _ in pendingQuote = nil
          jumpError = nil
        }
      } else {
        ProgressView("Loading replies…").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }

    private func loadOlderRepliesAutomatically() {
      let timeline = workspaces.openRoom.thread.transcript.timeline
      guard timeline.errorMessage == nil, workspaces.openRoom.thread.transcript.loadTask == nil,
            scroll.beginAutomaticOlderPage(
              userIsScrolling: userIsScrolling,
              isNearTop: olderBoundaryVisible,
              hasMore: timeline.hasMore,
              isLoading: timeline.isLoading || timeline.isLoadingOlder || workspaces.openRoom.directStream.isBusy
            ) else { return }
      olderBoundaryVisible = false
      let generation = timeline.generation
      Task { @MainActor in
        guard timeline.generation == generation, workspaces.openRoom.thread.transcript.loadTask == nil else { return }
        workspaces.openRoom.loadThreadPage(.older)
      }
    }

    @ViewBuilder private func replies(messages: [Components.Schemas.ChatRoomMessage], channels: [ComposerChannel], room: Components.Schemas.ChatRoom?,
                                      rowContext: TranscriptContext) -> some View {
      let timeline = workspaces.openRoom.thread.transcript.timeline
      if timeline.isLoading {
        ProgressView("Loading replies…")
      } else {
        if let error = timeline.errorMessage {
          Text(error).foregroundStyle(.secondary)
          Button("Retry") { workspaces.openRoom.loadThreadPage(timeline.failedPage ?? .initial) }
        }
        if workspaces.openRoom.directStream.parentMessageId == workspaces.openRoom.thread.parent?.id,
           let error = workspaces.openRoom.directStream.errorMessage {
          Text(error).foregroundStyle(.secondary)
        }
        if messages.isEmpty, timeline.errorMessage == nil {
          Text("No replies yet.").foregroundStyle(.secondary)
        }
        replyRows(messages: messages, channels: channels, room: room, rowContext: rowContext)
      }
    }

    private func replyRows(
      messages: [Components.Schemas.ChatRoomMessage],
      channels: [ComposerChannel],
      room: Components.Schemas.ChatRoom?,
      rowContext: TranscriptContext
    ) -> some View {
      let transcript = workspaces.openRoom.thread.transcript
      return ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
        let row = transcript.row(at: index, of: messages, context: rowContext, streamBusy: workspaces.openRoom.directStream.isBusy, now: Date())
        VStack(alignment: .leading, spacing: 0) {
          if let gap = row.gap {
            // Web's thread panel has no gap row (a reply jump is Apple's), so this stays a
            // tap; the row and its failure follow the room's gap row.
            PageBoundaryRow(copy: .transcript(isGap: true), status: gap) {
              workspaces.openRoom.loadThreadPage(.boundary(message.id))
            }
          }
          if let label = row.dayLabel {
            DaySeparatorRow(label: label)
          }
          switch row.content {
          case .status:
            if let status = roomStatusText(message) {
              RoomStatusRow(text: status)
                .jumpSpotlightRow(messageId: message.id)
            }
          case let .bubble(bubble):
            MessageRowView(channels: channels, room: room, preparedDocument: preparedTranscript?.document(for: message), message: message,
                           row: bubble.row,
                           outbound: bubble.outbound, sentAt: bubble.sentAt,
                           perform: { rowActions.perform($0, on: message) },
                           canRetryMention: workspaces.openRoom.canRetryMention(message),
                           jumpMark: bubble.jumpMark,
                           editing: workspaces.openRoom.messageEditing,
                           onSendToSelf: { try await workspaces.sendMessageToSelf(message) },
                           sokoBotFeedback: workspaces.sokoBotFeedback(for: message),
                           loadResultPreviews: { try await workspaces.messageResultPreviews(message) },
                           streamThinking: bubble.thinking)
              .jumpSpotlightRow(messageId: message.id)
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
