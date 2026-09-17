import CoreAPI
import SokosumiChat
import SwiftUI

/// Web `/chat/join/{token}` (`chat-join-card.tsx`, `chat-join-actions.tsx`): the public link preview, then Join for the
/// signed-in user, or the unavailable card for expired, revoked, depleted and unknown links. The app only reaches this
/// view signed in, so web's sign-in / create-account state has no native counterpart.
struct ChatJoinView: View {
  let resolve: (String) async throws -> Components.Schemas.ResolveChatRoomGuestInviteLink
  let join: (String) async throws -> Bool

  @StateObject private var model: GuestJoin
  @State private var retry = 0
  @Environment(\.dismiss) private var dismiss

  init(
    token: String,
    model: GuestJoin? = nil,
    resolve: @escaping (String) async throws -> Components.Schemas.ResolveChatRoomGuestInviteLink,
    join: @escaping (String) async throws -> Bool
  ) {
    self.resolve = resolve
    self.join = join
    _model = StateObject(wrappedValue: model ?? GuestJoin(token: token))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      content
    }
    .padding(20)
    .frame(width: 480)
    .disabled(model.joining)
    .interactiveDismissDisabled(model.joining)
    .task(id: retry) { await model.resolve(using: resolve) }
  }

  @ViewBuilder
  private var content: some View {
    if let error = model.loadError {
      Text("Join channel").font(.title2).fontWeight(.semibold)
      Text(error).foregroundStyle(.secondary)
      HStack {
        Spacer()
        Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("Retry") { retry += 1 }.keyboardShortcut(.defaultAction)
      }
    } else if let room = model.room {
      preview(room)
    } else if let status = model.link?.status {
      InviteErrorCard(title: "Invite link unavailable", description: Self.unavailableMessage(status)) { dismiss() }
    } else {
      Text("Join channel").font(.title2).fontWeight(.semibold)
      ProgressView("Checking invite link…").frame(maxWidth: .infinity, minHeight: 120)
      HStack {
        Spacer()
        Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
      }
    }
  }

  private func preview(_ room: Components.Schemas.ResolveChatRoomGuestInviteLink.RoomPayload) -> some View {
    VStack(spacing: 16) {
      Image(systemName: "number")
        .font(.title)
        .foregroundStyle(.secondary)
        .frame(width: 64, height: 64)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityHidden(true)
      Text("Join channel").font(.title2).fontWeight(.semibold)
      Text("You've been invited to join #\(room.name) (\(room.organizationName)).")
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Text("Joining as a guest does not make you a member of the host organization.")
        .font(.caption)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      if let error = model.joinError {
        Text(error).font(.callout).foregroundStyle(.red).multilineTextAlignment(.center)
      }
      HStack {
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button {
          Task {
            if await model.join(using: join) {
              dismiss()
            }
          }
        } label: {
          HStack(spacing: 6) {
            if model.joining {
              ProgressView().controlSize(.small)
            }
            Text(model.joining ? "Joining…" : "Join #\(room.name)")
          }
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
      }
    }
    .frame(maxWidth: .infinity)
  }

  static func unavailableMessage(_ status: Components.Schemas.ResolveChatRoomGuestInviteLink.StatusPayload) -> String {
    switch status {
    case .expired: "This invite link has expired."
    case .revoked: "This invite link has been revoked."
    case .depleted: "This invite link has reached its usage limit."
    case .notFound, .valid: "This invite link is not valid."
    }
  }
}
