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
  struct WorkspaceOption: Identifiable, Hashable {
    var id: String
    var title: String
    /// Single source for the org header + preference PUT: personal omits
    /// the header and PUTs null, an organization sends both. Constructed
    /// whole, so a half-filled option (id without slug) is unrepresentable.
    var workspace: WorkspaceSelection
  }

  enum Phase: Equatable {
    case idle
    case loading
    case blocked(gate: Components.Schemas.WorkspaceGateStatus)
    case ready
    case failed(message: String)
  }

  @Published private(set) var phase: Phase = .idle
  @Published private(set) var options: [WorkspaceOption] = []
  @Published private(set) var selectionId: String?
  @Published private(set) var rooms: [Components.Schemas.ChatRoom] = []
  @Published private(set) var roomsLoading = false
  /// Selected room. Never left empty while rooms exist: launch and workspace
  /// switches restore the saved room, else the first room.
  @Published private(set) var selectedRoomId: String?
  /// Switch/list failure while already `.ready`. Nil means the sidebar is fine.
  @Published private(set) var switchError: String?
  @Published private(set) var currentUserId = ""
  @Published private(set) var currentUserName = ""
  @Published private(set) var currentUserEmail = ""
  @Published private(set) var currentUserImageURL: String?
  /// Room the transcript pane shows. Nil clears the pane.
  @Published private(set) var transcriptRoomId: String?
  @Published private(set) var transcriptMessages: [Components.Schemas.ChatRoomMessage] = []
  @Published private(set) var transcriptHasMore = false
  @Published private(set) var transcriptLoading = false
  @Published private(set) var transcriptLoadingOlder = false
  /// Latest-page refetch in flight (ADR 0014 envelope). Not the older-page
  /// spinner: live refetch must not flash `transcriptLoadingOlder`.
  private(set) var transcriptRefreshing = false
  /// Failure text. Shown full-pane when there is no history, as a banner
  /// above loaded history otherwise — a failed older page never wipes
  /// what already resolved.
  @Published private(set) var transcriptError: String?
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

  private var transcriptCursor: String?
  /// Bumps on every open/clear so a slow room cannot paint over a newer one.
  private var transcriptGeneration = 0
  /// Envelope arrived while history, older-page, or a refetch was in flight.
  private var pendingTranscriptRefresh = false
  private var outboundFlight = ClassicOutboundFlight()

  private let service = ChatService()
  private let savedSelection: SavedWorkspaceSelection
  private let savedRoom: SavedRoomSelection
  private var hasLoaded = false

  /// Stable per-install Ably `clientInstanceId` (ADR 0003): persisted on
  /// first launch, reused after, so this Mac is one `{userId}:{instanceId}`
  /// device in every token it mints.
  let ablyClientInstanceId: String

  init(
    savedSelection: SavedWorkspaceSelection = SavedWorkspaceSelection(),
    savedRoom: SavedRoomSelection = SavedRoomSelection(),
    instanceStore: AblyClientInstanceIdStore = UserDefaultsAblyClientInstanceIdStore()
  ) {
    self.savedSelection = savedSelection
    self.savedRoom = savedRoom
    ablyClientInstanceId = getOrCreateAblyClientInstanceId(store: instanceStore)
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
    Task { await reload(auth: auth) }
  }

  func retry(auth: AuthState) {
    Task { await reload(auth: auth) }
  }

  /// Drop everything after sign-out so the next sign-in reloads from Core.
  /// The install instance id survives: this Mac stays one Ably device.
  func reset() {
    hasLoaded = false
    phase = .idle
    options = []
    selectionId = nil
    rooms = []
    roomsLoading = false
    ablyToken = nil
    switchError = nil
    currentUserId = ""
    currentUserName = ""
    currentUserEmail = ""
    currentUserImageURL = nil
    selectedRoomId = nil
    stopRealtime()
    clearTranscript()
    savedSelection.clear()
    savedRoom.clear()
  }

  /// User picked a room in the sidebar: persist it and open its transcript.
  /// A nil id only clears the pane; the saved pick survives for relaunch.
  func selectRoom(_ id: String?, auth: AuthState) {
    guard id != selectedRoomId else { return }
    applyRoomSelection(id, auth: auth)
  }

  private func applyRoomSelection(_ id: String?, auth: AuthState) {
    selectedRoomId = id
    guard let id, let room = rooms.first(where: { $0.id == id }) else {
      clearTranscript()
      return
    }
    savedRoom.save(id)
    openRoom(room, auth: auth)
  }

  /// Keep a room selected whenever rooms exist: the saved room when it is
  /// still listed, else the first room. Runs after every rooms load.
  private func ensureRoomSelection(auth: AuthState) {
    let current = selectedRoomId.flatMap { id in rooms.contains(where: { $0.id == id }) ? id : nil }
    let saved = savedRoom.load().flatMap { id in rooms.contains(where: { $0.id == id }) ? id : nil }
    applyRoomSelection(current ?? saved ?? rooms.first?.id, auth: auth)
  }

  /// Forget the transcript without touching rooms or selection.
  func clearTranscript() {
    transcriptGeneration += 1
    realtime?.watchRoom(nil)
    transcriptRoomId = nil
    transcriptMessages = []
    transcriptCursor = nil
    transcriptHasMore = false
    transcriptLoading = false
    transcriptLoadingOlder = false
    transcriptRefreshing = false
    pendingTranscriptRefresh = false
    transcriptError = nil
    clearOutbound()
  }

  /// Open a room's transcript: history first, mark-read after it resolves
  /// (ADR 0026). The sidebar entry is replaced with the POST-read DTO so
  /// unread chrome matches Core. A failed read keeps the resolved history
  /// on screen and leaves unread chrome unchanged.
  func openRoom(_ room: Components.Schemas.ChatRoom, auth: AuthState) {
    transcriptGeneration += 1
    let generation = transcriptGeneration
    transcriptRoomId = room.id
    transcriptMessages = []
    transcriptCursor = nil
    transcriptHasMore = false
    transcriptError = nil
    transcriptLoading = true
    transcriptRefreshing = false
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
    // Sendable by construction: the session actor plus values only, never
    // MainActor state. The slug rides as a parameter because switches
    // retarget it after connect.
    let provider: RealtimeTokenProvider = { slug in
      let client = Client.connecting(
        to: CoreSettings.baseURL,
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
    do {
      ablyToken = try await service.fetchAblyToken(
        client: client,
        clientInstanceId: ablyClientInstanceId,
        organizationSlug: selection?.workspace.organizationSlug
      )
      realtime?.reauthorize()
    } catch let error as ChatServiceError {
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
    guard let roomId = transcriptRoomId else { return }
    if transcriptLoading || transcriptLoadingOlder || transcriptRefreshing {
      pendingTranscriptRefresh = true
      return
    }
    transcriptRefreshing = true
    let generation = transcriptGeneration
    Task { await refresh(auth: auth, roomId: roomId, generation: generation) }
  }

  private func drainPendingTranscriptRefresh(auth: AuthState) {
    guard pendingTranscriptRefresh else { return }
    pendingTranscriptRefresh = false
    refreshTranscript(auth: auth)
  }

  func refresh(auth: AuthState, roomId: String, generation: Int) async {
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
      let page = try await service.listMessages(
        client: client,
        roomId: roomId,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard generation == transcriptGeneration, roomId == transcriptRoomId else { return }
      transcriptMessages = mergeRealtimePage(messages: transcriptMessages, page: page.messages)
      transcriptError = nil
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
      let page = try await service.listMessages(
        client: client,
        roomId: room.id,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard generation == transcriptGeneration else { return }
      // History resolved: paint it before the read so a failed read keeps
      // the transcript on screen instead of discarding it. Merge, not
      // assign: a live row that arrived while history was in flight survives
      // (the page wins by id). The pane was cleared on open, so only
      // in-flight live rows can be missing from the page.
      transcriptMessages = mergeRealtimePage(messages: transcriptMessages, page: page.messages)
      transcriptCursor = page.nextCursor
      transcriptHasMore = page.nextCursor != nil
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
    guard let roomId = transcriptRoomId, transcriptHasMore,
          !transcriptLoading, !transcriptLoadingOlder,
          let cursor = transcriptCursor
    else { return }
    transcriptLoadingOlder = true
    let generation = transcriptGeneration
    Task {
      await loadOlder(auth: auth, roomId: roomId, cursor: cursor, generation: generation)
    }
  }

  func loadOlder(auth: AuthState, roomId: String, cursor: String, generation: Int) async {
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
      let page = try await service.listMessages(
        client: client,
        roomId: roomId,
        cursor: cursor,
        organizationSlug: selection?.workspace.organizationSlug
      )
      guard generation == transcriptGeneration else { return }
      transcriptMessages = page.messages + transcriptMessages
      transcriptCursor = page.nextCursor
      transcriptHasMore = page.nextCursor != nil
      transcriptError = nil
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
    switch error {
    case let .unauthorized(message):
      auth.signOut(message: "Core rejected the session (\(message)). Sign in again.")
      return nil
    case let .unprocessable(statusCode, message):
      return "Core rejected the request (\(statusCode)): \(message)"
    case .blocked, .unexpectedResponse:
      return "Couldn't complete the request. Try again."
    }
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
    phase = .loading
    rooms = []
    switchError = nil
    selectedRoomId = nil
    clearTranscript()
    guard let client = resolveClient(auth: auth) else {
      phase = .failed(message: "Sign-in is not configured.")
      return
    }
    do {
      // Read-only launch: never PUT here. Re-asserting a default preference
      // on every launch yanks cross-client state and turns a flaky upload
      // into a dead window — writes happen on explicit switches only.
      let initial = try await service.loadInitialState(client: client, savedWorkspaceId: savedSelection.load())
      currentUserId = initial.currentUser.id
      currentUserName = initial.currentUser.name
      currentUserEmail = initial.currentUser.email
      currentUserImageURL = initial.currentUser.image
      var built: [WorkspaceOption] = []
      if initial.access.hasPersonalWorkspace {
        built.append(.init(id: "personal", title: "Personal", workspace: .personal))
      }
      built.append(
        contentsOf: initial.organizations.map {
          .init(id: $0.id, title: $0.name, workspace: .organization(id: $0.id, slug: $0.slug))
        }
      )
      options = built
      let selection = initial.defaultSelection
      selectionId = built.first { $0.workspace == selection }?.id
      phase = .ready
      roomsLoading = true
      defer { roomsLoading = false }
      rooms = try await service.listRooms(client: client, organizationSlug: selection.organizationSlug)
      let justConnected = startRealtimeIfNeeded(auth: auth)
      if !justConnected, realtime != nil || ablyToken != nil {
        await refreshAblyToken(auth: auth)
      }
      ensureRoomSelection(auth: auth)
    } catch let error as ChatServiceError {
      handleServiceError(error, auth: auth, signedOutMessage: "Signed out.")
    } catch {
      NSLog("Sokosumi workspace load failed: %@", String(describing: error))
      phase = .failed(message: friendlyMessage(for: error))
    }
  }

  func switchRooms(auth: AuthState, option: WorkspaceOption) async {
    roomsLoading = true
    // Bump the generation without wiping the pane: a failed switch keeps
    // showing the retained room's transcript instead of loading forever.
    // Success replaces it via ensureRoomSelection -> openRoom.
    transcriptGeneration += 1
    defer { roomsLoading = false }
    guard let client = resolveClient(auth: auth) else {
      switchError = "Sign-in is not configured."
      return
    }
    do {
      rooms = try await service.switchWorkspace(
        client: client,
        selection: option.workspace,
        previous: selection?.workspace ?? .personal
      )
      selectionId = option.id
      savedSelection.save(option.id)
      switchError = nil
      realtime?.setOrganizationSlug(option.workspace.organizationSlug)
      let justConnected = startRealtimeIfNeeded(auth: auth)
      if !justConnected, realtime != nil || ablyToken != nil {
        await refreshAblyToken(auth: auth)
      }
      ensureRoomSelection(auth: auth)
    } catch let error as ChatServiceError {
      handleServiceError(error, auth: auth, signedOutMessage: nil, keepReady: true)
    } catch {
      NSLog("Sokosumi workspace switch failed: %@", String(describing: error))
      switchError = friendlyMessage(for: error)
    }
  }

  private func handleServiceError(
    _ error: ChatServiceError,
    auth: AuthState,
    signedOutMessage: String?,
    keepReady: Bool = false
  ) {
    switch error {
    case let .blocked(gate):
      phase = .blocked(gate: gate)
    case let .unauthorized(message):
      auth.signOut(message: "Core rejected the session (\(message)). Sign in again.")
      if let signedOutMessage {
        phase = .failed(message: signedOutMessage)
      }
    case let .unprocessable(statusCode, message):
      let text = "Core rejected the request (\(statusCode)): \(message)"
      if keepReady {
        switchError = text
      } else {
        phase = .failed(message: text)
      }
    case .unexpectedResponse:
      let text = "Couldn't complete the request. Try again."
      if keepReady {
        switchError = text
      } else {
        phase = .failed(message: text)
      }
    }
  }
}
