import Combine
import CoreAPI
import Foundation
import os
import SokosumiAuth
import SokosumiChat
import SokosumiRealtime

private let logger = Logger(subsystem: "com.sokosumi.app", category: "transcript")

/// App-owned coordinator connecting authentication, chat sessions and realtime.
/// Package models own reusable behavior; this object orders their lifecycles,
/// forwards observation to SwiftUI and handles session-wide failures.
/// Keep cancellation and generation guards with their coordinated operations.
@MainActor
public final class WorkspaceState: ObservableObject {
  public typealias WorkspaceOption = WorkspaceSession.Option
  public typealias Phase = WorkspaceSession.Phase
  private let workspaceSession = WorkspaceSession()
  private var workspaceObservation: AnyCancellable?
  public struct MessageJump: Equatable, Sendable {
    public let roomId: String
    public let messageId: String
    /// The open Thread's parent after a reply jump (row 25c). The Thread covers the room, so the room marks it on
    /// arrival and lands on it when the Thread closes; any other jump marks its row once it scrolls into view.
    public let isThreadParent: Bool
    public let requestId = UUID()

    init(roomId: String, messageId: String, isThreadParent: Bool = false) {
      self.roomId = roomId
      self.messageId = messageId
      self.isThreadParent = isThreadParent
    }
  }

  @Published public internal(set) var messageJump: MessageJump?
  /// The sidebar's "N more unread threads" row asks for the room's thread overview (row 24g2, web's
  /// `?threads=1`); the room's tools open it once that room is on screen.
  public struct ThreadOverviewRequest: Equatable, Sendable {
    public let roomId: String
    public let requestId = UUID()
  }

  @Published public internal(set) var threadOverviewRequest: ThreadOverviewRequest?
  var messageNavigationRequest = UUID()
  public let thread: ThreadSession
  public let threadOverview = RoomThreadOverview()
  public let crossRoomThreads = CrossRoomThreads()
  @Published public internal(set) var threadAttentionRevision = 0
  public let messageEditing = MessageEditing()
  public let directStream: DirectStreamSession
  private var threadObservations: Set<AnyCancellable> = []
  /// The Channel, Direct or invitation change in flight, if any.
  @Published public private(set) var runningMutation: WorkspaceMutation?
  public let archivedChannels = ArchivedChannels()
  public let pendingInvitations = PendingInvitations()
  /// The workspace context: a reset, reload or switch renews it, and work started under an older one turns stale.
  @Published public private(set) var compositionContext = UUID()
  /// Channel/Direct mutations are single-flight across the workspace, matching web's one open dialog at a time.
  public var roomMutationInFlight: Bool {
    runningMutation != nil
  }

  public var phase: Phase {
    workspaceSession.phase
  }

  public var options: [WorkspaceOption] {
    workspaceSession.options
  }

  public var selectionId: String? {
    workspaceSession.selectionId
  }

  public let sidebar: ConversationSidebar
  public var readAttention: RoomReadAttention {
    sidebar.readAttention
  }

  private var attentionObservation: AnyCancellable?
  private var signInObservation: AnyCancellable?
  private var sidebarObservation: AnyCancellable?
  public var rooms: [Components.Schemas.ChatRoom] {
    get { readAttention.applying(to: sidebar.rooms) }
    set { sidebar.rooms = newValue }
  }

  public var roomsLoading: Bool {
    get { sidebar.isLoading }
    set { sidebar.isLoading = newValue }
  }

  /// The workspace whose Archived section and pending invitations the sidebar loads once; nil while it loads or
  /// switches. A list refresh leaves it alone: each collection is re-read by `sidebarRecovery` (web SOK-986).
  public var collectionsLoadContext: UUID? {
    phase == .ready && !workspaceSession.isSwitching ? compositionContext : nil
  }

  /// Selected room. Launch and workspace switches restore the saved room,
  /// else the first room. Revoking the open room can leave this nil while
  /// others remain: the saved pick is left alone so relaunch does not
  /// reopen a room that is gone.
  public var selectedRoomId: String? {
    get { sidebar.selectedRoomId }
    set { sidebar.selectedRoomId = newValue }
  }

  /// Switch/list failure while already `.ready`. Nil means the sidebar is fine.
  @Published public private(set) var switchError: String?
  public var currentUserId: String {
    workspaceSession.currentUser?.id ?? ""
  }

  public var currentUserName: String {
    workspaceSession.currentUser?.name ?? ""
  }

  public var currentUserEmail: String {
    workspaceSession.currentUser?.email ?? ""
  }

  public var currentUserImageURL: String? {
    workspaceSession.currentUser?.image
  }

  /// Failed mention shells whose retry POST is in flight; see `WorkspaceState+Mentions`.
  @Published var pendingMentionRetries: Set<MentionRetryRequest> = []
  /// Soko Bot turns rated in this session, by turn id; see `WorkspaceState+SokoBot`.
  @Published public internal(set) var sokoBotFeedback: [String: Bool] = [:]
  @Published var pendingSokoBotFeedback: Set<String> = []
  /// Account-synced chat display preferences; see `WorkspaceState+UserPreferences`.
  public let chatDisplay = ChatDisplayPreferences()
  public let notificationPreferences = ChatNotificationPreferences()
  /// App-side OS notification adapter; without it events raise no banner.
  let notificationPresenter: (any ChatNotificationPresenting)?
  var notificationBanners = ChatNotificationBanners()
  /// The open room's main Transcript: its history, Send queue, realtime updates and recovery.
  public let room: TranscriptSession
  /// Every loaded copy of a message (the room's history, the open Thread's parent and its replies) and the viewer's
  /// Pending reactions on them.
  public let loaded: LoadedMessages

  public let pins = PinnedMessages()
  @Published var pendingPins: Set<String> = []

  /// Room the transcript pane shows. Nil clears the pane.
  var transcriptRoomId: String? {
    room.timeline.roomId
  }

  var transcriptMessages: [Components.Schemas.ChatRoomMessage] {
    get { room.timeline.messages }
    set { room.timeline.messages = newValue }
  }

  var transcriptLoading: Bool {
    room.timeline.isLoading
  }

  var transcriptLoadingOlder: Bool {
    room.timeline.isLoadingOlder
  }

  /// Latest-page refetch in flight (ADR 0014 envelope). Not the older-page
  /// spinner: live refetch must not flash `transcriptLoadingOlder`.
  var transcriptRefreshing: Bool {
    room.timeline.isRefreshing
  }

  /// Failure text. Shown full-pane when there is no history, as a banner
  /// above loaded history otherwise — a failed older page never wipes
  /// what already resolved.
  var transcriptError: String? {
    get { room.timeline.errorMessage }
    set { room.timeline.errorMessage = newValue }
  }

  /// True while a classic POST is in flight for this composer.
  var outboundInFlight: Bool {
    room.outbox.isSending
  }

  /// Factory for the live socket: the app's ably-cocoa connection, a fake in tests. Without one the transcript stays
  /// HTTP-only and every realtime call below no-ops.
  let realtimeConnectionFactory: (@Sendable () -> (any RealtimeConnection))?
  var realtime: (any RealtimeConnection)?
  private var realtimeStreamTask: Task<Void, Never>?
  /// The read sync realtime events scheduled; tests await it.
  private(set) var realtimeReadSync: Task<Void, Never>?
  private var realtimeReadSyncPending = false
  private var realtimeContinuation: AsyncStream<ResolvedRealtimeDelivery>.Continuation?
  /// Org presence map and publisher bookkeeping (ADR 0003); see `WorkspaceState+Presence`.
  public let presence = OrgPresence()
  var presenceTickTask: Task<Void, Never>?
  /// The self dot reads offline only after the socket was up once; before
  /// that a launch would flash offline while the first token mints.
  var realtimeEverConnected = false
  /// Who is typing in the open room and what this client told it (ADR 0033); see
  /// `WorkspaceState+Typing`. Not forwarded to `objectWillChange`: only the Typing line reads it.
  public let typing = RoomTyping()
  var typingSweepTask: Task<Void, Never>?
  /// The open room's live read marks (row 31b1); see `WorkspaceState+ReadReceipts`.
  let roomReads = RoomReadMarks()

  /// Confirmed history plus unresolved outbound shells (sticky at the end), with Pending reactions on top.
  public var displayedTranscript: [Components.Schemas.ChatRoomMessage] {
    let messages = directStream.displayedMessages(persisted: room.displayedMessages)
    let rows = loaded.pendingReactions.overlaying(messages, viewer: reactionViewer)
    // Once the room's unread-thread read has answered it owns every reply bar's count (web, SOK-1151).
    return threadOverview.unreadReplyCounts.map { applyThreadUnreadReplyCounts(rows, counts: $0) } ?? rows
  }

  var transcriptCursor: String? {
    room.timeline.cursor
  }

  /// Bumps on every open/clear so a slow room cannot paint over a newer one.
  private var transcriptGeneration: Int {
    room.timeline.generation
  }

  let sidebarRecovery: SidebarCollectionsRecovery
  /// Re-reads the open room while it still counts unread (row 07e); see `WorkspaceState+OpenRoomUnreadRecheck`.
  let openRoomUnreadRecheck: OpenRoomUnreadRecheck
  private var connectionHealthy = false
  private(set) var roomsRefreshTask: Task<Void, Never>?
  private var roomsRefreshID = UUID()
  private var sidebarRecoveryGeneration = UUID()
  private(set) var transcriptRealtimeHealthy = false

  let service = ChatService()
  private var hasLoaded = false
  private var workspaceLoadTask: Task<Void, Never>?

  /// Stable per-install realtime `clientInstanceId` (ADR 0003): persisted on
  /// first launch, reused after, so this Mac is one `{userId}:{instanceId}`
  /// device in every token it mints.
  let realtimeClientInstanceId: String

  /// Creates a workspace coordinator. The host app must inject its authenticated
  /// client provider; the default resolves no client. It also passes its realtime connection and OS notification
  /// adapter; without them the workspace stays HTTP-only and raises no banner. `now`, `makeId` and `sleep` are the
  /// room and Thread transcripts' clock and ids; `sleep` also paces the sidebar recovery timer.
  public init(
    auth: AuthState,
    clientProvider: @escaping (AuthState) -> Client? = { _ in nil },
    savedRoom: SavedRoomSelection = SavedRoomSelection(),
    instanceStore: RealtimeClientInstanceIdStore = UserDefaultsRealtimeInstanceIdStore(),
    unreadsFilter: UnreadsFilterPreference = .transient,
    openRoomUnreadRecheck: OpenRoomUnreadRecheck = OpenRoomUnreadRecheck(),
    realtimeConnectionFactory: (@Sendable () -> (any RealtimeConnection))? = nil,
    notificationPresenter: (any ChatNotificationPresenting)? = nil,
    now: @escaping () -> Date = Date.init,
    makeId: @escaping () -> String = { UUID().uuidString },
    sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  ) {
    room = TranscriptSession(now: now, makeId: makeId, sleep: sleep)
    thread = ThreadSession(now: now, makeId: makeId, sleep: sleep)
    loaded = LoadedMessages(room: room, thread: thread)
    directStream = DirectStreamSession(now: now, makeId: makeId)
    sidebarRecovery = SidebarCollectionsRecovery(sleep: sleep)
    self.auth = auth
    self.clientProvider = clientProvider
    self.openRoomUnreadRecheck = openRoomUnreadRecheck
    self.realtimeConnectionFactory = realtimeConnectionFactory
    self.notificationPresenter = notificationPresenter
    sidebar = ConversationSidebar(savedRoom: savedRoom, unreadsFilter: unreadsFilter)
    realtimeClientInstanceId = getOrCreateRealtimeClientInstanceId(store: instanceStore)
    for publisher in [archivedChannels.objectWillChange, pendingInvitations.objectWillChange, threadOverview.objectWillChange, chatDisplay.objectWillChange, pins.objectWillChange, loaded.objectWillChange, room.objectWillChange, room.timeline.objectWillChange, room.outbox.objectWillChange, thread.objectWillChange, thread.transcript.objectWillChange, thread.transcript.timeline.objectWillChange, thread.transcript.outbox.objectWillChange, directStream.objectWillChange, presence.objectWillChange, roomReads.objectWillChange] {
      publisher.sink { [weak self] in self?.objectWillChange.send() }.store(in: &threadObservations)
    }
    // Rows need editor identity changes; draft and save state are observed by the editor itself.
    messageEditing.$source.map { $0?.id }.removeDuplicates().dropFirst()
      .sink { [weak self] _ in self?.objectWillChange.send() }
      .store(in: &threadObservations)
    sidebarObservation = sidebar.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    attentionObservation = readAttention.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    workspaceObservation = workspaceSession.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    watchOpenRoomUnread()
    connectTranscripts()
    watchLifecycle()
  }

  /// Sign-in follows the workspace itself, once for all windows: signing out drops the workspace and signing in
  /// starts it. At launch a window's loading view starts it.
  private func watchLifecycle() {
    // `@Published` sends before it stores, so this acts after a hop, once the new status is in place.
    signInObservation = auth.$status.map { $0 == .signedIn }.removeDuplicates().dropFirst()
      .sink { [weak self] signedIn in
        Task { @MainActor [weak self] in
          if signedIn {
            self?.startIfNeeded()
          } else {
            self?.reset()
          }
        }
      }
  }

  /// The app's one sign-in, shared by every window: Core requests read its client, and a rejected session signs it out.
  public let auth: AuthState
  private let clientProvider: (AuthState) -> Client?

  /// Test override for the injected authenticated client provider.
  var clientResolver: (() -> Client?)?
  func resolveClient() -> Client? {
    clientResolver?() ?? clientProvider(auth)
  }

  /// One Core request for this workspace: this account's client, the open workspace's slug and the one `ChatService`.
  /// A session Core rejects is signed out; without a client the request throws `unauthorized(signIn)`.
  func request<Value>(
    signIn: String = "Log in again.",
    _ operation: (ChatService, Client, String?) async throws -> Value
  ) async throws -> Value {
    guard let client = resolveClient() else { throw ChatServiceError.unauthorized(signIn) }
    do {
      return try await operation(service, client, selection?.workspace.organizationSlug)
    } catch {
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error)
      }
      throw error
    }
  }

  public var selection: WorkspaceOption? {
    options.first { $0.id == selectionId }
  }

  public func startIfNeeded() {
    guard !hasLoaded else { return }
    hasLoaded = true
    workspaceLoadTask?.cancel()
    workspaceLoadTask = Task { await reload() }
  }

  public func retry() {
    workspaceLoadTask?.cancel()
    workspaceLoadTask = Task { await reload() }
  }

  /// Drop everything after sign-out so the next sign-in reloads from Core.
  /// The install instance id survives: this Mac stays one Ably device.
  public func reset() {
    hasLoaded = false
    workspaceLoadTask?.cancel()
    workspaceLoadTask = nil
    renewContext()
    loaded.clearPendingReactions()
    sokoBotFeedback = [:]
    pendingSokoBotFeedback = []
    chatDisplay.reset()
    notificationPreferences.reset()
    clearNotificationBanners()
    archivedChannels.reset()
    pendingInvitations.reset()
    workspaceSession.reset()
    sidebar.reset()
    rooms = []
    roomsLoading = false
    switchError = nil
    selectedRoomId = nil
    stopRealtime()
    clearTranscript()
    // Parent text from the signed-in reader. The next account must not see it.
    crossRoomThreads.reset()
  }

  /// User picked a room in the sidebar: persist it and open its transcript.
  /// Nil is ignored — `List` emits it when collapsed rows leave the
  /// hierarchy, and this app keeps a room selected whenever one is listed.
  public func selectRoom(_ id: String?) {
    guard let id, id != selectedRoomId else { return }
    applyRoomSelection(id)
  }

  private func acceptCreatedRoom(_ room: Components.Schemas.ChatRoom, sourceRoom: String?) {
    if let index = rooms.firstIndex(where: { $0.id == room.id }) {
      rooms[index] = room
    } else {
      rooms.append(room)
    }
    realtime?.setMembershipRooms(Set(rooms.map(\.id)))
    // A completed request must not pull the user away from a room they selected meanwhile.
    if transcriptRoomId == sourceRoom {
      selectRoom(room.id)
    }
  }

  public func loadChannelRoster(context: UUID) async throws -> ChannelRoster {
    try await channelOperation(context: context) { client, organizationId, slug in
      try await service.channelRoster(client: client, organizationId: organizationId, organizationSlug: slug)
    }
  }

  public func checkChannelSlug(_ slug: String, context: UUID) async throws -> Bool {
    try await channelOperation(context: context) { client, _, organizationSlug in
      try await service.channelSlugIsAvailable(client: client, slug: slug, organizationSlug: organizationSlug)
    }
  }

  public func createChannel(_ draft: ChannelDraft, roster: ChatRecipientRoster, context: UUID) async throws -> Bool {
    let sourceRoom = transcriptRoomId
    return try await exclusive(.createChannel, context: context) {
      let room = try await channelOperation(context: context) { client, _, slug in
        try await service.createChannel(client: client, draft: draft, roster: roster, currentUserId: self.currentUserId, organizationSlug: slug)
      }
      acceptCreatedRoom(room, sourceRoom: sourceRoom)
    }
  }

  /// Settings edits reconcile the room in place and never navigate: the sidebar row and any open transcript keep their identity.
  public func updateChannel(_ draft: ChannelEditDraft, roomId: String, context: UUID) async throws -> Bool {
    guard draft.isValid, rooms.contains(where: { $0.id == roomId }) else { return false }
    let request = draft.updateRequest
    return try await exclusive(.updateRoom, context: context) {
      let room = try await channelOperation(context: context) { client, _, slug in
        try await service.updateRoom(client: client, roomId: roomId, request: request, organizationSlug: slug)
      }
      // A list read already in flight predates this settings edit.
      sidebar.invalidateRefresh()
      if let index = rooms.firstIndex(where: { $0.id == room.id }) {
        rooms[index] = room
      }
    }
  }

  /// Names or clears a group Direct's Group name (ADR-0040) in any workspace, then takes Core's room in place like `updateChannel`.
  public func nameGroup(_ draft: GroupNameDraft, roomId: String, context: UUID) async throws -> Bool {
    let slug = selection?.workspace.organizationSlug
    return try await exclusive(.updateRoom, context: context) {
      let room = try await workspaceOperation(context: context) { client in
        try await service.updateRoom(client: client, roomId: roomId, request: draft.updateRequest, organizationSlug: slug)
      }
      // A list read already in flight predates this rename.
      sidebar.invalidateRefresh()
      if let index = rooms.firstIndex(where: { $0.id == room.id }) {
        rooms[index] = room
      }
    }
  }

  public func browseChannels(query: String, context: UUID) async throws -> [Components.Schemas.DiscoverableChatRoom] {
    try await channelOperation(context: context) { client, _, slug in
      try await service.discoverableChannels(client: client, query: query, organizationSlug: slug)
    }
  }

  public func joinChannel(roomId: String, context: UUID) async throws -> Bool {
    let sourceRoom = transcriptRoomId
    return try await exclusive(.joinChannel, context: context) {
      let room = try await channelOperation(context: context) { client, _, slug in
        try await service.joinChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      acceptCreatedRoom(room, sourceRoom: sourceRoom)
    }
  }

  func channelOperation<Value: Sendable>(context: UUID, operation: (Client, String, String) async throws -> Value) async throws -> Value {
    guard let organizationId = selection?.workspace.organizationId, let slug = selection?.workspace.organizationSlug else { throw CancellationError() }
    return try await workspaceOperation(context: context) { client in
      try await operation(client, organizationId, slug)
    }
  }

  /// Runs `perform` as the workspace's one running mutation. It starts only for the live composition context, outside
  /// a switch, while no other runs; returns false when it could not start.
  func exclusive(_ mutation: WorkspaceMutation, context: UUID, _ perform: () async throws -> Void) async throws -> Bool {
    guard context == compositionContext, phase == .ready, !workspaceSession.isSwitching, !roomMutationInFlight else { return false }
    runningMutation = mutation
    defer {
      if context == compositionContext {
        runningMutation = nil
      }
    }
    try await perform()
    return true
  }

  /// A reset, reload or switch: work started under the old context turns stale and no mutation counts as running.
  private func renewContext() {
    compositionContext = UUID()
    runningMutation = nil
  }

  /// Runs an authenticated request for the current composition context; a workspace change or reset turns its result into cancellation.
  func workspaceOperation<Value: Sendable>(context: UUID, operation: (Client) async throws -> Value) async throws -> Value {
    guard context == compositionContext, phase == .ready, !workspaceSession.isSwitching, let client = resolveClient() else { throw CancellationError() }
    do {
      let value = try await operation(client)
      guard context == compositionContext, phase == .ready, !Task.isCancelled else { throw CancellationError() }
      return value
    } catch {
      guard context == compositionContext else { throw CancellationError() }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error)
      }
      throw error
    }
  }

  /// Web loads the Archived section for organization workspaces only and fails soft.
  public func loadArchivedChannels() async {
    guard selection?.workspace.organizationId != nil else {
      archivedChannels.reset()
      return
    }
    let context = compositionContext
    await archivedChannels.load {
      try await channelOperation(context: context) { client, organizationId, slug in
        try await service.archivedChannels(client: client, organizationId: organizationId, organizationSlug: slug)
      }
    }
  }

  /// Leaving drops the room like a membership revoke: the open transcript clears and no other room is forced open.
  public func leaveChannel(roomId: String, context: UUID) async throws -> Bool {
    try await exclusive(.channelLifecycle(.leave, roomId: roomId), context: context) {
      let slug = selection?.workspace.organizationSlug
      try await workspaceOperation(context: context) { client in
        try await service.leaveChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      applyMembershipRevoked(roomId: roomId)
    }
  }

  /// Archiving hides the channel for everyone; it moves into the Archived section.
  public func archiveChannel(roomId: String, context: UUID) async throws -> Bool {
    try await exclusive(.channelLifecycle(.archive, roomId: roomId), context: context) {
      try await channelOperation(context: context) { client, _, slug in
        try await service.archiveChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      if let room = rooms.first(where: { $0.id == roomId }) {
        archivedChannels.insert(room)
      }
      applyMembershipRevoked(roomId: roomId)
    }
  }

  /// Restoring returns the live room and opens it (web navigates to it) unless the user moved on meanwhile.
  public func restoreChannel(roomId: String, context: UUID) async throws -> Bool {
    let sourceRoom = transcriptRoomId
    return try await exclusive(.channelLifecycle(.restore, roomId: roomId), context: context) {
      let room = try await channelOperation(context: context) { client, _, slug in
        try await service.restoreChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      archivedChannels.remove(roomId: roomId)
      acceptCreatedRoom(room, sourceRoom: sourceRoom)
    }
  }

  public func deleteChannel(roomId: String, context: UUID) async throws -> Bool {
    try await exclusive(.channelLifecycle(.delete, roomId: roomId), context: context) {
      try await channelOperation(context: context) { client, _, slug in
        try await service.deleteChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      archivedChannels.remove(roomId: roomId)
    }
  }

  public func canOpenDirect(_ recipient: DirectRecipient) -> Bool {
    guard phase == .ready, let room = rooms.first(where: { $0.id == transcriptRoomId }) else { return false }
    return recipient.canOpen(from: room, currentUserId: currentUserId, hasActiveOrganization: selection?.workspace.organizationId != nil)
  }

  public func loadDirectRecipients(context: UUID) async throws -> ChatRecipientRoster {
    guard phase == .ready, context == compositionContext, !workspaceSession.isSwitching,
          let client = resolveClient() else { throw CancellationError() }
    do {
      let yourself = currentUserId.isEmpty ? nil : ChatRecipientTarget.messageYourself(
        userId: currentUserId, name: currentUserName.isEmpty ? currentUserEmail : currentUserName, imageURL: currentUserImageURL
      )
      let roster = try await service.directRecipients(
        client: client, yourself: yourself,
        organizationId: selection?.workspace.organizationId,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard context == compositionContext, phase == .ready, !Task.isCancelled else { throw CancellationError() }
      return roster
    } catch {
      guard context == compositionContext else { throw CancellationError() }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error)
      }
      throw error
    }
  }

  @discardableResult
  public func openParticipantDirect(_ recipient: DirectRecipient) async throws -> Bool {
    guard canOpenDirect(recipient) else { return false }
    var recipients = DirectConversationSelection(hasOrganization: selection?.workspace.organizationId != nil, currentUserId: currentUserId)
    recipients.add(recipient)
    return try await openDirect(recipients, context: compositionContext)
  }

  @discardableResult
  public func openDirect(_ recipients: DirectConversationSelection, context: UUID) async throws -> Bool {
    guard let first = recipients.recipients.first, let client = resolveClient() else { return false }
    let sourceRoom = transcriptRoomId
    var opened = false
    _ = try await exclusive(.openDirect(first), context: context) {
      do {
        let room = try await service.openDirect(client: client, selection: recipients, organizationSlug: selection?.workspace.organizationSlug)
        guard !Task.isCancelled, context == compositionContext, phase == .ready else { return }
        acceptCreatedRoom(room, sourceRoom: sourceRoom)
        opened = true
      } catch {
        guard context == compositionContext else { return }
        if let error = error as? ChatServiceError {
          signOutIfUnauthorized(error)
        }
        throw error
      }
    }
    return opened
  }

  private func applyRoomSelection(_ id: String?) {
    sidebar.select(id, userId: currentUserId, organizationId: selection?.workspace.organizationId)
    guard let id = selectedRoomId, let room = rooms.first(where: { $0.id == id }) else {
      clearTranscript()
      return
    }
    openRoom(room)
  }

  /// Keep a room selected whenever rooms exist: the saved room when it is
  /// still listed, else the first room. Runs after every rooms load.
  private func ensureRoomSelection() {
    applyRoomSelection(sidebar.restoredSelection(userId: currentUserId, organizationId: selection?.workspace.organizationId))
  }

  /// Forget the transcript without touching rooms or selection.
  func clearTranscript() {
    messageNavigationRequest = UUID()
    messageJump = nil
    threadOverviewRequest = nil
    messageEditing.reset()
    directStream.reset()
    thread.close()
    threadOverview.reset()
    transcriptRealtimeHealthy = false
    readAttention.roomChanged()
    pins.reset()
    pendingPins = []
    room.close()
    watchRoom(nil)
  }

  /// Open a room's transcript: history first, mark-read after it resolves
  /// (ADR 0026). The sidebar entry is replaced with the POST-read DTO so
  /// unread chrome matches Core. A failed read keeps the resolved history
  /// on screen and leaves unread chrome unchanged.
  public func openRoom(_ room: Components.Schemas.ChatRoom) {
    messageNavigationRequest = UUID()
    messageJump = nil
    // Only the room it names takes an overview request; any other room drops it.
    if threadOverviewRequest?.roomId != room.id {
      threadOverviewRequest = nil
    }
    messageEditing.reset()
    directStream.reset(room: room, userId: currentUserId, organizationId: selection?.workspace.organizationId)
    thread.close()
    threadOverview.reset()
    transcriptRealtimeHealthy = transcriptRoomId == room.id && transcriptRealtimeHealthy
    readAttention.roomChanged()
    pins.reset(roomId: room.id)
    pendingPins = []
    self.room.open(roomId: room.id)
    let generation = transcriptGeneration
    watchRoom(room.id)
    self.room.load(.initial)
    if directStream.roomId != nil, let client = resolveClient() {
      directStream.resume(client: client, organizationSlug: selection?.workspace.organizationSlug, settled: { [weak self] in
        guard let self else { return false }
        return await settleDirectStream(generation: generation)
      }, failed: { [weak self] error in
        guard let self, let error = error as? ChatServiceError else { return }
        signOutIfUnauthorized(error)
      })
    }
    self.room.recovery.start(foreground: readAttention.isVisible, healthy: transcriptRealtimeHealthy) { [weak self] in
      guard let self else { return }
      await recoverTranscript(generation: generation)
    }
  }

  public func setWindowVisible(_ visible: Bool, window: UUID) {
    let wasVisible = readAttention.isVisible
    readAttention.setVisible(visible, window: window)
    thread.transcript.recovery.setForeground(readAttention.isVisible)
    room.recovery.setForeground(readAttention.isVisible)
    sidebarRecovery.setForeground(readAttention.isVisible)
    if !wasVisible, readAttention.isVisible {
      realtime?.refreshMembership()
    }
    if wasVisible != readAttention.isVisible {
      // Web's visibilitychange: hidden publishes afk at once, visible counts as activity.
      presence.setVisible(readAttention.isVisible, now: Date())
      publishPresence(force: true)
      realtime?.setInFront(readAttention.isVisible)
    }
  }

  /// Wait for history/pagination before the recovery read. The scheduler's
  /// interval starts after the HTTP request and read-attention work finish.
  /// The scheduler decides whether a read may start while no chat window is
  /// active (row 07d); read attention keeps its own visibility gate.
  private func recoverTranscript(generation: Int) async {
    await room.whenIdle()
    guard generation == transcriptGeneration else { return }
    refreshTranscript()
    await room.whenIdle()
  }

  /// The room's and the Thread's Transcripts load on their own with this account's client: the room reads attention
  /// after its first and latest pages; the Thread reads the room after later pages, its first page's Look coming
  /// before the request (`loadThreadPage`).
  private func connectTranscripts() {
    // Every landed page changes what the reader sees, so read attention syncs before the load ends.
    room.hooks = transcriptHooks { [weak self] page in
      guard let self else { return }
      // The room's fresh copy of an open Thread's parent is the newer one.
      if page == .latest, let parent = transcriptMessages.first(where: { $0.id == thread.parent?.id }) {
        thread.apply(eventType: .update, message: parent)
      }
      await syncReadAttention()
    }
    thread.transcript.hooks = transcriptHooks { [weak self] _ in
      await self?.syncReadAttention()
    }
  }

  /// What a Transcript asks the workspace for: this account's client and slug, sign-out when Core rejects the
  /// session, and `pageLanded` once a page applied.
  func transcriptHooks(pageLanded: @escaping (RoomTimeline.Page) async -> Void) -> TranscriptSession.Hooks {
    .init(access: { [weak self] in
      guard let self, let client = resolveClient() else { return nil }
      return (client, selection?.workspace.organizationSlug)
    }, failed: { [weak self] error in
      guard let self else { return false }
      guard let error = error as? ChatServiceError else {
        logger.error("Sokosumi transcript load failed: \(String(describing: error), privacy: .public)")
        return false
      }
      return signOutIfUnauthorized(error)
    }, pageLanded: pageLanded)
  }

  public var composerChannels: [ComposerChannel] {
    ComposerChannel.catalog(rooms: rooms)
  }

  public var composerMentions: [ComposerMention] {
    guard let room = rooms.first(where: { $0.id == transcriptRoomId }) else { return [] }
    return ComposerMention.catalog(room: room, currentUserId: currentUserId)
  }

  /// Queue a local shell immediately, then POST in order. Invalid drafts stay
  /// with the composer; accepted sends retain a stable ID for safe retries.
  @discardableResult
  public func sendMessage(_ content: String, attachments: [ComposeAttachment] = [], quote: Components.Schemas.ChatRoomMessageQuote? = nil,
                          skills: [Components.Schemas.ChatRoomMessageSkill] = []) -> Bool {
    let draft = ComposerContent(content)
    guard let roomId = transcriptRoomId,
          let client = resolveClient() else { return false }
    // A quote can be the whole message, except in the coworker 1:1 stream,
    // which needs words to answer.
    guard draft.canSend(quoted: quote != nil && directStream.roomId != roomId) else { return false }
    // The message is on its way, so the Typing line must not outlive what it promised.
    composerStoppedTyping(roomId: roomId)
    room.timeline.followLatest()
    if directStream.roomId == roomId {
      let generation = transcriptGeneration
      return directStream.send(draft.text, client: client, organizationSlug: selection?.workspace.organizationSlug, attachments: attachments, quote: quote, settled: { [weak self] in
        guard let self else { return false }
        return await settleDirectStream(generation: generation)
      }, failed: { [weak self] error in
        guard let self, let error = error as? ChatServiceError else { return }
        signOutIfUnauthorized(error)
      })
    }
    let mentions = ComposerMention.selected(in: draft.text, catalog: composerMentions)
    return room.send(
      draft.text, client: client, organizationSlug: selection?.workspace.organizationSlug, sender: outboundSender,
      mentions: mentions, quote: quote, skills: skills
    ) { [weak self] result in
      guard case let .failure(error) = result, let self, let error = error as? ChatServiceError else { return }
      signOutIfUnauthorized(error)
    }
  }

  // MARK: - Live realtime (SOK-976)

  /// Opens one socket for the signed-in client; membership owns authorization.
  private func startRealtimeIfNeeded() {
    guard realtime == nil,
          let factory = realtimeConnectionFactory,
          let client = resolveClient(),
          !currentUserId.isEmpty
    else {
      return
    }
    let instanceId = realtimeClientInstanceId
    let service = service
    let provider: RealtimeTokenProvider = { slug in
      try await service.fetchAblyToken(
        client: client,
        clientInstanceId: instanceId,
        organizationSlug: slug
      )
    }
    let (stream, continuation) = AsyncStream.makeStream(of: ResolvedRealtimeDelivery.self)
    let connection = factory()
    realtime = connection
    realtimeContinuation = continuation
    connection.connect(
      userId: currentUserId,
      organizationSlug: selection?.workspace.organizationSlug,
      tokenProvider: provider,
      onEvent: { event in continuation.yield(event) }
    )
    connection.setMembershipRooms(Set(rooms.map(\.id)))
    connection.setInFront(readAttention.isVisible)
    realtimeStreamTask?.cancel()
    realtimeStreamTask = Task {
      for await event in stream {
        guard !Task.isCancelled else { break }
        handleRealtimeEvent(event)
        switch event {
        case .message, .patch, .envelope: syncReadAttentionAfterRealtime()
        default: break
        }
      }
    }
    syncPresenceOrganization()
    startPresenceTick()
  }

  /// Closes the socket and drops the event stream. Sign-out and teardown go
  /// through here; room changes only detach via `watchRoom`.
  func stopRealtime() {
    stopPresence()
    closeTyping()
    sidebarRecoveryGeneration = UUID()
    sidebarRecovery.stop()
    roomsRefreshTask?.cancel()
    roomsRefreshTask = nil
    roomsRefreshID = UUID()
    connectionHealthy = false
    realtimeContinuation?.finish()
    realtimeContinuation = nil
    realtimeStreamTask?.cancel()
    realtimeStreamTask = nil
    realtime?.disconnect()
    realtime = nil
  }

  private func handleRealtimeEvent(_ event: ResolvedRealtimeDelivery) {
    switch event.personalized(for: currentUserId) {
    case let .message(roomId, eventType, message):
      applyRealtimeMessage(roomId: roomId, eventType: eventType, message: message)
    case let .patch(patch):
      applyRealtimeMessagePatch(patch)
    case let .pin(roomId, messageId, isPinned, count):
      applyPin(roomId: roomId, messageId: messageId, isPinned: isPinned, count: count)
    case let .roomHealth(roomId, healthy, continuityLost):
      applyRealtimeHealth(roomId: roomId, healthy: healthy, continuityLost: continuityLost)
    case let .envelope(envelope):
      applyRealtimeEnvelope(envelope)
    case let .notification(notification):
      applyRealtimeNotification(notification)
    case let .revoked(roomId):
      applyMembershipRevoked(roomId: roomId)
    case let .roomsChanged(collections):
      sidebarRecovery.requestRefresh(collections)
    case let other:
      handleLiveStateEvent(other)
    }
  }

  /// Another member's message, edit or delete changes what the reader sees. The read runs beside the event loop, so
  /// a burst of events never waits on it; one more run follows whatever arrived while one was going.
  private func syncReadAttentionAfterRealtime() {
    guard !realtimeReadSyncPending else { return }
    realtimeReadSyncPending = true
    let previous = realtimeReadSync
    realtimeReadSync = Task { [weak self] in
      await previous?.value
      guard let self else { return }
      realtimeReadSyncPending = false
      await syncReadAttention()
    }
  }

  /// Who is reachable, present, typing or reading right now: state no HTTP read would return yet.
  private func handleLiveStateEvent(_ event: ResolvedRealtimeDelivery) {
    switch event {
    case let .connectionHealth(healthy):
      connectionHealthy = healthy
      sidebarRecovery.setHealthy(healthy)
      applyPresenceReachability(healthy: healthy)
    case let .presenceRoster(organizationId, members):
      applyPresenceRoster(organizationId: organizationId, members: members)
    case let .typing(roomId, signal):
      applyTyping(roomId: roomId, signal: signal, now: Date())
    case let .typingChannel(roomId, canPublish):
      applyTypingChannel(roomId: roomId, canPublish: canPublish)
    case let .roomRead(event):
      applyRoomRead(event)
    default:
      break
    }
  }

  func applyRealtimeMessagePatch(_ patch: RealtimeMessagePatch) {
    loaded.apply(patch)
  }

  /// A pin changed, here or in another client: the sidebar count, the row's pin and the open room's Pins follow.
  func applyPin(roomId: String, messageId: String, isPinned: Bool, count: Int) {
    guard let index = rooms.firstIndex(where: { $0.id == roomId }) else { return }
    rooms[index].pinnedMessageCount = count
    room.timeline.applyPin(roomId: roomId, messageId: messageId, isPinned: isPinned)
    if pins.roomId == roomId {
      if !isPinned {
        pins.remove(messageId: messageId)
      } else {
        pins.invalidate()
      }
    }
  }

  private func applyRealtimeHealth(roomId: String, healthy: Bool, continuityLost: Bool) {
    guard roomId == transcriptRoomId else { return }
    transcriptRealtimeHealthy = healthy
    thread.transcript.recovery.setHealthy(healthy)
    room.recovery.setHealthy(healthy)
    if continuityLost {
      threadAttentionRevision += 1
      thread.transcript.recovery.requestRefresh()
      room.recovery.requestRefresh()
    }
  }

  /// Apply a full-DTO Ably create/update/delete to the open room. Events for
  /// any other room are ignored here — the sidebar reads unread chrome from
  /// Core, not from live events. Own send + Ably create dedupe to one bubble
  /// by client turn id (ADR 0004). No mark-read: live arrival must not move
  /// unread chrome on its own.
  func applyRealtimeMessage(
    roomId: String,
    eventType: ChatRoomMessageRealtimeEventType,
    message: Components.Schemas.ChatRoomMessage
  ) {
    if roomId == transcriptRoomId, message.parentMessageId != nil {
      threadAttentionRevision += 1
    }
    if eventType == .create, roomId != transcriptRoomId {
      sidebarRecovery.requestRefresh([.active])
    }
    // Another member's rename retitles the open room now; other rows follow the sidebar refresh.
    if eventType == .create, roomId == transcriptRoomId, let index = rooms.firstIndex(where: { $0.id == roomId }),
       let renamed = rooms[index].applyingGroupNameChange(message) {
      rooms[index] = renamed
    }
    // While the coworker stream draws the room's newest rows, only a delete reaches the room's own history.
    guard roomId == transcriptRoomId, message.roomId == transcriptRoomId, !directStream.isBusy || eventType == .delete else {
      return thread.apply(eventType: eventType, message: message)
    }
    loaded.apply(eventType: eventType, message: message)
  }

  /// Apply an id envelope (ADR 0014): delete tombstones the on-screen row,
  /// create/update refetch history for the focused room, everything else is
  /// ignored. The refetch merges — it never invents a row.
  func applyRealtimeEnvelope(_ envelope: ChatRoomMessageIdEnvelope) {
    if envelope.roomId == transcriptRoomId, envelope.parentMessageId != nil {
      threadAttentionRevision += 1
    }
    let refreshParent = thread.apply(envelope)
    if envelope.roomId == directStream.roomId, directStream.isBusy, envelope.eventType != .delete, !refreshParent {
      return
    }
    // The room tombstones or refetches what it shows; an envelope it ignores may still move the Thread or sidebar.
    guard room.apply(envelope) == .ignore else { return }
    if refreshParent || (thread.parent != nil && envelope.roomId == transcriptRoomId && envelope.parentMessageId == thread.parent?.id) {
      room.recovery.requestRefresh()
    }
    if envelope.eventType == .create {
      sidebarRecovery.requestRefresh([.active])
    }
  }

  /// Re-read the latest history page and merge it (envelope refetch, ADR
  /// 0014): the same HTTP refresh as the live poll. No mark-read, never
  /// wipes resolved history on failure.
  public func refreshTranscript() {
    guard transcriptRoomId != nil else { return }
    guard !directStream.isBusy || thread.parent != nil else { return }
    room.load(.latest)
  }

  func settleDirectStream(generation: Int) async -> Bool {
    await room.whenIdle()
    guard generation == transcriptGeneration, !Task.isCancelled else { return false }
    guard let refreshed = room.load(.latest), await refreshed.value else { return false }
    var openedGeneration: Int?
    if let parent = streamingThreadToOpen {
      openThread(parent)
      openedGeneration = thread.transcript.timeline.generation
    }
    guard let parentId = directStream.parentMessageId, thread.parent?.id == parentId else {
      return true
    }
    _ = await thread.transcript.loadTask?.value
    guard generation == transcriptGeneration else { return false }
    guard thread.parent?.id == parentId else { return true }
    // A thread opened after the room refresh already fetched the completed turn.
    if openedGeneration == thread.transcript.timeline.generation, thread.transcript.timeline.hasLoadedHistory, thread.transcript.timeline.errorMessage == nil {
      return true
    }
    loadThreadPage(thread.transcript.timeline.hasLoadedHistory ? .latest : .initial)
    _ = await thread.transcript.loadTask?.value
    guard generation == transcriptGeneration else { return false }
    guard thread.parent?.id == parentId else { return true }
    return thread.transcript.timeline.errorMessage == nil
  }

  /// Drop a revoked room from the sidebar (chat-control event, SOK-742).
  /// When the open room is revoked its transcript clears — posting there is
  /// over — and the saved pick is left alone so relaunch does not reopen a
  /// room that is gone. Remints the token when one exists so caps drop.
  func applyMembershipRevoked(roomId revokedRoomId: String) {
    workspaceSession.applyMembershipRevoked(roomId: revokedRoomId)
    sidebar.invalidateRefresh()
    sidebar.rollbackPendingAction(roomId: revokedRoomId)
    roomsRefreshTask?.cancel()
    roomsRefreshTask = nil
    roomsRefreshID = UUID()
    let result = SokosumiChat.applyMembershipRevoked(
      rooms: rooms,
      selectedRoomId: selectedRoomId,
      revokedRoomId: revokedRoomId
    )
    rooms = result.rooms
    selectedRoomId = result.selectedRoomId
    if transcriptRoomId == revokedRoomId {
      clearTranscript()
    }
    realtime?.setMembershipRooms(Set(rooms.map(\.id)))
  }

  var outboundSender: Components.Schemas.ChatRoomUserParticipant {
    .init(
      id: currentUserId,
      name: currentUserName.isEmpty ? currentUserEmail : currentUserName,
      email: currentUserEmail,
      image: currentUserImageURL,
      presence: .online
    )
  }

  var readContent: RoomReadAttention.Content {
    .init(messages: transcriptMessages.map { .init(id: $0.id, content: $0.content) },
          parentMessageId: thread.parent?.id,
          replies: thread.transcript.timeline.messages.map { .init(id: $0.id, content: $0.content) })
  }

  var roomHistoryReadable: Bool {
    room.timeline.historicalAnchor == nil && room.timeline.hasLoadedHistory && room.timeline.failedPage != .initial && room.timeline.failedPage != .latest
  }

  public func syncReadAttention() async {
    // Behind the Threads view the room is off screen (row 24f1).
    guard !sidebar.showsThreadsView, let room = rooms.first(where: { $0.id == transcriptRoomId }) else { return }
    let content = readContent
    // Background reads stay silent; only a dead session needs action, and `request` signs that out.
    _ = try? await request { _, client, slug in
      try await readAttention.readIfNeeded(
        room: room,
        content: content,
        historyReadable: roomHistoryReadable && !thread.transcript.timeline.isLoading,
        client: client,
        organizationSlug: slug,
        threadLooked: { threadLooked(content.parentMessageId) }
      )
    }
  }

  public func performSidebarAction(_ action: ConversationSidebar.Action, roomId: String) async {
    do {
      try await request { _, client, slug in
        try await sidebar.perform(action, roomId: roomId, client: client, organizationSlug: slug, clock: (now: Date(), makeId: UUID.init))
      }
    } catch ChatServiceError.unauthorized(_) {
      // The auth card takes over; the modal alert would double-surface.
      readAttention.clearError()
      sidebar.clearActionError()
    } catch {}
  }

  /// Reorder Pinned. A failure of the latest reorder reloads the list: what Core holds is the truth.
  public func reorderPinnedRooms(_ roomIds: [String]) async {
    do {
      try await request { _, client, slug in
        try await sidebar.reorderPinned(roomIds, client: client, organizationSlug: slug, now: Date())
      }
    } catch ChatServiceError.unauthorized(_) {
      sidebar.clearActionError()
    } catch {
      // A read that started before the failure may already be running; it must not stand in for the reload.
      await roomsRefreshTask?.value
      await refreshRooms()
    }
  }

  /// Older history page for scroll-up. Merges by message ID; never marks read and never
  /// clears resolved history on failure.
  public func loadOlderMessages() {
    guard !directStream.isBusy else { return }
    room.load(.older)
  }

  /// Signs out when Core rejects the session. Returns whether it did, so
  /// silent callers (attention sync) can keep the side effect explicit.
  @discardableResult
  func signOutIfUnauthorized(_ error: ChatServiceError) -> Bool {
    if case let .unauthorized(message) = error {
      auth.signOut(message: "Core rejected the session (\(message)). Log in again.")
      return true
    }
    return false
  }

  public func select(_ option: WorkspaceOption) {
    guard option.id != selectionId else { return }
    guard !roomsLoading else { return }
    // Header + rooms commit together after the switch succeeds, so a
    // failed PUT never leaves the new header over the old rooms.
    roomsLoading = true
    Task { await switchRooms(option: option) }
  }

  func reload() async {
    guard !Task.isCancelled else { return }
    sidebar.reset()
    renewContext()
    archivedChannels.reset()
    pendingInvitations.reset()
    let context = compositionContext
    rooms = []
    switchError = nil
    selectedRoomId = nil
    stopRealtime()
    clearTranscript()
    crossRoomThreads.reset()
    guard let client = resolveClient() else { return }
    do {
      guard let loaded = try await workspaceSession.load(client: client), context == compositionContext else { return }
      rooms = loaded
      startRealtimeIfNeeded()
      startSidebarRecovery()
      ensureRoomSelection()
    } catch {
      guard context == compositionContext else { return }
      handleWorkspaceError(error)
    }
  }

  func switchRooms(option: WorkspaceOption) async {
    renewContext()
    roomsRefreshTask?.cancel()
    roomsRefreshTask = nil
    roomsRefreshID = UUID()
    sidebar.invalidateRefresh()
    let context = compositionContext
    roomsLoading = true
    defer {
      if context == compositionContext {
        roomsLoading = false
      }
    }
    guard let client = resolveClient() else { return }
    do {
      guard let loaded = try await workspaceSession.select(option, client: client), context == compositionContext else { return }
      sidebar.dropPendingActions()
      archivedChannels.reset()
      pendingInvitations.reset()
      readAttention.reset()
      clearTranscript()
      crossRoomThreads.reset()
      selectedRoomId = nil
      rooms = loaded
      switchError = nil
      realtime?.setOrganizationSlug(option.workspace.organizationSlug)
      realtime?.setMembershipRooms(Set(rooms.map(\.id)))
      startRealtimeIfNeeded()
      syncPresenceOrganization()
      startSidebarRecovery()
      guard context == compositionContext else { return }
      ensureRoomSelection()
    } catch {
      guard context == compositionContext else { return }
      switchError = workspaceSession.errorMessage
      handleWorkspaceError(error)
    }
  }

  public func refreshRooms() async {
    if let task = roomsRefreshTask {
      await task.value
      return
    }
    let id = UUID()
    roomsRefreshID = id
    let task = Task {
      await readRooms()
      if roomsRefreshID == id {
        roomsRefreshTask = nil
      }
    }
    roomsRefreshTask = task
    await task.value
  }

  /// Web reads Archived in organization workspaces only; the live list and the invitations in every workspace.
  private func startSidebarRecovery() {
    let generation = UUID()
    sidebarRecoveryGeneration = generation
    let collections: Set<ChatRoomCollection> = selection?.workspace.organizationId == nil ? [.active, .invitations] : Set(ChatRoomCollection.allCases)
    sidebarRecovery.start(collections, foreground: readAttention.isVisible, healthy: connectionHealthy) { [weak self] collection in
      guard let self else { return }
      if collection == .active {
        await roomsRefreshTask?.value
      }
      guard generation == sidebarRecoveryGeneration else { return }
      switch collection {
      case .active: await refreshRooms()
      case .archived: await loadArchivedChannels()
      case .invitations: await loadPendingInvitations()
      }
    }
  }

  private func readRooms() async {
    guard phase == .ready, !roomsLoading, let client = resolveClient() else { return }
    do {
      guard try await sidebar.refresh(client: client, organizationSlug: selection?.workspace.organizationSlug) else { return }
      realtime?.setMembershipRooms(Set(rooms.map(\.id)))
      // Preserve a visible transcript on refresh; open a replacement only if
      // the previous room is no longer membership-visible.
      if selectedRoomId == nil || !rooms.contains(where: { $0.id == selectedRoomId }) {
        ensureRoomSelection()
      }
    } catch {
      handleWorkspaceError(error)
    }
  }

  private func handleWorkspaceError(_ error: Error) {
    if case let ChatServiceError.unauthorized(message) = error {
      auth.signOut(message: "Core rejected the session (\(message)). Log in again.")
    }
  }
}

/// History gap rows (row 04a): the page between two loaded ranges that a jump left apart. The room's
/// `TranscriptSession` loads them, one after another; the row's state lives in `RoomTimeline.boundaryLoads`.
public extension WorkspaceState {
  /// A gap row scrolled into or out of view (web's `useLoadWhenVisible`):
  /// in view and idle, it loads itself once.
  func setHistoryGapVisible(before messageId: String, _ isVisible: Bool) {
    room.setGapVisible(before: messageId, isVisible)
  }

  /// A tap on the row, or Try again after a failure. The outcome stays on the row.
  func loadHistoryGap(before messageId: String) {
    room.loadGap(before: messageId)
  }
}
