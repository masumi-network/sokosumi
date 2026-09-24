import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// A leave/archive/restore/delete request, bound to the composition context it was made in.
struct ChannelLifecycleRequest: Identifiable {
  let id = UUID()
  let context: UUID
  let roomId: String
  let name: String
  let action: ChannelLifecycleAction
}

/// Runs channel lifecycle requests with web's confirm copy (`edit-channel-dialog.tsx`, `organization-chat-list.client.tsx`).
/// Restore runs without confirmation. Core rejections (last member, role, not archived) surface in an alert.
struct ChannelLifecycleConfirmation: ViewModifier {
  @Binding var request: ChannelLifecycleRequest?
  var completed: () -> Void = {}
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState
  @State private var failure: Failure?

  private struct Failure {
    let title: String
    let message: String
  }

  private struct Confirmation {
    let title: String
    let message: String
    let button: String
  }

  func body(content: Content) -> some View {
    let confirmation = request.flatMap(Self.confirmation)
    content
      .alert(confirmation?.title ?? "", isPresented: Binding(get: { confirmation != nil }, set: {
        if !$0 {
          request = nil
        }
      }), presenting: request) { request in
        Button("Cancel", role: .cancel) {}
        Button(confirmation?.button ?? "", role: .destructive) { perform(request) }
      } message: { _ in
        Text(confirmation?.message ?? "")
      }
      .alert(failure?.title ?? "", isPresented: Binding(get: { failure != nil }, set: {
        if !$0 {
          failure = nil
        }
      }), presenting: failure) { _ in
        Button("OK") {}
      } message: { failure in
        Text(failure.message)
      }
      .onChange(of: request?.id) { _, _ in
        guard let request, request.action == .restore else { return }
        self.request = nil
        perform(request)
      }
  }

  private func perform(_ request: ChannelLifecycleRequest) {
    Task { @MainActor in
      do {
        let done = switch request.action {
        case .leave: try await workspaces.leaveChannel(roomId: request.roomId, context: request.context, auth: auth)
        case .archive: try await workspaces.archiveChannel(roomId: request.roomId, context: request.context, auth: auth)
        case .restore: try await workspaces.restoreChannel(roomId: request.roomId, context: request.context, auth: auth)
        case .delete: try await workspaces.deleteChannel(roomId: request.roomId, context: request.context, auth: auth)
        }
        if done {
          completed()
        }
      } catch is CancellationError {
        // The workspace changed underneath the request; nothing to report.
      } catch {
        failure = .init(title: Self.failureTitle(request.action), message: chatErrorMessage(error))
      }
    }
  }

  private static func confirmation(_ request: ChannelLifecycleRequest) -> Confirmation? {
    switch request.action {
    case .leave:
      .init(title: "Leave \(request.name)?", message: "You will stop receiving messages from this channel and it will disappear from your list.", button: "Leave channel")
    case .archive:
      .init(title: "Archive \(request.name)?", message: "The channel disappears for everyone in the organization. Its messages are kept. Restore it later from Archived in the sidebar.", button: "Archive channel")
    case .delete:
      .init(title: "Permanently delete \(request.name)?", message: "This permanently deletes the channel and its messages for everyone. This cannot be undone.", button: "Delete permanently")
    case .restore:
      nil
    }
  }

  private static func failureTitle(_ action: ChannelLifecycleAction) -> String {
    switch action {
    case .leave: "Couldn’t leave channel"
    case .archive: "Couldn’t archive channel"
    case .restore: "Couldn’t restore channel"
    case .delete: "Couldn’t delete channel"
    }
  }
}
