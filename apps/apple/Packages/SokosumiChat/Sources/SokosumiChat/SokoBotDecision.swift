import CoreAPI
import Foundation

/// A Soko Bot's request for approval as its result card carries it (web `DecisionCard`, #5806; row 38h2): what the
/// bot wants to do (`tool`, the `proposal`), why (`reason`), and until when it waits.
public struct SokoBotDecision: Equatable, Sendable {
  /// Core's decision status; Core already reads a pending decision past `expiresAt` as expired.
  public enum Status: String, Equatable, Sendable {
    case pending = "PENDING"
    case processing = "PROCESSING"
    case accepted = "ACCEPTED"
    case rejected = "REJECTED"
    case expired = "EXPIRED"
  }

  /// Web's Accept / Reject.
  public enum Resolution: String, Equatable, Sendable {
    case accept = "ACCEPT"
    case reject = "REJECT"
  }

  public let id: String
  public let tool: SokoBotToolLabel
  public let reason: String
  public let status: Status
  public let expiresAt: Date
  public let proposal: ProposalSummary

  public init(_ decision: Components.Schemas.ChatResultAvailable.DecisionPayload) {
    id = decision.id
    tool = SokoBotToolLabel(toolName: decision.toolName)
    reason = decision.reason
    // The generated enums of the card and of the resolve answer carry Core's values.
    status = Status(rawValue: decision.status.rawValue) ?? .pending
    expiresAt = decision.expiresAt
    proposal = ProposalSummary(toolName: decision.toolName, proposal: decision.proposal.additionalProperties.mapValues(\.value))
  }

  /// Web shows Accept / Reject and the expiry only while the decision waits.
  public var isPending: Bool {
    status == .pending
  }

  /// Web disables Accept for a proposal it cannot accept (a hire without an Agent or a positive ceiling).
  public var canAccept: Bool {
    proposal.acceptable
  }
}

/// The tools web names (`App.SokoBot.Chat.tools`), by their runtime names.
public enum SokoBotTool: String, CaseIterable, Equatable, Sendable {
  case refreshContext = "refresh_context"
  case findCoworkers = "find_coworkers"
  case createTask = "create_task"
  case updateTask = "update_task"
  case assignTask = "assign_task"
  case getTaskStatus = "get_task_status"
  case listTasks = "list_tasks"
  case findAgents = "find_agents"
  case getAgentInputSchema = "get_agent_input_schema"
  case hireAgent = "hire_agent"
  case getJobStatus = "get_job_status"
  case provideJobInput = "provide_job_input"
  case requestUserDecision = "request_user_decision"
  case readMemory = "read_memory"
  case updateMemory = "update_memory"
  case scratchRead = "scratch_read"
  case scratchWrite = "scratch_write"
  case scratchList = "scratch_list"
  case readFile = "read_file"
  case generateImage = "generate_image"
  case getImage = "get_image"
  case previewResult = "preview_result"
}

/// Web `useToolLabel`: a tool web names, else the tool's own name with spaces for underscores, and "Working" without
/// one.
public enum SokoBotToolLabel: Equatable, Sendable {
  case working
  case known(SokoBotTool)
  case named(String)

  public init(toolName: String) {
    if let tool = SokoBotTool(rawValue: toolName) {
      self = .known(tool)
    } else if toolName.isEmpty || toolName == "default" {
      // Web's `t.has("default")` finds the "Working" label itself.
      self = .working
    } else {
      self = .named(toolName.replacingOccurrences(of: "_", with: " "))
    }
  }
}

public extension ChatService {
  /// `POST /soko-bots/me/decisions/{decisionId}` (web `resolveSokoBotDecisionAction`): accepts or rejects one of the
  /// caller's decisions. Decisions are the owner's, so the operation carries no workspace header. Returns the status
  /// Core settled on.
  func resolveSokoBotDecision(client: Client, decisionId: String, resolution: SokoBotDecision.Resolution) async throws -> SokoBotDecision.Status {
    let response = try await client.resolveMySokoBotDecision(.init(
      path: .init(decisionId: decisionId),
      body: .json(.init(resolution: resolution == .accept ? .accept : .reject))
    ))
    switch response {
    case let .ok(value):
      let status = try value.body.json.data.status.rawValue
      guard let settled = SokoBotDecision.Status(rawValue: status) else {
        throw ChatServiceError.unexpectedResponse("Unknown decision status \(status)")
      }
      return settled
    case let .unauthorized(value): throw try unauthorized(value.body.json.message)
    case let .forbidden(value): throw try rejected(status: 403, message: value.body.json.message)
    case let .conflict(value): throw try rejected(status: 409, message: value.body.json.message)
    case let .unprocessableContent(value): throw try rejected(status: 422, message: value.body.json.message)
    case let .undocumented(statusCode, payload): throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }
}
