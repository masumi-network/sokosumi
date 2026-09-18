import CoreAPI
import SokosumiChat
import SwiftUI

/// Web `/chat/invites/{id}` (`chat-room-invitation-card.tsx`): a pending card with Decline / Accept, a closed card for
/// accepted, declined and revoked invitations, and error cards for expired or unknown ones. Presented as a sheet when a
/// same-origin invite link is opened inside the app.
struct ChatInviteView: View {
  let load: (String) async throws -> Components.Schemas.ChatRoomInvitation
  let respond: (InvitationAction, String) async throws -> Bool
  let openRoom: (String) -> Void

  @StateObject private var model: InvitationDetail
  @State private var retry = 0
  @Environment(\.dismiss) private var dismiss

  init(
    invitationId: String,
    model: InvitationDetail? = nil,
    load: @escaping (String) async throws -> Components.Schemas.ChatRoomInvitation,
    respond: @escaping (InvitationAction, String) async throws -> Bool,
    openRoom: @escaping (String) -> Void
  ) {
    self.load = load
    self.respond = respond
    self.openRoom = openRoom
    _model = StateObject(wrappedValue: model ?? InvitationDetail(id: invitationId))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      content
    }
    .padding(20)
    .frame(width: 480)
    .disabled(model.responding != nil)
    .interactiveDismissDisabled(model.responding != nil)
    .task(id: retry) { await model.load(using: load) }
  }

  @ViewBuilder
  private var content: some View {
    if let error = model.loadError {
      Text("Channel invitation").font(.title2).fontWeight(.semibold)
      Text(error).foregroundStyle(.secondary)
      HStack {
        Spacer()
        Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("Retry") { retry += 1 }.keyboardShortcut(.defaultAction)
      }
    } else {
      switch model.presentation {
      case let .pending(invitation):
        pending(invitation)
      case let .accepted(invitation):
        InviteOutcomeCard(
          symbol: "checkmark", tint: .green, title: "You joined #\(invitation.roomName)",
          message: "You can open the channel anytime from External in chat. Host: \(invitation.organizationName).",
          button: "Open channel"
        ) {
          openRoom(invitation.roomId)
          dismiss()
        }
      case let .declined(invitation):
        InviteOutcomeCard(
          symbol: "xmark", tint: .red, title: "Invitation declined",
          message: "You declined the invitation to #\(invitation.roomName) from \(invitation.organizationName).",
          button: "Back to chat"
        ) { dismiss() }
      case let .revoked(invitation):
        InviteOutcomeCard(
          symbol: "xmark", tint: .red, title: "Invitation revoked",
          message: "The invitation to #\(invitation.roomName) from \(invitation.organizationName) was revoked.",
          button: "Back to chat"
        ) { dismiss() }
      case .expired:
        InviteErrorCard(
          title: "Invitation expired", description: "This channel invitation is no longer valid.",
          content: "Ask the host to send a new invitation if you still need access."
        ) { dismiss() }
      case .notFound:
        InviteErrorCard(
          title: "Invitation not found", description: "We couldn't find this channel invitation.",
          content: "The link may be wrong, or the invitation was already used or revoked."
        ) { dismiss() }
      case nil:
        Text("Channel invitation").font(.title2).fontWeight(.semibold)
        ProgressView("Loading invitation…").frame(maxWidth: .infinity, minHeight: 120)
        HStack {
          Spacer()
          Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        }
      }
    }
  }

  private func pending(_ invitation: Components.Schemas.ChatRoomInvitation) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Channel invitation").font(.title2).fontWeight(.semibold)
        Text("You've been invited to join a channel as a guest.").foregroundStyle(.secondary)
      }
      VStack(alignment: .leading, spacing: 8) {
        Text("\(Text(verbatim: invitation.inviter.name).bold()) has invited you to join \(Text(verbatim: "#\(invitation.roomName)").bold())")
        Text("Host organization: \(invitation.organizationName)").foregroundStyle(.secondary)
        Text("Accepting joins this channel only. You will not become a member of the host organization.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      if let error = model.responseError {
        Text(error).font(.callout).foregroundStyle(.red)
      }
      HStack {
        Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        respondButton("Decline", action: .decline)
        respondButton("Accept", action: .accept)
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
      }
    }
  }

  private func respondButton(_ title: String, action: InvitationAction) -> some View {
    Button {
      Task {
        if await model.respond(action, using: respond) {
          dismiss()
        }
      }
    } label: {
      HStack(spacing: 6) {
        if model.responding == action {
          ProgressView().controlSize(.small)
        }
        Text(title)
      }
    }
  }
}

/// Web's accepted / declined / revoked card: a tinted circle symbol, centered title and message, one full-width action.
struct InviteOutcomeCard: View {
  let symbol: String
  let tint: Color
  let title: String
  let message: String
  let button: String
  let action: () -> Void

  var body: some View {
    VStack(spacing: 16) {
      Text("Channel invitation").font(.title2).fontWeight(.semibold).frame(maxWidth: .infinity, alignment: .leading)
      Image(systemName: symbol)
        .font(.title)
        .foregroundStyle(tint)
        .frame(width: 64, height: 64)
        .background(tint.opacity(0.15), in: Circle())
        .accessibilityHidden(true)
      Text(title).font(.title2).fontWeight(.light).multilineTextAlignment(.center)
      Text(message).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
      Button(button, action: action)
        .frame(maxWidth: .infinity)
        .keyboardShortcut(.defaultAction)
    }
  }
}

/// Web `ChatRoomInvitationErrorCard` and `ChatJoinInvalidCard`: destructive title, explanation and a way back.
struct InviteErrorCard: View {
  let title: String
  let description: String
  var content: String?
  var button = "Back to chat"
  let action: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Label(title, systemImage: "exclamationmark.circle")
        .font(.title2)
        .fontWeight(.semibold)
        .foregroundStyle(.red)
      Text(description).foregroundStyle(.secondary)
      if let content {
        Text(content).font(.callout).foregroundStyle(.secondary)
      }
      Button(button, action: action)
        .frame(maxWidth: .infinity)
        .keyboardShortcut(.cancelAction)
        .padding(.top, 4)
    }
  }
}
