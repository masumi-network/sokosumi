import Combine
import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat
import SokosumiRealtime

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
    public let requestId = UUID()
  }

  @Published public internal(set) var messageJump: MessageJump?
  var messageNavigationRequest = UUID()
  public let thread = ThreadSession()
  public let threadOverview = RoomThreadOverview()
  @Published public internal(set) var threadAttentionRevision = 0
  public let messageEditing = MessageEditing()
  public let directStream = DirectStreamSession()
  private var threadObservations: Set<AnyCancellable> = []
  private var workspaceGeneration = 0
  @Published public private(set) var openingDirect: DirectRecipient?
  @Published public private(set) var creatingChannel = false
  @Published public private(set) var joiningChannel = false
  @Published public internal(set) var updatingChannel = false
  @Published public private(set) var channelLifecycle: ChannelLifecycleRequest?
  @Published public internal(set) var invitationResponse: InvitationResponse?
  public let archivedChannels = ArchivedChannels()
  public let pendingInvitations = PendingInvitations()
  @Published public private(set) var compositionContext = UUID()
  /// Channel/Direct mutations are single-flight across the workspace, matching web's one open dialog at a time.
  public var channelMutationInFlight: Bool {
    creatingChannel || joiningChannel || updatingChannel || openingDirect != nil || channelLifecycle != nil || invitationResponse != nil
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
  public let timeline = RoomTimeline()
  public let pins = PinnedMessages()
  @Published var pendingPins: Set<String> = []
  private(set) var transcriptLoadTask: Task<Void, Never>?
  private(set) var olderPageTask: Task<Void, Never>?
  private(set) var transcriptRefreshTask: Task<Void, Never>?
  private var timelineObservation: AnyCancellable?

  /// Room the transcript pane shows. Nil clears the pane.
  public var transcriptRoomId: String? {
    timeline.roomId
  }

  var transcriptMessages: [Components.Schemas.ChatRoomMessage] {
    get { timeline.messages }
    set { timeline.messages = newValue }
  }

  public var transcriptHasMore: Bool {
    timeline.hasMore
  }

  public var transcriptLoading: Bool {
    timeline.isLoading
  }

  public var transcriptLoadingOlder: Bool {
    timeline.isLoadingOlder
  }

  /// Latest-page refetch in flight (ADR 0014 envelope). Not the older-page
  /// spinner: live refetch must not flash `transcriptLoadingOlder`.
  public var transcriptRefreshing: Bool {
    timeline.isRefreshing
  }

  /// Failure text. Shown full-pane when there is no history, as a banner
  /// above loaded history otherwise — a failed older page never wipes
  /// what already resolved.
  public var transcriptError: String? {
    get { timeline.errorMessage }
    set { timeline.errorMessage = newValue }
  }

  /// Unconfirmed classic sends for the open room. Remount / room change
  /// drops them (no durable outbox).
  public let outbox = RoomOutbox()
  private var outboxObservation: AnyCancellable?
  public var outboundShells: [OutboundShell] {
    outbox.shells
  }

  /// True while a classic POST is in flight for this composer.
  var outboundInFlight: Bool {
    outbox.isSending
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

  /// Confirmed history plus unresolved outbound shells (sticky at the end), with Pending reactions on top.
  public var displayedTranscript: [Components.Schemas.ChatRoomMessage] {
    let messages = directStream.displayedMessages(persisted: SokosumiChat.displayedTranscript(messages: transcriptMessages, shells: outboundShells))
    return pendingReactions.overlaying(messages, viewer: reactionViewer)
  }

  var transcriptCursor: String? {
    timeline.cursor
  }

  /// Bumps on every open/clear so a slow room cannot paint over a newer one.
  private var transcriptGeneration: Int {
    timeline.generation
  }

  let transcriptRecovery = ChatRefreshScheduler()
  let sidebarRecovery = ChatRefreshScheduler()
  private var connectionHealthy = false
  private(set) var roomsRefreshTask: Task<Void, Never>?
  private var roomsRefreshID = UUID()
  private var sidebarRecoveryGeneration = UUID()
  private(set) var transcriptRealtimeHealthy = false

  private let service = ChatService()
  private var hasLoaded = false
  private var workspaceLoadTask: Task<Void, Never>?

  /// Stable per-install Ably `clientInstanceId` (ADR 0003): persisted on
  /// first launch, reused after, so this Mac is one `{userId}:{instanceId}`
  /// device in every token it mints.
  let ablyClientInstanceId: String

  /// Creates a workspace coordinator. The host app must inject its authenticated
  /// client provider; the default resolves no client.
  public init(
    clientProvider: @escaping (AuthState) -> Client? = { _ in nil },
    savedRoom: SavedRoomSelection = SavedRoomSelection(),
    instanceStore: AblyClientInstanceIdStore = UserDefaultsAblyClientInstanceIdStore()
  ) {
    self.clientProvider = clientProvider
    sidebar = ConversationSidebar(savedRoom: savedRoom)
    ablyClientInstanceId = getOrCreateAblyClientInstanceId(store: instanceStore)
    for publisher in [archivedChannels.objectWillChange, pendingInvitations.objectWillChange, threadOverview.objectWillChange, chatDisplay.objectWillChange, pins.objectWillChange, thread.objectWillChange, thread.timeline.objectWillChange, thread.outbox.objectWillChange, directStream.objectWillChange, presence.objectWillChange] {
      publisher.sink { [weak self] in self?.objectWillChange.send() }.store(in: &threadObservations)
    }
    // Rows need editor identity changes; draft and save state are observed by the editor itself.
    messageEditing.$source.map { $0?.id }.removeDuplicates().dropFirst()
      .sink { [weak self] _ in self?.objectWillChange.send() }
      .store(in: &threadObservations)
    outboxObservation = outbox.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    timelineObservation = timeline.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    sidebarObservation = sidebar.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    attentionObservation = readAttention.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    workspaceObservation = workspaceSession.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
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
    updatingChannel = false
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

  /// Editing reconciles the room in place and never navigates: the sidebar row and any open transcript keep their identity.
  public func updateChannel(_ draft: ChannelEditDraft, roomId: String, permissions: ChannelEditPermissions, context: UUID, auth: AuthState) async throws -> Bool {
    guard context == compositionContext, phase == .ready, !workspaceSession.isSwitching, permissions.canEditMembers, draft.isValid,
          !channelMutationInFlight else { return false }
    updatingChannel = true
    defer {
      if context == compositionContext {
        updatingChannel = false
      }
    }
    let request = draft.updateRequest(permissions: permissions, currentUserId: currentUserId)
    let room = try await channelOperation(context: context, auth: auth) { client, _, slug in
      try await ChatService().updateChannel(client: client, roomId: roomId, request: request, organizationSlug: slug)
    }
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
          !channelMutationInFlight else { return false }
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
    context == compositionContext && phase == .ready && !workspaceSession.isSwitching && !channelMutationInFlight
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
      let roster = try await ChatService().directRecipients(
        client: client, currentUserId: currentUserId,
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
    var recipients = DirectConversationSelection(hasOrganization: selection?.workspace.organizationId != nil)
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
    messageEditing.reset()
    directStream.reset()
    thread.close()
    threadOverview.reset()
    transcriptRealtimeHealthy = false
    transcriptRecovery.stop()
    readAttention.roomChanged()
    pins.reset()
    pendingPins = []
    timeline.reset()
    transcriptLoadTask = nil
    olderPageTask = nil
    transcriptRefreshTask = nil
    realtime?.watchRoom(nil)
    transcriptError = nil
    clearOutbound()
  }

  /// Open a room's transcript: history first, mark-read after it resolves
  /// (ADR 0026). The sidebar entry is replaced with the POST-read DTO so
  /// unread chrome matches Core. A failed read keeps the resolved history
  /// on screen and leaves unread chrome unchanged.
  public func openRoom(_ room: Components.Schemas.ChatRoom, auth: AuthState) {
    messageNavigationRequest = UUID()
    messageJump = nil
    messageEditing.reset()
    directStream.reset(room: room, userId: currentUserId, organizationId: selection?.workspace.organizationId)
    thread.close()
    threadOverview.reset()
    transcriptRealtimeHealthy = transcriptRoomId == room.id && transcriptRealtimeHealthy
    readAttention.roomChanged()
    pins.reset(roomId: room.id)
    pendingPins = []
    timeline.reset(roomId: room.id)
    olderPageTask = nil
    transcriptRefreshTask = nil
    let generation = transcriptGeneration
    clearOutbound()
    realtime?.watchRoom(room.id)
    transcriptLoadTask = Task { await loadTranscript(auth: auth, room: room, generation: generation) }
    if directStream.roomId != nil, let client = resolveClient(auth: auth) {
      directStream.resume(client: client, organizationSlug: selection?.workspace.organizationSlug, settled: { [weak self, weak auth] in
        guard let self, let auth else { return false }
        return await settleDirectStream(auth: auth, generation: generation)
      }, failed: { [weak self, weak auth] error in
        guard let self, let auth, let error = error as? ChatServiceError else { return }
        signOutIfUnauthorized(error, auth: auth)
      })
    }
    transcriptRecovery.start(foreground: readAttention.isVisible, healthy: transcriptRealtimeHealthy) { [weak self, weak auth] in
      guard let self, let auth else { return }
      await recoverTranscript(auth: auth, generation: generation)
    }
  }

  public func setWindowVisible(_ visible: Bool, window: UUID) {
    let wasVisible = readAttention.isVisible
    readAttention.setVisible(visible, window: window)
    thread.recovery.setForeground(readAttention.isVisible)
    transcriptRecovery.setForeground(readAttention.isVisible)
    sidebarRecovery.setForeground(readAttention.isVisible)
    if !wasVisible, readAttention.isVisible {
      realtime?.refreshMembership()
    }
    if wasVisible != readAttention.isVisible {
      // Web's visibilitychange: hidden publishes afk at once, visible counts as activity.
      presence.setVisible(readAttention.isVisible)
      publishPresence(force: true)
    }
  }

  /// Wait for history/pagination before the recovery read. The scheduler's
  /// interval starts after the HTTP request and read-attention work finish.
  private func recoverTranscript(auth: AuthState, generation: Int) async {
    while generation == transcriptGeneration,
          let task = transcriptLoadTask ?? olderPageTask ?? transcriptRefreshTask {
      await task.value
    }
    guard generation == transcriptGeneration else { return }
    guard readAttention.isVisible else {
      transcriptRecovery.requestRefresh()
      return
    }
    refreshTranscript(auth: auth)
    while generation == transcriptGeneration, let task = transcriptRefreshTask {
      await task.value
    }
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
  public func sendMessage(_ content: String, attachments: [ComposeAttachment] = [], quote: Components.Schemas.ChatRoomMessageQuote? = nil, auth: AuthState) -> Bool {
    let draft = ComposerContent(content)
    guard let roomId = transcriptRoomId, !transcriptLoading,
          let client = resolveClient(auth: auth) else { return false }
    // A quote can be the whole message, except in the coworker 1:1 stream,
    // which needs words to answer.
    guard draft.canSend(quoted: quote != nil && directStream.roomId != roomId) else { return false }
    timeline.followLatest()
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
    let id = UUID().uuidString
    let slug = selection?.workspace.organizationSlug
    let mentions = ComposerMention.selected(in: draft.text, catalog: composerMentions)
    var shell = makeOutboundShell(clientMessageId: id, roomId: roomId, content: draft.text)
    shell.quote = quote
    outbox.enqueue(shell, send: { [service] in
      try await service.createMessage(
        client: client, roomId: roomId, content: draft.text,
        clientMessageId: id, mentions: mentions, quote: quote, organizationSlug: slug
      )
    }, confirmed: { [weak self] message in
      guard let self else { return }
      transcriptMessages = confirmOutbound(
        messages: transcriptMessages, shells: [], confirmed: message, clientTurnId: id
      ).messages
    }, failed: { [weak self, weak auth] error in
      guard let self, let auth, let error = error as? ChatServiceError else { return }
      signOutIfUnauthorized(error, auth: auth)
    })
    return true
  }

  public func retryOutbound(clientTurnId: String) {
    outbox.retry(clientTurnId)
  }

  /// Drops the failed local shell only. Does not delete a Core row.
  public func removeOutbound(clientTurnId: String) {
    outbox.remove(clientTurnId)
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
    let instanceId = ablyClientInstanceId
    let service = service
    let provider: RealtimeTokenProvider = { slug in
      let token = try await service.fetchAblyToken(
        client: client,
        clientInstanceId: instanceId,
        organizationSlug: slug
      )
      return AblyTokenFields(token)
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
    case let .connectionHealth(healthy):
      connectionHealthy = healthy
      sidebarRecovery.setHealthy(healthy)
      applyPresenceReachability(healthy: healthy)
    case let .presenceRoster(organizationId, members):
      applyPresenceRoster(organizationId: organizationId, members: members)
    case let .envelope(envelope):
      applyRealtimeEnvelope(envelope)
    case let .notification(notification):
      applyRealtimeNotification(notification)
    case let .revoked(roomId):
      applyMembershipRevoked(roomId: roomId)
    case .ignored:
      break
    }
  }

  func applyRealtimeMessagePatch(_ patch: RealtimeMessagePatch) {
    thread.apply(patch)
    guard patch.roomId == transcriptRoomId else { return }
    transcriptMessages = applyRealtimePatch(patch, messages: transcriptMessages)
  }

  private func applyRealtimePin(roomId: String, messageId: String, isPinned: Bool, count: Int) {
    guard let index = rooms.firstIndex(where: { $0.id == roomId }) else { return }
    rooms[index].pinnedMessageCount = count
    timeline.applyPin(roomId: roomId, messageId: messageId, isPinned: isPinned)
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
    thread.recovery.setHealthy(healthy)
    transcriptRecovery.setHealthy(healthy)
    if continuityLost {
      threadAttentionRevision += 1
      thread.recovery.requestRefresh()
      transcriptRecovery.requestRefresh()
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
      sidebarRecovery.requestRefresh()
    }
    guard roomId == transcriptRoomId, message.roomId == transcriptRoomId, !directStream.isBusy || eventType == .delete else { return }
    let result = applyRealtimeFullEvent(
      messages: transcriptMessages,
      shells: outboundShells,
      eventType: eventType,
      message: message
    )
    transcriptMessages = result.messages
    outbox.reconcile(result.shells, confirmed: message)
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
    switch resolveRealtimeEnvelope(envelope, focusedRoomId: transcriptRoomId) {
    case .ignore:
      if refreshParent || (thread.parent != nil && envelope.roomId == transcriptRoomId && envelope.parentMessageId == thread.parent?.id) {
        transcriptRecovery.requestRefresh()
      }
      if envelope.eventType == .create {
        sidebarRecovery.requestRefresh()
      }
      return
    case let .tombstone(messageId):
      transcriptMessages = applyRealtimeTombstone(messages: transcriptMessages, messageId: messageId)
    case .needsRefetch:
      transcriptRecovery.requestRefresh()
    }
  }

  /// Re-read the latest history page and merge it (envelope refetch, ADR
  /// 0014): the same HTTP refresh as the live poll. No mark-read, never
  /// wipes resolved history on failure.
  public func refreshTranscript(auth: AuthState) {
    guard transcriptRoomId != nil else { return }
    guard !directStream.isBusy || thread.parent != nil else { return }
    if transcriptLoading || transcriptLoadingOlder || transcriptRefreshing || transcriptLoadTask != nil || olderPageTask != nil || transcriptRefreshTask != nil {
      return
    }
    let generation = transcriptGeneration
    transcriptRefreshTask = Task { _ = await refresh(auth: auth, generation: generation) }
  }

  @discardableResult
  func refresh(auth: AuthState, generation: Int) async -> Bool {
    defer {
      if generation == transcriptGeneration {
        transcriptRefreshTask = nil
      }
    }
    guard let client = resolveClient(auth: auth) else {
      if generation == transcriptGeneration {
        transcriptError = "Sign-in is not configured."
      }
      return false
    }
    do {
      let applied = try await timeline.loadPage(.latest, client: client, organizationSlug: selection?.workspace.organizationSlug, generation: generation)
      guard applied else { return false }
      if let parent = transcriptMessages.first(where: { $0.id == thread.parent?.id }) {
        thread.apply(eventType: .update, message: parent)
      }
      await syncReadAttention(auth: auth)
      return generation == transcriptGeneration && !Task.isCancelled
    } catch let error as ChatServiceError {
      guard generation == transcriptGeneration else { return false }
      transcriptError = transcriptFailureMessage(error, auth: auth)
      return false
    } catch {
      guard generation == transcriptGeneration else { return false }
      NSLog("Sokosumi transcript refresh failed: %@", String(describing: error))
      transcriptError = friendlyMessage(for: error)
      return false
    }
  }

  func settleDirectStream(auth: AuthState, generation: Int) async -> Bool {
    while generation == transcriptGeneration,
          let task = transcriptLoadTask ?? olderPageTask ?? transcriptRefreshTask {
      await task.value
    }
    guard generation == transcriptGeneration, !Task.isCancelled else { return false }
    guard await refresh(auth: auth, generation: generation) else { return false }
    var openedGeneration: Int?
    if let parent = streamingThreadToOpen {
      openThread(parent, auth: auth)
      openedGeneration = thread.timeline.generation
    }
    guard let parentId = directStream.parentMessageId, thread.parent?.id == parentId else {
      return true
    }
    await thread.loadTask?.value
    guard generation == transcriptGeneration else { return false }
    guard thread.parent?.id == parentId else { return true }
    // A thread opened after the room refresh already fetched the completed turn.
    if openedGeneration == thread.timeline.generation, thread.timeline.hasLoadedHistory, thread.timeline.errorMessage == nil {
      return true
    }
    loadThreadPage(thread.timeline.hasLoadedHistory ? .latest : .initial, auth: auth)
    await thread.loadTask?.value
    guard generation == transcriptGeneration else { return false }
    guard thread.parent?.id == parentId else { return true }
    return thread.timeline.errorMessage == nil
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

  private func clearOutbound() {
    outbox.reset()
  }

  private func makeOutboundShell(clientMessageId: String, roomId: String, content: String) -> OutboundShell {
    .init(
      clientTurnId: clientMessageId,
      roomId: roomId,
      content: content,
      sender: outboundSender
    )
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

  func loadTranscript(
    auth: AuthState,
    room _: Components.Schemas.ChatRoom,
    generation: Int
  ) async {
    defer {
      if generation == transcriptGeneration {
        transcriptLoadTask = nil
      }
    }
    guard let client = resolveClient(auth: auth) else {
      if generation == transcriptGeneration {
        timeline.failInitialLoad(message: "Sign-in is not configured.", generation: generation)
      }
      return
    }
    do {
      guard try await timeline.loadPage(.initial, client: client, organizationSlug: selection?.workspace.organizationSlug, generation: generation) else { return }
      await syncReadAttention(auth: auth)
    } catch let error as ChatServiceError {
      guard generation == transcriptGeneration else { return }
      transcriptError = transcriptFailureMessage(error, auth: auth)
    } catch {
      guard generation == transcriptGeneration else { return }
      NSLog("Sokosumi transcript load failed: %@", String(describing: error))
      transcriptError = friendlyMessage(for: error)
    }
  }

  public var readContent: RoomReadAttention.Content {
    .init(messages: transcriptMessages.map { .init(id: $0.id, content: $0.content) },
          parentMessageId: thread.parent?.id,
          replies: thread.timeline.messages.map { .init(id: $0.id, content: $0.content) })
  }

  var roomHistoryReadable: Bool {
    timeline.historicalAnchor == nil && timeline.hasLoadedHistory && timeline.failedPage != .initial && timeline.failedPage != .latest
  }

  public func syncReadAttention(auth: AuthState) async {
    guard let room = rooms.first(where: { $0.id == transcriptRoomId }), let client = resolveClient(auth: auth) else { return }
    do {
      try await readAttention.readIfNeeded(
        room: room,
        content: readContent,
        historyReadable: roomHistoryReadable && !thread.timeline.isLoading,
        client: client,
        organizationSlug: selection?.workspace.organizationSlug
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
      try await sidebar.perform(action, roomId: roomId, client: client, organizationSlug: selection?.workspace.organizationSlug)
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
      try await sidebar.reorderPinned(roomIds, client: client, organizationSlug: selection?.workspace.organizationSlug)
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
    guard transcriptRoomId != nil, transcriptHasMore,
          !directStream.isBusy,
          !transcriptLoading, !transcriptLoadingOlder, !transcriptRefreshing,
          olderPageTask == nil, transcriptRefreshTask == nil,
          transcriptCursor != nil
    else { return }
    let generation = transcriptGeneration
    olderPageTask = Task {
      await loadOlder(auth: auth, generation: generation)
    }
  }

  func loadOlder(auth: AuthState, generation: Int) async {
    defer {
      if generation == transcriptGeneration {
        olderPageTask = nil
      }
    }
    guard let client = resolveClient(auth: auth) else {
      if generation == transcriptGeneration {
        transcriptError = "Sign-in is not configured."
      }
      return
    }
    do {
      _ = try await timeline.loadPage(.older, client: client, organizationSlug: selection?.workspace.organizationSlug, generation: generation)
    } catch let error as ChatServiceError {
      guard generation == transcriptGeneration else { return }
      transcriptError = transcriptFailureMessage(error, auth: auth)
    } catch {
      guard generation == transcriptGeneration else { return }
      NSLog("Sokosumi older messages load failed: %@", String(describing: error))
      transcriptError = friendlyMessage(for: error)
    }
  }

  /// Maps a transcript failure to UI text. A 401 signs out (nil message —
  /// the auth card takes over); everything else becomes window-safe text.
  private func transcriptFailureMessage(_ error: ChatServiceError, auth: AuthState) -> String? {
    if signOutIfUnauthorized(error, auth: auth) {
      return nil
    }
    return friendlyMessage(for: error)
  }

  /// Signs out when Core rejects the session. Returns whether it did, so
  /// silent callers (attention sync) can keep the side effect explicit.
  @discardableResult
  func signOutIfUnauthorized(_ error: ChatServiceError, auth: AuthState) -> Bool {
    if case let .unauthorized(message) = error {
      auth.signOut(message: "Core rejected the session (\(message)). Sign in again.")
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
    updatingChannel = false
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
    updatingChannel = false
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

  private func startSidebarRecovery(auth: AuthState) {
    let generation = UUID()
    sidebarRecoveryGeneration = generation
    sidebarRecovery.start(foreground: readAttention.isVisible, healthy: connectionHealthy,
                          fallbackInterval: .seconds(15), refreshOnRecovery: true) { [weak self, weak auth] in
      guard let self, let auth else { return }
      await roomsRefreshTask?.value
      guard generation == sidebarRecoveryGeneration else { return }
      guard readAttention.isVisible else { sidebarRecovery.requestRefresh()
        return
      }
      await refreshRooms(auth: auth)
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
      auth.signOut(message: "Core rejected the session (\(message)). Sign in again.")
    }
  }
}
