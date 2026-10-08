import CoreAPI
import Foundation

/// A Soko Bot message's recorded results (web `ResultPreviews`, #5806; row 38e1). The message carries only opaque
/// descriptors (`resultPreviews`: `id`, `capturedAt`); each viewer reads the cards it may see through
/// `GET /chats/rooms/{id}/messages/{messageId}/results`, which answers an `available` card or `unavailable` per
/// descriptor.
public enum MessageResultPreviews {
  /// The descriptors a settled row reads (web `message.resultPreviews ?? []`). Core omits them on a deleted message.
  public static func descriptorIds(of message: Components.Schemas.ChatRoomMessage) -> [String] {
    guard message.deletedAt == nil else { return [] }
    return message.resultPreviews?.map(\.id) ?? []
  }

  /// Web keeps Core's answer in Core's order and only the results this message's descriptors name.
  public static func items(_ previews: [Components.Schemas.ChatResultPreview], descriptorIds: [String], webBaseURL: URL) -> [ResultPreviewItem] {
    let named = Set(descriptorIds)
    return previews.compactMap { preview in
      switch preview {
      case let .available(result): named.contains(result.id) ? .available(ResultPreviewCard(result, webBaseURL: webBaseURL)) : nil
      case let .unavailable(result): named.contains(result.id) ? .unavailable(id: result.id) : nil
      }
    }
  }

  /// Web `previewedTaskIds`: the Tasks an available `task` card already shows, whose small Task button the
  /// Soko Bot footer then drops (row 38's footer).
  public static func previewedTaskIds(_ items: [ResultPreviewItem]) -> Set<String> {
    Set(items.compactMap { item in
      if case let .available(card) = item {
        card.taskId
      } else {
        nil
      }
    })
  }

  /// A web page for a Core `localHref` (`/tasks/…`, `/drive/files/…?scope=me`): the path and query under the
  /// configured web origin, keeping its base path. Nil for anything that is not a local path.
  public static func webURL(forLocalHref href: String, webBaseURL: URL) -> URL? {
    // Core's `localHref`: one leading slash, never `//` or `/\`, so nothing leaves the web origin.
    guard href.hasPrefix("/"), !href.hasPrefix("//"), !href.hasPrefix("/\\"),
          let local = URLComponents(string: href), local.scheme == nil, local.host == nil,
          var components = URLComponents(url: webBaseURL, resolvingAgainstBaseURL: false) else { return nil }
    components.percentEncodedPath = SokoBotTurnMetadata.basePath(components) + local.percentEncodedPath
    components.percentEncodedQuery = local.percentEncodedQuery
    components.percentEncodedFragment = local.percentEncodedFragment
    return components.url
  }
}

/// One card of a message's results: what Core answered for one descriptor.
public enum ResultPreviewItem: Equatable, Identifiable, Sendable {
  case available(ResultPreviewCard)
  /// Web's locked card: "Result unavailable or no longer accessible". Core gives no reason.
  case unavailable(id: String)

  public var id: String {
    switch self {
    case let .available(card): card.id
    case let .unavailable(id): id
    }
  }
}

/// Web `ResultPreviewCard`'s generic card: the kind, a status chip, the title, the summary, the question, the detail
/// rows, the outputs and the recorded time; the card opens `sourceHref` on web.
public struct ResultPreviewCard: Equatable, Sendable {
  public typealias Kind = Components.Schemas.ChatResultAvailable.KindPayload

  /// The status chip: a job's is web's `JobStatusBadge` with its own labels, every other is `ChatResults.status`.
  public enum Status: Equatable, Sendable {
    case job(String)
    case result(String)
  }

  /// Web's `<dl>` rows, in web's order.
  public enum Detail: Equatable, Sendable {
    case assignee(String)
    /// The project's name, with web's `ProjectAvatar` when Core sends `projectInfo`.
    case project(String, mark: ProjectMark?)
    case destination(String)
    /// The next run, written in `timeZone` when Core names one.
    case scheduled(Date, timeZone: String?)
    case recurrence(String)
  }

  /// Web `ProjectAvatar`: the logo, else the name's first letter (or "P").
  public struct ProjectMark: Equatable, Sendable {
    public let name: String
    public let logoURL: String?

    public init(name: String, logoURL: String?) {
      self.name = name
      self.logoURL = logoURL
    }

    public var initial: String {
      name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "P"
    }
  }

  /// A project a `project_selection` card offers (Core's live `projectOptions`, row 38h1).
  public struct ProjectOption: Equatable, Identifiable, Sendable {
    public let id: String
    public let mark: ProjectMark

    public init(id: String, mark: ProjectMark) {
      self.id = id
      self.mark = mark
    }

    public var name: String {
      mark.name
    }
  }

  /// Who a schedule runs as (web `AssigneeAvatar` from `actor`): a person, a coworker or a Soko Bot.
  public struct Actor: Equatable, Sendable {
    public let name: String
    public let imageURL: String?

    public init(name: String, imageURL: String?) {
      self.name = name
      self.imageURL = imageURL
    }
  }

  /// A file the result produced. Until row 38e2 every output is a row that opens on web.
  public struct Output: Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let contentType: String?
    public let sizeBytes: Int?
    public let openURL: URL?
    public let downloadURL: URL?
  }

  public let id: String
  public let kind: Kind
  public let title: String
  public let status: Status?
  /// Nil when empty or the same as the title, as web hides it then.
  public let summary: String?
  public let question: String?
  public let details: [Detail]
  public let outputs: [Output]
  public let capturedAt: Date
  public let sourceURL: URL?
  /// The header's avatar, before the agent and the kind icon (web: `actor`, else `agent`, else the icon).
  public let actor: Actor?
  /// A job's agent, drawn where web draws `AgentIcon`.
  public let agentName: String?
  public let agentIconURL: String?
  /// The Task a `task` card shows (web `result.task.id`).
  public let taskId: String?
  /// What a `project_selection` card offers, in Core's order (by name); empty for every other kind.
  public let projectOptions: [ProjectOption]

  public init(_ result: Components.Schemas.ChatResultAvailable, webBaseURL: URL) {
    id = result.id
    kind = result.kind
    title = result.title
    status = result.status.nonEmpty.map { raw in
      result.kind == .job && Self.jobStatuses.contains(raw) ? .job(raw) : .result(raw)
    }
    summary = result.summary.nonEmpty.flatMap { $0 == result.title ? nil : $0 }
    question = result.question.nonEmpty
    details = [
      result.assignee.nonEmpty.map(Detail.assignee),
      result.project.nonEmpty.map { name in
        Detail.project(name, mark: result.projectInfo.map { ProjectMark(name: $0.name, logoURL: $0.logo.nonEmpty) })
      },
      result.destination.nonEmpty.map(Detail.destination),
      result.scheduledAt.map { Detail.scheduled($0, timeZone: result.timezone.nonEmpty) },
      result.recurrence.nonEmpty.map(Detail.recurrence)
    ].compactMap(\.self)
    outputs = (result.outputs ?? []).enumerated().map { index, output in
      Output(
        id: "\(output.openHref)-\(index)",
        name: output.name,
        contentType: output.contentType.nonEmpty,
        sizeBytes: output.sizeBytes.flatMap { $0.isFinite && $0 >= 0 ? Int($0) : nil },
        openURL: MessageResultPreviews.webURL(forLocalHref: output.openHref, webBaseURL: webBaseURL),
        downloadURL: output.downloadHref.flatMap { MessageResultPreviews.webURL(forLocalHref: $0, webBaseURL: webBaseURL) }
      )
    }
    capturedAt = result.capturedAt
    sourceURL = MessageResultPreviews.webURL(forLocalHref: result.sourceHref, webBaseURL: webBaseURL)
    actor = result.actor.map { Actor(name: $0.name, imageURL: $0.image.nonEmpty) }
    agentName = result.agent?.name
    agentIconURL = result.agent?.icon.nonEmpty
    // Web: an available `task` result that carries its `task` object.
    taskId = result.kind == .task ? result.task?.id : nil
    projectOptions = (result.projectOptions ?? []).map { .init(id: $0.id, mark: .init(name: $0.name, logoURL: $0.logo.nonEmpty)) }
  }

  /// `SokosumiJobStatus`: the statuses web's `JobStatusBadge` labels; any other job status gets the generic chip.
  static let jobStatuses: Set = [
    "started", "completed", "processing", "input_required", "result_pending", "failed", "payment_pending",
    "payment_failed", "refund_pending", "refund_resolved", "dispute_pending", "dispute_resolved"
  ]
}

private extension String? {
  /// Web's truthiness for an optional string: nil and empty both mean absent.
  var nonEmpty: String? {
    flatMap { $0.isEmpty ? nil : $0 }
  }
}

/// What a row's results show while and after it reads them (web `AuthorizedResultPreviews`).
public enum ResultPreviewsLoad: Equatable, Sendable {
  /// "Loading results…", also while a Retry reads again.
  case loading
  /// "Results could not be loaded" with Retry.
  case failed
  case loaded([ResultPreviewItem])
}
