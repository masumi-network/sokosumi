import SokosumiChat
import SwiftUI

/// Web `DecisionCard` (row 38h2), in place of the generic card for a result that carries a decision: a header with
/// "Needs your okay" (or "Approval" once settled) and the tool's label, the bot's reason, the proposal's typed fields
/// and its masked rest, a warning when a hire cannot be accepted, then Approve / Reject and the expiry while the
/// decision waits, or the settled status's explanation.
struct DecisionCardView: View {
  let decision: SokoBotDecision
  /// Resolves the decision; the row then reads its results again. Absent, both buttons stay disabled.
  let resolve: ((SokoBotDecision.Resolution) async throws -> Void)?
  @Environment(\.timeFormat) private var timeFormat
  @State private var inFlight: SokoBotDecision.Resolution?
  @State private var failure: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      Divider()
      VStack(alignment: .leading, spacing: 12) {
        Text(decision.reason)
          .font(.callout)
          .fixedSize(horizontal: false, vertical: true)
        if !decision.proposal.fields.isEmpty {
          fields
        }
        if let raw = decision.proposal.raw {
          Text(raw)
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        if !decision.canAccept {
          Text(LocalizedStringResource("proposal.incomplete",
                                       defaultValue: "This hire proposal is missing an Agent or a positive credit ceiling; it cannot be accepted.",
                                       table: chatResultsTable, comment: "Under a hire decision Approve cannot accept."))
            .font(.caption)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: false, vertical: true)
        }
        if decision.isPending {
          actions
        } else {
          explanation
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
    }
    .frame(maxWidth: resultCardMaxWidth, alignment: .leading)
    .background(.background, in: .rect(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8)
      .strokeBorder(decision.isPending ? Color.accentColor.opacity(0.4) : Color.primary.opacity(0.12)))
    .alert(Text(LocalizedStringResource("decision.error", defaultValue: "Could not resolve the approval.", table: chatResultsTable,
                                        comment: "Alert title when approving or rejecting a Soko Bot's decision failed.")),
           isPresented: Binding(get: { failure != nil }, set: {
             if !$0 {
               failure = nil
             }
           })) {
      Button("OK", role: .cancel) { failure = nil }
    } message: {
      Text(failure ?? "")
    }
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Group {
        if decision.isPending {
          Text(LocalizedStringResource("decision.heading", defaultValue: "Needs your okay", table: chatResultsTable,
                                       comment: "Heading of a Soko Bot decision waiting for approval."))
        } else {
          Text(LocalizedStringResource("decision.headingResolved", defaultValue: "Approval", table: chatResultsTable,
                                       comment: "Heading of a settled Soko Bot decision."))
        }
      }
      .font(.callout.weight(.medium))
      Spacer(minLength: 8)
      decision.tool.label
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
  }

  /// Web's `<dl>`: the label column sized to its longest label, the values wrapping beside it.
  private var fields: some View {
    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 4) {
      ForEach(decision.proposal.fields, id: \.key) { field in
        GridRow {
          field.key.label.foregroundStyle(.secondary)
          Text(field.value)
            .fontDesign(field.mono ? .monospaced : nil)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .font(.caption)
  }

  private var actions: some View {
    HStack(spacing: 8) {
      Button {
        press(.accept)
      } label: {
        actionLabel(.accept)
      }
      .buttonStyle(.borderedProminent)
      .disabled(resolve == nil || inFlight != nil || !decision.canAccept)
      Button {
        press(.reject)
      } label: {
        actionLabel(.reject)
      }
      .buttonStyle(.bordered)
      .disabled(resolve == nil || inFlight != nil)
      Spacer(minLength: 8)
      Text(LocalizedStringResource("decision.expires", defaultValue: "Expires \(timeFormat.shortDateTime(decision.expiresAt))",
                                   table: chatResultsTable, comment: "When a Soko Bot decision stops waiting. Argument: the date and time."))
        .font(.caption)
        .foregroundStyle(.secondary)
        .monospacedDigit()
    }
    .controlSize(.small)
    .padding(.top, 4)
  }

  /// Web's check and cross; the pressed button shows progress in their place while Core answers.
  private func actionLabel(_ resolution: SokoBotDecision.Resolution) -> some View {
    HStack(spacing: 4) {
      if inFlight == resolution {
        ProgressView().controlSize(.mini).accessibilityHidden(true)
      } else {
        Image(systemName: resolution == .accept ? "checkmark" : "xmark").accessibilityHidden(true)
      }
      switch resolution {
      case .accept:
        Text(LocalizedStringResource("decision.accept", defaultValue: "Approve", table: chatResultsTable,
                                     comment: "Approves a Soko Bot decision."))
      case .reject:
        Text(LocalizedStringResource("decision.reject", defaultValue: "Reject", table: chatResultsTable,
                                     comment: "Rejects a Soko Bot decision."))
      }
    }
  }

  /// Web `DecisionExplain`, tinted like web: approved green, in progress orange, the rest secondary.
  private var explanation: some View {
    let text = switch decision.status {
    case .pending: Text(verbatim: "")
    case .processing:
      Text(LocalizedStringResource(
        "decisionExplain.PROCESSING",
        defaultValue: "Being carried out. If this is an Agent hire, the seller-side start is in flight or unconfirmed — do not resubmit; it resolves automatically or an operator will follow up.",
        table: chatResultsTable, comment: "A Soko Bot decision being carried out."
      ))
    case .accepted:
      Text(LocalizedStringResource("decisionExplain.ACCEPTED", defaultValue: "Approved and carried out.", table: chatResultsTable,
                                   comment: "An approved Soko Bot decision."))
    case .rejected:
      Text(LocalizedStringResource("decisionExplain.REJECTED", defaultValue: "Rejected. Nothing was created.", table: chatResultsTable,
                                   comment: "A rejected Soko Bot decision."))
    case .expired:
      Text(LocalizedStringResource("decisionExplain.EXPIRED", defaultValue: "Expired without a decision. Ask your Soko Bot again if still needed.",
                                   table: chatResultsTable, comment: "A Soko Bot decision nobody answered in time."))
    }
    return text
      .font(.caption)
      .foregroundStyle(explanationStyle)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var explanationStyle: Color {
    switch decision.status {
    case .accepted: .green
    case .processing: .orange
    case .pending, .rejected, .expired: .secondary
    }
  }

  /// Web `resolve`: one press at a time; a success reads the row again, a failure says so with Core's message.
  private func press(_ resolution: SokoBotDecision.Resolution) {
    guard let resolve, inFlight == nil else { return }
    inFlight = resolution
    Task {
      do {
        try await resolve(resolution)
      } catch {
        failure = friendlyMessage(for: error, mode: .coreMessage)
      }
      inFlight = nil
    }
  }
}

extension SokoBotToolLabel {
  /// Web `App.SokoBot.Chat.tools`.
  var label: Text {
    switch self {
    case .working: Text(LocalizedStringResource("tools.default", defaultValue: "Working", table: chatResultsTable, comment: "A Soko Bot tool label."))
    case let .known(tool): Text(tool.label)
    case let .named(name): Text(verbatim: name)
    }
  }
}

extension SokoBotTool {
  private static func tool(_ key: StaticString, _ english: String.LocalizationValue) -> LocalizedStringResource {
    LocalizedStringResource(key, defaultValue: english, table: chatResultsTable, comment: "A Soko Bot tool label.")
  }

  var label: LocalizedStringResource {
    switch self {
    case .refreshContext: Self.tool("tools.refresh_context", "Refreshing context")
    case .findCoworkers: Self.tool("tools.find_coworkers", "Finding coworkers")
    case .createTask: Self.tool("tools.create_task", "Creating a task")
    case .updateTask: Self.tool("tools.update_task", "Updating a task")
    case .assignTask: Self.tool("tools.assign_task", "Assigning a task")
    case .getTaskStatus: Self.tool("tools.get_task_status", "Checking Task status")
    case .listTasks: Self.tool("tools.list_tasks", "Looking through your Tasks")
    case .findAgents: Self.tool("tools.find_agents", "Searching agents")
    case .getAgentInputSchema: Self.tool("tools.get_agent_input_schema", "Reading Agent inputs")
    case .hireAgent: Self.tool("tools.hire_agent", "Hiring an agent")
    case .getJobStatus: Self.tool("tools.get_job_status", "Checking Job status")
    case .provideJobInput: Self.tool("tools.provide_job_input", "Answering a job")
    case .requestUserDecision: Self.tool("tools.request_user_decision", "Asking for your approval")
    case .readMemory: Self.tool("tools.read_memory", "Reading memory")
    case .updateMemory: Self.tool("tools.update_memory", "Updating memory")
    case .scratchRead: Self.tool("tools.scratch_read", "Reading notes")
    case .scratchWrite: Self.tool("tools.scratch_write", "Writing notes")
    case .scratchList: Self.tool("tools.scratch_list", "Listing notes")
    case .readFile: Self.tool("tools.read_file", "Reading a file")
    case .generateImage: Self.tool("tools.generate_image", "Generating an image")
    case .getImage: Self.tool("tools.get_image", "Checking an image")
    case .previewResult: Self.tool("tools.preview_result", "Preparing a result preview")
    }
  }
}

extension ProposalSummary.FieldKey {
  private static func field(_ key: StaticString, _ english: String.LocalizationValue) -> Text {
    Text(LocalizedStringResource(key, defaultValue: english, table: chatResultsTable, comment: "A Soko Bot proposal's field label."))
  }

  /// Web `Components.SokoBot.Proposal.fields`.
  var label: Text {
    switch self {
    case .agentId: Self.field("proposal.fields.agentId", "Agent")
    case .maxCredits: Self.field("proposal.fields.maxCredits", "Max credits")
    case .name: Self.field("proposal.fields.name", "Name")
    case .projectId: Self.field("proposal.fields.projectId", "Project")
    case .inputData: Self.field("proposal.fields.inputData", "Input")
    case .taskId: Self.field("proposal.fields.taskId", "Task")
    case .coworkerId: Self.field("proposal.fields.coworkerId", "Coworker")
    case .status: Self.field("proposal.fields.status", "Status")
    case .description: Self.field("proposal.fields.description", "Description")
    case .jobId: Self.field("proposal.fields.jobId", "Job")
    case .eventId: Self.field("proposal.fields.eventId", "Job event")
    case .ready: Self.field("proposal.fields.ready", "Start right away")
    case .reason: Self.field("proposal.fields.reason", "Reason")
    }
  }
}
