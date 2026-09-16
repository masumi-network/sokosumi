import CoreAPI
import Foundation

public struct DirectRecipientTarget: Identifiable, Equatable, Sendable {
  public let id: DirectRecipient
  public let name: String
  public let detail: String
  public let imageURL: String?
  public let slug: String

  public init(id: DirectRecipient, name: String, detail: String = "", imageURL: String? = nil, slug: String = "") {
    self.id = id
    self.name = name
    self.detail = detail
    self.imageURL = imageURL
    self.slug = slug
  }
}

public struct DirectRecipientRoster: Equatable, Sendable {
  public let targets: [DirectRecipientTarget]
  public let membersLoadFailed: Bool

  public init(targets: [DirectRecipientTarget], membersLoadFailed: Bool = false) {
    self.targets = targets
    self.membersLoadFailed = membersLoadFailed
  }

  public func candidates(query: String, selection: DirectConversationSelection) -> [DirectRecipientTarget] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return targets.filter {
      !selection.recipients.contains($0.id)
        && (query.isEmpty || [$0.name, $0.detail, $0.slug].joined(separator: " ").lowercased().contains(query))
    }
  }
}

public extension ChatService {
  func directRecipients(client: Client, currentUserId: String, organizationId: String?, organizationSlug: String?) async throws -> DirectRecipientRoster {
    async let coworkers = directCoworkers(client: client, organizationSlug: organizationSlug)
    async let bot = directAssistant(client: client, organizationSlug: organizationSlug)
    async let members = directMembers(client: client, organizationId: organizationId, currentUserId: currentUserId)
    let (people, agents, assistant) = try await (members, coworkers, bot)
    try Task.checkCancellation()
    return DirectRecipientRoster(targets: people.targets + agents + assistant, membersLoadFailed: people.membersLoadFailed)
  }

  private func directCoworkers(client: Client, organizationSlug: String?) async throws -> [DirectRecipientTarget] {
    let response = try await client.getCoworkers(.init(
      query: .init(scope: .available, capability: [.chat]),
      headers: .init(xOrganizationSlug: organizationSlug)
    ))
    switch response {
    case let .ok(value):
      return try value.body.json.data.filter {
        $0.archivedAt == nil && $0.capabilities.contains(.chat)
          && !($0.baseURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      }.map {
        DirectRecipientTarget(id: .coworker($0.id), name: $0.name, detail: $0.caption ?? "@\($0.slug)", imageURL: $0.image, slug: $0.slug)
      }
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .unprocessableContent(value): throw try ChatServiceError.unprocessable(statusCode: 422, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  private func directAssistant(client: Client, organizationSlug: String?) async throws -> [DirectRecipientTarget] {
    // Web treats the personal assistant as optional, including when its endpoint is unavailable.
    let response = try? await client.getMySokoBot(.init(headers: .init(xOrganizationSlug: organizationSlug)))
    try Task.checkCancellation()
    guard case let .ok(value) = response, let bot = try value.body.json.data.sokoBot else { return [] }
    let name = (bot.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return [.init(id: .sokoBot(bot.id), name: name.isEmpty ? "Personal assistant" : name, imageURL: bot.avatarImageUrl)]
  }

  private func directMembers(client: Client, organizationId: String?, currentUserId: String) async throws -> DirectRecipientRoster {
    guard let organizationId else { return .init(targets: []) }
    let response = try await client.getOrganizationsIdMembers(.init(path: .init(id: organizationId)))
    try Task.checkCancellation()
    switch response {
    case let .ok(value):
      let targets = try value.body.json.data.filter { $0.user.id != currentUserId }.map {
        DirectRecipientTarget(
          id: .human($0.user.id), name: $0.user.name.isEmpty ? $0.user.email : $0.user.name,
          detail: $0.user.email, imageURL: $0.user.image
        )
      }
      return .init(targets: targets)
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case .forbidden, .notFound, .internalServerError, .undocumented:
      return .init(targets: [], membersLoadFailed: true)
    }
  }
}
