import CoreAPI
import SokosumiChat
import SwiftUI

/// SOK-974 transcript pane: history newest-at-bottom, scroll-up pagination,
/// empty/error states, and a disabled composer stub (send ships next).
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
        LazyVStack(alignment: .leading, spacing: 8) {
          if workspaces.transcriptHasMore {
            Button("Load older messages") {
              workspaces.loadOlderMessages(auth: auth)
            }
            .buttonStyle(.link)
            .frame(maxWidth: .infinity)
            .onAppear {
              workspaces.loadOlderMessages(auth: auth)
            }
          }
          if workspaces.transcriptLoadingOlder {
            ProgressView()
              .frame(maxWidth: .infinity)
          }
          if let error = workspaces.transcriptError {
            inlineError(error)
          }
          ForEach(workspaces.transcriptMessages, id: \.id) { message in
            MessageRow(message: message)
              .id(message.id)
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

private struct MessageRow: View {
  let message: Components.Schemas.ChatRoomMessage

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(messageSenderName(message.sender))
        .font(.caption)
        .fontWeight(.semibold)
        .foregroundStyle(.secondary)
      if message.deletedAt != nil {
        Text("This message was deleted.")
          .italic()
          .foregroundStyle(.tertiary)
      } else {
        Text(message.content)
          .textSelection(.enabled)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
