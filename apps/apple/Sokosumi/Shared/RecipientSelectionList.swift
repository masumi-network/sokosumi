import SokosumiChat
import SwiftUI

/// Searchable people / AI coworker / assistant toggles shared by channel creation and editing.
/// The current user stays selected and disabled, matching web's locked checkbox.
struct RecipientSelectionList: View {
  let sections: [ChatRecipientSection]
  let currentUserId: String
  @Binding var query: String
  @Binding var selection: Set<DirectRecipient>

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      TextField("Search participants", text: $query)
      list
      Text("You are always included in the channel.").font(.caption).foregroundStyle(.secondary)
    }
  }

  private var list: some View {
    List {
      ForEach(sections) { section in
        Section(sectionTitle(section.id)) {
          ForEach(section.targets) { target in
            Toggle(isOn: Binding(get: {
              target.id == .human(currentUserId) || selection.contains(target.id)
            }, set: { selected in
              if selected {
                selection.insert(target.id)
              } else {
                selection.remove(target.id)
              }
            })) {
              HStack(spacing: 8) {
                ParticipantAvatar(imageURL: target.imageURL, name: target.name, size: 28)
                VStack(alignment: .leading, spacing: 2) {
                  Text(target.name)
                  if !target.detail.isEmpty {
                    Text(target.detail).font(.caption).foregroundStyle(.secondary)
                  }
                }
              }
            }
            .disabled(target.id == .human(currentUserId))
            .listRowSeparator(.hidden)
          }
        }
      }
      if sections.isEmpty {
        Text("No matching participants").foregroundStyle(.secondary)
      }
    }
    .listStyle(.plain)
    .frame(height: 240)
  }

  private func sectionTitle(_ kind: ChatRecipientSection.Kind) -> LocalizedStringKey {
    switch kind {
    case .people: "People"
    case .coworkers: "AI coworkers"
    case .assistant: "Personal assistant"
    }
  }
}

extension ChannelDraft.Visibility {
  var help: String {
    switch self {
    case .public: "People in your organization can find and join this channel."
    case .private: "Only invited members can see this channel. Organization owners and admins can find and join it."
    case .external: "People in your organization can join. Guests need an invitation."
    }
  }
}
