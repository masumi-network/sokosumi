import CoreAPI
import SokosumiChat
import SwiftUI

/// Wall-clock HH:mm in the local timezone, like web `formatMessageTime`.
private let messageTimeFormatter: DateFormatter = {
  let formatter = DateFormatter()
  formatter.timeStyle = .short
  formatter.dateStyle = .none
  return formatter
}()

/// SOK-974 transcript pane mirroring the web message view: avatar rail with
/// Slack-style continuation grouping, day separator pills, membership status
/// rows, and a disabled composer stub (send ships next).
struct TranscriptView: View {
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState

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
      composerStub
    }
  }

  @ViewBuilder
  private var transcriptBody: some View {
    if workspaces.transcriptRoomId != roomId || workspaces.transcriptLoading {
      ProgressView("Loading messages…")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if workspaces.transcriptMessages.isEmpty {
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
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if workspaces.transcriptHasMore {
            Button("Load older messages") {
              workspaces.loadOlderMessages(auth: auth)
            }
            .buttonStyle(.link)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .onAppear {
              workspaces.loadOlderMessages(auth: auth)
            }
          }
          if workspaces.transcriptLoadingOlder {
            ProgressView()
              .frame(maxWidth: .infinity)
              .padding(.vertical, 4)
          }
          if let error = workspaces.transcriptError {
            inlineError(error)
          }
          let messages = workspaces.transcriptMessages
          ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
            let previous = index > 0 ? messages[index - 1] : nil
            if let label = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt) {
              DaySeparatorRow(label: label)
            }
            if let status = membershipStatusText(message) {
              MembershipStatusRow(text: status)
            } else {
              MessageRow(
                message: message,
                isContinuation: isMessageContinuation(previous: previous, current: message)
              )
              .id(message.id)
            }
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
      }
      .onAppear {
        if let lastID = workspaces.transcriptMessages.last?.id {
          proxy.scrollTo(lastID, anchor: .bottom)
        }
      }
      .onChange(of: workspaces.transcriptMessages.last?.id) { _, newID in
        if let newID {
          proxy.scrollTo(newID, anchor: .bottom)
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
      workspaces.loadOlderMessages(auth: auth)
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

  /// Disabled until the send ticket: the transcript must read before it
  /// writes.
  private var composerStub: some View {
    HStack {
      TextField("Message (coming soon)", text: .constant(""))
        .disabled(true)
        .textFieldStyle(.roundedBorder)
      Button("Send") {}
        .disabled(true)
    }
    .padding(8)
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
  let message: Components.Schemas.ChatRoomMessage
  let isContinuation: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      if isContinuation {
        Color.clear
          .frame(width: 32, height: 32)
      } else {
        avatarView
      }
      VStack(alignment: .leading, spacing: 2) {
        if !isContinuation {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(messageSenderName(message.sender))
              .fontWeight(.semibold)
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
          // foregroundColor (not Style): only Color keeps this Text for `+`.
          (Text(message.content) + Text(" Edited").font(.caption).foregroundColor(.secondary))
            .textSelection(.enabled)
        } else {
          Text(message.content)
            .textSelection(.enabled)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.top, isContinuation ? 2 : 10)
    .padding(.bottom, 2)
  }

  @ViewBuilder
  private var avatarView: some View {
    let name = messageSenderName(message.sender)
    if let urlString = avatarURLString, let url = URL(string: urlString) {
      AsyncImage(url: url) { image in
        image
          .resizable()
          .scaledToFill()
      } placeholder: {
        initialsFallback(name: name)
      }
      .frame(width: 32, height: 32)
      .clipShape(Circle())
    } else {
      initialsFallback(name: name)
    }
  }

  private func initialsFallback(name: String) -> some View {
    Text(initials(for: name))
      .font(.caption)
      .fontWeight(.semibold)
      .foregroundStyle(.white)
      .frame(width: 32, height: 32)
      .background(Circle().fill(Color.accentColor))
  }

  /// Photo for human senders; coworkers and bots render initials.
  private var avatarURLString: String? {
    if case let .case1(user) = message.sender {
      user.user.image
    } else {
      nil
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
        isContinuation: false
      )
      MessageRow(
        message: previewMessage(id: "m2", content: "Same burst, so no second header.", name: "Ada", minutesAfterNoon: 1),
        isContinuation: true
      )
      MessageRow(
        message: previewMessage(id: "m3", content: "Edited after the fact.", name: "Ada", minutesAfterNoon: 30, edited: true),
        isContinuation: false
      )
      MembershipStatusRow(text: "Bob joined")
    }
    .padding()
  }
#endif
