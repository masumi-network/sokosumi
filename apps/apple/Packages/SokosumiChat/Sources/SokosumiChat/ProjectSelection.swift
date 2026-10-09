import CoreAPI
import CryptoKit
import Foundation

/// The reply a project pick sends a Soko Bot (web `project-selection-message.tsx`, #5806; row 38h1), read back from
/// any message's text so the room and the Thread draw it as the chosen project's chip, old messages included.
public struct ProjectSelectionReply: Equatable, Sendable {
  public let projectId: String
  public let name: String

  public init(projectId: String, name: String) {
    self.projectId = projectId
    self.name = name
  }

  /// Web `readProjectSelectionReply`: exactly `Use project "<JSON name>" (project ID: <UUID>).`, or that line after
  /// the personal assistant's two continuation lines; anything else is an ordinary message.
  public init?(content: String) {
    let lines = content.components(separatedBy: "\n")
    if lines.count == 3 {
      for (line, prefix) in zip(lines, ["Continue this request: ", "Your question: "]) {
        guard line.hasPrefix(prefix), Self.decodeJSONString(line.dropFirst(prefix.count)) != nil else { return nil }
      }
    } else if lines.count != 1 {
      return nil
    }
    let line = lines[lines.count - 1]
    guard let match = Self.pattern.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
          let quoted = Range(match.range(at: 1), in: line), let id = Range(match.range(at: 2), in: line),
          let name = Self.decodeJSONString(line[quoted]),
          !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    self.init(projectId: String(line[id]), name: name)
  }

  /// The text web sends for a pick: the name as JSON, so quotes and line breaks stay inside the one line.
  public static func content(projectId: String, name: String) -> String {
    "Use project \(ProjectSelection.json(name)) (project ID: \(projectId))."
  }

  /// The chip's avatar: the reply names no logo, so web draws the initial.
  public var mark: ResultPreviewCard.ProjectMark {
    .init(name: name, logoURL: nil)
  }

  /// Web's regex, `i` flag included; `\z` because ICU's `$` would also match before a trailing `\r`.
  private static let pattern = try! NSRegularExpression( // swiftlint:disable:this force_try
    pattern: #"^Use project ("(?:[^"\\]|\\.)*") \(project ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\.\z"#,
    options: .caseInsensitive
  )

  /// Web `JSON.parse(…)` that must give a string.
  private static func decodeJSONString(_ text: Substring) -> String? {
    try? JSONDecoder().decode(String.self, from: Data(text.utf8))
  }
}

/// Picking an option of a `project_selection` result (web `selectChatProjectAction`, row 38h1).
public enum ProjectSelection {
  /// Web `JSON.stringify` for a string: quotes, backslashes and control characters escaped, everything else
  /// (`/` and non-ASCII included) literal.
  static func json(_ string: String) -> String {
    var out = "\""
    for scalar in string.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      case _ where scalar.value < 0x20: out += String(format: "\\u%04x", scalar.value)
      default: out.unicodeScalars.append(scalar)
      }
    }
    return out + "\""
  }

  /// The page of a project on web (`/projects/{id}`), where the chip links.
  public static func projectURL(projectId: String, webBaseURL: URL) -> URL? {
    var segment = CharacterSet.urlPathAllowed
    segment.remove("/")
    guard let id = projectId.addingPercentEncoding(withAllowedCharacters: segment) else { return nil }
    return MessageResultPreviews.webURL(forLocalHref: "/projects/\(id)", webBaseURL: webBaseURL)
  }

  /// Web's `cmdk` search over the options: Apple keeps Core's order and matches the name, ignoring case and accents.
  public static func options(_ options: [ResultPreviewCard.ProjectOption], matching query: String) -> [ResultPreviewCard.ProjectOption] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return query.isEmpty ? options : options.filter { $0.name.localizedStandardContains(query) }
  }

  /// The reply for `projectId`, only while Core still offers it on the card `previewId` names (web re-reads the
  /// results so a stale or forged option never reaches the bot).
  static func verifiedReply(in previews: [Components.Schemas.ChatResultPreview], previewId: String, projectId: String) -> String? {
    for case let .available(result) in previews where result.id == previewId && result.kind == .projectSelection {
      if let option = result.projectOptions?.first(where: { $0.id == projectId }) {
        return ProjectSelectionReply.content(projectId: option.id, name: option.name)
      }
    }
    return nil
  }

  /// Web's idempotency key: a retry or a second click of the same choice reuses the message id, so Core keeps one
  /// reply (unique on room and `clientMessageId`). The same choice on web and here gives the same id.
  public static func clientMessageId(userId: String, roomId: String, messageId: String, previewId: String, projectId: String) -> String {
    let source = "[" + [json("room"), json(roomId), json(messageId)].joined(separator: ",") + "]"
    let payload = "[" + [json(userId), source, json(previewId), json(projectId)].joined(separator: ",") + "]"
    let hex = SHA256.hash(data: Data(payload.utf8)).map { String(format: "%02x", $0) }.joined()
    func part(_ start: Int, _ end: Int) -> Substring {
      hex.dropFirst(start).prefix(end - start)
    }
    return "\(part(0, 8))-\(part(8, 12))-5\(part(13, 16))-a\(part(17, 20))-\(part(20, 32))"
  }
}

public extension ChatService {
  // swiftlint:disable function_parameter_count
  /// Web `selectChatProjectAction` for a room or Thread message: re-read the message's results, check the option is
  /// still offered, then reply to the bot that asked with its quote and mention, in its Thread when it asked there.
  func selectProject(client: Client, question message: Components.Schemas.ChatRoomMessage, previewId: String, projectId: String,
                     userId: String, organizationSlug: String?) async throws -> Components.Schemas.ChatRoomMessage {
    let unavailable = ChatServiceError.unexpectedResponse("Project selection unavailable")
    guard case let .case3(sender) = message.sender else { throw unavailable }
    let previews = try await messageResults(client: client, roomId: message.roomId, messageId: message.id, organizationSlug: organizationSlug)
    guard let content = ProjectSelection.verifiedReply(in: previews, previewId: previewId, projectId: projectId) else { throw unavailable }
    let bot = ComposerMention(id: sender.sokoBot.id, name: sender.sokoBot.name, slug: "", kind: .sokoBot)
    return try await createMessage(
      client: client, roomId: message.roomId, content: content,
      clientMessageId: ProjectSelection.clientMessageId(userId: userId, roomId: message.roomId, messageId: message.id,
                                                        previewId: previewId, projectId: projectId),
      parentMessageId: message.parentMessageId, mentions: [bot],
      // Core builds the quote from the id; the rest is the local preview's.
      quote: .init(messageId: message.id, authorName: sender.sokoBot.name, snippet: ""),
      organizationSlug: organizationSlug
    )
  }
  // swiftlint:enable function_parameter_count
}
