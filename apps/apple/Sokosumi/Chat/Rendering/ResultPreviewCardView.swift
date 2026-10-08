import CoreAPI
import SokosumiChat
import SwiftUI

/// Web's `max-w-xl`: a card stops growing at 576 pt.
private let resultCardMaxWidth: CGFloat = 576
/// Web's `max-w-sm` for a result drawn as a Task card (row 38f).
private let taskResultCardMaxWidth: CGFloat = 384

/// Web `ResultPreviewCard`: the generic card, or the locked one for a result this viewer may not see.
struct ResultPreviewCardView: View {
  let item: ResultPreviewItem
  /// Answers a `project_selection` card: the card's id and the picked project's (row 38h1).
  var select: ((String, String) async throws -> Void)?

  var body: some View {
    switch item {
    case let .available(card) where card.kind == .projectSelection:
      ProjectSelectionCard(card: card, select: select.map { select in { try await select(card.id, $0) } })
    case let .available(card):
      GenericResultCard(card: card)
    case .unavailable:
      Label {
        Text("Result unavailable or no longer accessible", tableName: chatResultsTable,
             comment: "A result card the reader may not see (any more).")
      } icon: {
        Image(systemName: "lock").accessibilityHidden(true)
      }
      .font(.callout)
      .foregroundStyle(.secondary)
      .padding(12)
      .frame(maxWidth: resultCardMaxWidth, alignment: .leading)
      .background(Color.primary.opacity(0.03), in: .rect(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12)))
    }
  }
}

/// The kind, the status, the title, the summary, the question, the detail rows, the outputs and the recorded time;
/// a click anywhere that is not a control opens the source on web, as web's card-wide link does. A `task` result
/// draws web's Task card in place of the status, title, summary and rows, without the card's own frame.
private struct GenericResultCard: View {
  let card: ResultPreviewCard
  @Environment(\.openURL) private var openURL
  @Environment(\.timeFormat) private var timeFormat

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      header
      if let task = card.task {
        ResultTaskCardView(task: task)
      } else {
        Text(card.title)
          .font(.callout.weight(.medium))
          .fixedSize(horizontal: false, vertical: true)
      }
      if let summary = card.summary {
        Text(summary)
          .font(.callout)
          .foregroundStyle(.secondary)
          .lineLimit(5)
      }
      if let question = card.question {
        Text(question)
          .font(.callout)
          .padding(8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 6))
      }
      if !card.details.isEmpty {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 4) {
          ForEach(Array(card.details.enumerated()), id: \.offset) { _, detail in
            GridRow {
              detailLabel(detail).foregroundStyle(.secondary)
              detailValue(detail)
            }
          }
        }
        .font(.caption)
      }
      if !card.outputs.isEmpty {
        ResultOutputsView(card: card)
      }
      Divider()
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text("Recorded \(timeFormat.monthDayTime(card.capturedAt))", tableName: chatResultsTable,
             comment: "When a result card was recorded. Argument: the date and time.")
          .foregroundStyle(.secondary)
        Spacer(minLength: 8)
        Button(action: openSource) {
          HStack(spacing: 4) {
            Text("Open source", tableName: chatResultsTable, comment: "Opens the result card's source on web.")
            Image(systemName: "arrow.up.right").accessibilityHidden(true)
          }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Open source: \(card.title)", tableName: chatResultsTable,
                                 comment: "Accessibility label of a result card. Argument: the result's title."))
        .disabled(card.sourceURL == nil)
      }
      .font(.caption)
    }
    // Around a Task card web drops the result's own border and padding and narrows it to `max-w-sm`.
    .padding(card.task == nil ? 16 : 0)
    .frame(maxWidth: card.task == nil ? resultCardMaxWidth : taskResultCardMaxWidth, alignment: .leading)
    .background {
      if card.task == nil {
        RoundedRectangle(cornerRadius: 8).fill(.background)
      }
    }
    .overlay {
      if card.task == nil {
        RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12))
      }
    }
    .contentShape(.rect(cornerRadius: 8))
    // The controls inside take their own clicks; the rest of the card is the source link.
    .onTapGesture(perform: openSource)
    .pointerStyle(.link)
  }

  private func openSource() {
    if let url = card.sourceURL {
      openURL(url)
    }
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 12) {
      HStack(spacing: 8) {
        if let actor = card.actor {
          // Web `AssigneeAvatar` at size lg; its image is named like web's `alt`. A Soko Bot without an image gets
          // initials, not web's orb (excluded since row 38).
          ParticipantAvatar(imageURL: actor.imageURL, name: actor.name, size: 32)
            .accessibilityElement()
            .accessibilityLabel(actor.name)
        } else if let agent = card.agentName {
          // Web `AgentIcon` at size-8; an icon this view cannot draw falls back to the agent's initials.
          ParticipantAvatar(imageURL: card.agentIconURL, name: agent, size: 32)
            .accessibilityHidden(true)
        } else {
          Image(systemName: card.kind.systemImage)
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
        }
        if let label = card.kind.label {
          label.font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      if let status = card.status {
        status.label
          .font(.caption)
          .foregroundStyle(.secondary)
          .padding(.horizontal, 8)
          .padding(.vertical, 2)
          .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 6))
      }
    }
  }

  private func detailLabel(_ detail: ResultPreviewCard.Detail) -> Text {
    switch detail {
    case .assignee: Text("Assigned to", tableName: chatResultsTable, comment: "Result card row: who the result is assigned to.")
    case .project: Text("Project", tableName: chatResultsTable, comment: "Result card row: the result's project.")
    case .destination: Text("Account", tableName: chatResultsTable, comment: "Result card row: the social account a post goes to.")
    case .scheduled: Text("Scheduled for", tableName: chatResultsTable, comment: "Result card row: when the result runs next.")
    case .recurrence: Text("Recurrence", tableName: chatResultsTable, comment: "Result card row: how the result repeats.")
    }
  }

  @ViewBuilder
  private func detailValue(_ detail: ResultPreviewCard.Detail) -> some View {
    switch detail {
    case let .project(value, mark?):
      HStack(spacing: 8) {
        ProjectMarkView(mark: mark)
        Text(value)
      }
    case let .assignee(value), let .project(value, nil), let .destination(value):
      Text(value)
    case let .scheduled(date, timeZone):
      // Web writes the time in the schedule's own zone and names it.
      let zone = timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
      Text(timeFormat.monthDayTime(date, timeZone: zone) + (timeZone.map { " · \($0)" } ?? ""))
    case let .recurrence(value):
      Text(value).monospaced()
    }
  }
}

/// Web `ProjectAvatar` at `size-5 rounded-sm` beside the project row: the logo, loaded like a participant's
/// photo (a public URL), else the name's initial on a muted square. Decorative, like web's empty `alt`.
struct ProjectMarkView: View {
  let mark: ResultPreviewCard.ProjectMark
  private let size: CGFloat = 20
  @Environment(\.displayScale) private var displayScale
  @State private var logo: CGImage?

  var body: some View {
    Group {
      if let logo {
        Image(decorative: logo, scale: displayScale)
          .resizable()
          .interpolation(.high)
          .scaledToFill()
      } else {
        Text(mark.initial)
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Color.primary.opacity(0.08))
      }
    }
    .frame(width: size, height: size)
    .clipShape(.rect(cornerRadius: 4))
    .accessibilityHidden(true)
    .task(id: "\(mark.logoURL ?? "")-\(displayScale)") {
      let loaded = await loadImageThumbnail(urlString: mark.logoURL, pointSize: size, scale: displayScale)
      guard !Task.isCancelled else { return }
      logo = loaded?.cgImage
    }
  }
}

extension ResultPreviewCard.Kind {
  /// Web's lucide icons as SF Symbols: ListTodo, CalendarClock, MessageSquare, ImageIcon, UserRound, FileText,
  /// FolderKanban.
  var systemImage: String {
    switch self {
    case .task: "checklist"
    case .taskSchedule, .botSchedule: "calendar.badge.clock"
    case .socialPost, .decision: "message"
    case .studioJob: "photo"
    case .job: "person"
    case .file: "doc.text"
    case .projectSelection: "folder"
    }
  }

  /// Web `ChatResults.kind`; a project selection has no label there.
  var label: Text? {
    switch self {
    case .task: Text("Task", tableName: chatResultsTable, comment: "The kind of a result card (task).")
    case .taskSchedule: Text("Task schedule", tableName: chatResultsTable, comment: "The kind of a result card (task_schedule).")
    case .botSchedule: Text("Bot follow-up", tableName: chatResultsTable, comment: "The kind of a result card (bot_schedule).")
    case .socialPost: Text("Social post", tableName: chatResultsTable, comment: "The kind of a result card (social_post).")
    case .studioJob: Text("Studio generation", tableName: chatResultsTable, comment: "The kind of a result card (studio_job).")
    case .job: Text("Agent result", tableName: chatResultsTable, comment: "The kind of a result card (job).")
    case .file: Text("File", tableName: chatResultsTable, comment: "The kind of a result card (file).")
    case .decision: Text("Approval", tableName: chatResultsTable, comment: "The kind of a result card (decision).")
    case .projectSelection: nil
    }
  }
}

extension ResultPreviewCard.Status {
  /// Web `t.has(statusKey) ? t(statusKey) : result.status`; a job's status reads web's `JobStatusBadge` labels.
  var label: Text {
    switch self {
    case let .job(raw):
      Self.jobLabels[raw].map { Text($0) } ?? Text(verbatim: raw)
    case let .result(raw):
      Self.resultLabels[raw].map { Text($0) } ?? Text(verbatim: raw)
    }
  }

  private static func status(_ key: StaticString, _ english: String.LocalizationValue) -> LocalizedStringResource {
    LocalizedStringResource(key, defaultValue: english, table: chatResultsTable, comment: "A result card's status chip.")
  }

  private static let resultLabels: [String: LocalizedStringResource] = [
    "DRAFT": status("status.DRAFT", "Draft"), "READY": status("status.READY", "Ready"),
    "INPUT_REQUIRED": status("status.INPUT_REQUIRED", "Waiting for input"), "RUNNING": status("status.RUNNING", "Running"),
    "COMPLETED": status("status.COMPLETED", "Completed"), "FAILED": status("status.FAILED", "Failed"),
    "CANCELLED": status("status.CANCELLED", "Cancelled"), "ACTIVE": status("status.ACTIVE", "Active"),
    "PAUSED": status("status.PAUSED", "Paused"), "ENDED": status("status.ENDED", "Ended"),
    "SCHEDULED": status("status.SCHEDULED", "Scheduled"), "PUBLISHED": status("status.PUBLISHED", "Published"),
    "QUEUED": status("status.QUEUED", "Queued"), "PENDING": status("status.PENDING", "Pending"),
    "PROCESSING": status("status.PROCESSING", "Processing"), "ACCEPTED": status("status.ACCEPTED", "Accepted"),
    "REJECTED": status("status.REJECTED", "Rejected"), "EXPIRED": status("status.EXPIRED", "Expired"),
    "SUCCEEDED": status("status.SUCCEEDED", "Completed"), "SUBMITTING": status("status.SUBMITTING", "Submitting"),
    "CANCELED": status("status.CANCELED", "Cancelled"),
    "SUBMISSION_UNCERTAIN": status("status.SUBMISSION_UNCERTAIN", "Awaiting confirmation"),
    "ORPHANED": status("status.ORPHANED", "Needs attention")
  ]

  private static let jobLabels: [String: LocalizedStringResource] = [
    "started": status("jobStatus.started", "Started"), "completed": status("jobStatus.completed", "Completed"),
    "processing": status("jobStatus.processing", "Working"), "input_required": status("jobStatus.input_required", "Input required"),
    "result_pending": status("jobStatus.result_pending", "Result missing"), "failed": status("jobStatus.failed", "Failed"),
    "payment_pending": status("jobStatus.payment_pending", "Payment pending"),
    "payment_failed": status("jobStatus.payment_failed", "Payment failed"),
    "refund_pending": status("jobStatus.refund_pending", "Refund requested"),
    "refund_resolved": status("jobStatus.refund_resolved", "Refunded"),
    "dispute_pending": status("jobStatus.dispute_pending", "Dispute pending"),
    "dispute_resolved": status("jobStatus.dispute_resolved", "Dispute resolved")
  ]
}
