import Foundation

/// A chat destination on the configured web origin. Other product URLs stay on web.
public struct ChatLink: Equatable, Sendable {
  public let roomId: String
  public let messageId: String?

  public init?(url: URL, webBaseURL: URL) {
    guard let target = URLComponents(url: url, resolvingAgainstBaseURL: true),
          let base = URLComponents(url: webBaseURL, resolvingAgainstBaseURL: true),
          target.scheme?.lowercased() == base.scheme?.lowercased(), target.host?.lowercased() == base.host?.lowercased(), target.port == base.port,
          target.user == nil, target.password == nil else { return nil }
    let path = target.path.hasSuffix("/") ? String(target.path.dropLast()) : target.path
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 4, parts[0].isEmpty, parts[1] == "chat", parts[2] == "rooms",
          !parts[3].isEmpty else { return nil }
    roomId = String(parts[3])
    let message = target.queryItems?.first(where: { $0.name == "message" })?.value?.trimmingCharacters(in: .whitespacesAndNewlines)
    messageId = message?.isEmpty == false ? message : nil
  }
}
