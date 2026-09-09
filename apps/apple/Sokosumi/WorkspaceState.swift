import Combine
import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat
import SokosumiRealtime

/// Thin UI state for the workspace + rooms sidebar (SOK-973), the room
/// transcript (SOK-974), classic send (SOK-975), and live Ably updates
/// (SOK-976).
///
/// Behavior lives in `SokosumiChat.ChatService` (UI-free, tested); this
/// object only holds the current selection/rooms/transcript for SwiftUI and
/// forwards failures: 401 signs out via `AuthState`, other gates surface as
/// text. The realtime subscription itself (ably-cocoa) forwards full DTOs,
/// id envelopes, and revoke events into the `applyRealtime*` methods below.
@MainActor
final class WorkspaceState: ObservableObject {
  typealias WorkspaceOption = WorkspaceSession.Option
  typealias Phase = WorkspaceSession.Phase
  private let workspaceSession = WorkspaceSession()
  private var workspaceObservation: AnyCancellable?
  private var workspaceGeneration = 0
  var phase: Phase {
    workspaceSession.phase
  }

  var options: [WorkspaceOption] {
    workspaceSession.options
  }

  var selectionId: String? {
    workspaceSession.selectionId
  }

  let sidebar: ConversationSidebar
  private var sidebarObservation: AnyCancellable?
  var rooms: [Components.Schemas.ChatRoom] {
    get { sidebar.rooms }
    set { sidebar.rooms = newValue }
  }

  var roomsLoading: Bool {
    get { sidebar.isLoading }
    set { sidebar.isLoading = newValue }
  }

  /// Selected room. Launch and workspace switches restore the saved room,
  /// else the first room. Revoking the open room can leave this nil while
  /// others remain: the saved pick is left alone so relaunch does not
  /// reopen a room that is gone.
  var selectedRoomId: String? {
    get { sidebar.selectedRoomId }
    set { sidebar.selectedRoomId = newValue }
  }

  /// Switch/list failure while already `.ready`. Nil means the sidebar is fine.
  @Published private(set) var switchError: String?
  var currentUserId: String {
    workspaceSession.currentUser?.id ?? ""
  }

  var currentUserName: String {
    workspaceSession.currentUser?.name ?? ""
  }

  var currentUserEmail: String {
    workspaceSession.currentUser?.email ?? ""
  }

  var currentUserImageURL: String? {
    workspaceSession.currentUser?.image
  }

  let timeline = RoomTimeline()
  private var timelineObservation: AnyCancellable?

  /// Room the transcript pane shows. Nil clears the pane.
  var transcriptRoomId: String? {
    get { timeline.roomId }
    set { timeline.roomId = newValue }
  }

  var transcriptMessages: [Components.Schemas.ChatRoomMessage] {
    get { timeline.messages }
    set { timeline.messages = newValue }
  }

  var transcriptHasMore: Bool {
    get { timeline.hasMore }
    set { timeline.hasMore = newValue }
  }

  var transcriptLoading: Bool {
    get { timeline.isLoading }
    set { timeline.isLoading = newValue }
  }

  var transcriptLoadingOlder: Bool {
    get { timeline.isLoadingOlder }
    set { timeline.isLoadingOlder = newValue }
  }

  /// Latest-page refetch in flight (ADR 0014 envelope). Not the older-page
  /// spinner: live refetch must not flash `transcriptLoadingOlder`.
  var transcriptRefreshing: Bool {
    get { timeline.isRefreshing }
    set { timeline.isRefreshing = newValue }
  }

  /// Failure text. Shown full-pane when there is no history, as a banner
  /// above loaded history otherwise — a failed older page never wipes
  /// what already resolved.
  var transcriptError: String? {
    get { timeline.errorMessage }
    set { timeline.errorMessage = newValue }
  }

  /// Unconfirmed classic sends for the open room. Remount / room change
  /// drops them (no durable outbox).
  @Published private(set) var outboundShells: [OutboundShell] = []
  /// True while a classic POST is in flight for this composer.
  @Published private(set) var outboundInFlight = false
  /// Last minted Ably token. Nil until the first mint; membership changes
  /// remint once a token exists or the socket is live, so idle windows
  /// never pay for one.
  @Published private(set) var ablyToken: Components.Schemas.AblyTokenRequest?
  /// Factory for the live socket. Set by the app at launch (ably-cocoa);
  /// nil in tests unless a fake is installed. Without one the transcript
  /// stays HTTP-only and every realtime call below no-ops.
  var realtimeConnectionFactory: (@Sendable () -> (any RealtimeConnection))?
  private var realtime: (any RealtimeConnection)?
  private weak var realtimeAuth: AuthState?
  private var realtimeStreamTask: Task<Void, Never>?
  private var realtimeContinuation: AsyncStream<ResolvedRealtimeDelivery>.Continuation?

  /// Confirmed history plus unresolved outbound shells (sticky at the end).
  var displayedTranscript: [Components.Schemas.ChatRoomMessage] {
    SokosumiChat.displayedTranscript(messages: transcriptMessages, shells: outboundShells)
  }

  var transcriptCursor: String? {
    get { timeline.cursor }
    set { timeline.cursor = newValue }
  }

  /// Bumps on every open/clear so a slow room cannot paint over a newer one.
  private var transcriptGeneration: Int {
    timeline.generation
  }

  /// Envelope arrived while history, older-page, or a refetch was in flight.
  private var pendingTranscriptRefresh = false
  private var outboundFlight = ClassicOutboundFlight()

  private let service = ChatService()
  private var hasLoaded = false
  private var workspaceLoadTask: Task<Void, Never>?

  /// Stable per-install Ably `clientInstanceId` (ADR 0003): persisted on
  /// first launch, reused after, so this Mac is one `{userId}:{instanceId}`
  /// device in every token it mints.
  let ablyClientInstanceId: String

  init(
    savedRoom: SavedRoomSelection = SavedRoomSelection(),
    instanceStore: AblyClientInstanceIdStore = UserDefaultsAblyClientInstanceIdStore()
  ) {
    sidebar = ConversationSidebar(savedRoom: savedRoom)
    ablyClientInstanceId = getOrCreateAblyClientInstanceId(store: instanceStore)
    timelineObservation = timeline.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    sidebarObservation = sidebar.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
    workspaceObservation = workspaceSession.objectWillChange.sink { [weak self] in
      self?.objectWillChange.send()
    }
  }

  /// Test seam: when set, replaces `auth.coreClient()` as the client source.
  var clientResolver: (() -> Client?)?
  /// Test seam: when set, replaces `auth.oauthSession` as the Ably token
  /// source for the live socket.
  var realtimeSessionOverride: OAuthSession?

  private func resolveClient(auth: AuthState) -> Client? {
    clientResolver?() ?? auth.coreClient()
  }

  var selection: WorkspaceOption? {
    options.first { $0.id == selectionId }
  }

  func startIfNeeded(auth: AuthState) {
    guard !hasLoaded else { return }
    hasLoaded = true
    workspaceLoadTask?.cancel()
    workspaceLoadTask = Task { await reload(auth: auth) }
  }

  func retry(auth: AuthState) {
    workspaceLoadTask?.cancel()
    workspaceLoadTask = Task { await reload(auth: auth) }
  }

  /// Drop everything after sign-out so the next sign-in reloads from Core.
  /// The install instance id survives: this Mac stays one Ably device.
  func reset() {
    hasLoaded = false
    workspaceLoadTask?.cancel()
    workspaceLoadTask = nil
    workspaceGeneration += 1
    workspaceSession.reset()
    sidebar.reset()
    rooms = []
    roomsLoading = false
    ablyToken = nil
    switchError = nil
    selectedRoomId = nil
    stopRealtime()
    clearTranscript()
  }

  /// User picked a room in the sidebar: persist it and open its transcript.
  /// Nil is ignored — `List` emits it when collapsed rows leave the
  /// hierarchy, and this app keeps a room selected whenever one is listed.
  func selectRoom(_ id: String?, auth: AuthState) {
    guard let id, id != selectedRoomId else { return }
    applyRoomSelection(id, auth: auth)
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
    timeline.reset()
    realtime?.watchRoom(nil)
    pendingTranscriptRefresh = false
    transcriptError = nil
    clearOutbound()
  }

  /// Open a room's transcript: history first, mark-read after it resolves
  /// (ADR 0026). The sidebar entry is replaced with the POST-read DTO so
  /// unread chrome matches Core. A failed read keeps the resolved history
  /// on screen and leaves unread chrome unchanged.
  func openRoom(_ room: Components.Schemas.ChatRoom, auth: AuthState) {
    timeline.reset(roomId: room.id)
    let generation = transcriptGeneration
    pendingTranscriptRefresh = false
    clearOutbound()
    realtime?.watchRoom(room.id)
    Task { await loadTranscript(auth: auth, room: room, generation: generation) }
  }

  /// Paint a pending shell immediately, then POST. No-op while a send is
  /// already in flight or the composer has nothing to send.
  func sendMessage(_ content: String, auth: AuthState) {
    let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let roomId = transcriptRoomId, !trimmed.isEmpty, !transcriptLoading else { return }
    let clientMessageId = UUID().uuidString
    guard outboundFlight.begin(clientMessageId) else { return }
    outboundInFlight = true
    outboundShells.append(makeOutboundShell(clientMessageId: clientMessageId, roomId: roomId, content: trimmed))
    Task { await postOutbound(auth: auth, roomId: roomId, content: trimmed, clientMessageId: clientMessageId) }
  }

  /// Reuses the same client turn id. No-op unless that shell is failed and
  /// the composer slot is free.
  func retryOutbound(clientTurnId: String, auth: AuthState) {
    guard let shell = outboundShells.first(where: { $0.clientTurnId == clientTurnId }),
          shell.status == .failed,
          let roomId = transcriptRoomId
    else { return }
    guard outboundFlight.begin(clientTurnId) else { return }
    outboundInFlight = true
    outboundShells = markOutboundPending(shells: outboundShells, clientTurnId: clientTurnId)
    Task { await postOutbound(auth: auth, roomId: roomId, content: shell.content, clientMessageId: clientTurnId) }
  }

  /// Drops the local shell only. Does not delete a Core row.
  func removeOutbound(clientTurnId: String) {
    outboundShells = SokosumiChat.removeOutbound(shells: outboundShells, clientTurnId: clientTurnId)
  }

  // MARK: - Live realtime (SOK-976)

  /// Opens the socket once rooms are ready. Returns whether this call
  /// connected: callers skip their remint then, because the connect-time
  /// auth already minted. No factory (tests, HTTP-only mode) means no live.
  @discardableResult
  private func startRealtimeIfNeeded(auth: AuthState) -> Bool {
    guard realtime == nil,
          let factory = realtimeConnectionFactory,
          let session = realtimeSessionOverride ?? auth.oauthSession,
          !currentUserId.isEmpty
    else {
      return false
    }
    realtimeAuth = auth
    let instanceId = ablyClientInstanceId
    let baseURL = CoreSettings.baseURL
    // Sendable by construction: the session actor plus values only, never
    // MainActor state. The slug rides as a parameter because switches
    // retarget it after connect.
    let provider: RealtimeTokenProvider = { slug in
      let client = Client.connecting(
        to: baseURL,
        middlewares: [
          BearerAuthMiddleware(session: session),
          ExplicitNullPreferredOrganizationMiddleware()
        ]
      )
      let token = try await ChatService().fetchAblyToken(
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
    realtimeStreamTask?.cancel()
    realtimeStreamTask = Task {
      for await event in stream {
        handleRealtimeEvent(event)
      }
    }
    return true
  }

  /// Closes the socket and drops the event stream. Sign-out and teardown go
  /// through here; room changes only detach via `watchRoom`.
  private func stopRealtime() {
    realtimeContinuation?.finish()
    realtimeContinuation = nil
    realtimeStreamTask?.cancel()
    realtimeStreamTask = nil
    realtime?.disconnect()
    realtime = nil
    realtimeAuth = nil
  }

  private func handleRealtimeEvent(_ event: ResolvedRealtimeDelivery) {
    switch event {
    case let .message(roomId, eventType, message):
      applyRealtimeMessage(roomId: roomId, eventType: eventType, message: message)
    case let .envelope(envelope):
      guard let auth = realtimeAuth else { return }
      applyRealtimeEnvelope(envelope, auth: auth)
    case let .revoked(roomId):
      guard let auth = realtimeAuth else { return }
      applyMembershipRevoked(roomId: roomId, auth: auth)
    case .ignored:
      break
    }
  }

  /// Mint (or remint) the Ably token for the current workspace. The socket
  /// auth callback mints through its own provider; this path serves explicit
  /// refresh and membership changes, then pushes the new caps into the live
  /// socket. A 401 signs out; any other failure keeps the previous token so
  /// a transient mint never drops a live subscription.
  func refreshAblyToken(auth: AuthState) async {
    guard let client = resolveClient(auth: auth) else { return }
    let generation = workspaceGeneration
    let slug = selection?.workspace.organizationSlug
    do {
      let token = try await service.fetchAblyToken(
        client: client,
        clientInstanceId: ablyClientInstanceId,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard generation == workspaceGeneration, slug == selection?.workspace.organizationSlug else { return }
      ablyToken = token
      realtime?.reauthorize(token: AblyTokenFields(token))
    } catch let error as ChatServiceError {
      guard generation == workspaceGeneration, slug == selection?.workspace.organizationSlug else { return }
      if case let .unauthorized(message) = error {
        auth.signOut(message: "Core rejected the session (\(message)). Sign in again.")
      } else {
        NSLog("Sokosumi Ably token mint failed: %@", String(describing: error))
      }
    } catch {
      NSLog("Sokosumi Ably token mint failed: %@", String(describing: error))
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
    guard roomId == transcriptRoomId, message.roomId == transcriptRoomId else { return }
    let result = applyRealtimeFullEvent(
      messages: transcriptMessages,
      shells: outboundShells,
      eventType: eventType,
      message: message
    )
    transcriptMessages = result.messages
    outboundShells = result.shells
  }

  /// Apply an id envelope (ADR 0014): delete tombstones the on-screen row,
  /// create/update refetch history for the focused room, everything else is
  /// ignored. The refetch merges — it never invents a row.
  func applyRealtimeEnvelope(_ envelope: ChatRoomMessageIdEnvelope, auth: AuthState) {
    switch resolveRealtimeEnvelope(envelope, focusedRoomId: transcriptRoomId) {
    case .ignore:
      return
    case let .tombstone(messageId):
      transcriptMessages = applyRealtimeTombstone(messages: transcriptMessages, messageId: messageId)
    case .needsRefetch:
      refreshTranscript(auth: auth)
    }
  }

  /// Re-read the latest history page and merge it (envelope refetch, ADR
  /// 0014): the same HTTP refresh as the live poll. No mark-read, never
  /// wipes resolved history on failure.
  func refreshTranscript(auth: AuthState) {
    guard transcriptRoomId != nil else { return }
    if transcriptLoading || transcriptLoadingOlder || transcriptRefreshing {
      pendingTranscriptRefresh = true
      return
    }
    transcriptRefreshing = true
    let generation = transcriptGeneration
    Task { await refresh(auth: auth, generation: generation) }
  }

  private func drainPendingTranscriptRefresh(auth: AuthState) {
    guard pendingTranscriptRefresh else { return }
    pendingTranscriptRefresh = false
    refreshTranscript(auth: auth)
  }

  func refresh(auth: AuthState, generation: Int) async {
    defer {
      if generation == transcriptGeneration {
        transcriptRefreshing = false
        drainPendingTranscriptRefresh(auth: auth)
      }
    }
    guard let client = resolveClient(auth: auth) else {
      if generation == transcriptGeneration {
        transcriptError = "Sign-in is not configured."
      }
      return
    }
    do {
      _ = try await timeline.loadPage(.latest, client: client, organizationSlug: selection?.workspace.organizationSlug, generation: generation)
    } catch let error as ChatServiceError {
      guard generation == transcriptGeneration else { return }
      transcriptError = transcriptFailureMessage(error, auth: auth)
    } catch {
      guard generation == transcriptGeneration else { return }
      NSLog("Sokosumi transcript refresh failed: %@", String(describing: error))
      transcriptError = friendlyMessage(for: error)
    }
  }

  /// Drop a revoked room from the sidebar (chat-control event, SOK-742).
  /// When the open room is revoked its transcript clears — posting there is
  /// over — and the saved pick is left alone so relaunch does not reopen a
  /// room that is gone. Remints the token when one exists so caps drop.
  func applyMembershipRevoked(roomId revokedRoomId: String, auth: AuthState) {
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
    if realtime != nil || ablyToken != nil {
      Task { await refreshAblyToken(auth: auth) }
    }
  }

  private func clearOutbound() {
    outboundFlight.clear()
    outboundInFlight = false
    outboundShells = []
  }

  private func makeOutboundShell(clientMessageId: String, roomId: String, content: String) -> OutboundShell {
    .init(
      clientTurnId: clientMessageId,
      roomId: roomId,
      content: content,
      sender: .init(
        id: currentUserId,
        name: currentUserName.isEmpty ? currentUserEmail : currentUserName,
        email: currentUserEmail,
        image: currentUserImageURL,
        presence: .online
      )
    )
  }

  private func postOutbound(
    auth: AuthState,
    roomId: String,
    content: String,
    clientMessageId: String
  ) async {
    // Flight and leftover shells are not the history-load generation: a
    // failed workspace switch bumps generation but keeps this room.
    defer {
      outboundFlight.end(clientMessageId)
      outboundInFlight = outboundFlight.isInFlight
    }
    guard let client = resolveClient(auth: auth) else {
      failPresentOutbound(clientMessageId, "Sign-in is not configured.")
      return
    }
    let generation = transcriptGeneration
    do {
      let confirmed = try await service.createMessage(
        client: client,
        roomId: roomId,
        content: content,
        clientMessageId: clientMessageId,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard outboundShells.contains(where: { $0.clientTurnId == clientMessageId }) else { return }
      let result = confirmOutbound(
        messages: transcriptMessages,
        shells: outboundShells,
        confirmed: confirmed,
        clientTurnId: clientMessageId
      )
      transcriptMessages = result.messages
      outboundShells = result.shells
    } catch let error as ChatServiceError {
      guard generation == transcriptGeneration else { return }
      failPresentOutbound(clientMessageId, transcriptFailureMessage(error, auth: auth))
    } catch {
      NSLog("Sokosumi send failed: %@", String(describing: error))
      failPresentOutbound(clientMessageId, friendlyMessage(for: error))
    }
  }

  /// Confirm/fail only when the shell is still here. Cleared shells mean
  /// the surface was torn down; leftover shells are still this room.
  private func failPresentOutbound(_ clientMessageId: String, _ errorMessage: String?) {
    guard outboundShells.contains(where: { $0.clientTurnId == clientMessageId }) else { return }
    outboundShells = failOutbound(
      shells: outboundShells,
      clientTurnId: clientMessageId,
      errorMessage: errorMessage
    )
  }

  func loadTranscript(
    auth: AuthState,
    room: Components.Schemas.ChatRoom,
    generation: Int
  ) async {
    defer {
      if generation == transcriptGeneration {
        transcriptLoading = false
        drainPendingTranscriptRefresh(auth: auth)
      }
    }
    guard let client = resolveClient(auth: auth) else {
      if generation == transcriptGeneration {
        transcriptError = "Sign-in is not configured."
      }
      return
    }
    do {
      guard try await timeline.loadPage(.initial, client: client, organizationSlug: selection?.workspace.organizationSlug, generation: generation) else { return }
      // The read is only for the room still selected now: a stale open must
      // not mark the previous room read after the user moved on.
      let updated = try await service.markRoomRead(
        client: client,
        roomId: room.id,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard generation == transcriptGeneration else { return }
      if let index = rooms.firstIndex(where: { $0.id == updated.id }) {
        rooms[index] = updated
      }
    } catch let error as ChatServiceError {
      guard generation == transcriptGeneration else { return }
      transcriptError = transcriptFailureMessage(error, auth: auth)
    } catch {
      guard generation == transcriptGeneration else { return }
      NSLog("Sokosumi transcript load failed: %@", String(describing: error))
      transcriptError = friendlyMessage(for: error)
    }
  }

  /// Older history page for scroll-up. Prepends; never marks read and never
  /// clears resolved history on failure.
  func loadOlderMessages(auth: AuthState) {
    guard transcriptRoomId != nil, transcriptHasMore,
          !transcriptLoading, !transcriptLoadingOlder,
          transcriptCursor != nil
    else { return }
    transcriptLoadingOlder = true
    let generation = transcriptGeneration
    Task {
      await loadOlder(auth: auth, generation: generation)
    }
  }

  func loadOlder(auth: AuthState, generation: Int) async {
    defer {
      if generation == transcriptGeneration {
        transcriptLoadingOlder = false
        drainPendingTranscriptRefresh(auth: auth)
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
    if case let .unauthorized(message) = error {
      auth.signOut(message: "Core rejected the session (\(message)). Sign in again.")
      return nil
    }
    return friendlyMessage(for: error)
  }

  func select(_ option: WorkspaceOption, auth: AuthState) {
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
      _ = startRealtimeIfNeeded(auth: auth)
      ensureRoomSelection(auth: auth)
    } catch {
      guard generation == workspaceGeneration else { return }
      handleWorkspaceError(error, auth: auth)
    }
  }

  func switchRooms(auth: AuthState, option: WorkspaceOption) async {
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
      clearTranscript()
      selectedRoomId = nil
      rooms = loaded
      switchError = nil
      realtime?.setOrganizationSlug(option.workspace.organizationSlug)
      let justConnected = startRealtimeIfNeeded(auth: auth)
      if !justConnected, realtime != nil || ablyToken != nil {
        await refreshAblyToken(auth: auth)
      }
      guard generation == workspaceGeneration else { return }
      ensureRoomSelection(auth: auth)
    } catch {
      guard generation == workspaceGeneration else { return }
      switchError = workspaceSession.errorMessage
      handleWorkspaceError(error, auth: auth)
    }
  }

  func refreshRooms(auth: AuthState) async {
    guard phase == .ready, !roomsLoading, let client = resolveClient(auth: auth) else { return }
    do {
      guard try await sidebar.refresh(client: client, organizationSlug: selection?.workspace.organizationSlug) else { return }
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
