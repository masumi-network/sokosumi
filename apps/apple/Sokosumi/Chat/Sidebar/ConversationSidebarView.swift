import CoreAPI
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

struct ConversationSidebarView: View {
  @EnvironmentObject private var auth: AuthState
  @EnvironmentObject private var workspaces: WorkspaceState
  @Environment(\.openSettings) private var openSettings
  @Environment(\.openURL) private var openURL

  /// Web's inset rows start on the room row's label column: past its 20 pt mark and the gap after it. The
  /// indent is padding inside the row, since the sidebar List ignores `listRowInsets` on a badged row.
  private static let threadRowIndent: CGFloat = DirectRoomAvatarStack.faceSize + 8

  @State private var startDirect: CompositionPresentation?
  @State private var createChannel: CompositionPresentation?
  @State private var browseChannels: CompositionPresentation?
  @State private var editChannel: RoomEditPresentation?
  @State private var nameGroup: RoomEditPresentation?
  @State private var lifecycle: ChannelLifecycleRequest?
  @State private var invitationFailure: InvitationFailure?

  private struct InvitationFailure {
    let action: InvitationAction
    let message: String
  }

  private struct CompositionPresentation: Identifiable {
    let id: UUID
    let hasOrganization: Bool
  }

  /// Reloads the Archived section and pending invitations per workspace and after each room list refresh settles, like web's collection refresh.
  private struct SidebarCollectionsLoadKey: Equatable {
    let context: UUID
    let ready: Bool
  }

  var body: some View {
    let partitioned = workspaces.sidebar.partitioned
    // Web lists pending invitations above joined external rooms, in every workspace.
    let invitations = workspaces.pendingInvitations.invitations
    VStack(spacing: 0) {
      List(selection: Binding<SidebarDestination?>(
        get: {
          workspaces.sidebar.showsThreadsView ? .threads : workspaces.selectedRoomId.map(SidebarDestination.room)
        },
        set: { newValue in
          // List writes selection during its own update. Publishing
          // selectedRoomId / openRoom there trips SwiftUI's
          // "Publishing changes from within view updates" runtime issue.
          // Nil is structural (collapsed section / missing tag), not a
          // user deselect — skip it so the open transcript stays.
          switch newValue {
          case nil:
            return
          case .threads:
            Task { @MainActor in workspaces.showThreadsView() }
          case let .room(id):
            // Reorder mode: a press moves the room, so Pinned rows stop navigating (web).
            if workspaces.sidebar.pinnedReorderMode, partitioned.pinned.contains(where: { $0.id == id }) {
              return
            }
            Task { @MainActor in
              await workspaces.showRoom(id, auth: auth)
            }
          }
        }
      )) {
        workspaceMenu
        if workspaces.roomsLoading, workspaces.rooms.isEmpty {
          ProgressView("Loading rooms…")
        } else {
          // Web's `ChatUnreadNavRows`: above every section, not a room, so no room menu.
          Section {
            threadsRow
          }
          // Web: every pinned room of any kind, in the reader's own order; hidden when nothing is pinned.
          if !partitioned.pinned.isEmpty {
            Section {
              sectionHeader("Pinned", section: .pinned, closedAttention: resolveSectionAttention(partitioned.pinned))
              if !workspaces.sidebar.collapsedSections.contains(.pinned) {
                // Reorder mode lists rooms only, so the move offsets stay room offsets.
                ForEach(sidebarRoomListItems(partitioned.pinned, reordering: workspaces.sidebar.pinnedReorderMode)) { item in
                  sidebarItem(item) { pinnedRow($0, in: partitioned.pinned) }
                }
                .onMove(perform: workspaces.sidebar.pinnedReorderMode ? { movePinned(partitioned.pinned, from: $0, to: $1) } : nil)
              }
            }
          }
          if workspaces.selection?.workspace.organizationId != nil {
            Section {
              sectionHeader("Channels", section: .channels, closedAttention: resolveSectionAttention(partitioned.channels))
              if !workspaces.sidebar.collapsedSections.contains(.channels) {
                if partitioned.channels.isEmpty {
                  Text("No channels yet.")
                    .foregroundStyle(.secondary)
                }
                ForEach(sidebarRoomListItems(partitioned.channels)) { item in
                  sidebarItem(item) { roomRow($0, icon: $0.discoverability == ._private ? "lock" : "number") }
                }
              }
            }
          }
          if !partitioned.external.isEmpty || !invitations.isEmpty {
            Section {
              sectionHeader("External", section: .external, closedAttention: resolveSectionAttention(partitioned.external, hasPendingInvitation: !invitations.isEmpty))
              if !workspaces.sidebar.collapsedSections.contains(.external) {
                ForEach(invitations, id: \.id) { invitation in
                  PendingInvitationRow(
                    invitation: invitation,
                    responding: workspaces.invitationResponse?.invitationId == invitation.id ? workspaces.invitationResponse?.action : nil,
                    busy: workspaces.roomMutationInFlight
                  ) { respondToInvitation($0, invitation: invitation) }
                }
                ForEach(sidebarRoomListItems(partitioned.external)) { item in
                  sidebarItem(item) { roomRow($0, icon: "globe") }
                }
              }
            }
          }
          if workspaces.selection?.workspace.organizationId != nil, !workspaces.archivedChannels.rooms.isEmpty {
            Section {
              sectionHeader("Archived", section: .archived)
              if !workspaces.sidebar.collapsedSections.contains(.archived) {
                ForEach(workspaces.archivedChannels.rooms, id: \.id) { room in
                  ArchivedChannelRow(
                    room: room,
                    pending: workspaces.channelLifecycle?.roomId == room.id,
                    busy: workspaces.roomMutationInFlight,
                    canDelete: workspaces.archivedChannels.canDelete
                  ) { requestLifecycle($0, room: room) }
                }
              }
            }
          }
          Section {
            sectionHeader("Directs", section: .directs, closedAttention: resolveSectionAttention(partitioned.directMessages))
            if !workspaces.sidebar.collapsedSections.contains(.directs) {
              if partitioned.directMessages.isEmpty {
                Text("No direct messages yet.")
                  .foregroundStyle(.secondary)
              }
              ForEach(sidebarRoomListItems(partitioned.directMessages)) { item in
                sidebarItem(item) { roomRow($0, icon: "person", showsDirectAvatars: true) }
              }
            }
          }
        }
      }
      .listStyle(.sidebar)
      .toolbar {
        ToolbarItem {
          Button("New chat", systemImage: "square.and.pencil") {
            startDirect = .init(id: workspaces.compositionContext, hasOrganization: workspaces.selection?.workspace.organizationId != nil)
          }
          .disabled(workspaces.phase != .ready || workspaces.roomsLoading || workspaces.roomMutationInFlight)
          .help("New chat")
        }
        ToolbarItem {
          Button("Create channel", systemImage: "number") {
            createChannel = .init(id: workspaces.compositionContext, hasOrganization: true)
          }
          .disabled(workspaces.phase != .ready || workspaces.selection?.workspace.organizationId == nil || workspaces.roomMutationInFlight)
          .help("Create channel")
        }
        ToolbarItem {
          Button("Refresh conversations", systemImage: "arrow.clockwise") {
            Task { await workspaces.refreshRooms(auth: auth) }
          }
          .disabled(workspaces.roomsLoading)
        }
      }
      if workspaces.roomsLoading {
        ProgressView("Refreshing conversations…")
          .controlSize(.small)
          .padding(8)
      }
      if let error = workspaces.sidebar.errorMessage {
        VStack(alignment: .leading, spacing: 4) {
          Text(error).font(.caption).foregroundStyle(.secondary)
          Button("Retry") { Task { await workspaces.refreshRooms(auth: auth) } }
        }
        .padding(8)
      }
      if let switchError = workspaces.switchError {
        Text(switchError)
          .font(.caption)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
      }
      Divider()
      meSection
    }
    .sheet(item: $startDirect) { presentation in
      StartDirectView(hasOrganization: presentation.hasOrganization, load: {
        try await workspaces.loadDirectRecipients(context: presentation.id, auth: auth)
      }, open: {
        try await workspaces.openDirect($0, context: presentation.id, auth: auth)
      })
    }
    .sheet(item: $createChannel) { presentation in
      CreateChannelView(currentUserId: workspaces.currentUserId, organizationName: workspaces.selection?.title ?? "", load: {
        try await workspaces.loadChannelRoster(context: presentation.id, auth: auth)
      }, checkSlug: {
        try await workspaces.checkChannelSlug($0, context: presentation.id, auth: auth)
      }, create: {
        try await workspaces.createChannel($0, roster: $1, context: presentation.id, auth: auth)
      })
    }
    .sheet(item: $browseChannels) { presentation in
      BrowseChannelsView(load: {
        try await workspaces.browseChannels(query: $0, context: presentation.id, auth: auth)
      }, join: {
        try await workspaces.joinChannel(roomId: $0, context: presentation.id, auth: auth)
      })
    }
    .onChange(of: workspaces.compositionContext) { _, _ in
      startDirect = nil
      createChannel = nil
      browseChannels = nil
      lifecycle = nil
    }
    .modifier(EditChannelSheet(presentation: $editChannel))
    .modifier(NameGroupSheet(presentation: $nameGroup))
    .modifier(ChannelLifecycleConfirmation(request: $lifecycle))
    .task(id: SidebarCollectionsLoadKey(context: workspaces.compositionContext, ready: workspaces.phase == .ready && !workspaces.roomsLoading)) {
      guard workspaces.phase == .ready, !workspaces.roomsLoading else { return }
      async let archived: Void = workspaces.loadArchivedChannels(auth: auth)
      async let invitations: Void = workspaces.loadPendingInvitations(auth: auth)
      _ = await (archived, invitations)
    }
    .navigationSplitViewColumnWidth(min: 220, ideal: 260)
    .alert("Couldn’t update conversation", isPresented: Binding(
      get: { workspaces.sidebar.actionError != nil },
      set: {
        if !$0 {
          Task { @MainActor in workspaces.sidebar.clearActionError() }
        }
      }
    )) {
      Button("OK") { workspaces.sidebar.clearActionError() }
    } message: {
      Text(workspaces.sidebar.actionError ?? "")
    }
    .alert(invitationFailure?.action == .decline ? "Couldn’t decline invitation" : "Couldn’t accept invitation", isPresented: Binding(
      get: { invitationFailure != nil },
      set: {
        if !$0 {
          invitationFailure = nil
        }
      }
    ), presenting: invitationFailure) { _ in
      Button("OK") {}
    } message: { failure in
      Text(failure.message)
    }
  }

  /// Web accepts or declines in place: the row leaves the list on success and Core's message surfaces on failure.
  private func respondToInvitation(_ action: InvitationAction, invitation: Components.Schemas.ChatRoomInvitation) {
    guard !workspaces.roomMutationInFlight else { return }
    let context = workspaces.compositionContext
    Task { @MainActor in
      do {
        switch action {
        case .accept: try await workspaces.acceptInvitation(id: invitation.id, context: context, auth: auth)
        case .decline: try await workspaces.declineInvitation(id: invitation.id, context: context, auth: auth)
        }
      } catch is CancellationError {
        // The workspace changed underneath the request; nothing to report.
      } catch {
        invitationFailure = .init(action: action, message: chatErrorMessage(error))
      }
    }
  }

  /// Web's `closedAttention`: a closed section hides the rows that carry its rooms' attention, so the
  /// heading says it, in the row's own bold. An open section's rooms speak for themselves.
  private func sectionHeader(_ title: String, section: ConversationSidebar.Section, closedAttention: SectionAttention? = nil) -> some View {
    let collapsed = workspaces.sidebar.collapsedSections.contains(section)
    let attention = collapsed ? closedAttention : nil
    return HStack {
      Button {
        workspaces.sidebar.setExpanded(
          workspaces.sidebar.collapsedSections.contains(section), section: section
        )
      } label: {
        HStack(spacing: 4) {
          Text(title)
            .fontWeight(attention == nil ? .semibold : .bold)
            .foregroundStyle(attention == nil ? .secondary : .primary)
          Image(systemName: collapsed ? "chevron.right" : "chevron.down")
            .font(.caption)
        }
      }
      .buttonStyle(.plain)
      .accessibilityLabel(title)
      .accessibilityAddTraits(.isHeader)
      .accessibilityValue(sectionAccessibilityValue(collapsed: collapsed, attention: attention))
      .help(collapsed ? "Expand \(title)" : "Collapse \(title)")
      Spacer()
      if section == .pinned, workspaces.sidebar.canReorderPinned {
        let reordering = workspaces.sidebar.pinnedReorderMode
        Button(reordering ? "Done reordering" : "Reorder pinned chats", systemImage: reordering ? "checkmark" : "arrow.up.arrow.down") {
          workspaces.sidebar.setPinnedReorderMode(!reordering)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .frame(width: 20)
        .accessibilityAddTraits(reordering ? .isSelected : [])
        .help(reordering ? "Done reordering" : "Reorder pinned chats")
      }
      if section == .channels {
        Button("Browse channels", systemImage: "list.bullet") {
          browseChannels = .init(id: workspaces.compositionContext, hasOrganization: true)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .frame(width: 20)
        .disabled(workspaces.phase != .ready || workspaces.roomMutationInFlight)
        .help("Browse channels")
      }
    }
    .font(.subheadline.weight(.semibold))
    .foregroundStyle(.secondary)
    .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
    .selectionDisabled()
  }

  /// Web reads the row's rail strings into the closed heading's accessible name.
  private func sectionAccessibilityValue(collapsed: Bool, attention: SectionAttention?) -> String {
    switch attention {
    case .mention: "Collapsed, mentions you"
    case .unread: "Collapsed, unread"
    case nil: collapsed ? "Collapsed" : "Expanded"
    }
  }

  /// A pinned row keeps the leading mark of the section it left.
  private func pinnedRow(_ room: Components.Schemas.ChatRoom, in pinned: [Components.Schemas.ChatRoom]) -> some View {
    let reorderingIn = workspaces.sidebar.pinnedReorderMode ? pinned : nil
    return switch sidebarRoomKind(room) {
    case .channel: roomRow(room, icon: room.discoverability == ._private ? "lock" : "number", reorderingIn: reorderingIn)
    case .external: roomRow(room, icon: "globe", reorderingIn: reorderingIn)
    case .direct: roomRow(room, icon: "person", showsDirectAvatars: true, reorderingIn: reorderingIn)
    }
  }

  /// `List` reports the drop during its own update; hop before publishing the optimistic order.
  private func movePinned(_ pinned: [Components.Schemas.ChatRoom], from source: IndexSet, to destination: Int) {
    var roomIds = pinned.map(\.id)
    roomIds.move(fromOffsets: source, toOffset: destination)
    reorderPinned(roomIds, current: pinned)
  }

  private func reorderPinned(_ roomIds: [String], current: [Components.Schemas.ChatRoom]) {
    guard roomIds != current.map(\.id) else { return }
    Task { @MainActor in await workspaces.reorderPinnedRooms(roomIds, auth: auth) }
  }

  /// Workspace switcher pinned to the top of the sidebar.
  private var workspaceMenu: some View {
    Menu {
      ForEach(workspaces.options) { option in
        Button {
          workspaces.select(option, auth: auth)
        } label: {
          HStack {
            Text(option.title)
            if option.id == workspaces.selectionId {
              Image(systemName: "checkmark")
            }
          }
        }
      }
    } label: {
      HStack {
        Text(workspaces.selection?.title ?? "Sokosumi")
          .font(.headline)
        Image(systemName: "chevron.down")
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .padding(.vertical, 4)
  }

  private func roomRow(
    _ room: Components.Schemas.ChatRoom,
    icon: String,
    showsDirectAvatars: Bool = false,
    reorderingIn pinned: [Components.Schemas.ChatRoom]? = nil
  ) -> some View {
    let attention = resolveRoomAttention(room, showUnreadCount: workspaces.chatDisplay.showsRoomUnreadCount)
    return Label {
      HStack(spacing: 6) {
        VStack(alignment: .leading, spacing: 2) {
          Text(roomDisplayName(room, currentUserId: workspaces.currentUserId))
            .lineLimit(1)
            .fontWeight(attention.bold ? .bold : .regular)
            .foregroundStyle(room.mutedAt != nil && room.id != workspaces.selectedRoomId ? .secondary : .primary)
          if room.myAccess == .guest, let organization = room.organizationName, !organization.isEmpty {
            Text(organization)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 0)
        // Web draws the row's one number in the badge's column (SOK-1147): the count takes the trailing
        // edge where the mention badge would stand, as on the Threads row. Without it the status keeps its
        // centred 20 pt column.
        HStack(spacing: 4) {
          if attention.unreadTextCount > 0 {
            RoomUnreadCountLabel(count: attention.unreadTextCount)
          }
          roomStatus(room, reorderingIn: pinned)
        }
        .frame(minWidth: 20, alignment: attention.unreadTextCount > 0 ? .trailing : .center)
      }
    } icon: {
      RoomLeadingIcon(
        room: room,
        icon: icon,
        currentUserId: workspaces.currentUserId,
        showsDirectAvatars: showsDirectAvatars,
        livePresence: workspaces.presence.byUserId
      )
    }
    .presenceAccessibilityValue(directPresence(room, showsDirectAvatars: showsDirectAvatars))
    .labelStyle(RoomRowLabelStyle())
    .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
    .badge(mentionBadge(attention))
    .contextMenu {
      // Reorder mode: the handle stands where the status does and the row menu is not offered.
      if pinned == nil {
        roomActions(room)
      }
    }
    // Outermost, so the List reads it as the row's selection value.
    .tag(SidebarDestination.room(room.id))
  }

  /// One List row per item: a room, one of its inset unread Threads, or its overflow row (row 24g2).
  @ViewBuilder
  private func sidebarItem(
    _ item: SidebarRoomListItem, @ViewBuilder room roomRow: (Components.Schemas.ChatRoom) -> some View
  ) -> some View {
    switch item {
    case let .room(room): roomRow(room)
    case let .thread(row): threadRow(row)
    case let .moreThreads(roomId, count): moreThreadsRow(roomId: roomId, count: count)
    }
  }

  /// Web's inset Thread link: opens the Thread at its first unread reply through the chat notification's link,
  /// the path every in-app message link takes (`ChatRootView`'s `openURL`), where the Thread's Look reads it.
  /// Not selectable: the room row keeps the List's selection, as web's inset links never show as current.
  private func threadRow(_ row: SidebarThreadRow) -> some View {
    Button {
      if let url = ChatLink.href(roomId: row.roomId, messageId: row.firstUnreadReplyId, webBaseURL: CoreSettings.webBaseURL) {
        openURL(url)
      }
    } label: {
      SidebarThreadRowLabel(row: row)
        .padding(.leading, Self.threadRowIndent)
    }
    .buttonStyle(.plain)
    .badge(threadMentionBadge(row))
    .selectionDisabled()
  }

  /// A Thread naming the reader draws the room rows' mention badge in place of its reply count.
  private func threadMentionBadge(_ row: SidebarThreadRow) -> Text? {
    guard row.mentionCount > 0 else { return nil }
    return Text(verbatim: roomCountLabel(row.mentionCount))
      .accessibilityLabel(row.mentionCount == 1 ? "1 mention" : "\(row.mentionCount) mentions")
  }

  /// Web's "N more unread threads": what Core's cap of three left out. Opens the room's thread overview, on
  /// the Thread labels' column.
  private func moreThreadsRow(roomId: String, count: Int) -> some View {
    Button {
      Task { await workspaces.openThreadOverview(roomId: roomId, auth: auth) }
    } label: {
      SidebarMoreThreadsLabel(count: count)
        .padding(.leading, Self.threadRowIndent)
    }
    .buttonStyle(.plain)
    // No `listRowInsets`: the List ignores them on its badged rows (every room and Thread row) and honours them
    // here, which would push this row off the column the others share.
    .selectionDisabled()
  }

  /// Web's Threads entry (`ChatUnreadNavRows`, SOK-1159): opens the chat-level Threads view in the detail
  /// column. It carries the one number a room row does, from the rooms alone: the mention badge where an
  /// unread Thread names the reader, the muted count of unread Threads otherwise, nothing at zero; bold
  /// while any Thread is unread. VoiceOver hears web's words for both.
  private var threadsRow: some View {
    let attention = resolveUnreadThreadsAttention(workspaces.rooms)
    return Label {
      HStack(spacing: 6) {
        Text("Threads")
          .lineLimit(1)
          .fontWeight(attention.threadCount > 0 ? .bold : .regular)
        Spacer(minLength: 0)
        if attention.mentionCount == 0, attention.threadCount > 0 {
          Text(roomCountLabel(attention.threadCount))
            .font(.caption.weight(.semibold)).monospacedDigit()
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
        }
      }
    } icon: {
      Image(systemName: "bubble.left.and.bubble.right")
        .foregroundStyle(.secondary)
        .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
    }
    .labelStyle(RoomRowLabelStyle())
    .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
    .badge(threadsMentionBadge(attention))
    // With a badge, the badge speaks for the row; otherwise the row carries web's words for its count.
    .accessibilityValue(attention.mentionCount > 0 ? "" : attention.accessibilityLabel)
    .tag(SidebarDestination.threads)
  }

  /// The Threads row's mention badge, drawn like a room's, spoken as web's "N mentions, N unread threads".
  private func threadsMentionBadge(_ attention: UnreadThreadsAttention) -> Text? {
    guard attention.mentionCount > 0 else { return nil }
    return Text(verbatim: roomCountLabel(attention.mentionCount)).accessibilityLabel(attention.accessibilityLabel)
  }

  /// The mention badge as text, so it caps at "99+" like every other chat count. `nil` draws no
  /// badge, as the zero `Int` badge did; VoiceOver hears web's spoken form, not "99 plus".
  private func mentionBadge(_ attention: RoomAttention) -> Text? {
    guard let label = attention.badgeLabel, let spoken = attention.badgeAccessibilityLabel else {
      return nil
    }
    return Text(verbatim: label).accessibilityLabel(spoken)
  }

  /// Web's handle takes the drag and the Up/Down keys. `List` drags the whole row natively, so the
  /// handle is the pointer, keyboard and VoiceOver path to the same moves.
  private func reorderHandle(_ room: Components.Schemas.ChatRoom, in pinned: [Components.Schemas.ChatRoom]) -> some View {
    let roomIds = pinned.map(\.id)
    return Menu {
      Button("Move up", systemImage: "arrow.up") {
        reorderPinned(movingPinnedRoom(room.id, by: -1, in: roomIds), current: pinned)
      }
      .disabled(roomIds.first == room.id)
      Button("Move down", systemImage: "arrow.down") {
        reorderPinned(movingPinnedRoom(room.id, by: 1, in: roomIds), current: pinned)
      }
      .disabled(roomIds.last == room.id)
    } label: {
      Image(systemName: "line.3.horizontal")
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(width: 20, height: 20)
        .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .accessibilityLabel("Reorder \(roomDisplayName(room, currentUserId: workspaces.currentUserId))")
    .help("Drag to reorder, or choose Move up or Move down")
  }

  /// Web's 1:1 Direct row announces its one peer's availability; group rows
  /// leave that to the roster so the label is not read twice.
  private func directPresence(_ room: Components.Schemas.ChatRoom, showsDirectAvatars: Bool) -> Components.Schemas.ChatRoomPresence? {
    guard showsDirectAvatars, !room.isSelfDirect else { return nil }
    let participants = directRoomAvatarParticipants(room, currentUserId: workspaces.currentUserId)
    guard participants.count == 1, let peer = participants.first else { return nil }
    return peer.isAI ? .online : workspaces.presence(forUser: peer.id, fallback: peer.presence)
  }

  @ViewBuilder
  private func roomStatus(_ room: Components.Schemas.ChatRoom, reorderingIn pinned: [Components.Schemas.ChatRoom]?) -> some View {
    if let pinned {
      reorderHandle(room, in: pinned)
    } else if workspaces.sidebar.isPending(roomId: room.id) || workspaces.channelLifecycle?.roomId == room.id {
      ProgressView()
        .controlSize(.mini)
        .accessibilityLabel("Updating conversation")
    } else if room.mutedAt != nil {
      Image(systemName: "bell.slash")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Muted")
    }
  }

  @ViewBuilder
  private func roomActions(_ room: Components.Schemas.ChatRoom) -> some View {
    Button("Mark unread", systemImage: "envelope.badge") {
      Task { @MainActor in await workspaces.performSidebarAction(.markUnread, roomId: room.id, auth: auth) }
    }
    .disabled(!workspaces.sidebar.canPerform(.markUnread, roomId: room.id))
    Button(room.starredAt == nil ? "Pin" : "Unpin", systemImage: room.starredAt == nil ? "pin" : "pin.slash") {
      Task { @MainActor in await workspaces.performSidebarAction(room.starredAt == nil ? .pin : .unpin, roomId: room.id, auth: auth) }
    }
    .disabled(!workspaces.sidebar.canPerform(room.starredAt == nil ? .pin : .unpin, roomId: room.id))
    Button(room.mutedAt == nil ? "Mute" : "Unmute", systemImage: room.mutedAt == nil ? "bell.slash" : "bell") {
      Task { @MainActor in await workspaces.performSidebarAction(room.mutedAt == nil ? .mute : .unmute, roomId: room.id, auth: auth) }
    }
    .disabled(!workspaces.sidebar.canPerform(room.mutedAt == nil ? .mute : .unmute, roomId: room.id))
    if ChannelEditPermissions.isEditable(room) || ChannelEditPermissions.canLeave(room) || GroupNameDraft.canName(room) {
      Divider()
    }
    if GroupNameDraft.canName(room) {
      Button {
        nameGroup = .init(id: workspaces.compositionContext, roomId: room.id)
      } label: {
        NameGroupLabel()
      }
      .disabled(workspaces.roomMutationInFlight)
    }
    if ChannelEditPermissions.isEditable(room) {
      Button("Channel settings…", systemImage: "gearshape") {
        editChannel = .init(id: workspaces.compositionContext, roomId: room.id)
      }
    }
    if ChannelEditPermissions.canLeave(room) {
      Button("Leave channel…", systemImage: "rectangle.portrait.and.arrow.right") {
        lifecycle = .init(context: workspaces.compositionContext, roomId: room.id, name: room.name, action: .leave)
      }
      .disabled(workspaces.roomMutationInFlight)
    }
  }

  private func requestLifecycle(_ action: ChannelLifecycleAction, room: Components.Schemas.ChatRoom) {
    guard !workspaces.roomMutationInFlight else { return }
    lifecycle = .init(context: workspaces.compositionContext, roomId: room.id, name: room.name, action: action)
  }

  /// "Me" section pinned to the bottom of the sidebar: account menu with
  /// Settings and Sign out.
  private var meSection: some View {
    Menu {
      Button("Settings…") {
        openSettings()
      }
      Divider()
      Button("Sign out") {
        auth.signOut()
      }
    } label: {
      HStack(spacing: 8) {
        // Web's account chip: a local self-approximation, not the org roster.
        ParticipantAvatar(
          imageURL: workspaces.currentUserImageURL,
          name: workspaces.currentUserName,
          size: 28
        )
        .presenceBadge(workspaces.presence.selfPresence)
        VStack(alignment: .leading, spacing: 0) {
          Text(workspaces.currentUserName.isEmpty ? "Me" : workspaces.currentUserName)
            .font(.callout)
            .lineLimit(1)
          if !workspaces.currentUserEmail.isEmpty {
            Text(workspaces.currentUserEmail)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        Spacer()
      }
      .padding(8)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityValue(presenceLabel(workspaces.presence.selfPresence))
  }
}

/// What a sidebar row opens in the detail column: the chat-level Threads view or a room.
enum SidebarDestination: Hashable {
  case threads
  case room(String)
}

/// The reader's Room unread count (web `RowCountMark`'s muted count): drawn only where the row has no
/// mention badge, at the trailing edge, in the Threads row's muted style. VoiceOver hears web's words.
struct RoomUnreadCountLabel: View {
  let count: Int

  var body: some View {
    Text(roomCountLabel(count))
      .font(.caption.weight(.semibold))
      .monospacedDigit()
      .foregroundStyle(.secondary)
      .lineLimit(1)
      .fixedSize()
      .layoutPriority(1)
      .accessibilityLabel(roomUnreadAccessibilityLabel(count))
  }
}

/// Sidebar `Label` otherwise pins the icon to a square column, which
/// squashes a group Direct stack into overlapping blobs.
struct RoomRowLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 8) {
      configuration.icon
        .fixedSize()
      configuration.title
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// Sidebar leading slot. Direct messages get the participant stack; channels
/// and External keep an SF Symbol. Guest Directs in External stay a symbol.
private struct RoomLeadingIcon: View {
  let icon: String
  let showsDirectAvatars: Bool
  let showsPresence: Bool
  let participants: [DirectRoomAvatarParticipant]
  let livePresence: [String: Components.Schemas.ChatRoomPresence]

  init(
    room: Components.Schemas.ChatRoom,
    icon: String,
    currentUserId: String,
    showsDirectAvatars: Bool,
    livePresence: [String: Components.Schemas.ChatRoomPresence]
  ) {
    self.icon = icon
    self.showsDirectAvatars = showsDirectAvatars
    showsPresence = !room.isSelfDirect
    participants = showsDirectAvatars
      ? directRoomAvatarParticipants(room, currentUserId: currentUserId)
      : []
    self.livePresence = livePresence
  }

  var body: some View {
    if showsDirectAvatars {
      DirectRoomAvatarStack(participants: participants, showsPresence: showsPresence, livePresence: livePresence)
    } else {
      Image(systemName: icon)
        .foregroundStyle(.secondary)
        .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
    }
  }
}

struct DirectRoomAvatarStack: View {
  /// Web `DirectRoomAvatarStack`: `size-5` faces, `-ml-1.5` overlap, `size-2` marks.
  static let faceSize: CGFloat = 20
  private static let overlap: CGFloat = 6
  private static let markSize: CGFloat = 8

  let participants: [DirectRoomAvatarParticipant]
  /// Self Directs show no mark.
  var showsPresence = true
  /// Live org map (userId → online/afk); humans fall back to their snapshot.
  var livePresence: [String: Components.Schemas.ChatRoomPresence] = [:]

  var body: some View {
    stackContent
      .accessibilityHidden(true)
  }

  @ViewBuilder
  private var stackContent: some View {
    if participants.isEmpty {
      Image(systemName: "message")
        .foregroundStyle(.secondary)
        .frame(width: Self.faceSize, height: Self.faceSize)
    } else {
      HStack(spacing: -Self.overlap) {
        ForEach(participants.enumerated(), id: \.element.id) { index, participant in
          ParticipantAvatar(
            imageURL: participant.imageURL,
            name: participant.name,
            size: Self.faceSize
          )
          .overlay {
            Circle()
              .strokeBorder(.background, lineWidth: 1)
          }
          .overlay(alignment: .bottomTrailing) {
            if showsPresence {
              PresenceDot(presence: presence(for: participant), size: Self.markSize).offset(x: 2, y: 2)
            }
          }
          .zIndex(Double(participants.count - index))
        }
      }
    }
  }

  private func presence(for participant: DirectRoomAvatarParticipant) -> Components.Schemas.ChatRoomPresence {
    participant.isAI ? .online : livePresence[participant.id] ?? participant.presence
  }
}
