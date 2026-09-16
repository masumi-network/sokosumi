import SokosumiChat
import SwiftUI

struct StartDirectView: View {
  let load: () async throws -> DirectRecipientRoster
  let open: (DirectConversationSelection) async throws -> Bool
  @Environment(\.dismiss) private var dismiss
  @StateObject private var picker: DirectRecipientPicker
  @State private var retry = 0
  @FocusState private var searchFocused: Bool

  init(
    hasOrganization: Bool,
    load: @escaping () async throws -> DirectRecipientRoster,
    open: @escaping (DirectConversationSelection) async throws -> Bool
  ) {
    self.load = load
    self.open = open
    _picker = StateObject(wrappedValue: DirectRecipientPicker(hasOrganization: hasOrganization))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Start Direct").font(.title2).fontWeight(.semibold)
        Text("Choose people or an AI coworker to start a conversation.")
          .foregroundStyle(.secondary)
      }
      if !picker.selectedTargets.isEmpty {
        ScrollView(.horizontal) {
          HStack(spacing: 8) {
            ForEach(picker.selectedTargets) { target in
              HStack(spacing: 6) {
                ParticipantAvatar(imageURL: target.imageURL, name: target.name)
                Text(target.name).lineLimit(1).frame(maxWidth: 160)
                Button {
                  picker.remove(target.id)
                  searchFocused = true
                } label: {
                  Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(target.name)")
                .help("Remove \(target.name)")
              }
                      .padding(.vertical, 5)
              .background(.quaternary, in: Capsule())
            }
          }
        }
        .scrollIndicators(.hidden)
        .disabled(picker.creating)
      }
      TextField(searchPlaceholder, text: $picker.query)
        .accessibilityLabel("Search people or AI coworkers")
        .textFieldStyle(.roundedBorder)
        .focused($searchFocused)
        .onSubmit(startDirect)
        .disabled(picker.creating)
      roster
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      if let error = picker.creationError {
        Text(error).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
      }
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }
          .keyboardShortcut(.cancelAction)
          .disabled(picker.creating)
        Button(action: startDirect) {
          HStack(spacing: 6) {
            if picker.creating {
              ProgressView().controlSize(.small)
            }
            Text(picker.creating ? "Opening…" : "Start Direct")
          }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(picker.creating || picker.loading || picker.errorMessage != nil || picker.selectedTargets.isEmpty)
      }
    }
    .padding(20)
    .frame(minWidth: 420, idealWidth: 480, maxWidth: 600, minHeight: 420, idealHeight: 500)
    .interactiveDismissDisabled(picker.creating)
    .task(id: retry) {
      searchFocused = true
      await picker.load(using: load)
    }
  }

  private func startDirect() {
    Task { @MainActor in
      if await picker.create(using: open) {
        dismiss()
      }
    }
  }

  private var searchPlaceholder: String {
    switch picker.selection.recipients.first {
    case nil: "Search people or AI coworkers"
    case .human: "Add more people"
    case .coworker, .sokoBot: "Replace recipient"
    }
  }

  @ViewBuilder
  private var roster: some View {
    if picker.loading {
      ProgressView("Loading recipients…")
    } else if let error = picker.errorMessage {
      VStack(spacing: 12) {
        Text("Couldn’t load recipients").font(.headline)
        Text(error).foregroundStyle(.secondary).multilineTextAlignment(.center)
        Button("Retry") { retry += 1 }
      }
    } else {
      VStack(spacing: 8) {
        if picker.roster.membersLoadFailed {
          HStack {
            Text("Couldn’t load people. AI coworkers are still available.")
              .font(.callout).foregroundStyle(.secondary)
            Spacer()
            Button("Retry") { retry += 1 }.disabled(picker.creating)
          }
          .padding(10)
          .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        }
        if picker.candidates.isEmpty {
          Text(picker.query.isEmpty ? "No more recipients" : "No matching recipients")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          ScrollViewReader { proxy in
            List(picker.candidates) { target in
              HStack {
                DirectRecipientRow(target: target, disabledReason: picker.selection.disabledReason(for: target.id)) {
                  picker.add(target)
                  searchFocused = true
                }
              }
              .listRowSeparator(.hidden)
              .listRowInsets(.horizontal, 0)
              .listRowInsets(.vertical, 2)
            }
            .listStyle(.plain)
            .contentMargins(0, for: .scrollContent)
            .disabled(picker.creating)
            .onChange(of: picker.selection) { _, _ in
              if let first = picker.candidates.first {
                proxy.scrollTo(first.id, anchor: .top)
              }
            }
            .onChange(of: picker.query) { _, _ in
              if let first = picker.candidates.first {
                proxy.scrollTo(first.id, anchor: .top)
              }
            }
          }
        }
      }
    }
  }
}

private struct DirectRecipientRow: View {
  let target: DirectRecipientTarget
  let disabledReason: String?
  let select: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: select) {
      HStack(spacing: 10) {
        ParticipantAvatar(imageURL: target.imageURL, name: target.name, size: 32)
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 5) {
            Text(target.name).lineLimit(1)
            if case .human = target.id {} else {
              Image(systemName: "sparkles").foregroundStyle(.secondary).font(.caption)
                .accessibilityLabel(badge)
            }
          }
          if !target.detail.isEmpty {
            Text(target.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(.vertical, 6)
      .contentShape(Rectangle())
      .background(hovering && disabledReason == nil ? Color.primary.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 6))
    }
    .buttonStyle(.plain)
    .disabled(disabledReason != nil)
    .opacity(disabledReason == nil ? 1 : 0.5)
    .onHover { hovering = $0 }
    .help(disabledReason ?? "Add \(target.name)")
    .accessibilityHint(disabledReason ?? "Add recipient")
  }

  private var badge: String {
    if case .sokoBot = target.id {
      return "Personal assistant"
    }
    return "AI coworker"
  }
}

#Preview("Start Direct") {
  StartDirectView(hasOrganization: true, load: {
    .init(targets: [
      .init(id: .human("one"), name: "Alexandra Long Recipient Name", detail: "alexandra@example.com"),
      .init(id: .human("two"), name: "Sam Rivera", detail: "sam@example.com"),
      .init(id: .coworker("ai"), name: "Research assistant", detail: "Research and analysis"),
      .init(id: .sokoBot("bot"), name: "Personal assistant")
    ])
  }, open: { _ in false })
    .frame(width: 480, height: 500)
}
