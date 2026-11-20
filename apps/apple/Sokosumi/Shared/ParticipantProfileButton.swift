import CoreAPI
import SokosumiChat
import SwiftUI

struct ParticipantProfileButton<Label: View>: View {
  let sender: Components.Schemas.ChatRoomMessageSender
  var showsAgentMark = false
  @ViewBuilder let label: () -> Label
  @State private var isPresented = false
  @ScaledMetric(relativeTo: .body) private var markSize: CGFloat = 14

  var body: some View {
    if let profile = ChatParticipantProfile(sender: sender) {
      Button { isPresented.toggle() } label: {
        if showsAgentMark, profile.recipient.aiKindLabel != nil {
          HStack(spacing: 4) {
            Image(.agentMark).resizable().scaledToFit()
              .frame(width: markSize, height: markSize)
              .foregroundStyle(.secondary)
            label()
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(Text("\(profile.name) (AI agent)", tableName: "ChatSokoBot"))
        } else {
          label()
        }
      }
      .buttonStyle(.plain)
      .help("Show participant details")
      .popover(isPresented: $isPresented) { ParticipantDetailsView(profile: profile) }
    } else {
      label()
    }
  }
}
