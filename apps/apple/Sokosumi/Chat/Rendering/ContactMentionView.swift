import CoreAPI
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

enum MessageProfile: Identifiable {
  case participant(ChatParticipantProfile)
  case contact(ContactMention, UUID)

  enum Identity: Hashable {
    case participant(DirectRecipient)
    case contact(URL, UUID)
  }

  var id: Identity {
    switch self {
    case let .participant(profile): .participant(profile.id)
    case let .contact(mention, context): .contact(mention.url, context)
    }
  }
}

struct ContactMentionView: View {
  let mention: ContactMention
  let context: UUID
  let openInContacts: (URL) -> Void
  @EnvironmentObject private var workspaces: WorkspaceState
  @Environment(\.dismiss) private var dismiss
  @State private var details: ContactMentionDetails?

  var body: some View {
    ContactMentionCard(details: context == workspaces.compositionContext ? details : .unavailable) { url in
      guard context == workspaces.compositionContext else { return }
      dismiss()
      openInContacts(url)
    }
    .task {
      do {
        details = try await workspaces.contactMentionDetails(mention, context: context)
      } catch {
        guard !Task.isCancelled else { return }
        details = .unavailable
      }
    }
    .onChange(of: workspaces.compositionContext) { dismiss() }
  }
}

struct ContactMentionCard: View {
  let details: ContactMentionDetails?
  let openInContacts: (URL) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      switch details {
      case let .available(contact, url):
        HStack(alignment: .top, spacing: 12) {
          ParticipantAvatar(imageURL: nil, name: contact.name, size: 48)
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: contact.name).font(.headline).accessibilityAddTraits(.isHeader)
            if let role = contact.role, !role.isEmpty {
              Text(verbatim: role).font(.callout).foregroundStyle(.secondary)
            }
            if let organization = contact.organization, !organization.isEmpty {
              Text(verbatim: organization).font(.callout).foregroundStyle(.secondary)
            }
            if let email = contact.channels.first(where: { $0._type == .email && $0.isPrimary }) ?? contact.channels.first(where: { $0._type == .email }) {
              Text(verbatim: email.value).font(.callout).textSelection(.enabled)
            }
          }
        }
        openButton(url)
      case let .otherWorkspace(url):
        Text("This link opens another workspace.", tableName: "ChatContacts")
        openButton(url)
      case let .merged(url):
        Text("This contact has been merged.", tableName: "ChatContacts")
        openButton(url)
      case .unavailable:
        Text("Contact details unavailable.", tableName: "ChatContacts")
      case nil:
        ProgressView { Text("Loading contact…", tableName: "ChatContacts") }
          .controlSize(.small)
      }
    }
    .padding()
    .frame(minWidth: 240, idealWidth: 280, maxWidth: 360, alignment: .leading)
  }

  private func openButton(_ url: URL) -> some View {
    Button {
      openInContacts(url)
    } label: {
      Text("Open in Contacts", tableName: "ChatContacts")
    }
  }
}
