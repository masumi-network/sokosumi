import Foundation

/// Web `summarizeProposal` (`proposal-summary.ts`; row 38h2): a decision's model-authored proposal as a bounded,
/// readable summary beside Accept / Reject. Nothing in it is trusted: credential-looking keys are masked, depth and
/// size are capped, and a hire must name an Agent and a positive credit ceiling before it can be accepted.
public struct ProposalSummary: Equatable, Sendable {
  /// Web `ProposalFieldKey`: the typed fields web labels (`Components.SokoBot.Proposal.fields`).
  public enum FieldKey: String, CaseIterable, Equatable, Sendable {
    case agentId, maxCredits, name, projectId, inputData, taskId, coworkerId, status, description, jobId, eventId, ready, reason
  }

  public struct Field: Equatable, Sendable {
    public let key: FieldKey
    public let value: String
    /// Monospaced, for identifiers.
    public let mono: Bool

    public init(key: FieldKey, value: String, mono: Bool) {
      self.key = key
      self.value = value
      self.mono = mono
    }
  }

  public let fields: [Field]
  /// Whether Accept may be offered: false for a malformed hire.
  public let acceptable: Bool
  /// The rest of the proposal on one line, masked (web `formatRedactedValue(summary.raw)`); nil when nothing is left.
  public let raw: String?

  /// Web `FIELD_ORDER`: the typed fields of the tools web knows, in the order it lists them.
  private static let fieldOrder: [String: [FieldKey]] = [
    "hire_agent": [.agentId, .maxCredits, .name, .projectId, .inputData],
    "provide_job_input": [.jobId, .eventId, .inputData],
    "create_task": [.name, .coworkerId, .status, .projectId, .description],
    "update_task": [.taskId, .name, .status, .description],
    "assign_task": [.taskId, .coworkerId, .ready, .status]
  ]

  /// Web `MONO_KEYS`.
  private static let monoKeys: Set<FieldKey> = [.agentId, .projectId, .taskId, .coworkerId, .jobId, .eventId]

  /// `proposal` as the generated client decodes it: JSON values as `Bool`, `Int`, `Double`, `String`, arrays and
  /// dictionaries. Core's schema makes it an object, so web's non-object branch has nothing to read here.
  public init(toolName: String, proposal: [String: (any Sendable)?]) {
    acceptable = toolName == "hire_agent" ? Self.isHireAcceptable(proposal) : true
    let order = Self.fieldOrder[toolName] ?? []
    fields = order.compactMap { key in
      guard let entry = proposal[key.rawValue] else { return nil }
      let redacted = RedactedValue(RedactedValue.isSensitive(key.rawValue) ? RedactedValue.masked : entry)
      guard redacted != .null else { return nil }
      return Field(key: key, value: redacted.formatted, mono: Self.monoKeys.contains(key))
    }
    // A typed key stays consumed even when its value was null and drew no field.
    let consumed = Set(order.map(\.rawValue))
    let rest = proposal.filter { !consumed.contains($0.key) }
    raw = rest.isEmpty ? nil : RedactedValue(rest).formatted
  }

  /// Web `isHireProposalAcceptable`: a non-blank `agentId` and a finite, positive `maxCredits`.
  static func isHireAcceptable(_ proposal: [String: (any Sendable)?]) -> Bool {
    guard let agentId = proposal["agentId"].flatMap(\.self) as? String, !agentId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return false
    }
    switch proposal["maxCredits"].flatMap(\.self) {
    case let credits as Int: return credits > 0
    case let credits as Double: return credits.isFinite && credits > 0
    default: return false
    }
  }
}

/// Web `RedactedValue`: a proposal value after masking and capping. Objects keep their keys in code-point order,
/// since the generated client decodes JSON objects into unordered dictionaries.
indirect enum RedactedValue: Equatable, Sendable {
  case null
  case string(String)
  /// Already written as JavaScript's `String(number)` would.
  case number(String)
  case bool(Bool)
  case array([RedactedValue])
  case object([Entry])

  struct Entry: Equatable, Sendable {
    let key: String
    let value: RedactedValue
  }

  /// Web `REDACTED_VALUE`.
  static let masked = "•••"
  private static let maxDepth = 3
  private static let maxEntries = 12
  private static let maxArrayItems = 5
  private static let maxStringLength = 160
  /// Web `SENSITIVE_KEY_PATTERN`, case-insensitive.
  private static let sensitiveKeyPattern = #"token|password|passwd|secret|api[-_]?key|authorization|payment|card|credential"#

  static func isSensitive(_ key: String) -> Bool {
    key.range(of: sensitiveKeyPattern, options: [.regularExpression, .caseInsensitive]) != nil
  }

  /// Web `redactProposalValue`: masks credential-looking keys and caps depth, breadth and length, so a hostile
  /// proposal can neither leak a secret nor flood the card. A plain value is kept at any depth.
  init(_ value: (any Sendable)?, depth: Int = 0) {
    switch value {
    case nil: self = .null
    case let text as String: self = .string(Self.truncated(text))
    case let flag as Bool: self = .bool(flag)
    case let number as Int: self = .number(String(number))
    case let number as Double: self = .number(Self.javaScriptString(number))
    case _ where depth >= Self.maxDepth: self = .string("…")
    case let items as [(any Sendable)?]: self = Self.array(items, depth: depth)
    case let object as [String: (any Sendable)?]: self = Self.object(object, depth: depth)
    case let other?: self = .string(Self.truncated(String(describing: other)))
    }
  }

  /// Web's array branch: the first five items, then "…" for the rest.
  private static func array(_ items: [(any Sendable)?], depth: Int) -> RedactedValue {
    var redacted = items.prefix(maxArrayItems).map { RedactedValue($0, depth: depth + 1) }
    if items.count > maxArrayItems {
      redacted.append(.string("…"))
    }
    return .array(redacted)
  }

  /// Web's object branch: twelve entries, then "…" for the rest; a credential-looking key's value is masked.
  private static func object(_ object: [String: (any Sendable)?], depth: Int) -> RedactedValue {
    var entries = object.keys.sorted().prefix(maxEntries).map { key in
      Entry(key: key, value: isSensitive(key) ? .string(masked) : RedactedValue(object[key].flatMap(\.self), depth: depth + 1))
    }
    if object.count > maxEntries {
      entries.append(Entry(key: "…", value: .string("…")))
    }
    return .object(entries)
  }

  /// Web `formatRedactedValue`: one compact line.
  var formatted: String {
    switch self {
    case .null: "—"
    case let .string(text), let .number(text): text
    case let .bool(flag): flag ? "true" : "false"
    case let .array(items): items.map(\.formatted).joined(separator: ", ")
    case let .object(entries): entries.map { "\($0.key): \($0.value.formatted)" }.joined(separator: " · ")
    }
  }

  /// Web `truncate`: at most 160 UTF-16 units, the last of them "…". Whole characters only, so an emoji is never
  /// split in half.
  private static func truncated(_ text: String) -> String {
    guard text.utf16.count > maxStringLength else { return text }
    var kept = ""
    var units = 0
    for character in text {
      let width = character.utf16.count
      guard units + width <= maxStringLength - 1 else { break }
      kept.append(character)
      units += width
    }
    return kept + "…"
  }

  /// `String(number)` for the JSON numbers a proposal holds: whole numbers without a fraction.
  private static func javaScriptString(_ number: Double) -> String {
    if number.rounded() == number, abs(number) < 1e21 {
      return String(format: "%.0f", number)
    }
    return String(number)
  }
}
