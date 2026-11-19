import CoreAPI

public extension ChatService {
  func contact(client: Client, id: String, organizationSlug: String?) async throws -> Components.Schemas.Contact {
    try await call {
      try await client.getContactsId(.init(path: .init(id: id), headers: .init(xOrganizationSlug: organizationSlug)))
    }.ok.body.json.data.value1
  }
}
