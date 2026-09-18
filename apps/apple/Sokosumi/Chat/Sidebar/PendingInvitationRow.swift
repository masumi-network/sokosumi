import CoreAPI
import SokosumiChat
import SwiftUI

/// Web External pending rows (`organization-chat-list.client.tsx`): globe, channel name, host organization and
/// Accept / Decline. Every row disables while one response runs; the pressed button reads "Loading…" like web.
/// Rows are not selectable; the room appears as a normal External row once the invitation is accepted.
struct PendingInvitationRow: View {
  let invitation: Components.Schemas.ChatRoomInvitation
  /// This row's running action, if any.
  let responding: InvitationAction?
  let busy: Bool
  let respond: (InvitationAction) -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "globe")
        .foregroundStyle(.secondary)
        .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(invitation.roomName)
          .fontWeight(.medium)
          .lineLimit(1)
        Text(invitation.organizationName)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
        HStack(spacing: 6) {
          Button(responding == .accept ? "Loading…" : "Accept") { respond(.accept) }
            .buttonStyle(.borderedProminent)
          Button(responding == .decline ? "Loading…" : "Decline") { respond(.decline) }
            .buttonStyle(.bordered)
        }
        .controlSize(.small)
        .disabled(busy)
        .padding(.top, 4)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
    .selectionDisabled()
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Invitation to \(invitation.roomName) from \(invitation.organizationName)")
  }
}
