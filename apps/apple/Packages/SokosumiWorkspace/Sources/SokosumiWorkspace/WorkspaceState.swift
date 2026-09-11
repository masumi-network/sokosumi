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
  public let thread = ThreadSession()
  public let directStream = DirectStreamSession()
  private var threadObservations: Set<AnyCancellable> = []
  private var workspaceGeneration = 0
  @Published public private(set) var openingDirect: DirectRecipient?
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

  public let timeline = RoomTimeline()
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
  private var realtime: (any RealtimeConnection)?
  private var realtimeStreamTask: Task<Void, Never>?
  private var realtimeContinuation: AsyncStream<ResolvedRealtimeDelivery>.Continuation?

  /// Confirmed history plus unresolved outbound shells (sticky at the end).
  public var displayedTranscript: [Components.Schemas.ChatRoomMessage] {
    directStream.displayedMessages(persisted: SokosumiChat.displayedTranscript(messages: transcriptMessages, shells: outboundShells))
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
    for publisher in [thread.objectWillChange, thread.timeline.objectWillChange, thread.outbox.objectWillChange, directStream.objectWillChange] {
      publisher.sink { [weak self] in self?.objectWillChange.send() }.store(in: &threadObservations)
    }
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
    openingDirect = nil
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

  public func canOpenDirect(_ recipient: DirectRecipient) -> Bool {
    guard phase == .ready, let room = rooms.first(where: { $0.id == transcriptRoomId }) else { return false }
    return recipient.canOpen(from: room, currentUserId: currentUserId, hasActiveOrganization: selection?.workspace.organizationId != nil)
  }

  @discardableResult
  public func openParticipantDirect(_ recipient: DirectRecipient, auth: AuthState) async throws -> Bool {
    guard openingDirect == nil, canOpenDirect(recipient), let client = resolveClient(auth: auth) else { return false }
    let generation = workspaceGeneration
    let selectionID = selectionId
    let sourceRoom = transcriptRoomId
    openingDirect = recipient
    defer {
      if generation == workspaceGeneration {
        openingDirect = nil
      }
    }
    do {
      let room = try await ChatService().openDirect(client: client, recipient: recipient, organizationSlug: selection?.workspace.organizationSlug)
      guard !Task.isCancelled, generation == workspaceGeneration, selectionID == selectionId, phase == .ready else { return false }
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
      return true
    } catch {
      guard generation == workspaceGeneration, selectionID == selectionId else { return false }
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
    directStream.reset()
    thread.close()
    transcriptRealtimeHealthy = false
    transcriptRecovery.stop()
    readAttention.roomChanged()
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
    directStream.reset(room: room, userId: currentUserId, organizationId: selection?.workspace.organizationId)
    thread.close()
    transcriptRealtimeHealthy = transcriptRoomId == room.id && transcriptRealtimeHealthy
    readAttention.roomChanged()
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
  public func sendMessage(_ content: String, auth: AuthState) -> Bool {
    let draft = ComposerContent(content)
    guard let roomId = transcriptRoomId, draft.canSend, !transcriptLoading,
          let client = resolveClient(auth: auth) else { return false }
    if directStream.roomId == roomId {
      let generation = transcriptGeneration
      return directStream.send(draft.text, client: client, organizationSlug: selection?.workspace.organizationSlug, settled: { [weak self, weak auth] in
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
    let shell = makeOutboundShell(clientMessageId: id, roomId: roomId, content: draft.text)
    outbox.enqueue(shell, send: { [service] in
      try await service.createMessage(
        client: client, roomId: roomId, content: draft.text,
        clientMessageId: id, mentions: mentions, organizationSlug: slug
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
  }

  /// Closes the socket and drops the event stream. Sign-out and teardown go
  /// through here; room changes only detach via `watchRoom`.
  private func stopRealtime() {
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
      thread.apply(patch)
      guard patch.roomId == transcriptRoomId else { return }
      transcriptMessages = applyRealtimePatch(patch, messages: transcriptMessages)
    case let .pin(roomId, messageId, isPinned, count):
      applyRealtimePin(roomId: roomId, messageId: messageId, isPinned: isPinned, count: count)
    case let .roomHealth(roomId, healthy, continuityLost):
      applyRealtimeHealth(roomId: roomId, healthy: healthy, continuityLost: continuityLost)
    case let .connectionHealth(healthy):
      connectionHealthy = healthy
      sidebarRecovery.setHealthy(healthy)
    case let .envelope(envelope):
      applyRealtimeEnvelope(envelope)
    case let .revoked(roomId):
      applyMembershipRevoked(roomId: roomId)
    case .ignored:
      break
    }
  }

  private func applyRealtimePin(roomId: String, messageId: String, isPinned: Bool, count: Int) {
    guard let index = rooms.firstIndex(where: { $0.id == roomId }) else { return }
    rooms[index].pinnedMessageCount = count
    timeline.applyPin(roomId: roomId, messageId: messageId, isPinned: isPinned)
  }

  private func applyRealtimeHealth(roomId: String, healthy: Bool, continuityLost: Bool) {
    guard roomId == transcriptRoomId else { return }
    transcriptRealtimeHealthy = healthy
    thread.recovery.setHealthy(healthy)
    transcriptRecovery.setHealthy(healthy)
    if continuityLost {
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
    timeline.hasLoadedHistory && timeline.failedPage != .initial && timeline.failedPage != .latest
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

  public func markRoomUnread(_ room: Components.Schemas.ChatRoom, auth: AuthState) async {
    guard let client = resolveClient(auth: auth) else { return }
    do {
      try await readAttention.markUnread(room: room, activeRoomId: selectedRoomId, client: client, organizationSlug: selection?.workspace.organizationSlug)
    } catch {
      if let error = error as? ChatServiceError, signOutIfUnauthorized(error, auth: auth) {
        // The auth card takes over; the modal alert would double-surface.
        readAttention.clearError()
      }
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
    openingDirect = nil
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
      readAttention.reset()
      clearTranscript()
      selectedRoomId = nil
      rooms = loaded
      switchError = nil
      realtime?.setOrganizationSlug(option.workspace.organizationSlug)
      realtime?.setMembershipRooms(Set(rooms.map(\.id)))
      startRealtimeIfNeeded(auth: auth)
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
