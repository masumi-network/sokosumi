import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

struct ParticipantDetailsView: View {
  let profile: ChatParticipantProfile
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState
  @Environment(\.dismiss) private var dismiss
  @State private var errorMessage: String?

  var body: some View {
    let presence = workspaces.presence(for: profile)
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 12) {
        ParticipantAvatar(imageURL: profile.image, name: profile.name, size: 48)
          .presenceBadge(presence, size: 12)
        VStack(alignment: .leading, spacing: 4) {
          Text(profile.name).font(.headline)
          Text(kindLabel(profile.recipient)).font(.caption).foregroundStyle(.secondary)
          // Web's hover card writes availability out for humans only; AI members
          // are pinned online and the mark already says so.
          if case .human = profile.recipient {
            Text(presenceLabel(presence)).font(.caption).fontWeight(.medium)
          }
          if let detail = profile.detail, !detail.isEmpty {
            Text(detail).font(.callout).textSelection(.enabled)
          }
        }
      }
      if let errorMessage {
        Text(errorMessage).font(.callout).foregroundStyle(.red)
      }
      if workspaces.canOpenDirect(profile.recipient) {
        Button("Message", systemImage: "bubble.left") {
          errorMessage = nil
          Task { @MainActor in
            do {
              if try await workspaces.openParticipantDirect(profile.recipient, auth: auth) {
                dismiss()
              }
            } catch { errorMessage = friendlyMessage(for: error) }
          }
        }
        .disabled(workspaces.openingDirect != nil)
      }
    }
    .padding()
    .frame(minWidth: 240, idealWidth: 280, maxWidth: 360, alignment: .leading)
  }

  private func kindLabel(_ recipient: DirectRecipient) -> String {
    switch recipient {
    case .human: "Person"
    case .coworker: "Coworker"
    case .sokoBot: "Personal assistant"
    }
  }
}
