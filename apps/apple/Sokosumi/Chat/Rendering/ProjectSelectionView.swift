import SokosumiChat
import SwiftUI

/// Web `ProjectSelectionMessage` (row 38h1): a check, "Selected project" and the project as a chip with its avatar
/// that opens the project on web. A reply to a project question draws this in place of its text; the answered
/// picker draws it too.
struct ProjectSelectionChip: View {
  let projectId: String
  let mark: ResultPreviewCard.ProjectMark
  @Environment(\.openURL) private var openURL
  @State private var hovered = false

  var body: some View {
    WrappingRow(spacing: 8) {
      HStack(spacing: 8) {
        Image(systemName: "checkmark")
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
        Text("Selected project", tableName: chatResultsTable, comment: "Before the project a reply to a Soko Bot chose.")
          .foregroundStyle(.secondary)
      }
      Button {
        if let url = ProjectSelection.projectURL(projectId: projectId, webBaseURL: CoreSettings.webBaseURL) {
          openURL(url)
        }
      } label: {
        HStack(spacing: 8) {
          ProjectMarkView(mark: mark)
          Text(mark.name)
            .fontWeight(.medium)
            .lineLimit(1)
            .truncationMode(.tail)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.primary.opacity(hovered ? 0.1 : 0.04), in: .rect(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.12)))
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .onHover { hovered = $0 }
      .help(mark.name)
      .accessibilityLabel(mark.name)
    }
    .font(.callout)
  }
}

/// Web `ChatProjectSelection`: a `project_selection` card is only its picker. Picking sends the choice to the bot
/// that asked; while it goes the picker is disabled under "Sending your choice…", a failure says so and keeps the
/// picker, and the sent choice replaces the picker with the chosen project's chip.
struct ProjectSelectionCard: View {
  let card: ResultPreviewCard
  /// Sends the pick (the project's id); absent where nothing can answer, as web's card without a `source`.
  let select: ((String) async throws -> Void)?
  @State private var selected: ResultPreviewCard.ProjectOption?
  @State private var sending = false
  @State private var failed = false
  @State private var picking = false
  @State private var hovered = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let selected {
        ProjectSelectionChip(projectId: selected.id, mark: selected.mark)
          .accessibilityElement(children: .combine)
          .accessibilityLabel(Text("Selected \(selected.name)", tableName: chatResultsTable,
                                   comment: "Accessibility label once a project was chosen. Argument: the project's name."))
      } else if !card.projectOptions.isEmpty, select != nil {
        trigger
      } else {
        noProjects.font(.callout)
      }
      if sending {
        Text("Sending your choice…", tableName: chatResultsTable, comment: "While a chosen project is sent to the Soko Bot.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      if failed {
        Text("Could not send your choice. Please try again.", tableName: chatResultsTable,
             comment: "When the chosen project could not be sent to the Soko Bot.")
          .font(.caption)
          .foregroundStyle(.red)
      }
    }
    .padding(12)
    // Web's `max-w-sm`.
    .frame(maxWidth: 384, alignment: .leading)
    .background(.background, in: .rect(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12)))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text("Choose a project", tableName: chatResultsTable, comment: "A Soko Bot's question which project to use."))
  }

  /// Web `TaskProjectSelect`'s field: the placeholder and the up-down chevrons, opening the searchable list.
  private var trigger: some View {
    Button {
      picking = true
    } label: {
      HStack(spacing: 8) {
        Text("Choose a project", tableName: chatResultsTable, comment: "A Soko Bot's question which project to use.")
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: "chevron.up.chevron.down")
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
      }
      .font(.callout)
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(Color.primary.opacity(hovered ? 0.06 : 0), in: .rect(cornerRadius: 6))
      .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.15)))
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
    .disabled(sending)
    .popover(isPresented: $picking, arrowEdge: .bottom) {
      ProjectPickerList(options: card.projectOptions) { option in
        picking = false
        Task { await send(option) }
      }
    }
  }

  private var noProjects: some View {
    Text("No projects available. Ask the bot to refresh the choices.", tableName: chatResultsTable,
         comment: "When a Soko Bot's project question offers no project.")
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
  }

  /// Web `handleSelect`: one send at a time, and none once a choice went through.
  private func send(_ option: ResultPreviewCard.ProjectOption) async {
    guard let select, !sending, selected == nil else { return }
    sending = true
    failed = false
    do {
      try await select(option.id)
      selected = option
    } catch {
      failed = true
    }
    sending = false
  }
}

/// Web `TaskProjectSelect`'s list: a search field over the options, each with its avatar and name; Return picks the
/// first match, as `cmdk` picks its highlighted first row.
struct ProjectPickerList: View {
  let options: [ResultPreviewCard.ProjectOption]
  let pick: (ResultPreviewCard.ProjectOption) -> Void
  @State private var query = ""
  @FocusState private var fieldFocused: Bool

  var body: some View {
    let matches = ProjectSelection.options(options, matching: query)
    VStack(spacing: 0) {
      TextField(text: $query) {
        Text("Search projects…", tableName: chatResultsTable, comment: "Placeholder of the project search.")
      }
      .textFieldStyle(.roundedBorder)
      .focused($fieldFocused)
      .onSubmit {
        if let first = matches.first {
          pick(first)
        }
      }
      .padding(8)
      Divider()
      if matches.isEmpty {
        Text("No projects available. Ask the bot to refresh the choices.", tableName: chatResultsTable,
             comment: "When a Soko Bot's project question offers no project.")
          .font(.callout)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 8)
          .padding(.vertical, 24)
          .frame(maxWidth: .infinity)
      } else {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(matches) { option in
              ProjectPickerRow(option: option) { pick(option) }
            }
          }
          .padding(4)
        }
        // Web's list stops at 288 pt (`max-h-72`).
        .frame(maxHeight: 288)
        .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(width: 300)
    .task {
      fieldFocused = true
    }
  }
}

private struct ProjectPickerRow: View {
  let option: ResultPreviewCard.ProjectOption
  let pick: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: pick) {
      HStack(spacing: 8) {
        ProjectMarkView(mark: option.mark)
        Text(option.name)
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .font(.callout)
      .padding(.horizontal, 8)
      .padding(.vertical, 6)
      .background(hovered ? Color.primary.opacity(0.08) : .clear, in: .rect(cornerRadius: 6))
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
    .accessibilityLabel(option.name)
  }
}
