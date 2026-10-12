import CoreAPI
import Foundation
import OpenAPIRuntime

/// `metadata.soko_bot` on a message a Soko Bot turn produced (web
/// `readSokoBotMetadata`): the turn to rate, the approvals it still waits on
/// and the Tasks it created. Web renders the footer only on settled rows.
public struct SokoBotTurnMetadata: Equatable, Sendable {
  public let turnId: String
  public let pendingDecisionIds: [String]
  public let taskIds: [String]
  /// Set on messages the bot sent on its own (stand-up, ingest, events).
  public let source: String?
  /// The schedule a `SCHEDULE` run belongs to, and its system key (`standup`, `weekly-wrap`, …; nil for one the owner made).
  public let scheduleName: String?
  public let scheduleKey: String?

  public init(turnId: String, pendingDecisionIds: [String] = [], taskIds: [String] = [], source: String? = nil,
              scheduleName: String? = nil, scheduleKey: String? = nil) {
    self.turnId = turnId
    self.pendingDecisionIds = pendingDecisionIds
    self.taskIds = taskIds
    self.source = source
    self.scheduleName = scheduleName
    self.scheduleKey = scheduleKey
  }

  public init?(metadata: [String: OpenAPIValueContainer]?) {
    guard let record = metadata?["soko_bot"]?.value as? [String: Any],
          let turnId = record["turn_id"] as? String else { return nil }
    self.turnId = turnId
    pendingDecisionIds = Self.ids(record["pending_decision_ids"])
    taskIds = Self.ids(record["task_ids"])
    source = record["source"] as? String
    scheduleName = record["schedule_name"] as? String
    scheduleKey = record["schedule_key"] as? String
  }

  public init?(message: Components.Schemas.ChatRoomMessage) {
    self.init(metadata: message.metadata?.additionalProperties)
  }

  public var pendingDecisionCount: Int {
    pendingDecisionIds.count
  }

  /// Web `hasSokoBotMessageFooter`: the footer holds approvals and Tasks only,
  /// so a turn with neither leaves no line under the message (#5554).
  public var hasFooter: Bool {
    !pendingDecisionIds.isEmpty || !taskIds.isEmpty
  }

  /// Web `SokoBotMessageFooter`'s `previewedTaskIds`: a Task whose result card already shows drops its small
  /// Task button (row 38e1).
  public func footerTaskIds(excluding previewed: Set<String>) -> [String] {
    taskIds.filter { !previewed.contains($0) }
  }

  /// The assistant page filtered to this turn (`/personal-assistant?turn=`),
  /// where the pending approvals are resolved. Opens on web.
  public func assistantURL(webBaseURL: URL) -> URL? {
    guard var components = URLComponents(url: webBaseURL, resolvingAgainstBaseURL: false) else { return nil }
    components.percentEncodedPath = Self.basePath(components) + "/personal-assistant"
    components.queryItems = [URLQueryItem(name: "turn", value: turnId)]
    return components.url
  }

  /// A Task the turn created (`/tasks/{id}`). Opens on web.
  public static func taskURL(taskId: String, webBaseURL: URL) -> URL? {
    guard let encoded = taskId.addingPercentEncoding(withAllowedCharacters: uriComponentAllowed) else { return nil }
    return MessageResultPreviews.webURL(forLocalHref: "/tasks/" + encoded, webBaseURL: webBaseURL)
  }

  /// JavaScript `encodeURIComponent`: alphanumerics plus `-_.!~*'()`.
  private static let uriComponentAllowed = CharacterSet.alphanumerics.union(.init(charactersIn: "-_.!~*'()"))

  static func basePath(_ components: URLComponents) -> String {
    let path = components.percentEncodedPath
    return path.hasSuffix("/") ? String(path.dropLast()) : path
  }

  private static func ids(_ value: Any?) -> [String] {
    (value as? [Any])?.compactMap { $0 as? String } ?? []
  }
}

/// Where a message the bot sent on its own came from (web `sokoBotSourceLabel`, #5536): the quiet line
/// above it. Replies in chat carry no `source` and get none.
public enum SokoBotSourceLabel: Equatable, Sendable {
  case inbox
  case standup
  case weeklyWrap
  case scheduled(name: String)
  case taskUpdate

  public init?(turn: SokoBotTurnMetadata) {
    switch turn.source {
    case "INGEST": self = .inbox
    case "EVENT": self = .taskUpdate
    case "SCHEDULE":
      switch turn.scheduleKey {
      case "standup": self = .standup
      case "weekly-wrap": self = .weeklyWrap
      default:
        // Web's `schedule_name ? … : null`: an empty name labels nothing.
        guard let name = turn.scheduleName, !name.isEmpty else { return nil }
        self = .scheduled(name: name)
      }
    default: return nil
    }
  }

  /// The label a transcript row draws: web renders it in a settled row's body only, so a deleted message and a
  /// mention shell (thinking or failed) carry none. Web does not check the sender.
  public init?(message: Components.Schemas.ChatRoomMessage) {
    guard message.deletedAt == nil, MentionThoughtShell(message: message) == nil,
          let turn = SokoBotTurnMetadata(message: message) else { return nil }
    self.init(turn: turn)
  }
}

/// `metadata.soko_bot_chain` on a message one assistant wrote to another
/// (web `readChainMetadata`): how far the exchange has gone and how close the
/// hop and hourly room limits are. All four numbers are required.
public struct SokoBotChainMetadata: Equatable, Sendable {
  public let depth: Int
  public let maxDepth: Int
  public let roomMessagesThisHour: Int
  public let roomMessagesPerHour: Int

  public init(depth: Int, maxDepth: Int, roomMessagesThisHour: Int, roomMessagesPerHour: Int) {
    self.depth = depth
    self.maxDepth = maxDepth
    self.roomMessagesThisHour = roomMessagesThisHour
    self.roomMessagesPerHour = roomMessagesPerHour
  }

  public init?(metadata: [String: OpenAPIValueContainer]?) {
    guard let record = metadata?["soko_bot_chain"]?.value as? [String: Any],
          let depth = Self.number(record["depth"]),
          let maxDepth = Self.number(record["max_depth"]),
          let roomMessagesThisHour = Self.number(record["room_messages_this_hour"]),
          let roomMessagesPerHour = Self.number(record["room_messages_per_hour"]) else { return nil }
    self.depth = depth
    self.maxDepth = maxDepth
    self.roomMessagesThisHour = roomMessagesThisHour
    self.roomMessagesPerHour = roomMessagesPerHour
  }

  public init?(message: Components.Schemas.ChatRoomMessage) {
    self.init(metadata: message.metadata?.additionalProperties)
  }

  var isLastHop: Bool {
    depth >= maxDepth
  }

  /// The badge text, e.g. `2/3`.
  public var label: String {
    "\(depth)/\(maxDepth)"
  }

  private var depthDescription: String {
    "Assistant-to-assistant reply \(depth) of \(maxDepth). A person writing here resets the count."
  }

  private var roomRateDescription: String {
    "\(roomMessagesThisHour) of \(roomMessagesPerHour) assistant messages in this room this hour."
  }

  private static let lastHopDescription = "This is the last hop — it will not wake anyone else."

  /// Web's tooltip: depth, room rate and, on the final hop, that it ends there.
  public var summary: String {
    var lines = [depthDescription, roomRateDescription]
    if isLastHop {
      lines.append(Self.lastHopDescription)
    }
    return lines.joined(separator: "\n")
  }

  /// Web accepts JSON numbers only (`typeof === "number"`), never strings.
  private static func number(_ value: Any?) -> Int? {
    switch value {
    case let integer as Int: integer
    case let integer as Int64: Int(exactly: integer)
    case let double as Double: double.isFinite && double.magnitude < Double(Int.max) ? Int(double) : nil
    default: nil
    }
  }
}
