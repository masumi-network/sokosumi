import Foundation

/// A chat destination on the configured web origin: a room (optionally a message), a channel invitation page or a
/// guest join link. Other product URLs stay on web.
public enum ChatLink: Equatable, Sendable {
  case room(id: String, messageId: String?)
  case invitation(id: String)
  case guestJoin(token: String)

  public init?(url: URL, webBaseURL: URL) {
    guard let target = URLComponents(url: url, resolvingAgainstBaseURL: true),
          let base = URLComponents(url: webBaseURL, resolvingAgainstBaseURL: true),
          target.scheme?.lowercased() == base.scheme?.lowercased(), target.host?.lowercased() == base.host?.lowercased(), target.port == base.port,
          target.user == nil, target.password == nil else { return nil }
    let path = target.path.hasSuffix("/") ? String(target.path.dropLast()) : target.path
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 4, parts[0].isEmpty, parts[1] == "chat", !parts[3].isEmpty else { return nil }
    let value = String(parts[3])
    switch parts[2] {
    case "rooms":
      let message = target.queryItems?.first(where: { $0.name == "message" })?.value?.trimmingCharacters(in: .whitespacesAndNewlines)
      self = .room(id: value, messageId: message?.isEmpty == false ? message : nil)
    case "invites":
      self = .invitation(id: value)
    case "join":
      self = .guestJoin(token: value)
    default:
      return nil
    }
  }

  /// Inverse of `init?(url:webBaseURL:)`. Blank `messageId` is omitted.
  public static func href(roomId: String, messageId: String?, webBaseURL: URL) -> URL? {
    guard var components = URLComponents(url: webBaseURL, resolvingAgainstBaseURL: false) else {
      return nil
    }
    let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
    components.path = "\(basePath)/chat/rooms/\(roomId)"
    let trimmed = messageId?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let trimmed, !trimmed.isEmpty {
      components.queryItems = [URLQueryItem(name: "message", value: trimmed)]
    } else {
      components.queryItems = nil
    }
    return components.url
  }
}
