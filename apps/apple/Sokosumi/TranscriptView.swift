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

  /// Transcript pane: avatar rail with Slack-style continuation grouping,
  /// day separator pills, membership status rows, and a native composer.
  struct TranscriptView: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    /// Eager first layout can report near-top before the bottom anchor
    /// lands. Require a trip away from the top before auto-loading.
    @State private var transcriptWasAwayFromTop = false
    @State private var visibleMessageId: String?
    @State private var scrollIntent = TimelineScrollIntent()
    @State private var userIsScrolling = false

    let roomId: String

    private var room: Components.Schemas.ChatRoom? {
      workspaces.rooms.first { $0.id == roomId }
    }

    var body: some View {
      VStack(spacing: 0) {
        if let room {
          Text(roomDisplayName(room, currentUserId: workspaces.currentUserId))
            .font(.headline)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
          Divider()
        }
        transcriptBody
        Divider()
        RoomComposer(
          userId: workspaces.currentUserId,
          organizationId: workspaces.selection?.workspace.organizationId,
          roomId: roomId
        )
        .id([workspaces.currentUserId, workspaces.selectionId ?? "", roomId])
      }
      .onChange(of: roomId) { _, _ in
        transcriptWasAwayFromTop = false
        visibleMessageId = nil
        scrollIntent = TimelineScrollIntent()
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
      } else {
        messageList
      }
    }

    private var messageList: some View {
      // Eager stack so the bottom anchor has real last-row geometry on first
      // paint. LazyVStack estimated a tall empty clip; scrolling up realized
      // rows and the blank collapsed. First page is 100 messages.
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
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
            }
            let messages = workspaces.displayedTranscript
            ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
              let previous = index > 0 ? messages[index - 1] : nil
              // Unary row: a top-level if (day pill) plus the bubble made the
              // lazy path reserve blank slots. One container per message id.
              VStack(alignment: .leading, spacing: 0) {
                if let label = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt) {
                  DaySeparatorRow(label: label)
                }
                if let status = membershipStatusText(message) {
                  MembershipStatusRow(text: status)
                } else {
                  let outbound = workspaces.outboundShells.first { $0.id == message.id }
                  MessageRow(
                    message: message,
                    isContinuation: isMessageContinuation(previous: previous, current: message),
                    outbound: outbound,
                    retryDisabled: false,
                    onRetry: outbound.map { shell in
                      { workspaces.retryOutbound(clientTurnId: shell.clientTurnId) }
                    },
                    onRemove: outbound.map { shell in
                      { workspaces.removeOutbound(clientTurnId: shell.clientTurnId) }
                    }
                  )
                }
              }
              .id(message.id)
            }
            Color.clear.frame(height: 1).id("timeline-bottom")
          }
          .scrollTargetLayout()
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
        }
        .defaultScrollAnchor(.bottom)
        .scrollPosition(id: $visibleMessageId, anchor: .top)
        .onScrollPhaseChange { _, phase in
          userIsScrolling = phase == .interacting || phase == .decelerating
        }
        .onChange(of: workspaces.displayedTranscript.last?.id) { _, _ in
          if scrollIntent.followsLatest {
            proxy.scrollTo("timeline-bottom", anchor: .bottom)
          }
        }
        .overlay(alignment: .bottomTrailing) {
          if !scrollIntent.followsLatest {
            Button("Latest messages", systemImage: "arrow.down") {
              scrollIntent.followLatest()
              proxy.scrollTo("timeline-bottom", anchor: .bottom)
            }
            .buttonStyle(.borderedProminent)
            .padding(12)
          }
        }
        .onScrollGeometryChange(for: [Double].self) { geometry in
          [geometry.visibleRect.minY, geometry.contentSize.height - geometry.visibleRect.maxY]
        } action: { _, geometry in
          if userIsScrolling {
            scrollIntent.userScrolled(distanceFromBottom: geometry[1])
          } else if scrollIntent.followsLatest {
            proxy.scrollTo("timeline-bottom", anchor: .bottom)
          }
          let isNearTop = geometry[0] < 40
          if !isNearTop {
            transcriptWasAwayFromTop = true
            return
          }
          guard transcriptWasAwayFromTop, workspaces.transcriptError == nil,
                scrollIntent.beginAutomaticOlderPage(
                  userIsScrolling: userIsScrolling,
                  isNearTop: isNearTop,
                  hasMore: workspaces.transcriptHasMore,
                  isLoading: workspaces.transcriptLoading || workspaces.transcriptLoadingOlder
                ) else { return }
          Task { @MainActor in
            workspaces.loadOlderMessages(auth: auth)
          }
        }
      }
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
  }

  /// Owns typing state so edits do not invalidate the transcript. The parent
  /// gives each account/workspace/room a distinct identity before loading its draft.
  private struct RoomComposer: View {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @State private var draft: String

    private let savedDraft: SavedComposeDraft
    private let roomId: String

    init(userId: String, organizationId: String?, roomId: String) {
      self.roomId = roomId
      let savedDraft = SavedComposeDraft(userId: userId, organizationId: organizationId, roomId: roomId)
      self.savedDraft = savedDraft
      _draft = State(initialValue: savedDraft.load())
    }

    private var canSend: Bool {
      ComposerContent(draft).canSend
        && !workspaces.transcriptLoading
        && workspaces.transcriptRoomId == roomId
    }

    var body: some View {
      HStack {
        ComposerInput(text: Binding(
          get: { draft },
          set: { text in
            draft = text
            savedDraft.save(text)
          }
        ), submit: sendDraft)
        if ComposerContent(draft).showsCounter {
          Text("\(ComposerContent(draft).count)/\(ComposerContent.maximumLength)")
            .font(.caption)
            .foregroundStyle(ComposerContent(draft).isTooLong ? .red : .secondary)
            .accessibilityLabel("Message length: \(ComposerContent(draft).count) of \(ComposerContent.maximumLength)")
        }
        Button("Send") { sendDraft() }
          .disabled(!canSend)
      }
      .padding(8)
    }

    @discardableResult
    private func sendDraft() -> Bool {
      guard canSend else { return false }
      guard workspaces.sendMessage(draft, auth: auth) else { return false }
      draft = ""
      savedDraft.save("")
      return true
    }
  }

  /// Centered day pill ("Today", "Yesterday", weekday, dd/mm/yyyy),
  /// like web `DaySeparator`.
  struct DaySeparatorRow: View {
    let label: String

    var body: some View {
      HStack {
        Spacer()
        Text(label)
          .font(.caption)
          .fontWeight(.medium)
          .foregroundStyle(.secondary)
          .padding(.horizontal, 12)
          .padding(.vertical, 4)
          .background(Color.secondary.opacity(0.15))
          .clipShape(.capsule)
        Spacer()
      }
      .padding(.vertical, 4)
      .frame(maxWidth: .infinity)
    }
  }

  /// Centered join/leave status, like web `MembershipStatusRow`.
  struct MembershipStatusRow: View {
    let text: String

    var body: some View {
      Text(text)
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
  }

  /// One chat bubble row: avatar rail plus sender header, or a bare
  /// continuation rail when the burst continues. Plain text body only.
  struct MessageRow: View {
    /// Avatar edge: web uses 32px, but that reads oversized next to the
    /// native sidebar (28pt "me" avatar), so the transcript matches in-app.
    static let avatarDiameter: CGFloat = 28

    let message: Components.Schemas.ChatRoomMessage
    let isContinuation: Bool
    let outbound: OutboundShell?
    let retryDisabled: Bool
    let onRetry: (() -> Void)?
    let onRemove: (() -> Void)?

    var body: some View {
      HStack(alignment: .top, spacing: 14) {
        if isContinuation {
          Color.clear
            .frame(width: Self.avatarDiameter, height: Self.avatarDiameter)
        } else {
          avatarView
        }
        // Header-to-body rhythm mirrors web: space-y-1.5 (6pt) under the
        // header, and gap-x-2.5 (10pt) between name and time.
        VStack(alignment: .leading, spacing: 6) {
          if !isContinuation {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
              Text(messageSenderName(message.sender))
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
                .lineLimit(1)
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
          if message.deletedAt != nil {
            Text("This message was deleted")
              .italic()
              .foregroundStyle(.secondary)
          } else if isContinuation, message.editedAt != nil {
            Text("\(Text(message.content))\(Text(" Edited").font(.caption).foregroundStyle(.secondary))")
              .textSelection(.enabled)
          } else {
            Text(message.content)
              .textSelection(.enabled)
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
                  .disabled(retryDisabled)
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
      .padding(.top, isContinuation ? 2 : 10)
      .padding(.bottom, 2)
    }

    private var avatarView: some View {
      CircleAvatar(
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
        MessageRow(
          message: previewMessage(id: "m1", content: "Morning all — the tracer renders web-style rows now.", name: "Ada", minutesAfterNoon: 0),
          isContinuation: false,
          outbound: nil,
          retryDisabled: false,
          onRetry: nil,
          onRemove: nil
        )
        MessageRow(
          message: previewMessage(id: "m2", content: "Same burst, so no second header.", name: "Ada", minutesAfterNoon: 1),
          isContinuation: true,
          outbound: nil,
          retryDisabled: false,
          onRetry: nil,
          onRemove: nil
        )
        MessageRow(
          message: previewMessage(id: "m3", content: "Edited after the fact.", name: "Ada", minutesAfterNoon: 30, edited: true),
          isContinuation: false,
          outbound: nil,
          retryDisabled: false,
          onRetry: nil,
          onRemove: nil
        )
        MembershipStatusRow(text: "Bob joined")
      }
      .padding()
    }
  #endif

#endif
