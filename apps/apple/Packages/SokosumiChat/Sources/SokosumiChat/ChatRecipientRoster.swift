import CoreAPI
import Foundation

public struct ChatRecipientTarget: Identifiable, Equatable, Sendable {
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

public struct ChatRecipientSection: Identifiable, Equatable, Sendable {
  public enum Kind: CaseIterable, Sendable {
    case coworkers, people, assistant
  }

  public let id: Kind
  public let targets: [ChatRecipientTarget]
}

public struct ChatRecipientRoster: Equatable, Sendable {
  public let targets: [ChatRecipientTarget]
  public let membersLoadFailed: Bool

  public init(targets: [ChatRecipientTarget], membersLoadFailed: Bool = false) {
    self.targets = targets
    self.membersLoadFailed = membersLoadFailed
  }

  public func sections(query: String, excluding: Set<DirectRecipient> = []) -> [ChatRecipientSection] {
    let matches = matchingTargets(query: query).filter { !excluding.contains($0.id) }
    return ChatRecipientSection.Kind.allCases.compactMap { kind in
      let targets = matches.filter { target in
        switch (kind, target.id) {
        case (.coworkers, .coworker), (.people, .human), (.assistant, .sokoBot): true
        default: false
        }
      }
      return targets.isEmpty ? nil : ChatRecipientSection(id: kind, targets: targets)
    }
  }

  private func matchingTargets(query: String) -> [ChatRecipientTarget] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return targets.filter {
      query.isEmpty || [$0.name, $0.detail, $0.slug].joined(separator: " ").lowercased().contains(query)
    }
  }
}

public extension ChatService {
  func directRecipients(client: Client, currentUserId: String, organizationId: String?, organizationSlug: String?) async throws -> ChatRecipientRoster {
    let roster = try await chatRecipients(client: client, organizationId: organizationId, organizationSlug: organizationSlug)
    return .init(targets: roster.targets.filter { $0.id != .human(currentUserId) }, membersLoadFailed: roster.membersLoadFailed)
  }

  func chatRecipients(client: Client, organizationId: String?, organizationSlug: String?) async throws -> ChatRecipientRoster {
    async let coworkers = chatCoworkers(client: client, organizationSlug: organizationSlug)
    async let bot = chatAssistant(client: client, organizationSlug: organizationSlug)
    async let members = chatMembers(client: client, organizationId: organizationId)
    let (people, agents, assistant) = try await (members, coworkers, bot)
    try Task.checkCancellation()
    return ChatRecipientRoster(targets: people.targets + agents + assistant, membersLoadFailed: people.membersLoadFailed)
  }

  private func chatCoworkers(client: Client, organizationSlug: String?) async throws -> [ChatRecipientTarget] {
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
        ChatRecipientTarget(id: .coworker($0.id), name: $0.name, detail: $0.caption ?? "@\($0.slug)", imageURL: $0.image, slug: $0.slug)
      }
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .unprocessableContent(value): throw try rejected(status: 422, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  private func chatAssistant(client: Client, organizationSlug: String?) async throws -> [ChatRecipientTarget] {
    // Web treats the personal assistant as optional, including when its endpoint is unavailable.
    let response = try? await client.getMySokoBot(.init(headers: .init(xOrganizationSlug: organizationSlug)))
    try Task.checkCancellation()
    guard case let .ok(value) = response, let bot = try value.body.json.data.sokoBot else { return [] }
    let name = (bot.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return [.init(id: .sokoBot(bot.id), name: name.isEmpty ? "Personal assistant" : name, imageURL: bot.avatarImageUrl)]
  }

  private func chatMembers(client: Client, organizationId: String?) async throws -> ChatRecipientRoster {
    guard let organizationId else { return .init(targets: []) }
    let response = try await client.getOrganizationsIdMembers(.init(path: .init(id: organizationId)))
    try Task.checkCancellation()
    switch response {
    case let .ok(value):
      let targets = try value.body.json.data.map {
        ChatRecipientTarget(
          id: .human($0.user.id), name: $0.user.name.isEmpty ? $0.user.email : $0.user.name,
          detail: $0.user.email, imageURL: $0.user.image
        )
      }
      return .init(targets: targets)
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case .forbidden, .notFound, .internalServerError, .undocumented:
      return .init(targets: [], membersLoadFailed: true)
    }
  }
}
