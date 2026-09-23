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
  @State private var nameGroup: RoomEditPresentation?
  @State private var lifecycle: ChannelLifecycleRequest?

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Members").font(.headline)
        Spacer()
        Button("Close", systemImage: "xmark", action: close)
          .labelStyle(.iconOnly).buttonStyle(.borderless).help("Close members")
      }.padding()
      List {
        if room.kind == .channel {
          Section("Channel") {
            Text(room.name).font(.headline)
            Text(visibility).foregroundStyle(.secondary)
            if let topic = room.topic?.trimmingCharacters(in: .whitespacesAndNewlines), !topic.isEmpty {
              Text(topic).textSelection(.enabled)
            }
            if ChannelEditPermissions.isEditable(room) {
              Button("Channel settings…") {
                editChannel = .init(id: workspaces.compositionContext, roomId: room.id)
              }
            } else if ChannelEditPermissions.canLeave(room) {
              // Guests and matched members cannot edit; web's dialog shrinks to Leave for them.
              Button("Leave channel…") {
                lifecycle = .init(context: workspaces.compositionContext, roomId: room.id, name: room.name, action: .leave)
              }
              .disabled(workspaces.channelMutationInFlight)
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
            .disabled(workspaces.channelMutationInFlight)
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
            memberRow(member)
          }
        }
      }.listStyle(.plain)
      if let errorMessage {
        Text(errorMessage).font(.callout).foregroundStyle(.red).padding()
      }
    }
    .popover(item: $selectedProfile) { ParticipantDetailsView(profile: $0) }
    .modifier(EditChannelSheet(presentation: $editChannel))
    .modifier(NameGroupSheet(presentation: $nameGroup))
    .modifier(ChannelLifecycleConfirmation(request: $lifecycle))
    .onDisappear { directRequestId = nil }
    .onChange(of: room.id) { _, _ in
      directRequestId = nil
      errorMessage = nil
      selectedProfile = nil
      editChannel = nil
      nameGroup = nil
      lifecycle = nil
    }
  }

  private var visibility: String {
    switch room.discoverability {
    case ._private: "Private channel"
    case .external: "External channel"
    default: "Public channel"
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

  /// Web's roster badges beside the name; humans carry none.
  private func roleBadge(_ profile: ChatParticipantProfile) -> String? {
    switch profile.recipient {
    case .human: nil
    case .coworker: "Coworker"
    case .sokoBot: "Personal assistant"
    }
  }
}
