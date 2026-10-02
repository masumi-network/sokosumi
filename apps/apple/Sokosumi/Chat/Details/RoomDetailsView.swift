import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

struct RoomDetailsView: View {
  let room: Components.Schemas.ChatRoom
  let close: () -> Void
  @EnvironmentObject private var workspaces: WorkspaceState
  @EnvironmentObject private var auth: AuthState
  @State private var errorMessage: String?
  @State private var directRequestId: UUID?
  @State private var selectedProfile: ChatParticipantProfile?
  @State private var editChannel: RoomEditPresentation?
  @State private var addMembers: RoomEditPresentation?
  @State private var nameGroup: RoomEditPresentation?
  @State private var lifecycle: ChannelLifecycleRequest?
  @State private var removal: RoomRosterMember?

  /// The members panel manages membership (SOK-1258); settings stay with organization owners and admins.
  private var permissions: ChannelEditPermissions {
    ChannelEditPermissions(room: room, isOwnerOrAdmin: workspaces.isOrganizationOwnerOrAdmin)
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Members").font(.headline)
        Spacer()
        if permissions.canEditMembers {
          Button("Add members…", systemImage: "person.badge.plus") {
            addMembers = .init(id: workspaces.compositionContext, roomId: room.id)
          }
          .labelStyle(.iconOnly).buttonStyle(.borderless).help("Add members")
          .disabled(workspaces.roomMutationInFlight)
        }
        Button("Close", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly).buttonStyle(.borderless).help("Close members")
      }.padding()
      List {
        if room.kind == .channel {
          Section("Channel") {
            Text(room.name).font(.headline)
            Text(ChannelMark(room.discoverability).channelDescription).foregroundStyle(.secondary)
            if let topic = room.topic?.trimmingCharacters(in: .whitespacesAndNewlines), !topic.isEmpty {
              Text(topic).textSelection(.enabled)
            }
            if permissions.canManageSettings {
              Button("Channel settings…") {
                editChannel = .init(id: workspaces.compositionContext, roomId: room.id)
              }
            }
            if ChannelEditPermissions.canLeave(room) {
              Button("Leave channel…") {
                lifecycle = .init(context: workspaces.compositionContext, roomId: room.id, name: room.name, action: .leave)
              }
              .disabled(workspaces.roomMutationInFlight)
            }
          }
        }
        if GroupNameDraft.canName(room) {
          Section {
            if let groupName = room.groupName {
              Text(groupName).font(.headline)
            }
            Button {
              nameGroup = .init(id: workspaces.compositionContext, roomId: room.id)
            } label: {
              NameGroupLabel()
            }
            .disabled(workspaces.roomMutationInFlight)
          } header: {
            Text("Group", tableName: groupNameTable, comment: "Members inspector section for a group Direct's name.")
          }
        }
        Section {
          let members = RoomRoster.members(in: room)
          if members.isEmpty {
            Text("No members.").foregroundStyle(.secondary)
          }
          ForEach(members) { member in
            managedRow(member)
          }
        }
        let guests = RoomRoster.guests(in: room)
        if !guests.isEmpty {
          Section("Guests") {
            ForEach(guests) { guest in
              managedRow(guest)
            }
          }
        }
      }.listStyle(.plain)
      if let errorMessage {
        Text(errorMessage).font(.callout).foregroundStyle(.red).padding()
      }
    }
    .popover(item: $selectedProfile) { ParticipantDetailsView(profile: $0) }
    .modifier(EditChannelSheet(presentation: $editChannel))
    .modifier(AddChannelMembersSheet(presentation: $addMembers))
    .modifier(NameGroupSheet(presentation: $nameGroup))
    .modifier(ChannelLifecycleConfirmation(request: $lifecycle))
    .alert(removalTitle, isPresented: Binding(get: { removal != nil }, set: {
      if !$0 {
        removal = nil
      }
    }), presenting: removal) { member in
      Button("Cancel", role: .cancel) {}
      Button("Remove", role: .destructive) { remove(member) }
    } message: { member in
      Text("\(member.profile.name) will no longer see this channel or its messages.")
    }
    .onDisappear { directRequestId = nil }
    .onChange(of: room.id) { _, _ in
      directRequestId = nil
      errorMessage = nil
      selectedProfile = nil
      editChannel = nil
      addMembers = nil
      nameGroup = nil
      lifecycle = nil
      removal = nil
    }
  }

  private func memberRow(_ member: RoomRosterMember) -> some View {
    let presence = workspaces.presence(for: member.profile)
    return HStack(spacing: 8) {
      // Web keeps the mark decorative and states availability in hidden text
      // per row; here the avatar button carries it as its value.
      Button { selectedProfile = member.profile } label: {
        ParticipantAvatar(imageURL: member.profile.image, name: member.profile.name, size: 32)
          .presenceBadge(presence)
      }
      .buttonStyle(.plain).help("Show participant details")
      .accessibilityLabel("Show details for \(member.profile.name)")
      .accessibilityValue(presenceLabel(presence))
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(member.profile.name).lineLimit(1)
          if let badge = roleBadge(member.profile) {
            Text(badge).font(.caption).foregroundStyle(.secondary).lineLimit(1).layoutPriority(1)
          }
        }
        if let subtitle = member.subtitle, !subtitle.isEmpty {
          CopyTextButton(text: subtitle).font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      if workspaces.canOpenDirect(member.id) {
        Button {
          errorMessage = nil
          let requestId = UUID()
          directRequestId = requestId
          Task { @MainActor in
            do {
              _ = try await workspaces.openParticipantDirect(member.id, auth: auth)
            } catch {
              if directRequestId == requestId {
                errorMessage = friendlyMessage(for: error)
              }
            }
          }
        } label: {
          if workspaces.openingDirect == member.id {
            ProgressView().controlSize(.mini)
          } else {
            Image(systemName: "bubble.left")
          }
        }
        .buttonStyle(.borderless)
        .disabled(workspaces.openingDirect != nil)
        .help("Message \(member.profile.name)")
        .accessibilityLabel("Message \(member.profile.name)")
      }
    }.padding(.vertical, 2)
  }

  /// Remove sits in the row's context menu on macOS and iOS, and in a trailing swipe on iOS.
  private func managedRow(_ member: RoomRosterMember) -> some View {
    memberRow(member)
      .contextMenu { removeAction(member) }
    #if os(iOS)
      .swipeActions { removeAction(member) }
    #endif
  }

  /// Shown only where Core would accept it; a person's removal asks first, a Coworker or own Soko Bot goes at once.
  @ViewBuilder
  private func removeAction(_ member: RoomRosterMember) -> some View {
    if permissions.canRemove(member.id, in: room, currentUserId: workspaces.currentUserId) {
      let title: LocalizedStringKey = isPerson(member) ? "Remove from channel…" : "Remove from channel"
      Button(title, systemImage: "person.badge.minus", role: .destructive) {
        guard !workspaces.roomMutationInFlight else { return }
        if isPerson(member) {
          removal = member
        } else {
          remove(member)
        }
      }
      .disabled(workspaces.roomMutationInFlight)
    }
  }

  private var removalTitle: String {
    removal.map { "Remove \($0.profile.name) from this channel?" } ?? ""
  }

  private func isPerson(_ member: RoomRosterMember) -> Bool {
    if case .human = member.id {
      return true
    }
    return false
  }

  private func remove(_ member: RoomRosterMember) {
    errorMessage = nil
    let context = workspaces.compositionContext
    let roomId = room.id
    Task { @MainActor in
      do {
        let removed = try await workspaces.removeChannelMember(member.id, roomId: roomId, context: context, auth: auth)
        if !removed {
          errorMessage = "Couldn’t remove \(member.profile.name). Try again."
        }
      } catch is CancellationError {
        // The workspace changed underneath the request; nothing to report.
      } catch {
        errorMessage = friendlyMessage(for: error, mode: .coreMessage)
      }
    }
  }

  /// Web's roster badges beside the name; humans carry none.
  private func roleBadge(_ profile: ChatParticipantProfile) -> String? {
    switch profile.recipient {
    case .human: nil
    case .coworker: "Coworker"
    case .sokoBot: "Personal assistant"
    }
  }
}
