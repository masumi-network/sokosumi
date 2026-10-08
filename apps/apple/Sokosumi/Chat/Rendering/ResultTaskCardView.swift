import CoreAPI
import SokosumiChat
import SwiftUI

/// The String Catalog for the Task card's words (`ChatTasks.xcstrings`, web `App.Tasks`).
let chatTasksTable = "ChatTasks"

/// Web `TaskCard` (row 38f), non-compact and without a drag handle, as a chat `task` result draws it: the status
/// badge and lock, the priority mark, identifier and name, two tags and a `+N`, the project, the start of a Queued
/// Task, and the people, comments and creation day. A click anywhere but its controls opens the Task on web.
struct ResultTaskCardView: View {
  let task: ResultTaskCard
  @Environment(\.openURL) private var openURL
  @State private var isHovered = false

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        TaskStatusBadge(status: task.status, tone: task.tone)
        Spacer(minLength: 0)
        if task.isPrivate {
          Image(systemName: "lock")
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityLabel(Text("Private", tableName: chatTasksTable, comment: "Spoken label of a Task card's lock: the Task is private."))
        }
      }
      title
      TaskTagsRow(task: task)
      project
      if let runAt = task.runAt {
        TaskRunAtLabel(runAt: runAt)
      }
      VStack(alignment: .leading, spacing: 8) {
        Divider()
        HStack(spacing: 8) {
          TaskActorCluster(task: task)
          Spacer(minLength: 8)
          TaskCardFacts(task: task)
        }
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.background, in: .rect(cornerRadius: 8))
    // Web's `hover:border-primary hover:shadow-sm`.
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(isHovered ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.primary.opacity(0.12))))
    .shadow(color: .black.opacity(isHovered ? 0.08 : 0), radius: 2, y: 1)
    .contentShape(.rect(cornerRadius: 8))
    // Web stretches the name's link over the card; its controls take their own clicks.
    .onTapGesture(perform: openTask)
    .onHover { isHovered = $0 }
    .animation(.easeOut(duration: 0.15), value: isHovered)
  }

  private func openTask() {
    if let url = task.url {
      openURL(url)
    }
  }

  /// Web's `h3`: the priority mark, the identifier in small grey digits and the name, two lines at most.
  private var title: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      TaskPriorityMark(priority: task.priority)
      Button(action: openTask) {
        titleText
          .lineLimit(2)
          .multilineTextAlignment(.leading)
          .fixedSize(horizontal: false, vertical: true)
      }
      .buttonStyle(.plain)
      .help(task.name)
    }
  }

  private var titleText: Text {
    // A font on the whole run replaces the identifier's caption (web's `text-xs`).
    let name = Text(verbatim: task.name).font(.callout.weight(.medium))
    guard let identifier = task.identifier else { return name }
    let prefix = Text(verbatim: identifier).font(.caption).fontWeight(.regular).foregroundStyle(.secondary).monospacedDigit()
    return Text("\(prefix) \(name)")
  }

  @ViewBuilder
  private var project: some View {
    if let project = task.project {
      Button {
        if let url = project.url {
          openURL(url)
        }
      } label: {
        HStack(spacing: 8) {
          ProjectMarkView(mark: project.mark)
          Text(verbatim: project.name).lineLimit(2)
        }
        .frame(minHeight: 24)
      }
      .buttonStyle(.plain)
      .font(.caption)
      .foregroundStyle(.secondary)
      .help(project.name)
      .accessibilityLabel(Text("Open project: \(project.name)", tableName: chatTasksTable,
                               comment: "Spoken label of a Task card's project link. Argument: the project's name."))
    } else {
      Text("No project", tableName: chatTasksTable, comment: "A Task card without a project.")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }
}

/// Web `TaskStatusBadge`: the status's glyph and label on its column's tone; only Running moves.
private struct TaskStatusBadge: View {
  let status: ResultTaskCard.Status
  let tone: TaskStatusTone
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: status.systemImage)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(tone.weight == .solid ? AnyShapeStyle(.white) : AnyShapeStyle(tone.hue.color))
        .symbolEffect(.variableColor.iterative, isActive: status == .running && !reduceMotion)
        .accessibilityHidden(true)
      Text(status.label)
        .foregroundStyle(tone.weight == .solid ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
    }
    .font(.caption.weight(.medium))
    .padding(.horizontal, 10)
    .padding(.vertical, 4)
    .background(fill, in: .rect(cornerRadius: 4))
    .overlay {
      if tone.weight == .outline {
        RoundedRectangle(cornerRadius: 4).strokeBorder(tone.hue.color.opacity(0.45))
      }
    }
  }

  private var fill: Color {
    switch tone.weight {
    case .filled: tone.hue.color.opacity(0.15)
    case .outline: .clear
    case .solid: tone.hue.color
    }
  }
}

/// Web `TaskPriorityMark`: one to three signal bars, a red "!" square for Urgent, nothing for No priority.
private struct TaskPriorityMark: View {
  let priority: ResultTaskCard.Priority

  var body: some View {
    switch priority {
    case .none:
      EmptyView()
    case .urgent:
      Image(systemName: "exclamationmark.square.fill")
        .font(.system(size: 13))
        .foregroundStyle(.red)
        .accessibilityLabel(priority.label)
    case .high, .medium, .low:
      TaskPriorityBars(filled: priority == .high ? 3 : priority == .medium ? 2 : 1)
        .frame(width: 16, height: 16)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
        .accessibilityElement()
        .accessibilityLabel(priority.label)
    }
  }
}

/// Web `TaskPriorityIcon`'s bars on its 16 × 16 grid: filled bars at full strength, the rest faint.
private struct TaskPriorityBars: View {
  let filled: Int
  private static let bars = [
    CGRect(x: 2, y: 9, width: 2.5, height: 4), CGRect(x: 6.5, y: 6, width: 2.5, height: 7), CGRect(x: 11, y: 3, width: 2.5, height: 10)
  ]

  var body: some View {
    Canvas { context, size in
      let unit = size.width / 16
      for (index, bar) in Self.bars.enumerated() {
        var layer = context
        layer.opacity = index < filled ? 1 : 0.3
        let rect = CGRect(x: bar.minX * unit, y: bar.minY * unit, width: bar.width * unit, height: bar.height * unit)
        layer.fill(Path(roundedRect: rect, cornerRadius: 0.75 * unit), with: .foreground)
      }
    }
  }
}

/// Web `TaskTags`: two outline tags and a `+N` that lists them all; "No tags yet" without any.
private struct TaskTagsRow: View {
  let task: ResultTaskCard
  @State private var showsAll = false

  var body: some View {
    if task.tags.isEmpty {
      Text("No tags yet", tableName: chatTasksTable, comment: "A Task card without tags.")
        .font(.caption)
        .foregroundStyle(.secondary)
    } else {
      // Two tags and the count fit one line at the card's width.
      HStack(spacing: 4) {
        ForEach(task.visibleTags, id: \.self) { tag in
          TaskTagBadge(tag: tag)
        }
        if task.hiddenTagCount > 0 {
          Button {
            showsAll = true
          } label: {
            Text(verbatim: "+\(task.hiddenTagCount)")
              .font(.caption)
              .padding(.horizontal, 6)
              .frame(minHeight: 20)
              .contentShape(.rect)
          }
          .buttonStyle(.borderless)
          .accessibilityLabel(Text("Show all \(task.tags.count) tags", tableName: chatTasksTable,
                                   comment: "Opens every tag of a Task card. Argument: how many tags it has."))
          .popover(isPresented: $showsAll, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 8) {
              Text("Tags", tableName: chatTasksTable, comment: "A Task card's tags: the list's label and the popover's title.")
                .font(.callout.weight(.medium))
              WrappingRow(spacing: 4) {
                ForEach(task.tags, id: \.self) { tag in
                  TaskTagBadge(tag: tag)
                }
              }
            }
            .padding(12)
            .frame(width: 256, alignment: .leading)
          }
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text("Tags", tableName: chatTasksTable, comment: "A Task card's tags: the list's label and the popover's title."))
    }
  }
}

/// Web's outline `Badge` for one tag.
private struct TaskTagBadge: View {
  let tag: ResultTaskCard.Tag

  var body: some View {
    Text(tag.label)
      .font(.caption)
      .foregroundStyle(.secondary)
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color.primary.opacity(0.15)))
  }
}

/// Web `TaskRunAtBadge`: when a Queued Task starts, relative while it is close; the full date and time on hover.
private struct TaskRunAtLabel: View {
  let runAt: Date
  @Environment(\.timeFormat) private var timeFormat
  @Environment(\.locale) private var locale

  var body: some View {
    TimelineView(.everyMinute) { context in
      Label {
        label(TaskRunTime(runAt: runAt, now: context.date))
          .monospacedDigit()
          .lineLimit(1)
      } icon: {
        Image(systemName: "calendar.badge.clock").accessibilityHidden(true)
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      .labelStyle(TaskMetaLabelStyle())
      .help(timeFormat.dateTime(runAt, locale: locale))
    }
  }

  private func label(_ time: TaskRunTime) -> Text {
    switch time {
    case .overdue:
      Text("Starting soon", tableName: chatTasksTable, comment: "A Queued Task's start has passed.")
    case let .inMinutes(minutes):
      Text("Starts in \(minutes) minutes", tableName: chatTasksTable, comment: "A Queued Task starts within the hour. Argument: minutes.")
    case let .inHours(hours):
      Text("Starts in \(hours) hours", tableName: chatTasksTable, comment: "A Queued Task starts within the day. Argument: hours.")
    case let .tomorrow(date):
      Text("Starts tomorrow at \(timeFormat.time(date, locale: locale))", tableName: chatTasksTable,
           comment: "A Queued Task starts tomorrow. Argument: the clock time.")
    case let .later(date):
      Text("Starts \(timeFormat.monthDayTime(date, locale: locale))", tableName: chatTasksTable,
           comment: "A Queued Task starts later. Argument: the date and time.")
    }
  }
}

/// Web `TaskActorCluster`: up to three overlapping faces, the assignee first, then `+N`; a "?" face for nobody.
/// Named by everyone's names, as web's label and tooltip.
private struct TaskActorCluster: View {
  let task: ResultTaskCard
  private let size: CGFloat = 20

  var body: some View {
    HStack(spacing: -6) {
      if task.faces.isEmpty {
        ParticipantAvatar(imageURL: nil, name: "", size: size, monogram: true)
      }
      ForEach(Array(task.faces.enumerated()), id: \.element.id) { index, actor in
        ParticipantAvatar(imageURL: actor.imageURL, name: actor.name, size: size, monogram: true)
          .background(Circle().fill(.background).padding(-2))
          .zIndex(Double(task.faces.count - index))
      }
      if task.hiddenFaceCount > 0 {
        Text(verbatim: "+\(task.hiddenFaceCount)")
          .font(.system(size: 10, weight: .medium))
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .padding(.horizontal, 4)
          .frame(minWidth: size, minHeight: size)
          .background(Capsule().fill(.quaternary).background(.background, in: .capsule))
          .background(Capsule().fill(.background).padding(-2))
          // Above the last face, so the count stays legible.
          .zIndex(Double(task.faces.count + 1))
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(task.actorNames)
    .help(task.actorNames)
  }
}

/// Web's card meta on the right: the comment count when there are any, and the day the Task was created.
private struct TaskCardFacts: View {
  let task: ResultTaskCard
  @Environment(\.locale) private var locale

  var body: some View {
    HStack(spacing: 8) {
      if task.commentsCount > 0 {
        Label {
          Text(task.commentsCount, format: .number)
        } icon: {
          Image(systemName: "message").accessibilityHidden(true)
        }
      }
      Label {
        Text(task.createdAt.formatted(Date.FormatStyle(locale: locale).month(.abbreviated).day()))
      } icon: {
        Image(systemName: "calendar").accessibilityHidden(true)
      }
    }
    .labelStyle(TaskMetaLabelStyle())
    .font(.caption2)
    .monospacedDigit()
    .foregroundStyle(.secondary)
  }
}

/// A small glyph tight beside its text, as web's `gap-1` icon rows.
private struct TaskMetaLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon
      configuration.title
    }
  }
}

extension TaskStatusTone.Hue {
  /// System colours standing in for web's status tokens: grey, indigo, purple, orange, green and red.
  var color: Color {
    switch self {
    case .dormant: .gray
    case .staged: .indigo
    case .active: .purple
    case .blocked: .orange
    case .resolved: .green
    case .fault: .red
    }
  }
}

extension ResultTaskCard.Status {
  /// Web's `MARKER_ICONS` (lucide) as SF Symbols.
  var systemImage: String {
    switch self {
    case .draft: "pencil.line"
    case .queued: "clock"
    case .ready: "play.circle"
    case .grantPending: "exclamationmark.shield"
    case .inputRequired: "exclamationmark.bubble"
    case .approvalRequired: "checkmark.seal"
    case .authenticationRequired: "key"
    case .outOfCredits: "wallet.bifold"
    case .creditsToppedUp: "plus.circle"
    case .running: "progress.indicator"
    case .awaitingExternal: "hourglass"
    case .completed: "checkmark.circle"
    case .failed: "xmark.circle"
    case .canceled: "slash.circle"
    }
  }

  /// Web `App.Tasks.Filters.statusOptions`, which the chat passes to the card.
  var label: LocalizedStringResource {
    switch self {
    case .draft: Self.resource("taskStatus.DRAFT", "Draft")
    case .queued: Self.resource("taskStatus.QUEUED", "Scheduled")
    case .ready: Self.resource("taskStatus.READY", "Ready")
    case .grantPending: Self.resource("taskStatus.GRANT_PENDING", "Grant pending")
    case .inputRequired: Self.resource("taskStatus.INPUT_REQUIRED", "Input required")
    case .approvalRequired: Self.resource("taskStatus.APPROVAL_REQUIRED", "Approval required")
    case .authenticationRequired: Self.resource("taskStatus.AUTHENTICATION_REQUIRED", "Authentication required")
    case .outOfCredits: Self.resource("taskStatus.OUT_OF_CREDITS", "Paused: credits needed")
    case .creditsToppedUp: Self.resource("taskStatus.CREDITS_TOPPED_UP", "Credits topped up")
    case .running: Self.resource("taskStatus.RUNNING", "Running")
    case .awaitingExternal: Self.resource("taskStatus.AWAITING_EXTERNAL", "Awaiting external")
    case .completed: Self.resource("taskStatus.COMPLETED", "Completed")
    case .failed: Self.resource("taskStatus.FAILED", "Failed")
    case .canceled: Self.resource("taskStatus.CANCELED", "Canceled")
    }
  }

  private static func resource(_ key: StaticString, _ english: String.LocalizationValue) -> LocalizedStringResource {
    LocalizedStringResource(key, defaultValue: english, table: chatTasksTable, comment: "A Task card's status badge.")
  }
}

extension ResultTaskCard.Priority {
  /// Web `App.Tasks.Priority.levels`, the mark's spoken name.
  var label: Text {
    switch self {
    case .urgent: Text(LocalizedStringResource("taskPriority.URGENT", defaultValue: "Urgent", table: chatTasksTable))
    case .high: Text(LocalizedStringResource("taskPriority.HIGH", defaultValue: "High", table: chatTasksTable))
    case .medium: Text(LocalizedStringResource("taskPriority.MEDIUM", defaultValue: "Medium", table: chatTasksTable))
    case .low: Text(LocalizedStringResource("taskPriority.LOW", defaultValue: "Low", table: chatTasksTable))
    case .none: Text(verbatim: "")
    }
  }
}

extension ResultTaskCard.Tag {
  /// Web `App.Tasks.Tags.vocabulary`.
  var label: LocalizedStringResource {
    switch self {
    case .research: LocalizedStringResource("taskTag.research", defaultValue: "Research", table: chatTasksTable)
    case .strategy: LocalizedStringResource("taskTag.strategy", defaultValue: "Strategy", table: chatTasksTable)
    case .writing: LocalizedStringResource("taskTag.writing", defaultValue: "Writing", table: chatTasksTable)
    case .design: LocalizedStringResource("taskTag.design", defaultValue: "Design", table: chatTasksTable)
    case .analysis: LocalizedStringResource("taskTag.analysis", defaultValue: "Analysis", table: chatTasksTable)
    case .development: LocalizedStringResource("taskTag.development", defaultValue: "Development", table: chatTasksTable)
    case .marketing: LocalizedStringResource("taskTag.marketing", defaultValue: "Marketing", table: chatTasksTable)
    case .social: LocalizedStringResource("taskTag.social", defaultValue: "Social media", table: chatTasksTable)
    case .seo: LocalizedStringResource("taskTag.seo", defaultValue: "SEO", table: chatTasksTable)
    case .operations: LocalizedStringResource("taskTag.operations", defaultValue: "Operations", table: chatTasksTable)
    }
  }
}
