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
  @Environment(RoomEditSheets.self) private var roomEditSheets: RoomEditSheets?

  /// Web's inset rows start on the room row's label column: past its 20 pt mark and the gap after it. The
  /// indent is padding inside the row, since the sidebar List ignores `listRowInsets` on a badged row.
  private static let threadRowIndent: CGFloat = DirectRoomAvatarStack.faceSize + 8

  @State private var startDirect: CompositionPresentation?
  @State private var createChannel: CompositionPresentation?
  @State private var browseChannels: CompositionPresentation?
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

  private var commands: SokosumiChat.SidebarCommands {
    SokosumiChat.SidebarCommands(
      phase: workspaces.phase,
      roomsLoading: workspaces.roomsLoading,
      mutationInFlight: workspaces.roomMutationInFlight,
      hasOrganization: workspaces.selection?.workspace.organizationId != nil
    )
  }

  var body: some View {
    let partitioned = workspaces.sidebar.partitioned
    // Web lists pending invitations above joined external rooms, in every workspace.
    let invitations = workspaces.pendingInvitations.invitations
    // Row 24f2: while the Unreads filter is on, one flat list stands in place of the sections.
    let unreadsFilter = workspaces.unreadsFilter
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
              await workspaces.showRoom(id)
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
            unreadsRow(unreadsFilter)
          }
          if let unreadsFilter {
            unreadsSections(unreadsFilter, invitations: invitations)
          } else {
            allSections(partitioned, invitations: invitations)
          }
        }
      }
      .listStyle(.sidebar)
      .toolbar {
        ToolbarItem {
          Button("New chat", systemImage: "square.and.pencil") {
            startDirect = .init(id: workspaces.compositionContext, hasOrganization: workspaces.selection?.workspace.organizationId != nil)
          }
          .disabled(!commands.newChat)
          .help("New chat")
        }
        ToolbarItem {
          Button("Create channel", systemImage: "number") {
            createChannel = .init(id: workspaces.compositionContext, hasOrganization: true)
          }
          .disabled(!commands.createChannel)
          .help("Create channel")
        }
        ToolbarItem {
          Button("Refresh conversations", systemImage: "arrow.clockwise") {
            Task { await workspaces.refreshRooms() }
          }
          .disabled(!commands.refresh)
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
          Button("Retry") { Task { await workspaces.refreshRooms() } }
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
      StartDirectView(hasOrganization: presentation.hasOrganization, currentUserId: workspaces.currentUserId, load: {
        try await workspaces.loadDirectRecipients(context: presentation.id)
      }, open: {
        try await workspaces.openDirect($0, context: presentation.id)
      })
    }
    .sheet(item: $createChannel) { presentation in
      CreateChannelView(currentUserId: workspaces.currentUserId, organizationName: workspaces.selection?.title ?? "", load: {
        try await workspaces.loadChannelRoster(context: presentation.id)
      }, checkSlug: {
        try await workspaces.checkChannelSlug($0, context: presentation.id)
      }, create: {
        try await workspaces.createChannel($0, roster: $1, context: presentation.id)
      })
    }
    .sheet(item: $browseChannels) { presentation in
      BrowseChannelsView(load: {
        try await workspaces.browseChannels(query: $0, context: presentation.id)
      }, join: {
        try await workspaces.joinChannel(roomId: $0, context: presentation.id)
      })
    }
    .onChange(of: workspaces.compositionContext) { _, _ in
      startDirect = nil
      createChannel = nil
      browseChannels = nil
      lifecycle = nil
    }
    .modifier(ChannelLifecycleConfirmation(request: $lifecycle))
    // Web keeps the pass the list was drawn from during render; a view update hops before publishing it.
    .onChange(of: unreadsFilter?.pass, initial: true) { _, pass in
      guard let pass else { return }
      Task { @MainActor in workspaces.sidebar.keepUnreadsFilterPass(pass) }
    }
    // First load of Archived and the invitations per workspace; afterwards each recovers on its own (`sidebarRecovery`).
    .task(id: workspaces.collectionsLoadContext) {
      guard workspaces.collectionsLoadContext != nil else { return }
      async let archived: Void = workspaces.loadArchivedChannels()
      async let invitations: Void = workspaces.loadPendingInvitations()
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

  /// Every section, as the sidebar lists them while the Unreads filter is off.
  @ViewBuilder
  private func allSections(_ partitioned: PartitionedSidebarRooms, invitations: [Components.Schemas.ChatRoomInvitation]) -> some View {
    // Web: every pinned room of any kind, in the reader's own order; hidden when nothing is pinned.
    if !partitioned.pinned.isEmpty {
      pinnedSection(partitioned.pinned)
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
            sidebarItem(item) { roomRow($0) }
          }
        }
      }
    }
    if !partitioned.external.isEmpty || !invitations.isEmpty {
      externalSection(partitioned.external, invitations: invitations)
    }
    if workspaces.selection?.workspace.organizationId != nil, !workspaces.archivedChannels.rooms.isEmpty {
      Section {
        sectionHeader("Archived", section: .archived)
        if !workspaces.sidebar.collapsedSections.contains(.archived) {
          ForEach(workspaces.archivedChannels.rooms, id: \.id) { room in
            ArchivedChannelRow(
              room: room,
              pending: workspaces.runningMutation?.lifecycleRoomId == room.id,
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
          sidebarItem(item) { roomRow($0) }
        }
      }
    }
  }

  /// The collapsible Pinned section with its reorder mode.
  private func pinnedSection(_ pinned: [Components.Schemas.ChatRoom]) -> some View {
    Section {
      sectionHeader("Pinned", section: .pinned, closedAttention: resolveSectionAttention(pinned))
      if !workspaces.sidebar.collapsedSections.contains(.pinned) {
        // Reorder mode lists rooms only, so the move offsets stay room offsets.
        ForEach(sidebarRoomListItems(pinned, reordering: workspaces.sidebar.pinnedReorderMode)) { item in
          sidebarItem(item) { pinnedRow($0, in: pinned) }
        }
        .onMove(perform: workspaces.sidebar.pinnedReorderMode ? { movePinned(pinned, from: $0, to: $1) } : nil)
      }
    }
  }

  /// Pending invitations above joined external rooms. Under the Unreads filter only the invitations stay: they
  /// wait on the reader (web).
  private func externalSection(_ rooms: [Components.Schemas.ChatRoom], invitations: [Components.Schemas.ChatRoomInvitation]) -> some View {
    Section {
      sectionHeader("External", section: .external, closedAttention: resolveSectionAttention(rooms, hasPendingInvitation: !invitations.isEmpty))
      if !workspaces.sidebar.collapsedSections.contains(.external) {
        ForEach(invitations, id: \.id) { invitation in
          PendingInvitationRow(
            invitation: invitation,
            responding: workspaces.runningMutation?.response(to: invitation.id),
            busy: workspaces.roomMutationInFlight
          ) { respondToInvitation($0, invitation: invitation) }
        }
        ForEach(sidebarRoomListItems(rooms)) { item in
          sidebarItem(item) { roomRow($0) }
        }
      }
    }
  }

  /// Web's Unreads filter (row 24f2): one flat list in place of Channels, External rooms, Directs and Archived,
  /// each room in the place it first took in the pass and dimmed once read; with nothing unread, "All caught up"
  /// leads and "Read just now" names the rooms still listed. Pending invitations stay under External, then a fixed
  /// Pinned group with every pin in the reader's order.
  @ViewBuilder
  private func unreadsSections(_ filter: UnreadsFilterList, invitations: [Components.Schemas.ChatRoomInvitation]) -> some View {
    if filter.caughtUp || !filter.rooms.isEmpty {
      Section {
        if filter.caughtUp {
          caughtUpRow
        }
        if filter.showsReadLabel {
          groupLabel("Read just now")
        }
        ForEach(sidebarRoomListItems(filter.rooms)) { item in
          sidebarItem(item) { roomRow($0, dimmed: filter.isDimmed($0.id)) }
        }
      }
    }
    if !invitations.isEmpty {
      externalSection([], invitations: invitations)
    }
    if !filter.pinned.isEmpty {
      Section {
        groupLabel("Pinned")
        ForEach(sidebarRoomListItems(filter.pinned)) { item in
          sidebarItem(item) { roomRow($0, dimmed: filter.isDimmed($0.id)) }
        }
      }
    }
  }

  /// Web's Unreads toggle (`ChatUnreadNavRows`): a mode, not a place, so it is a button and never the List's
  /// selection. On, it takes the accent tint web gives what is on. Mark all as read stands at its trailing edge
  /// while the filter lists anything a read would still change.
  private func unreadsRow(_ filter: UnreadsFilterList?) -> some View {
    let isOn = filter != nil
    let isActive = SidebarEmphasis.navRow(isActive: isOn, hasUnread: false) == .active
    return HStack(spacing: 6) {
      Button {
        workspaces.sidebar.setUnreadsFilter(!isOn)
      } label: {
        Label {
          Text("Unreads")
            .lineLimit(1)
            .fontWeight(isActive ? .medium : .regular)
            // Off, it rests muted like the Threads row (web's `THREADS_ROW_CLASS`).
            .foregroundStyle(isActive ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
        } icon: {
          Image(systemName: "tray")
            .foregroundStyle(isActive ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
        }
        .labelStyle(RoomRowLabelStyle())
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(isOn ? [.isToggle, .isSelected] : .isToggle)
      .accessibilityValue(isOn ? "Showing unread only" : "")
      .help(isOn ? "Show every chat" : "Show only chats with something unread")
      if let filter, filter.showsMarkAll {
        markAllButton
      }
    }
    // No `listRowInsets`: the List ignores them on its badged rows (the Threads and room rows above and below) and
    // honours them here, which would push this row off the column they share.
    .listRowBackground(isOn ? RoundedRectangle(cornerRadius: 6).fill(.tint.opacity(0.15)).padding(.horizontal, 10) : nil)
    .selectionDisabled()
  }

  /// Web's Mark all as read (`CheckCheck`, a spinner while it runs). A failure raises the sidebar's alert.
  private var markAllButton: some View {
    let marking = workspaces.sidebar.isMarkingAllUnreadRead
    return Button {
      Task { await workspaces.markAllUnreadRead() }
    } label: {
      if marking {
        ProgressView()
          .controlSize(.mini)
      } else {
        Image(systemName: "checkmark.circle")
          .foregroundStyle(.tint)
      }
    }
    .buttonStyle(.borderless)
    .frame(width: 20)
    .disabled(marking)
    .accessibilityLabel("Mark all as read")
    .help("Mark all as read")
  }

  /// Web's caught-up row: a message, not a room, so nothing opens. Row-sized and muted like a read row.
  private var caughtUpRow: some View {
    Label {
      Text("All caught up")
        .lineLimit(1)
    } icon: {
      Image(systemName: "checkmark.circle")
        .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
    }
    .labelStyle(RoomRowLabelStyle())
    .foregroundStyle(SidebarEmphasis.atRest.textStyle)
    // No `listRowInsets`, so it stands on the room rows' column (see `unreadsRow`).
    .selectionDisabled()
  }

  /// A heading over the filter's rows that neither collapses nor holds a control (web's "Read just now" and Pinned).
  private func groupLabel(_ title: String) -> some View {
    Text(title)
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(.secondary)
      .accessibilityAddTraits(.isHeader)
      .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
      .selectionDisabled()
  }

  /// Web accepts or declines in place: the row leaves the list on success and Core's message surfaces on failure.
  private func respondToInvitation(_ action: InvitationAction, invitation: Components.Schemas.ChatRoomInvitation) {
    guard !workspaces.roomMutationInFlight else { return }
    let context = workspaces.compositionContext
    Task { @MainActor in
      do {
        switch action {
        case .accept: try await workspaces.acceptInvitation(id: invitation.id, context: context)
        case .decline: try await workspaces.declineInvitation(id: invitation.id, context: context)
        }
      } catch is CancellationError {
        // The workspace changed underneath the request; nothing to report.
      } catch {
        invitationFailure = .init(action: action, message: friendlyMessage(for: error, mode: .coreMessage))
      }
    }
  }

  /// Web's `closedAttention`: a closed section hides the rows that carry its rooms' attention, so the
  /// heading says it, in the row's own bold. An open section's rooms speak for themselves.
  private func sectionHeader(_ title: String, section: ConversationSidebar.Section, closedAttention: SectionAttention? = nil) -> some View {
    let collapsed = workspaces.sidebar.collapsedSections.contains(section)
    let attention = collapsed ? closedAttention : nil
    let emphasis = SidebarEmphasis.header(attention: attention)
    return HStack {
      Button {
        workspaces.sidebar.setExpanded(
          workspaces.sidebar.collapsedSections.contains(section), section: section
        )
      } label: {
        HStack(spacing: 4) {
          Text(title)
            .fontWeight(emphasis == .attention ? .bold : .semibold)
            .foregroundStyle(emphasis.textStyle)
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
        .disabled(!commands.browseChannels)
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
    roomRow(room, reorderingIn: workspaces.sidebar.pinnedReorderMode ? pinned : nil)
  }

  /// `List` reports the drop during its own update; hop before publishing the optimistic order.
  private func movePinned(_ pinned: [Components.Schemas.ChatRoom], from source: IndexSet, to destination: Int) {
    var roomIds = pinned.map(\.id)
    roomIds.move(fromOffsets: source, toOffset: destination)
    reorderPinned(roomIds, current: pinned)
  }

  private func reorderPinned(_ roomIds: [String], current: [Components.Schemas.ChatRoom]) {
    guard roomIds != current.map(\.id) else { return }
    Task { @MainActor in await workspaces.reorderPinnedRooms(roomIds) }
  }

  /// Workspace switcher pinned to the top of the sidebar.
  private var workspaceMenu: some View {
    Menu {
      ForEach(workspaces.options) { option in
        Button {
          workspaces.select(option)
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

  /// A room row. The leading mark follows the kind the room lists under, so a pinned row or one in the Unreads
  /// filter keeps the mark of the section it left; `pinned` is the Pinned list while reorder mode is on.
  private func roomRow(
    _ room: Components.Schemas.ChatRoom,
    reorderingIn pinned: [Components.Schemas.ChatRoom]? = nil,
    dimmed: Bool = false
  ) -> some View {
    let row = SidebarRoomRow(room: room, context: rowContext(room, reordering: pinned != nil, dimmed: dimmed))
    let showsDirectAvatars = row.mark == .directAvatars
    return Label {
      HStack(spacing: 6) {
        VStack(alignment: .leading, spacing: 2) {
          Text(roomDisplayName(room, currentUserId: workspaces.currentUserId))
            .lineLimit(1)
            .fontWeight(row.emphasis == .attention ? .bold : .regular)
            .foregroundStyle(row.emphasis.textStyle)
          if room.myAccess.value1 == .guest, let organization = room.organizationName, !organization.isEmpty {
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
          if let unreadCount = row.unreadCount {
            RoomUnreadCountLabel(count: unreadCount)
          }
          roomStatus(row.status, room: room, reorderingIn: pinned)
        }
        .frame(minWidth: 20, alignment: row.unreadCount == nil ? .center : .trailing)
      }
    } icon: {
      RoomLeadingIcon(
        room: room,
        icon: row.mark.systemImage,
        currentUserId: workspaces.currentUserId,
        showsDirectAvatars: showsDirectAvatars,
        livePresence: workspaces.presence.byUserId
      )
    }
    .presenceAccessibilityValue(directPresence(room, showsDirectAvatars: showsDirectAvatars))
    .labelStyle(RoomRowLabelStyle())
    // The Unreads filter dims a room read in its pass (web: 60 %).
    .opacity(row.isDimmed ? 0.6 : 1)
    .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
    .badge(row.badge?.text)
    .contextMenu {
      // Reorder mode: the handle stands where the status does and the menu is empty.
      roomActions(row.menu, room: room)
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
      // `.equatable()`, so the preview is built again only when the row changes, not on every sidebar update.
      SidebarThreadRowLabel(row: row)
        .equatable()
        .padding(.leading, Self.threadRowIndent)
    }
    .buttonStyle(.plain)
    // A Thread naming the reader draws the room rows' mention badge in place of its reply count.
    .badge(SidebarBadge.thread(row)?.text)
    .selectionDisabled()
  }

  /// Web's "N more unread threads": what Core's cap of three left out. Opens the room's thread overview, on
  /// the Thread labels' column.
  private func moreThreadsRow(roomId: String, count: Int) -> some View {
    Button {
      Task { await workspaces.openThreadOverview(roomId: roomId) }
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
  /// unread Thread names the reader, the muted count of unread Threads otherwise, nothing at zero. The label
  /// is bold and full strength while any Thread is unread and muted at rest, like web's `THREADS_ROW_CLASS`.
  /// VoiceOver hears web's words for both.
  private var threadsRow: some View {
    let attention = resolveUnreadThreadsAttention(workspaces.rooms)
    let emphasis = SidebarEmphasis.navRow(isActive: false, hasUnread: attention.isUnread)
    return Label {
      HStack(spacing: 6) {
        Text("Threads")
          .lineLimit(1)
          .fontWeight(emphasis == .attention ? .bold : .regular)
          .foregroundStyle(emphasis.textStyle)
        Spacer(minLength: 0)
        if attention.mentionCount == 0, attention.isUnread {
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
    // The mention badge, drawn like a room's, spoken as web's "N mentions, N unread threads".
    .badge(SidebarBadge.threadsEntry(attention)?.text)
    // With a badge, the badge speaks for the row; otherwise the row carries web's words for its count.
    .accessibilityValue(attention.mentionCount > 0 ? "" : attention.accessibilityLabel)
    .tag(SidebarDestination.threads)
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
    guard showsDirectAvatars, !room.isSelfDirect, !room.isReadOnly else { return nil }
    let participants = directRoomAvatarParticipants(room, currentUserId: workspaces.currentUserId)
    guard participants.count == 1, let peer = participants.first else { return nil }
    return peer.isAI ? .online : workspaces.presence(forUser: peer.id, fallback: peer.presence)
  }

  /// The status slot's content: the reorder handle, a spinner while the room changes, or the muted bell. The
  /// handle needs the Pinned list for its moves, which only the reorder-mode caller has.
  @ViewBuilder
  private func roomStatus(
    _ status: SidebarRoomRow.Status, room: Components.Schemas.ChatRoom, reorderingIn pinned: [Components.Schemas.ChatRoom]?
  ) -> some View {
    switch status {
    case .reorderHandle:
      if let pinned {
        reorderHandle(room, in: pinned)
      }
    case .updating:
      ProgressView()
        .controlSize(.mini)
        .accessibilityLabel("Updating conversation")
    case .muted:
      Image(systemName: "bell.slash")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Muted")
    case .none:
      EmptyView()
    }
  }

  /// What `SidebarRoomRow` needs to know about the workspace for one row.
  private func rowContext(_ room: Components.Schemas.ChatRoom, reordering: Bool, dimmed: Bool) -> SidebarRoomRow.Context {
    .init(
      selectedRoomId: workspaces.selectedRoomId,
      showsUnreadCount: workspaces.chatDisplay.showsRoomUnreadCount,
      reorderingPinned: reordering,
      dimmed: dimmed,
      isPending: workspaces.sidebar.isPending(roomId: room.id),
      lifecycleRoomId: workspaces.runningMutation?.lifecycleRoomId,
      mutationInFlight: workspaces.roomMutationInFlight,
      isOwnerOrAdmin: workspaces.isOrganizationOwnerOrAdmin
    )
  }

  /// The room menu: the package decides which entries stand, in which order and which are enabled.
  @ViewBuilder
  private func roomActions(_ menu: RoomMenu, room: Components.Schemas.ChatRoom) -> some View {
    ForEach(menu.quick, id: \.command) { entry in
      roomMenuButton(entry, room: room)
    }
    if !menu.manage.isEmpty {
      Divider()
    }
    ForEach(menu.manage, id: \.command) { entry in
      roomMenuButton(entry, room: room)
    }
  }

  private func roomMenuButton(_ entry: RoomMenuEntry, room: Components.Schemas.ChatRoom) -> some View {
    Button {
      switch entry.command {
      case .nameGroup:
        roomEditSheets?.nameGroup = .init(id: workspaces.compositionContext, roomId: room.id)
      case .channelSettings:
        roomEditSheets?.editChannel = .init(id: workspaces.compositionContext, roomId: room.id)
      case .leave:
        lifecycle = .init(context: workspaces.compositionContext, roomId: room.id, name: room.name, action: .leave)
      case .markUnread, .pin, .unpin, .mute, .unmute:
        if let action = entry.command.sidebarAction {
          Task { @MainActor in await workspaces.performSidebarAction(action, roomId: room.id) }
        }
      }
    } label: {
      RoomMenuEntryLabel(command: entry.command)
    }
    .disabled(!entry.isEnabled)
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

private extension SidebarEmphasis {
  /// A label's colour: full strength unless at rest. Weight stays with each row type.
  var textStyle: HierarchicalShapeStyle {
    self == .atRest ? .secondary : .primary
  }
}

private extension SidebarBadge {
  /// Drawn as text, so it caps at "99+" like every other chat count; VoiceOver hears the spoken form.
  var text: Text {
    Text(verbatim: label).accessibilityLabel(spokenLabel)
  }
}

private extension SidebarRoomRow.Mark {
  /// The leading symbol; a Direct draws its participants' faces instead and keeps this as its fallback.
  var systemImage: String {
    switch self {
    case let .channel(mark): mark.systemImage
    case .external: ChannelMark.globe.systemImage
    case .directAvatars: "person"
    }
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
  let isReadOnly: Bool
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
    // Former members are not here to be online, and their faces sit back.
    showsPresence = !room.isSelfDirect && !room.isReadOnly
    isReadOnly = room.isReadOnly
    participants = showsDirectAvatars
      ? directRoomAvatarParticipants(room, currentUserId: currentUserId)
      : []
    self.livePresence = livePresence
  }

  var body: some View {
    if showsDirectAvatars {
      DirectRoomAvatarStack(participants: participants, showsPresence: showsPresence, isDimmed: isReadOnly, livePresence: livePresence)
    } else {
      Image(systemName: icon)
        .foregroundStyle(.secondary)
        .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
    }
  }
}

struct DirectRoomAvatarStack: View {
  /// Web `DirectRoomAvatarStack`.
  static let faceSize: CGFloat = 20
  private static let overlap: CGFloat = 6
  private static let markSize: CGFloat = 8

  let participants: [DirectRoomAvatarParticipant]
  /// Self Directs and Read-only Directs show no mark.
  var showsPresence = true
  /// A Read-only Direct's Former members: web's `opacity-50 grayscale`.
  var isDimmed = false
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
          .grayscale(isDimmed ? 1 : 0)
          .opacity(isDimmed ? 0.5 : 1)
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
