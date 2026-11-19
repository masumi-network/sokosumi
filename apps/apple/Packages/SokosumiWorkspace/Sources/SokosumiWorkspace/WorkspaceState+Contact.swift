import CoreAPI
import Foundation
import SokosumiChat

public enum ContactMentionDetails: Sendable {
  case available(Components.Schemas.Contact, URL)
  case otherWorkspace(URL)
  case merged(URL)
  case unavailable
}

public extension WorkspaceState {
  func contactMentionDetails(_ mention: ContactMention, context: UUID) async throws -> ContactMentionDetails {
    guard let selection, context == collectionsLoadContext else { return .unavailable }
    if let workspaceId = mention.workspaceId, workspaceId != selection.workspaceId {
      return options.contains { $0.workspaceId == workspaceId } ? .otherWorkspace(mention.url) : .unavailable
    }
    return try await workspaceOperation(context: context) { client, slug in
      let contact = try await service.contact(client: client, id: mention.id, organizationSlug: slug)
      guard contact.id == mention.id, let url = mention.scopedURL(contactId: contact.mergedIntoId ?? contact.id,
                                                                  workspaceId: selection.workspaceId) else { return .unavailable }
      return contact.mergedIntoId == nil ? .available(contact, url) : .merged(url)
    }
  }
}
