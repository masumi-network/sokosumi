import CoreAPI
import Foundation

/// Web `TaskCard` as a chat `task` result draws it (row 38f; web `result-previews.tsx` passes the preview's `task`
/// object to the Task board's card, non-compact and without a drag handle). Core captures the object when the turn
/// records the result and does not refresh it on a later read, so the card shows the Task as it stood then.
public struct ResultTaskCard: Equatable, Sendable {
  public typealias Status = Components.Schemas.TaskStatus
  public typealias Priority = Components.Schemas.TaskPriority
  public typealias Tag = Components.Schemas.TaskTagId

  /// A face in web's actor cluster (`AssigneeAvatar`): the assignee or a participant.
  public struct Actor: Equatable, Identifiable, Sendable {
    /// Web's `${kind}:${id}`, which also folds an assignee who is a participant into one face.
    public let id: String
    public let name: String
    public let imageURL: String?

    public init(id: String, name: String, imageURL: String?) {
      self.id = id
      self.name = name
      self.imageURL = imageURL
    }
  }

  /// The Task's project: web's `ProjectAvatar` and name, a link to `/projects/{id}`.
  public struct Project: Equatable, Sendable {
    public let mark: ResultPreviewCard.ProjectMark
    public let url: URL?

    public init(mark: ResultPreviewCard.ProjectMark, url: URL?) {
      self.mark = mark
      self.url = url
    }

    public var name: String {
      mark.name
    }
  }

  /// Web's `TaskCard` keeps two tags and a `+N` for the rest, and three faces with a `+N`.
  public static let visibleTagLimit = 2
  public static let visibleFaceLimit = 3

  public let id: String
  public let name: String
  /// The project's prefix and number ("LAU-7"), nil without a project identifier.
  public let identifier: String?
  public let status: Status
  public let priority: Priority
  public let isPrivate: Bool
  /// Manual tags before automatic ones, as web lists them (Core keeps the two apart, at most five in all).
  public let tags: [Tag]
  public let project: Project?
  /// The assignee first, then the participants in join order, each once.
  public let actors: [Actor]
  public let commentsCount: Int
  public let createdAt: Date
  /// When a Queued Task starts; web's `TaskRunAtBadge`.
  public let runAt: Date?
  /// Web `taskHref`: the identifier and a slug of the name, else the id.
  public let url: URL?

  /// Web draws its Task card only for a `task` result whose `task` carries `createdAt`; any other keeps the
  /// generic card.
  init?(_ result: Components.Schemas.ChatResultAvailable, webBaseURL: URL) {
    guard result.kind == .task, let task = result.task, let createdAt = task.createdAt else { return nil }
    id = task.id
    name = task.name
    identifier = task.identifier.flatMap { $0.isEmpty ? nil : $0 }
    status = task.status
    priority = task.priority
    isPrivate = task.visibility == ._private
    var seenTags: Set<Tag> = []
    tags = (task.tags.manual + task.tags.automatic).filter { seenTags.insert($0).inserted }
    project = task.project.map { project in
      Project(mark: .init(name: project.name, logoURL: project.logo.flatMap { $0.isEmpty ? nil : $0 }),
              url: MessageResultPreviews.webURL(forLocalHref: "/projects/\(Self.pathSegment(project.id))", webBaseURL: webBaseURL))
    }
    let assignee = task.assignee.map { Actor(id: "\($0.kind.rawValue):\($0.id)", name: $0.name, imageURL: $0.image) }
    var seenActors: Set<String> = []
    actors = ([assignee].compactMap(\.self) + task.participants.map {
      Actor(id: "\($0.kind.rawValue):\($0.id)", name: $0.name, imageURL: $0.image)
    }).filter { seenActors.insert($0.id).inserted }
    commentsCount = task.commentsCount
    self.createdAt = createdAt
    runAt = task.runAt
    url = MessageResultPreviews.webURL(forLocalHref: Self.href(id: task.id, identifier: identifier, name: task.name),
                                       webBaseURL: webBaseURL)
  }

  public var visibleTags: [Tag] {
    Array(tags.prefix(Self.visibleTagLimit))
  }

  public var hiddenTagCount: Int {
    tags.count - visibleTags.count
  }

  public var faces: [Actor] {
    Array(actors.prefix(Self.visibleFaceLimit))
  }

  public var hiddenFaceCount: Int {
    actors.count - faces.count
  }

  /// Web's cluster label and tooltip: every actor's name, a blank one as "—".
  public var actorNames: String {
    let names = actors.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "—" : $0.name }
    return names.isEmpty ? "—" : names.joined(separator: ", ")
  }

  public var tone: TaskStatusTone {
    Self.tone(for: status)
  }

  public static func tone(for status: Status) -> TaskStatusTone {
    switch status {
    case .draft, .canceled: TaskStatusTone(hue: .dormant, weight: .outline)
    case .queued, .ready: TaskStatusTone(hue: .staged, weight: .filled)
    case .creditsToppedUp: TaskStatusTone(hue: .staged, weight: .outline)
    case .running: TaskStatusTone(hue: .active, weight: .filled)
    case .awaitingExternal: TaskStatusTone(hue: .active, weight: .outline)
    case .grantPending: TaskStatusTone(hue: .blocked, weight: .outline)
    case .inputRequired, .approvalRequired, .authenticationRequired, .outOfCredits: TaskStatusTone(hue: .blocked, weight: .filled)
    case .completed: TaskStatusTone(hue: .resolved, weight: .filled)
    case .failed: TaskStatusTone(hue: .fault, weight: .solid)
    }
  }

  /// Web `taskHref`: `/tasks/{identifier}-{slug}` when the Task has an identifier, `/tasks/{identifier}` when the
  /// name leaves no slug, else `/tasks/{id}`. Core resolves either and ignores the slug.
  static func href(id: String, identifier: String?, name: String) -> String {
    guard let identifier else { return "/tasks/\(pathSegment(id))" }
    let slug = slug(name)
    return slug.isEmpty ? "/tasks/\(pathSegment(identifier))" : "/tasks/\(pathSegment(identifier))-\(slug)"
  }

  /// Web `slugifyTaskName`: `sanitizeChannelSlug`, cut to 60 characters at a dash so no word is chopped; a single
  /// longer word keeps the hard cut.
  static func slug(_ name: String) -> String {
    let limit = 60
    let slug = Array(sanitizedSlug(name))
    guard slug.count > limit else { return String(slug) }
    let head = Array(slug.prefix(limit))
    if slug[limit] == "-" {
      return String(head)
    }
    guard let lastDash = head.lastIndex(of: "-"), lastDash > 0 else { return String(head) }
    return String(head[..<lastDash])
  }

  /// `@sokosumi/utils` `sanitizeChannelSlug`: trimmed, lower-cased, NFKD without combining marks, every run of
  /// anything but `a-z0-9` one dash, no dash at either end.
  static func sanitizedSlug(_ raw: String) -> String {
    let decomposed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().decomposedStringWithCompatibilityMapping
    var slug = ""
    var pendingDash = false
    for scalar in decomposed.unicodeScalars where !(0x300 ... 0x36F).contains(scalar.value) {
      if ("a" ... "z").contains(scalar) || ("0" ... "9").contains(scalar) {
        if pendingDash, !slug.isEmpty {
          slug.append("-")
        }
        pendingDash = false
        slug.unicodeScalars.append(scalar)
      } else {
        pendingDash = true
      }
    }
    return slug
  }

  private static func pathSegment(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? value
  }
}

/// Web `TASK_STATUS_MARKERS`: hue is the board column, weight the status inside it; only a failure is solid.
public struct TaskStatusTone: Equatable, Sendable {
  public enum Hue: Equatable, Sendable {
    case dormant, staged, active, blocked, resolved, fault
  }

  public enum Weight: Equatable, Sendable {
    case filled, outline, solid
  }

  public let hue: Hue
  public let weight: Weight
}

/// Web `formatRunTimeLabel` for a Queued Task's start: minutes or hours while it is close, tomorrow's clock time,
/// else a date and time.
public enum TaskRunTime: Equatable, Sendable {
  /// "Starting soon": the start has passed.
  case overdue
  case inMinutes(Int)
  case inHours(Int)
  /// "Starts tomorrow at {time}".
  case tomorrow(Date)
  /// "Starts {date and time}".
  case later(Date)

  /// Days are `calendar`'s, in its time zone, as web compares calendar days in the formatter's zone.
  public init(runAt: Date, now: Date, calendar: Calendar = .current) {
    let seconds = runAt.timeIntervalSince(now)
    let hour: TimeInterval = 3600
    let day = 24 * hour
    if seconds <= 0 {
      self = .overdue
    } else if seconds < hour {
      self = .inMinutes(max(1, Int((seconds / 60).rounded(.up))))
    } else if seconds < day {
      self = .inHours(max(1, Int((seconds / hour).rounded(.up))))
    } else if calendar.isDate(runAt, inSameDayAs: now.addingTimeInterval(day)) {
      self = .tomorrow(runAt)
    } else {
      self = .later(runAt)
    }
  }
}
