import CoreAPI
import SokosumiChat
import SwiftUI

#if os(macOS)
  /// Web `SkillPickerPanel` (row 42): a search field over skills.sh skills, the top skills before anything is typed.
  /// Each row names the skill, its compact install count and its description (or, without one, its source); an attached
  /// skill is dimmed with a check and cannot be picked again. Return picks the first skill not yet attached.
  struct SkillPickerView: View {
    let attached: Set<String>
    let search: (String) async throws -> [Components.Schemas.ChatSkillCatalogItem]
    let pick: (Components.Schemas.ChatSkillCatalogItem) -> Void
    @StateObject private var model = SkillSearch()
    @State private var query = ""
    @FocusState private var fieldFocused: Bool

    var body: some View {
      VStack(spacing: 0) {
        TextField("Search skills", text: $query)
          .textFieldStyle(.roundedBorder)
          .focused($fieldFocused)
          .accessibilityLabel("Search skills")
          .onSubmit {
            if let first = model.firstPickable(for: query, excluding: attached) {
              pick(first)
            }
          }
          .padding(8)
        Divider()
        results
          .frame(minHeight: 96, maxHeight: 340)
      }
      .frame(width: 320)
      .task(id: SkillSearch.normalized(query)) {
        await model.search(query, using: search)
      }
      .task {
        fieldFocused = true
      }
    }

    @ViewBuilder private var results: some View {
      if let placeholder = model.placeholder {
        Text(Self.text(placeholder))
          .font(.callout)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 8)
          .padding(.vertical, 24)
          .frame(maxWidth: .infinity)
      } else {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(model.results, id: \.id) { item in
              SkillPickerRow(item: item, attached: attached.contains(item.id)) { pick(item) }
            }
          }
          .padding(4)
        }
        .accessibilityLabel("Skills from skills.sh")
      }
    }

    static func text(_ placeholder: SkillSearch.Placeholder) -> String {
      switch placeholder {
      case .loading: "Loading skills…"
      case .unavailable: "Skills could not be loaded. Try again."
      case .noResults: "No skills found"
      }
    }
  }

  private struct SkillPickerRow: View {
    let item: Components.Schemas.ChatSkillCatalogItem
    let attached: Bool
    let pick: () -> Void
    @State private var hovered = false
    @Environment(\.locale) private var locale

    var body: some View {
      Button(action: pick) {
        HStack(alignment: .top, spacing: 8) {
          VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(item.name)
                .font(.callout.weight(.medium))
                .lineLimit(1)
                .truncationMode(.tail)
              Text(MessageSkills.installsLabel(item.installs, locale: locale))
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .fixedSize()
            }
            Text(item.description ?? item.source)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(2)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          if attached {
            Image(systemName: "checkmark")
              .foregroundStyle(.secondary)
              .accessibilityLabel("Added")
          }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(hovered && !attached ? Color.primary.opacity(0.08) : .clear, in: .rect(cornerRadius: 6))
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .disabled(attached)
      .opacity(attached ? 0.6 : 1)
      .onHover { hovered = $0 }
    }
  }
#endif
