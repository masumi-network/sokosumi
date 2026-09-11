import CoreAPI
import Foundation

/// Participant details supplied by Core, shared by author and mention presentation.
public struct ChatParticipantProfile: Equatable, Sendable, Identifiable {
  public var id: DirectRecipient {
    recipient
  }

  public let name: String
  public let detail: String?
  public let image: String?
  public let presence: String
  public let recipient: DirectRecipient

  public init?(sender: Components.Schemas.ChatRoomMessageSender) {
    switch sender {
    case let .case1(value):
      name = value.user.name.isEmpty ? value.user.email : value.user.name
      detail = value.user.email
      image = value.user.image
      presence = value.user.presence.rawValue
      recipient = .human(value.user.id)
    case let .case2(value):
      name = value.coworker.name
      let caption = value.coworker.caption?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      detail = caption.isEmpty ? "@" + value.coworker.slug : caption
      image = value.coworker.image
      presence = value.coworker.presence.rawValue
      recipient = .coworker(value.coworker.id)
    case let .case3(value):
      name = value.sokoBot.name
      detail = value.sokoBot.caption?.trimmingCharacters(in: .whitespacesAndNewlines)
      image = value.sokoBot.image
      presence = value.sokoBot.presence.rawValue
      recipient = .sokoBot(value.sokoBot.id)
    case .case4: return nil
    }
  }

  public static func resolving(_ url: URL, in room: Components.Schemas.ChatRoom) -> Self? {
    guard url.scheme == "sokosumi-participant", let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let id = components.queryItems?.first(where: { $0.name == "id" })?.value else { return nil }
    switch url.host {
    case "human":
      guard let user = room.userMembers.first(where: { $0.id == id }) else { return nil }
      return Self(sender: .case1(.init(_type: .user, user: user)))
    case "coworker":
      guard let coworker = room.coworkerMembers.first(where: { $0.id == id }) else { return nil }
      return Self(sender: .case2(.init(_type: .coworker, coworker: coworker)))
    case "sokobot":
      guard let bot = room.sokoBotMembers.first(where: { $0.id == id }) else { return nil }
      return Self(sender: .case3(.init(_type: .sokoBot, sokoBot: bot)))
    default: return nil
    }
  }
}
