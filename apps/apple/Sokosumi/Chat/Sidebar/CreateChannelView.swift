import SokosumiChat
import SwiftUI

struct CreateChannelView: View {
  let currentUserId: String
  let organizationName: String
  let load: () async throws -> ChannelRoster
  let checkSlug: (String) async throws -> Bool
  let create: (ChannelDraft, ChatRecipientRoster) async throws -> Bool

  @StateObject private var model: ChannelCreation
  @State private var retry = 0
  @State private var slugRetry = 0
  @FocusState private var slugFocused: Bool
  @Environment(\.dismiss) private var dismiss

  init(currentUserId: String, organizationName: String, model: ChannelCreation = ChannelCreation(), load: @escaping () async throws -> ChannelRoster, checkSlug: @escaping (String) async throws -> Bool, create: @escaping (ChannelDraft, ChatRecipientRoster) async throws -> Bool) {
    self.currentUserId = currentUserId
    self.organizationName = organizationName
    self.load = load
    self.checkSlug = checkSlug
    self.create = create
    _model = StateObject(wrappedValue: model)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(model.step == .details ? "Create channel" : "Add people to \(model.draft.name)")
        .font(.title2).fontWeight(.semibold)
      if !model.draft.slug.isEmpty {
        Text("#\(model.draft.slug)").foregroundStyle(.secondary)
      }
      if model.loading {
        ProgressView("Loading participants…").frame(maxWidth: .infinity, minHeight: 160)
      } else if model.roster == nil || model.participantsUnavailable {
        Text(model.errorMessage ?? "Couldn’t load organization members.").foregroundStyle(.secondary)
        Button("Retry") { retry += 1 }
      } else if model.step == .details {
        details
      } else {
        participants
      }
      if let error = model.errorMessage, model.roster != nil {
        Text(error).foregroundStyle(.red).font(.callout)
      }
      HStack {
        if model.step == .participants {
          Button("Back") { model.back() }
        }
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        if model.step == .details {
          Button("Next") { model.advance() }.keyboardShortcut(.defaultAction).disabled(!model.canAdvance)
        } else {
          Button(model.creating ? "Creating…" : "Create channel") {
            Task {
              if await model.create(using: create) {
                dismiss()
              }
            }
          }
          .keyboardShortcut(.defaultAction)
          .disabled(model.loading || model.roster == nil || model.participantsUnavailable)
        }
      }
    }
    .padding(20)
    .frame(width: 480)
    .disabled(model.creating)
    .interactiveDismissDisabled(model.creating)
    .task(id: retry) { await model.load(using: load) }
    .task(id: model.draft.slug + "|\(slugRetry)|\(model.step)") {
      guard model.step == .details else { return }
      await model.checkSlug { slug in
        try await Task.sleep(for: .milliseconds(300))
        return try await checkSlug(slug)
      }
    }
  }

  private var details: some View {
    Form {
      TextField("Channel handle", text: Binding(get: { model.draft.slug }, set: { model.draft.setSlug($0) }), prompt: Text("welcome"))
        .focused($slugFocused)
        .task { slugFocused = true }
        .autocorrectionDisabled()
      HStack {
        Text(handleStatus).font(.caption).foregroundStyle(model.handleStatus.isError ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
        if model.availability == .failed {
          Button("Retry") { slugRetry += 1 }
        }
      }
      TextField("Display name", text: Binding(get: { model.draft.name }, set: { model.draft.setName($0) }), prompt: Text("e.g. Welcome"))
      HStack(alignment: .firstTextBaseline) {
        Text("Shown in the sidebar. It starts from the handle; you can change it here.").font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 12)
        RemainingCharacters(count: model.draft.remainingNameCharacters)
      }
      TextField("Topic (optional)", text: Binding(get: { model.draft.topic }, set: { model.draft.setTopic($0) }), prompt: Text("What is this channel about?"), axis: .vertical)
        .lineLimit(3 ... 5)
      RemainingCharacters(count: model.draft.remainingTopicCharacters)
        .frame(maxWidth: .infinity, alignment: .trailing)
      Picker("Visibility", selection: $model.draft.visibility) {
        Text("Public").tag(ChannelDraft.Visibility.public)
        Text("Private").tag(ChannelDraft.Visibility.private)
        if model.roster?.isOwnerOrAdmin == true {
          Text("External").tag(ChannelDraft.Visibility.external)
        }
      }
      Text(model.draft.visibility.help).font(.caption).foregroundStyle(.secondary)
    }
    .formStyle(.grouped)
    .frame(height: 420)
  }

  private var participants: some View {
    VStack(alignment: .leading, spacing: 12) {
      Picker("Add people", selection: $model.draft.addAllMembers) {
        Text("Add all \(model.roster?.organizationMemberCount ?? 0) members of \(organizationName)").tag(true)
        VStack(alignment: .leading, spacing: 2) {
          Text("Add specific people")
          Text("Select people and AI coworkers to add to this channel.").font(.caption).foregroundStyle(.secondary)
        }
        .tag(false)
      }
      .pickerStyle(.radioGroup)
      if !model.draft.addAllMembers {
        RecipientSelectionList(sections: model.sections, currentUserId: currentUserId, query: $model.query, selection: $model.draft.recipients)
      }
    }
  }

  /// Web's single line under the handle: help unless the check runs or failed.
  private var handleStatus: LocalizedStringKey {
    switch model.handleStatus {
    case .help: "Unique among channels. You cannot change it after creating."
    case .checking: "Checking handle…"
    case .invalid: "Enter a valid handle."
    case .taken: "This channel handle already exists. Browse channels to find it."
    case .failed: "Could not check this handle. Try again."
    }
  }
}

/// Web's live counter beside a length-limited field: the characters still left, never below 0. Hidden from VoiceOver as on web.
private struct RemainingCharacters: View {
  let count: Int

  var body: some View {
    Text(count, format: .number)
      .font(.caption)
      .monospacedDigit()
      .foregroundStyle(.secondary)
      .accessibilityHidden(true)
  }
}
