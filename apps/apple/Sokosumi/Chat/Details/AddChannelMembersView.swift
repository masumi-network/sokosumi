import CoreAPI
import SokosumiChat
import SwiftUI

/// The members panel's Add picker (SOK-1258): people, Coworkers and the caller's own Soko Bot who are not in the
/// Channel yet, added with one confirm. On an External channel a second tab hosts the guest invitations and links.
struct AddChannelMembersView: View {
  let room: Components.Schemas.ChatRoom
  let currentUserId: String
  let load: () async throws -> ChatRecipientRoster
  let add: (Set<DirectRecipient>) async throws -> Bool
  let guestAccess: GuestAccessActions

  @StateObject private var model: ChannelMemberAddition
  @State private var tab = Tab.organization
  @State private var retry = 0
  @Environment(\.dismiss) private var dismiss

  private enum Tab: Hashable {
    case organization, outside
  }

  init(room: Components.Schemas.ChatRoom, currentUserId: String, model: ChannelMemberAddition? = nil,
       load: @escaping () async throws -> ChatRecipientRoster, add: @escaping (Set<DirectRecipient>) async throws -> Bool,
       guestAccess: GuestAccessActions) {
    self.room = room
    self.currentUserId = currentUserId
    self.load = load
    self.add = add
    self.guestAccess = guestAccess
    _model = StateObject(wrappedValue: model ?? ChannelMemberAddition(room: room))
  }

  var body: some View {
    let invitesGuests = ChannelEditPermissions.canInviteGuests(model.room)
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Add members").font(.title2).fontWeight(.semibold)
        Text("Add people, coworkers, and your personal assistants to \(model.room.name).").foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      if invitesGuests {
        Picker("Add from", selection: $tab) {
          Text("From your organization").tag(Tab.organization)
          Text("Invite from outside").tag(Tab.outside)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
      }
      if invitesGuests, tab == .outside {
        ScrollView {
          GuestAccessSection(room: model.room, actions: guestAccess)
        }
        .frame(maxHeight: 520)
        HStack {
          Spacer()
          Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
        }
      } else {
        members
        HStack {
          Spacer()
          Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
          Button(model.adding ? "Adding…" : "Add") {
            Task {
              if await model.add(using: add) {
                dismiss()
              }
            }
          }
          .keyboardShortcut(.defaultAction)
          .disabled(!model.canAdd)
        }
      }
    }
    .padding(20)
    .frame(width: 480)
    .interactiveDismissDisabled(model.adding)
    .task(id: retry) { await model.load(using: load) }
    .onChange(of: room) { _, room in
      Task { @MainActor in model.updateRoom(room) }
    }
  }

  @ViewBuilder
  private var members: some View {
    if model.loading {
      ProgressView("Loading participants…").frame(maxWidth: .infinity, minHeight: 160)
    } else if model.roster == nil {
      Text(model.errorMessage ?? "Couldn’t load participants.").foregroundStyle(.secondary)
      Button("Retry") { retry += 1 }
    } else if model.nobodyToAdd {
      Text("Everyone you can add is already in this channel.").foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, minHeight: 80)
    } else {
      RecipientSelectionList(sections: model.sections, currentUserId: currentUserId, query: $model.query, selection: $model.selection,
                             membersLoadFailed: model.membersLoadFailed, retryMembers: { retry += 1 }, note: nil)
        .disabled(model.adding)
      if let error = model.errorMessage {
        Text(error).foregroundStyle(.red).font(.callout)
      }
    }
  }
}
