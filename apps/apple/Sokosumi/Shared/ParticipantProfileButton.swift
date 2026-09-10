import CoreAPI
import SokosumiChat
import SwiftUI

struct ParticipantProfileButton<Label: View>: View {
  let sender: Components.Schemas.ChatRoomMessageSender
  @ViewBuilder let label: () -> Label
  @State private var isPresented = false

  var body: some View {
    if let profile = ChatParticipantProfile(sender: sender) {
      Button { isPresented.toggle() } label: { label() }
        .buttonStyle(.plain)
        .help("Show participant details")
        .popover(isPresented: $isPresented) { ParticipantDetailsView(profile: profile) }
    } else {
      label()
    }
  }
}
