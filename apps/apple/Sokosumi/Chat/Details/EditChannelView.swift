import CoreAPI
import SokosumiChat
import SwiftUI

/// Web `edit-channel-dialog.tsx`: the admin-only channel settings (name, topic, visibility) and Archive. Membership,
/// guest access and Leave live in the members panel (SOK-1258).
struct EditChannelView: View {
  let room: Components.Schemas.ChatRoom
  let save: (ChannelEditDraft) async throws -> Bool
  let requestArchive: () -> Void

  @StateObject private var model: ChannelEditing
  @Environment(\.dismiss) private var dismiss

  init(room: Components.Schemas.ChatRoom, model: ChannelEditing? = nil, save: @escaping (ChannelEditDraft) async throws -> Bool,
       requestArchive: @escaping () -> Void) {
    self.room = room
    self.save = save
    self.requestArchive = requestArchive
    _model = StateObject(wrappedValue: model ?? ChannelEditing(room: room))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Channel settings").font(.title2).fontWeight(.semibold)
      if let slug = model.room.slug, !slug.isEmpty {
        Text("#\(slug)").foregroundStyle(.secondary)
      }
      settings
      if let error = model.errorMessage {
        Text(error).foregroundStyle(.red).font(.callout)
      }
      Divider()
      Text("Manage channel").font(.headline)
      Button("Archive channel…", systemImage: "archivebox", role: .destructive, action: requestArchive)
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Button(model.saving ? "Saving…" : "Save") {
          Task {
            if await model.save(using: save) {
              dismiss()
            }
          }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(!model.canSave)
      }
    }
    .padding(20)
    .frame(width: 480)
    .disabled(model.saving)
    .interactiveDismissDisabled(model.saving)
    .onChange(of: room) { _, room in
      Task { @MainActor in model.updateRoom(room) }
    }
  }

  private var settings: some View {
    Form {
      TextField("Display name", text: Binding(get: { model.draft.name }, set: { model.draft.setName($0) }))
      TextField("Topic (optional)", text: Binding(get: { model.draft.topic }, set: { model.draft.setTopic($0) }), axis: .vertical)
        .lineLimit(3 ... 5)
      Picker("Visibility", selection: $model.draft.visibility) {
        Text("Public").tag(ChannelDraft.Visibility.public)
        Text("Private").tag(ChannelDraft.Visibility.private)
        Text("External").tag(ChannelDraft.Visibility.external)
      }
      Text(model.draft.visibility.help).font(.caption).foregroundStyle(.secondary)
    }
    .formStyle(.grouped)
    .frame(height: 230)
  }
}
