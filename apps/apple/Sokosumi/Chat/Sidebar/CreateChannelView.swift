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
      } else if model.roster == nil || model.roster?.recipients.membersLoadFailed == true {
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
          .disabled(model.loading || model.roster?.recipients.membersLoadFailed != false)
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
      TextField("Channel handle", text: Binding(get: { model.draft.slug }, set: { model.draft.setSlug($0) }))
        .focused($slugFocused)
        .task { slugFocused = true }
        .autocorrectionDisabled()
      HStack {
        Text(slugStatus).font(.caption).foregroundStyle(.secondary)
        if model.availability == .failed {
          Button("Retry") { slugRetry += 1 }
        }
      }
      TextField("Display name", text: Binding(get: { model.draft.name }, set: { model.draft.setName($0) }))
      TextField("Topic (optional)", text: Binding(get: { model.draft.topic }, set: { model.draft.setTopic($0) }), axis: .vertical)
        .lineLimit(3 ... 5)
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
    .frame(height: 320)
  }

  private var participants: some View {
    VStack(alignment: .leading, spacing: 12) {
      Picker("Add people", selection: $model.draft.addAllMembers) {
        Text("Everyone in \(organizationName)").tag(true)
        Text("Specific people or AI coworkers").tag(false)
      }
      .pickerStyle(.radioGroup)
      if !model.draft.addAllMembers {
        RecipientSelectionList(sections: model.sections, currentUserId: currentUserId, query: $model.query, selection: $model.draft.recipients)
      } else {
        Text("You are always included in the channel.").font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var slugStatus: String {
    switch model.availability {
    case .invalid: "Choose a channel handle."
    case .checking: "Checking availability…"
    case .free: "This handle is available."
    case .taken: "This handle is already taken."
    case .failed: "Couldn’t check availability."
    }
  }
}
