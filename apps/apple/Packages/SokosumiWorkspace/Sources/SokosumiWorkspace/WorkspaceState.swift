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
  private var workspaceGeneration = 0
  @Published public private(set) var openingDirect: DirectRecipient?
  @Published public private(set) var creatingChannel = false
  @Published public private(set) var joiningChannel = false
  @Published public internal(set) var updatingRoom = false
  @Published public private(set) var channelLifecycle: ChannelLifecycleRequest?
  @Published public internal(set) var invitationResponse: InvitationResponse?
  public let archivedChannels = ArchivedChannels()
  public let pendingInvitations = PendingInvitations()
  @Published public private(set) var compositionContext = UUID()
  /// Channel/Direct mutations are single-flight across the workspace, matching web's one open dialog at a time.
  public var roomMutationInFlight: Bool {
    creatingChannel || joiningChannel || updatingRoom || openingDirect != nil || channelLifecycle != nil || invitationResponse != nil
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

  /// The viewer's unconfirmed reaction taps (ADR 0032); see `WorkspaceState+Reactions`.
  @Published var pendingReactions = PendingReactions()
  /// Failed mention shells whose retry POST is in flight; see `WorkspaceState+Mentions`.
  @Published var pendingMentionRetries: Set<MentionRetryRequest> = []
  /// Soko Bot turns rated in this session, by turn id; see `WorkspaceState+SokoBot`.
  @Published public internal(set) var sokoBotFeedback: [String: Bool] = [:]
  @Published var pendingSokoBotFeedback: Set<String> = []
  /// Account-synced chat display preferences; see `WorkspaceState+DisplayPreferences`.
  public let chatDisplay = ChatDisplayPreferences()
  public let notificationPreferences = ChatNotificationPreferences()
  /// App-side OS notification adapter; without it events raise no banner.
  public var notificationPresenter: (any ChatNotificationPresenting)?
  var notificationBanners = ChatNotificationBanners()
  /// The open room's main Transcript: its history, Send queue, realtime updates and recovery.
  public let room: TranscriptSession
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

  /// Factory for the live socket. Set by the app at launch (ably-cocoa);
  /// nil in tests unless a fake is installed. Without one the transcript
  /// stays HTTP-only and every realtime call below no-ops.
  public var realtimeConnectionFactory: (@Sendable () -> (any RealtimeConnection))?
  var realtime: (any RealtimeConnection)?
  private var realtimeStreamTask: Task<Void, Never>?
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
    let rows = pendingReactions.overlaying(messages, viewer: reactionViewer)
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

  private let service = ChatService()
  private var hasLoaded = false
  private var workspaceLoadTask: Task<Void, Never>?

  /// Stable per-install realtime `clientInstanceId` (ADR 0003): persisted on
  /// first launch, reused after, so this Mac is one `{userId}:{instanceId}`
  /// device in every token it mints.
  let realtimeClientInstanceId: String

  /// Creates a workspace coordinator. The host app must inject its authenticated
  /// client provider; the default resolves no client. `now`, `makeId` and `sleep` are the room and Thread
  /// transcripts' clock and ids; `sleep` also paces the sidebar recovery timer.
  public init(
    clientProvider: @escaping (AuthState) -> Client? = { _ in nil },
    savedRoom: SavedRoomSelection = SavedRoomSelection(),
    instanceStore: RealtimeClientInstanceIdStore = UserDefaultsRealtimeInstanceIdStore(),
    unreadsFilter: UnreadsFilterPreference = .transient,
    openRoomUnreadRecheck: OpenRoomUnreadRecheck = OpenRoomUnreadRecheck(),
    now: @escaping () -> Date = Date.init,
    makeId: @escaping () -> String = { UUID().uuidString },
    sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  ) {
    room = TranscriptSession(now: now, makeId: makeId, sleep: sleep)
    thread = ThreadSession(now: now, makeId: makeId, sleep: sleep)
    directStream = DirectStreamSession(now: now, makeId: makeId)
    sidebarRecovery = SidebarCollectionsRecovery(sleep: sleep)
    self.clientProvider = clientProvider
    self.openRoomUnreadRecheck = openRoomUnreadRecheck
    sidebar = ConversationSidebar(savedRoom: savedRoom, unreadsFilter: unreadsFilter)
    realtimeClientInstanceId = getOrCreateRealtimeClientInstanceId(store: instanceStore)
    for publisher in [archivedChannels.objectWillChange, pendingInvitations.objectWillChange, threadOverview.objectWillChange, chatDisplay.objectWillChange, pins.objectWillChange, room.objectWillChange, room.timeline.objectWillChange, room.outbox.objectWillChange, thread.objectWillChange, thread.transcript.objectWillChange, thread.transcript.timeline.objectWillChange, thread.transcript.outbox.objectWillChange, directStream.objectWillChange, presence.objectWillChange, roomReads.objectWillChange] {
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
  }

  private let clientProvider: (AuthState) -> Client?

  /// Test override for the injected authenticated client provider.
  var clientResolver: (() -> Client?)?
  func resolveClient(auth: AuthState) -> Client? {
    clientResolver?() ?? clientProvider(auth)
  }

  public var selection: WorkspaceOption? {
    options.first { $0.id == selectionId }
  }

  public func startIfNeeded(auth: AuthState) {
    guard !hasLoaded else { return }
    hasLoaded = true
    workspaceLoadTask?.cancel()
    workspaceLoadTask = Task { await reload(auth: auth) }
  }

  public func retry(auth: AuthState) {
    workspaceLoadTask?.cancel()
    workspaceLoadTask = Task { await reload(auth: auth) }
  }

  /// Drop everything after sign-out so the next sign-in reloads from Core.
  /// The install instance id survives: this Mac stays one Ably device.
  public func reset() {
    hasLoaded = false
    workspaceLoadTask?.cancel()
    workspaceLoadTask = nil
    workspaceGeneration += 1
    compositionContext = UUID()
    openingDirect = nil
    creatingChannel = false
    joiningChannel = false
    updatingRoom = false
    channelLifecycle = nil
    invitationResponse = nil
    pendingReactions = PendingReactions()
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
  public func selectRoom(_ id: String?, auth: AuthState) {
    guard let id, id != selectedRoomId else { return }
    applyRoomSelection(id, auth: auth)
  }

  private func acceptCreatedRoom(_ room: Components.Schemas.ChatRoom, sourceRoom: String?, auth: AuthState) {
    if let index = rooms.firstIndex(where: { $0.id == room.id }) {
      rooms[index] = room
    } else {
      rooms.append(room)
    }
    realtime?.setMembershipRooms(Set(rooms.map(\.id)))
    // A completed request must not pull the user away from a room they selected meanwhile.
    if transcriptRoomId == sourceRoom {
      selectRoom(room.id, auth: auth)
    }
  }

  public func loadChannelRoster(context: UUID, auth: AuthState) async throws -> ChannelRoster {
    try await channelOperation(context: context, auth: auth) { client, organizationId, slug in
      try await ChatService().channelRoster(client: client, organizationId: organizationId, organizationSlug: slug)
    }
  }

  public func checkChannelSlug(_ slug: String, context: UUID, auth: AuthState) async throws -> Bool {
    try await channelOperation(context: context, auth: auth) { client, _, organizationSlug in
      try await ChatService().channelSlugIsAvailable(client: client, slug: slug, organizationSlug: organizationSlug)
    }
  }

  public func createChannel(_ draft: ChannelDraft, roster: ChatRecipientRoster, context: UUID, auth: AuthState) async throws -> Bool {
    guard canStartMutation(context: context) else { return false }
    let sourceRoom = transcriptRoomId
    creatingChannel = true
    defer {
      if context == compositionContext {
        creatingChannel = false
      }
    }
    let room = try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().createChannel(client: client, draft: draft, roster: roster, currentUserId: self.currentUserId, organizationSlug: slug)
    }
    acceptCreatedRoom(room, sourceRoom: sourceRoom, auth: auth)
    return true
  }

  /// Settings edits reconcile the room in place and never navigate: the sidebar row and any open transcript keep their identity.
  public func updateChannel(_ draft: ChannelEditDraft, roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    guard canStartMutation(context: context), draft.isValid, rooms.contains(where: { $0.id == roomId }) else { return false }
    updatingRoom = true
    defer {
      if context == compositionContext {
        updatingRoom = false
      }
    }
    let request = draft.updateRequest
    let room = try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().updateRoom(client: client, roomId: roomId, request: request, organizationSlug: slug)
    }
    // A list read already in flight predates this settings edit.
    sidebar.invalidateRefresh()
    if let index = rooms.firstIndex(where: { $0.id == room.id }) {
      rooms[index] = room
    }
    return true
  }

  /// Names or clears a group Direct's Group name (ADR-0040) in any workspace, then takes Core's room in place like `updateChannel`.
  public func nameGroup(_ draft: GroupNameDraft, roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    guard canStartMutation(context: context) else { return false }
    updatingRoom = true
    defer {
      if context == compositionContext {
        updatingRoom = false
      }
    }
    let slug = selection?.workspace.organizationSlug
    let room = try await workspaceOperation(context: context, auth: auth) { client in
      try await ChatService().updateRoom(client: client, roomId: roomId, request: draft.updateRequest, organizationSlug: slug)
    }
    // A list read already in flight predates this rename.
    sidebar.invalidateRefresh()
    if let index = rooms.firstIndex(where: { $0.id == room.id }) {
      rooms[index] = room
    }
    return true
  }

  public func browseChannels(query: String, context: UUID, auth: AuthState) async throws -> [Components.Schemas.DiscoverableChatRoom] {
    try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().discoverableChannels(client: client, query: query, organizationSlug: slug)
    }
  }

  public func joinChannel(roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    guard context == compositionContext, phase == .ready, !workspaceSession.isSwitching,
          !roomMutationInFlight else { return false }
    let sourceRoom = transcriptRoomId
    joiningChannel = true
    defer {
      if context == compositionContext {
        joiningChannel = false
      }
    }
    let room = try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().joinChannel(client: client, roomId: roomId, organizationSlug: slug)
    }
    acceptCreatedRoom(room, sourceRoom: sourceRoom, auth: auth)
    return true
  }

  func channelOperation<Value: Sendable>(context: UUID, auth: AuthState, operation: (Client, String, String) async throws -> Value) async throws -> Value {
    guard let organizationId = selection?.workspace.organizationId, let slug = selection?.workspace.organizationSlug else { throw CancellationError() }
    return try await workspaceOperation(context: context, auth: auth) { client in
      try await operation(client, organizationId, slug)
    }
  }

  /// Channel, Direct and invitation mutations start only for the live composition context, outside a switch, one at a time.
  func canStartMutation(context: UUID) -> Bool {
    context == compositionContext && phase == .ready && !workspaceSession.isSwitching && !roomMutationInFlight
  }

  /// Runs an authenticated request for the current composition context; a workspace change or reset turns its result into cancellation.
  func workspaceOperation<Value: Sendable>(context: UUID, auth: AuthState, operation: (Client) async throws -> Value) async throws -> Value {
    guard context == compositionContext, phase == .ready, !workspaceSession.isSwitching, let client = resolveClient(auth: auth) else { throw CancellationError() }
    do {
      let value = try await operation(client)
      guard context == compositionContext, phase == .ready, !Task.isCancelled else { throw CancellationError() }
      return value
    } catch {
      guard context == compositionContext else { throw CancellationError() }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }

  /// Web loads the Archived section for organization workspaces only and fails soft.
  public func loadArchivedChannels(auth: AuthState) async {
    guard selection?.workspace.organizationId != nil else {
      archivedChannels.reset()
      return
    }
    let context = compositionContext
    await archivedChannels.load {
      try await channelOperation(context: context, auth: auth) { client, organizationId, slug in
        try await ChatService().archivedChannels(client: client, organizationId: organizationId, organizationSlug: slug)
      }
    }
  }

  /// Leaving drops the room like a membership revoke: the open transcript clears and no other room is forced open.
  public func leaveChannel(roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    try await runChannelLifecycle(.leave, roomId: roomId, context: context) {
      let slug = selection?.workspace.organizationSlug
      try await workspaceOperation(context: context, auth: auth) { client in
        try await ChatService().leaveChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      applyMembershipRevoked(roomId: roomId)
    }
  }

  /// Archiving hides the channel for everyone; it moves into the Archived section.
  public func archiveChannel(roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    try await runChannelLifecycle(.archive, roomId: roomId, context: context) {
      try await channelOperation(context: context, auth: auth) { client, _, slug in
        try await ChatService().archiveChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      if let room = rooms.first(where: { $0.id == roomId }) {
        archivedChannels.insert(room)
      }
      applyMembershipRevoked(roomId: roomId)
    }
  }

  /// Restoring returns the live room and opens it (web navigates to it) unless the user moved on meanwhile.
  public func restoreChannel(roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    let sourceRoom = transcriptRoomId
    return try await runChannelLifecycle(.restore, roomId: roomId, context: context) {
      let room = try await channelOperation(context: context, auth: auth) { client, _, slug in
        try await ChatService().restoreChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      archivedChannels.remove(roomId: roomId)
      acceptCreatedRoom(room, sourceRoom: sourceRoom, auth: auth)
    }
  }

  public func deleteChannel(roomId: String, context: UUID, auth: AuthState) async throws -> Bool {
    try await runChannelLifecycle(.delete, roomId: roomId, context: context) {
      try await channelOperation(context: context, auth: auth) { client, _, slug in
        try await ChatService().deleteChannel(client: client, roomId: roomId, organizationSlug: slug)
      }
      archivedChannels.remove(roomId: roomId)
    }
  }

  private func runChannelLifecycle(_ action: ChannelLifecycleAction, roomId: String, context: UUID, perform: () async throws -> Void) async throws -> Bool {
    guard canStartMutation(context: context) else { return false }
    channelLifecycle = .init(roomId: roomId, action: action)
    defer {
      if context == compositionContext {
        channelLifecycle = nil
      }
    }
    try await perform()
    return true
  }

  public func canOpenDirect(_ recipient: DirectRecipient) -> Bool {
    guard phase == .ready, let room = rooms.first(where: { $0.id == transcriptRoomId }) else { return false }
    return recipient.canOpen(from: room, currentUserId: currentUserId, hasActiveOrganization: selection?.workspace.organizationId != nil)
  }

  public func loadDirectRecipients(context: UUID, auth: AuthState) async throws -> ChatRecipientRoster {
    guard phase == .ready, context == compositionContext, !workspaceSession.isSwitching,
          let client = resolveClient(auth: auth) else { throw CancellationError() }
    do {
      let yourself = currentUserId.isEmpty ? nil : ChatRecipientTarget.messageYourself(
        userId: currentUserId, name: currentUserName.isEmpty ? currentUserEmail : currentUserName, imageURL: currentUserImageURL
      )
      let roster = try await ChatService().directRecipients(
        client: client, yourself: yourself,
        organizationId: selection?.workspace.organizationId,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard context == compositionContext, phase == .ready, !Task.isCancelled else { throw CancellationError() }
      return roster
    } catch {
      guard context == compositionContext else { throw CancellationError() }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }

  @discardableResult
  public func openParticipantDirect(_ recipient: DirectRecipient, auth: AuthState) async throws -> Bool {
    guard canOpenDirect(recipient) else { return false }
    var recipients = DirectConversationSelection(hasOrganization: selection?.workspace.organizationId != nil, currentUserId: currentUserId)
    recipients.add(recipient)
    return try await openDirect(recipients, context: compositionContext, auth: auth)
  }

  @discardableResult
  public func openDirect(_ recipients: DirectConversationSelection, context: UUID, auth: AuthState) async throws -> Bool {
    guard canStartMutation(context: context),
          let first = recipients.recipients.first, let client = resolveClient(auth: auth) else { return false }
    let sourceRoom = transcriptRoomId
    openingDirect = first
    defer {
      if context == compositionContext {
        openingDirect = nil
      }
    }
    do {
      let room = try await ChatService().openDirect(client: client, selection: recipients, organizationSlug: selection?.workspace.organizationSlug)
      guard !Task.isCancelled, context == compositionContext, phase == .ready else { return false }
      acceptCreatedRoom(room, sourceRoom: sourceRoom, auth: auth)
      return true
    } catch {
      guard context == compositionContext else { return false }
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
      throw error
    }
  }

  private func applyRoomSelection(_ id: String?, auth: AuthState) {
    sidebar.select(id, userId: currentUserId, organizationId: selection?.workspace.organizationId)
    guard let id = selectedRoomId, let room = rooms.first(where: { $0.id == id }) else {
      clearTranscript()
      return
    }
    openRoom(room, auth: auth)
  }

  /// Keep a room selected whenever rooms exist: the saved room when it is
  /// still listed, else the first room. Runs after every rooms load.
  private func ensureRoomSelection(auth: AuthState) {
    applyRoomSelection(sidebar.restoredSelection(userId: currentUserId, organizationId: selection?.workspace.organizationId), auth: auth)
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
  public func openRoom(_ room: Components.Schemas.ChatRoom, auth: AuthState) {
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
    connectRoomTranscript(auth: auth)
    let generation = transcriptGeneration
    watchRoom(room.id)
    self.room.load(.initial)
    if directStream.roomId != nil, let client = resolveClient(auth: auth) {
      directStream.resume(client: client, organizationSlug: selection?.workspace.organizationSlug, settled: { [weak self, weak auth] in
        guard let self, let auth else { return false }
        return await settleDirectStream(auth: auth, generation: generation)
      }, failed: { [weak self, weak auth] error in
        guard let self, let auth, let error = error as? ChatServiceError else { return }
        signOutIfUnauthorized(error, auth: auth)
      })
    }
    self.room.recovery.start(foreground: readAttention.isVisible, healthy: transcriptRealtimeHealthy) { [weak self, weak auth] in
      guard let self, let auth else { return }
      await recoverTranscript(auth: auth, generation: generation)
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
  private func recoverTranscript(auth: AuthState, generation: Int) async {
    await room.whenIdle()
    guard generation == transcriptGeneration else { return }
    refreshTranscript(auth: auth)
    await room.whenIdle()
  }

  /// Every entry point that loads the room hands the room's Transcript this account's hooks first, so a load reads
  /// with the client the caller's sign-in resolves.
  func connectRoomTranscript(auth: AuthState) {
    room.hooks = transcriptHooks(auth: auth) { [weak self, weak auth] page in
      guard let self, let auth else { return }
      switch page {
      case .initial:
        await syncReadAttention(auth: auth)
      case .latest:
        // The room's fresh copy of an open Thread's parent is the newer one.
        if let parent = transcriptMessages.first(where: { $0.id == thread.parent?.id }) {
          thread.apply(eventType: .update, message: parent)
        }
        await syncReadAttention(auth: auth)
      default:
        break
      }
    }
  }

  /// What a Transcript asks the workspace for: this account's client and slug, sign-out when Core rejects the
  /// session, and `pageLanded` once a page applied.
  func transcriptHooks(auth: AuthState, pageLanded: @escaping (RoomTimeline.Page) async -> Void) -> TranscriptSession.Hooks {
    .init(access: { [weak self, weak auth] in
      guard let self, let auth, let client = resolveClient(auth: auth) else { return nil }
      return (client, selection?.workspace.organizationSlug)
    }, failed: { [weak self, weak auth] error in
      guard let self, let auth else { return false }
      guard let error = error as? ChatServiceError else {
        logger.error("Sokosumi transcript load failed: \(String(describing: error), privacy: .public)")
        return false
      }
      return signOutIfUnauthorized(error, auth: auth)
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
                          skills: [Components.Schemas.ChatRoomMessageSkill] = [], auth: AuthState) -> Bool {
    let draft = ComposerContent(content)
    guard let roomId = transcriptRoomId,
          let client = resolveClient(auth: auth) else { return false }
    // A quote can be the whole message, except in the coworker 1:1 stream,
    // which needs words to answer.
    guard draft.canSend(quoted: quote != nil && directStream.roomId != roomId) else { return false }
    // The message is on its way, so the Typing line must not outlive what it promised.
    composerStoppedTyping(roomId: roomId)
    room.timeline.followLatest()
    if directStream.roomId == roomId {
      let generation = transcriptGeneration
      return directStream.send(draft.text, client: client, organizationSlug: selection?.workspace.organizationSlug, attachments: attachments, quote: quote, settled: { [weak self, weak auth] in
        guard let self, let auth else { return false }
        return await settleDirectStream(auth: auth, generation: generation)
      }, failed: { [weak self, weak auth] error in
        guard let self, let auth, let error = error as? ChatServiceError else { return }
        signOutIfUnauthorized(error, auth: auth)
      })
    }
    let mentions = ComposerMention.selected(in: draft.text, catalog: composerMentions)
    return room.send(
      draft.text, client: client, organizationSlug: selection?.workspace.organizationSlug, sender: outboundSender,
      mentions: mentions, quote: quote, skills: skills
    ) { [weak self, weak auth] result in
      guard case let .failure(error) = result, let self, let auth, let error = error as? ChatServiceError else { return }
      signOutIfUnauthorized(error, auth: auth)
    }
  }

  public func retryOutbound(clientTurnId: String) {
    room.outbox.retry(clientTurnId)
  }

  /// Drops the failed local shell only. Does not delete a Core row.
  public func removeOutbound(clientTurnId: String) {
    room.outbox.remove(clientTurnId)
  }

  // MARK: - Live realtime (SOK-976)

  /// Opens one socket for the signed-in client; membership owns authorization.
  private func startRealtimeIfNeeded(auth: AuthState) {
    guard realtime == nil,
          let factory = realtimeConnectionFactory,
          let client = resolveClient(auth: auth),
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
      applyRealtimePin(roomId: roomId, messageId: messageId, isPinned: isPinned, count: count)
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
    thread.apply(patch)
    room.apply(patch)
  }

  private func applyRealtimePin(roomId: String, messageId: String, isPinned: Bool, count: Int) {
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
    thread.apply(eventType: eventType, message: message)
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
    guard roomId == transcriptRoomId, message.roomId == transcriptRoomId, !directStream.isBusy || eventType == .delete else { return }
    room.apply(eventType: eventType, message: message)
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
  public func refreshTranscript(auth: AuthState) {
    guard transcriptRoomId != nil else { return }
    guard !directStream.isBusy || thread.parent != nil else { return }
    connectRoomTranscript(auth: auth)
    room.load(.latest)
  }

  func settleDirectStream(auth: AuthState, generation: Int) async -> Bool {
    await room.whenIdle()
    guard generation == transcriptGeneration, !Task.isCancelled else { return false }
    connectRoomTranscript(auth: auth)
    guard let refreshed = room.load(.latest), await refreshed.value else { return false }
    var openedGeneration: Int?
    if let parent = streamingThreadToOpen {
      openThread(parent, auth: auth)
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
    loadThreadPage(thread.transcript.timeline.hasLoadedHistory ? .latest : .initial, auth: auth)
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

  public var readContent: RoomReadAttention.Content {
    .init(messages: transcriptMessages.map { .init(id: $0.id, content: $0.content) },
          parentMessageId: thread.parent?.id,
          replies: thread.transcript.timeline.messages.map { .init(id: $0.id, content: $0.content) })
  }

  var roomHistoryReadable: Bool {
    room.timeline.historicalAnchor == nil && room.timeline.hasLoadedHistory && room.timeline.failedPage != .initial && room.timeline.failedPage != .latest
  }

  public func syncReadAttention(auth: AuthState) async {
    // Behind the Threads view the room is off screen (row 24f1).
    guard !sidebar.showsThreadsView,
          let room = rooms.first(where: { $0.id == transcriptRoomId }), let client = resolveClient(auth: auth) else { return }
    let content = readContent
    do {
      try await readAttention.readIfNeeded(
        room: room,
        content: content,
        historyReadable: roomHistoryReadable && !thread.transcript.timeline.isLoading,
        client: client,
        organizationSlug: selection?.workspace.organizationSlug,
        threadLooked: { threadLooked(content.parentMessageId) }
      )
    } catch {
      // Background reads stay silent; only a dead session needs action.
      if let error = error as? ChatServiceError {
        signOutIfUnauthorized(error, auth: auth)
      }
    }
  }

  public func performSidebarAction(_ action: ConversationSidebar.Action, roomId: String, auth: AuthState) async {
    guard let client = resolveClient(auth: auth) else { return }
    do {
      try await sidebar.perform(
        action, roomId: roomId, client: client, organizationSlug: selection?.workspace.organizationSlug,
        clock: (now: Date(), makeId: UUID.init)
      )
    } catch {
      if let error = error as? ChatServiceError, signOutIfUnauthorized(error, auth: auth) {
        // The auth card takes over; the modal alert would double-surface.
        readAttention.clearError()
        sidebar.clearActionError()
      }
    }
  }

  /// Reorder Pinned. A failure of the latest reorder reloads the list: what Core holds is the truth.
  public func reorderPinnedRooms(_ roomIds: [String], auth: AuthState) async {
    guard let client = resolveClient(auth: auth) else { return }
    do {
      try await sidebar.reorderPinned(
        roomIds, client: client, organizationSlug: selection?.workspace.organizationSlug, now: Date()
      )
    } catch {
      if let error = error as? ChatServiceError, signOutIfUnauthorized(error, auth: auth) {
        sidebar.clearActionError()
        return
      }
      // A read that started before the failure may already be running; it must not stand in for the reload.
      await roomsRefreshTask?.value
      await refreshRooms(auth: auth)
    }
  }

  /// Older history page for scroll-up. Merges by message ID; never marks read and never
  /// clears resolved history on failure.
  public func loadOlderMessages(auth: AuthState) {
    guard !directStream.isBusy else { return }
    connectRoomTranscript(auth: auth)
    room.load(.older)
  }

  /// Signs out when Core rejects the session. Returns whether it did, so
  /// silent callers (attention sync) can keep the side effect explicit.
  @discardableResult
  func signOutIfUnauthorized(_ error: ChatServiceError, auth: AuthState) -> Bool {
    if case let .unauthorized(message) = error {
      auth.signOut(message: "Core rejected the session (\(message)). Log in again.")
      return true
    }
    return false
  }

  public func select(_ option: WorkspaceOption, auth: AuthState) {
    guard option.id != selectionId else { return }
    guard !roomsLoading else { return }
    // Header + rooms commit together after the switch succeeds, so a
    // failed PUT never leaves the new header over the old rooms.
    roomsLoading = true
    Task { await switchRooms(auth: auth, option: option) }
  }

  func reload(auth: AuthState) async {
    guard !Task.isCancelled else { return }
    sidebar.reset()
    workspaceGeneration += 1
    compositionContext = UUID()
    openingDirect = nil
    creatingChannel = false
    joiningChannel = false
    updatingRoom = false
    channelLifecycle = nil
    invitationResponse = nil
    archivedChannels.reset()
    pendingInvitations.reset()
    let generation = workspaceGeneration
    rooms = []
    switchError = nil
    selectedRoomId = nil
    stopRealtime()
    clearTranscript()
    crossRoomThreads.reset()
    guard let client = resolveClient(auth: auth) else { return }
    do {
      guard let loaded = try await workspaceSession.load(client: client), generation == workspaceGeneration else { return }
      rooms = loaded
      startRealtimeIfNeeded(auth: auth)
      startSidebarRecovery(auth: auth)
      ensureRoomSelection(auth: auth)
    } catch {
      guard generation == workspaceGeneration else { return }
      handleWorkspaceError(error, auth: auth)
    }
  }

  func switchRooms(auth: AuthState, option: WorkspaceOption) async {
    compositionContext = UUID()
    openingDirect = nil
    creatingChannel = false
    joiningChannel = false
    updatingRoom = false
    channelLifecycle = nil
    invitationResponse = nil
    roomsRefreshTask?.cancel()
    roomsRefreshTask = nil
    roomsRefreshID = UUID()
    sidebar.invalidateRefresh()
    let generation = workspaceGeneration
    roomsLoading = true
    defer {
      if generation == workspaceGeneration {
        roomsLoading = false
      }
    }
    guard let client = resolveClient(auth: auth) else { return }
    do {
      guard let loaded = try await workspaceSession.select(option, client: client), generation == workspaceGeneration else { return }
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
      startRealtimeIfNeeded(auth: auth)
      syncPresenceOrganization()
      startSidebarRecovery(auth: auth)
      guard generation == workspaceGeneration else { return }
      ensureRoomSelection(auth: auth)
    } catch {
      guard generation == workspaceGeneration else { return }
      switchError = workspaceSession.errorMessage
      handleWorkspaceError(error, auth: auth)
    }
  }

  public func refreshRooms(auth: AuthState) async {
    if let task = roomsRefreshTask {
      await task.value
      return
    }
    let id = UUID()
    roomsRefreshID = id
    let task = Task {
      await readRooms(auth: auth)
      if roomsRefreshID == id {
        roomsRefreshTask = nil
      }
    }
    roomsRefreshTask = task
    await task.value
  }

  /// Web reads Archived in organization workspaces only; the live list and the invitations in every workspace.
  private func startSidebarRecovery(auth: AuthState) {
    let generation = UUID()
    sidebarRecoveryGeneration = generation
    let collections: Set<ChatRoomCollection> = selection?.workspace.organizationId == nil ? [.active, .invitations] : Set(ChatRoomCollection.allCases)
    sidebarRecovery.start(collections, foreground: readAttention.isVisible, healthy: connectionHealthy) { [weak self, weak auth] collection in
      guard let self, let auth else { return }
      if collection == .active {
        await roomsRefreshTask?.value
      }
      guard generation == sidebarRecoveryGeneration else { return }
      switch collection {
      case .active: await refreshRooms(auth: auth)
      case .archived: await loadArchivedChannels(auth: auth)
      case .invitations: await loadPendingInvitations(auth: auth)
      }
    }
  }

  private func readRooms(auth: AuthState) async {
    guard phase == .ready, !roomsLoading, let client = resolveClient(auth: auth) else { return }
    do {
      guard try await sidebar.refresh(client: client, organizationSlug: selection?.workspace.organizationSlug) else { return }
      realtime?.setMembershipRooms(Set(rooms.map(\.id)))
      // Preserve a visible transcript on refresh; open a replacement only if
      // the previous room is no longer membership-visible.
      if selectedRoomId == nil || !rooms.contains(where: { $0.id == selectedRoomId }) {
        ensureRoomSelection(auth: auth)
      }
    } catch {
      handleWorkspaceError(error, auth: auth)
    }
  }

  private func handleWorkspaceError(_ error: Error, auth: AuthState) {
    if case let ChatServiceError.unauthorized(message) = error {
      auth.signOut(message: "Core rejected the session (\(message)). Log in again.")
    }
  }
}
