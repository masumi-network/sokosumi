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
  @Environment(RoomEditSheets.self) private var roomEditSheets: RoomEditSheets?
  @State private var errorMessage: String?
  @State private var directRequestId: UUID?
  @State private var selectedProfile: ChatParticipantProfile?
  @State private var addMembers: RoomEditPresentation?
  @State private var lifecycle: ChannelLifecycleRequest?
  @State private var removal: RoomRosterMember?
  @State private var notice: ChannelMembershipNotice?
  @State private var noticeSerial = 0

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
                roomEditSheets?.editChannel = .init(id: workspaces.compositionContext, roomId: room.id)
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
              roomEditSheets?.nameGroup = .init(id: workspaces.compositionContext, roomId: room.id)
            } label: {
              NameGroupLabel()
            }
            .disabled(workspaces.roomMutationInFlight)
          } header: {
            Text("Group", tableName: groupNameTable, comment: "Members inspector section for a group Direct's name.")
          }
        }
        // Row 31b2: read state from the same receipts as Seen by, so a live `chat_room_read` reorders the list.
        let roster = RoomRoster.groups(in: room, currentUserId: workspaces.currentUserId, receipts: workspaces.readReceipts(for: room))
        Section {
          // Web's roster says so only when it lists nobody at all, Guests included.
          if roster.isEmpty {
            Text("No members to show.").foregroundStyle(.secondary)
          }
          ForEach(roster.people) { member in
            managedRow(member)
          }
          if !roster.neverRead.isEmpty {
            // A division inside the people, not a third kind of member: a lighter mark than the headings.
            RosterHeading(title: "Not read yet", count: roster.neverRead.count)
              .font(.caption2.weight(.medium)).foregroundStyle(.secondary)
              .padding(.top, 4)
            ForEach(roster.neverRead) { member in
              managedRow(member)
            }
          }
        } header: {
          if roster.showsHeadings, roster.peopleCount > 0 {
            RosterHeading(title: "People", count: roster.peopleCount)
          }
        }
        if !roster.guests.isEmpty {
          Section {
            ForEach(roster.guests) { guest in
              managedRow(guest)
            }
          } header: {
            if roster.showsHeadings {
              RosterHeading(title: "Guests", count: roster.guests.count)
            }
          }
        }
        if !roster.agents.isEmpty {
          Section {
            ForEach(roster.agents) { agent in
              managedRow(agent)
            }
          } header: {
            if roster.showsHeadings {
              RosterHeading(title: "Coworkers", count: roster.agents.count)
            }
          }
        }
      }.listStyle(.plain)
      if let notice {
        ChannelMembershipNoticeBar(notice: notice, serial: noticeSerial, undoDisabled: workspaces.roomMutationInFlight,
                                   undo: undo, dismiss: { self.notice = nil })
      }
      if let errorMessage {
        Text(errorMessage).font(.callout).foregroundStyle(.red).padding()
      }
    }
    .popover(item: $selectedProfile) { ParticipantDetailsView(profile: $0) }
    .modifier(AddChannelMembersSheet(presentation: $addMembers) { post(.added(count: $0)) })
    .modifier(ChannelLifecycleConfirmation(request: $lifecycle))
    .alert(removalTitle, isPresented: Binding(get: { removal != nil }, set: {
      if !$0 {
        removal = nil
      }
    }), presenting: removal) { member in
      Button("Cancel", role: .cancel) {}
      Button("Remove from channel", role: .destructive) { remove(member) }
    } message: { member in
      Text("\(member.profile.name) will no longer see this channel or its messages.")
    }
    .onDisappear { directRequestId = nil }
    .onChange(of: room.id) { _, _ in
      directRequestId = nil
      errorMessage = nil
      selectedProfile = nil
      addMembers = nil
      lifecycle = nil
      removal = nil
      notice = nil
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
      memberText(member)
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

  /// The name (with a Soko Bot's badge), the email or caption to copy, and when a reader last read the room.
  private func memberText(_ member: RoomRosterMember) -> some View {
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
      if let lastReadAt = member.lastReadAt {
        RosterReadTime(lastReadAt: lastReadAt)
      }
    }
  }

  /// Remove sits in the row's context menu on macOS and iOS, and in a trailing swipe on iOS. A row Core would refuse
  /// gets neither, so it never opens an empty menu.
  @ViewBuilder
  private func managedRow(_ member: RoomRosterMember) -> some View {
    if permissions.canRemove(member.id, in: room, currentUserId: workspaces.currentUserId) {
      memberRow(member)
        .contextMenu { removeAction(member) }
      #if os(iOS)
        .swipeActions { removeAction(member) }
      #endif
    } else {
      memberRow(member)
    }
  }

  /// A person's removal asks first; a Coworker or own Soko Bot goes at once.
  private func removeAction(_ member: RoomRosterMember) -> some View {
    let title: LocalizedStringKey = isPerson(member) ? "Remove from channel…" : "Remove from channel"
    return Button(title, systemImage: "person.badge.minus", role: .destructive) {
      guard !workspaces.roomMutationInFlight else { return }
      if isPerson(member) {
        removal = member
      } else {
        remove(member)
      }
    }
    .disabled(workspaces.roomMutationInFlight)
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
        if removed {
          post(.removed(member.id, name: member.profile.name))
        } else {
          errorMessage = "Couldn’t remove \(member.profile.name). Try again."
        }
      } catch is CancellationError {
        // The workspace changed underneath the request; nothing to report.
      } catch {
        errorMessage = friendlyMessage(for: error, mode: .coreMessage)
      }
    }
  }

  /// Web's Undo adds the Coworker or Soko Bot back and closes the toast; a failure shows Core's message.
  private func undo(_ member: DirectRecipient) {
    notice = nil
    errorMessage = nil
    let context = workspaces.compositionContext
    let roomId = room.id
    Task { @MainActor in
      do {
        if try await !workspaces.addChannelMembers([member], roomId: roomId, context: context, auth: auth) {
          errorMessage = "Couldn’t undo. Try again."
        }
      } catch is CancellationError {
        // The workspace changed underneath the request; nothing to report.
      } catch {
        errorMessage = friendlyMessage(for: error, mode: .coreMessage)
      }
    }
  }

  private func post(_ notice: ChannelMembershipNotice) {
    self.notice = notice
    noticeSerial += 1
  }

  /// Web's roster badge beside the name: only a Soko Bot's, which tells it apart from a Coworker in the same section.
  /// The Coworkers heading names Coworkers once instead of a word on every row; people carry none.
  private func roleBadge(_ profile: ChatParticipantProfile) -> String? {
    switch profile.recipient {
    case .human, .coworker: nil
    case .sokoBot: "Personal assistant"
    }
  }
}

/// A roster heading and its count (web `RoomRosterPanel`'s section headings): "People 4", "Not read yet 2".
private struct RosterHeading: View {
  let title: LocalizedStringKey
  let count: Int

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text(title)
      Text(count, format: .number).monospacedDigit()
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }
}

/// When a member last read the room (web `RosterMemberReadState`), under the name and email: the interval alone in
/// the row, the sentence for the tooltip and for anyone listening, since "2 hours ago" out of the column says
/// nothing about what happened then. Refreshed each minute.
private struct RosterReadTime: View {
  let lastReadAt: Date
  @Environment(\.locale) private var locale

  var body: some View {
    TimelineView(.periodic(from: .now, by: 60)) { context in
      let age = relativeAgeLabel(since: lastReadAt, now: context.date, unitsStyle: .full, locale: locale)
      Text(age)
        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        .help("Last read \(age)")
        .accessibilityLabel("Last read \(age)")
    }
  }
}
