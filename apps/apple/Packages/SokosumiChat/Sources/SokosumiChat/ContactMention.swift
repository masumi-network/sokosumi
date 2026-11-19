import Foundation

/// A contact URL on the web origin already checked by ChatLink. Older messages may omit the workspace.
public struct ContactMention: Equatable, Sendable {
  public let id: String
  public let workspaceId: String?
  public let url: URL

  init?(_ target: URLComponents) {
    guard target.percentEncodedPath == "/contacts", target.fragment == nil, let items = target.queryItems,
          let contactId = Self.identifier("contact", in: items), let url = target.url else { return nil }
    let workspaceId = Self.identifier("workspace", in: items)
    guard items.count == (workspaceId == nil ? 1 : 2) else { return nil }
    id = contactId
    self.workspaceId = workspaceId
    self.url = url
  }

  public func scopedURL(contactId: String, workspaceId: String) -> URL? {
    guard let contact = UUID(uuidString: contactId), let workspace = UUID(uuidString: workspaceId),
          var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    components.queryItems = [.init(name: "contact", value: contact.uuidString.lowercased()),
                             .init(name: "workspace", value: workspace.uuidString.lowercased())]
    return components.url
  }

  private static func identifier(_ name: String, in items: [URLQueryItem]) -> String? {
    guard let value = items.first(where: { $0.name == name })?.value,
          let uuid = UUID(uuidString: value) else { return nil }
    return uuid.uuidString.lowercased()
  }
}
