import CoreAPI
import SokosumiChat
import SwiftUI

/// Web `edit-channel-dialog.tsx`: settings for organization owners/admins, roster for any host member, guest access
/// for host members of external channels.
struct EditChannelView: View {
  let currentUserId: String
  let load: () async throws -> ChannelRoster
  let save: (ChannelEditDraft, ChannelEditPermissions) async throws -> Bool
  let requestLifecycle: (ChannelLifecycleAction) -> Void
  let guestAccess: GuestAccessActions

  @StateObject private var model: ChannelEditing
  @State private var retry = 0
  @Environment(\.dismiss) private var dismiss

  init(room: Components.Schemas.ChatRoom, currentUserId: String, model: ChannelEditing? = nil, load: @escaping () async throws -> ChannelRoster,
       save: @escaping (ChannelEditDraft, ChannelEditPermissions) async throws -> Bool, requestLifecycle: @escaping (ChannelLifecycleAction) -> Void,
       guestAccess: GuestAccessActions) {
    self.currentUserId = currentUserId
    self.load = load
    self.save = save
    self.requestLifecycle = requestLifecycle
    self.guestAccess = guestAccess
    _model = StateObject(wrappedValue: model ?? ChannelEditing(room: room))
  }

  /// Web's dialog scrolls within the viewport; the Cancel/Save row stays put below the scrolling content.
  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Channel settings").font(.title2).fontWeight(.semibold)
          if let slug = model.room.slug, !slug.isEmpty {
            Text("#\(slug)").foregroundStyle(.secondary)
          }
          if model.loading {
            ProgressView("Loading participants…").frame(maxWidth: .infinity, minHeight: 160)
          } else if model.roster == nil || model.roster?.recipients.membersLoadFailed == true {
            Text(model.errorMessage ?? "Couldn’t load organization members.").foregroundStyle(.secondary)
            Button("Retry") { retry += 1 }
          } else {
            if model.permissions?.canManageSettings == true {
              settings
            }
            Text("Participants").font(.headline)
            RecipientSelectionList(sections: model.sections, currentUserId: currentUserId, query: $model.query, selection: $model.draft.recipients)
          }
          if let error = model.errorMessage, model.roster != nil {
            Text(error).foregroundStyle(.red).font(.callout)
          }
          if ChannelEditPermissions.canInviteGuests(model.room) {
            GuestAccessSection(room: model.room, actions: guestAccess)
          }
          manageChannel
        }
        .padding(20)
      }
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
      .padding([.horizontal, .bottom], 20)
    }
    .frame(width: 480)
    .frame(maxHeight: 760)
    .disabled(model.saving)
    .interactiveDismissDisabled(model.saving)
    .task(id: retry) { await model.load(using: load) }
  }

  /// Web "Manage channel": Leave for any member but a host channel's last host, Archive for owners/admins once the role is known.
  @ViewBuilder
  private var manageChannel: some View {
    let canLeave = ChannelEditPermissions.canLeave(model.room)
    let canArchive = model.permissions?.canArchive == true
    if canLeave || canArchive {
      Divider()
      Text("Manage channel").font(.headline)
      HStack {
        if canLeave {
          Button("Leave channel…", systemImage: "rectangle.portrait.and.arrow.right") { requestLifecycle(.leave) }
        }
        if canArchive {
          Button("Archive channel…", systemImage: "archivebox", role: .destructive) { requestLifecycle(.archive) }
        }
      }
      .disabled(model.saving)
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
