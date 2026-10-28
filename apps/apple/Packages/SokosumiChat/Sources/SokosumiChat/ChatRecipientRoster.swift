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

public extension ChatRecipientTarget {
  /// Web's Message yourself entry (`create-direct-dialog.tsx`:53-64): the reader's own id, named for what it does,
  /// with "You · {name}" under it and the reader's avatar. Choosing it opens the reader's Self Direct.
  static func messageYourself(userId: String, name: String, imageURL: String?) -> ChatRecipientTarget {
    .init(id: .human(userId), name: "Message yourself", detail: "You · \(name)", imageURL: imageURL)
  }
}

public struct ChatRecipientRoster: Equatable, Sendable {
  public let targets: [ChatRecipientTarget]
  /// The humans could not be loaded: the Organization's members for a Channel, the reader's people for a Direct (web
  /// `membersLoadFailed` / `peopleLoadFailed`).
  public let humansLoadFailed: Bool
  /// Nobody but the reader could be loaded, so Message yourself is the one target (web's catch in
  /// `loadChatComposeRosterAction`).
  public let recipientsLoadFailed: Bool

  public init(targets: [ChatRecipientTarget], humansLoadFailed: Bool = false, recipientsLoadFailed: Bool = false) {
    self.targets = targets
    self.humansLoadFailed = humansLoadFailed
    self.recipientsLoadFailed = recipientsLoadFailed
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
  /// The New chat roster: Message yourself first (nil without a signed-in reader), then everyone else but the reader.
  /// People are everyone the reader shares an Organization or External channel with, whatever the workspace.
  func directRecipients(client: Client, yourself: ChatRecipientTarget?, organizationSlug: String?) async throws -> ChatRecipientRoster {
    let roster: ChatRecipientRoster
    do {
      roster = try await recipients(client: client, organizationSlug: organizationSlug) { try await chatPeople(client: client) }
    } catch {
      // Web keeps Message yourself whatever else fails; a 401 still ends the session and a cancel stays one.
      guard let yourself, !(error is CancellationError), !Task.isCancelled else { throw error }
      if case ChatServiceError.unauthorized = error {
        throw error
      }
      return .init(targets: [yourself], humansLoadFailed: true, recipientsLoadFailed: true)
    }
    let others = roster.targets.filter { $0.id != yourself?.id }
    return .init(targets: (yourself.map { [$0] } ?? []) + others, humansLoadFailed: roster.humansLoadFailed)
  }

  /// The Channel roster: the active Organization's members, its coworkers and the reader's assistant.
  func chatRecipients(client: Client, organizationId: String?, organizationSlug: String?) async throws -> ChatRecipientRoster {
    try await recipients(client: client, organizationSlug: organizationSlug) {
      try await chatMembers(client: client, organizationId: organizationId)
    }
  }

  private func recipients(
    client: Client, organizationSlug: String?, humans: @Sendable () async throws -> ChatRecipientRoster
  ) async throws -> ChatRecipientRoster {
    async let coworkers = chatCoworkers(client: client, organizationSlug: organizationSlug)
    async let bot = chatAssistant(client: client, organizationSlug: organizationSlug)
    async let members = humans()
    let (people, agents, assistant) = try await (members, coworkers, bot)
    try Task.checkCancellation()
    return ChatRecipientRoster(targets: people.targets + agents + assistant, humansLoadFailed: people.humansLoadFailed)
  }

  private func chatCoworkers(client: Client, organizationSlug: String?) async throws -> [ChatRecipientTarget] {
    let value = try await call {
      try await client.getCoworkers(.init(
        query: .init(scope: .available, capability: [.chat]),
        headers: .init(xOrganizationSlug: organizationSlug)
      ))
    }.ok
    return try value.body.json.data.filter {
      $0.archivedAt == nil && $0.capabilities.contains(.chat)
        && !($0.baseURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }.map {
      ChatRecipientTarget(id: .coworker($0.id), name: $0.name, detail: $0.caption ?? "@\($0.slug)", imageURL: $0.image, slug: $0.slug)
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

  private func chatPeople(client: Client) async throws -> ChatRecipientRoster {
    try await softHumans {
      try await call { try await client.listChatPeople() }.ok.body.json.data.map {
        ChatRecipientTarget(id: .human($0.id), name: $0.name.isEmpty ? $0.email : $0.name, detail: $0.email, imageURL: $0.image)
      }
    }
  }

  private func chatMembers(client: Client, organizationId: String?) async throws -> ChatRecipientRoster {
    guard let organizationId else { return .init(targets: []) }
    return try await softHumans {
      try await call { try await client.getOrganizationsIdMembers(.init(path: .init(id: organizationId))) }.ok.body.json.data.map {
        ChatRecipientTarget(
          id: .human($0.user.id), name: $0.user.name.isEmpty ? $0.user.email : $0.user.name,
          detail: $0.user.email, imageURL: $0.user.image
        )
      }
    }
  }

  /// People failing leaves AI recipients usable (`humansLoadFailed`); a 401 still ends the session.
  private func softHumans(_ load: () async throws -> [ChatRecipientTarget]) async throws -> ChatRecipientRoster {
    do {
      let targets = try await load()
      try Task.checkCancellation()
      return .init(targets: targets)
    } catch let error as ChatServiceError {
      try Task.checkCancellation()
      if case .unauthorized = error {
        throw error
      }
      return .init(targets: [], humansLoadFailed: true)
    }
  }
}
