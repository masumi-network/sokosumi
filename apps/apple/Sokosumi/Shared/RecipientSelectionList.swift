import SokosumiChat
import SwiftUI

/// Searchable people / AI coworker / assistant toggles shared by channel creation and editing.
/// The current user stays selected and disabled, matching web's locked checkbox.
struct RecipientSelectionList: View {
  let sections: [ChatRecipientSection]
  let currentUserId: String
  @Binding var query: String
  @Binding var selection: Set<DirectRecipient>
  /// Web `participant-checkboxes.tsx`: a failed member page puts its notice where the People toggles go, and the
  /// other sections stay.
  var membersLoadFailed = false
  var retryMembers: () -> Void = {}

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      TextField("Search participants", text: $query)
      list
      Text("You are always included in the channel.").font(.caption).foregroundStyle(.secondary)
    }
  }

  private var list: some View {
    List {
      if membersLoadFailed {
        Section(sectionTitle(.people)) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Members could not be loaded").fontWeight(.medium)
            Text("Organization members are temporarily unavailable. Try again in a moment.").font(.caption).foregroundStyle(.secondary)
            Button("Retry", action: retryMembers).padding(.top, 4)
          }
          .listRowSeparator(.hidden)
        }
      }
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
      if sections.isEmpty, !membersLoadFailed {
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
    case .public: "Anyone in the organization can find and join this channel."
    case .private: "Only invited members can see this channel. Organization owners and admins can still find and join it."
    case .external: "Anyone in the organization can find and join. Outsiders join only by email invite as guests — they are not organization members."
    }
  }
}
