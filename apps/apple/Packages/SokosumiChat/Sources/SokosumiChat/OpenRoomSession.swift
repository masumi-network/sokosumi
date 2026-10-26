import Combine
import CoreAPI
import Foundation

/// Everything that lives and dies with the Open room: its Transcript, the open Thread, the coworker stream, Pins,
/// the Thread overview, the message being edited and where a jump should land. Opening another room or closing this
/// one resets all of it in one place. Sends, the coworker stream and the socket's updates for the room go through
/// here, so the room and its Thread stay in step; the workspace owns what spans rooms.
@MainActor
public final class OpenRoomSession: ObservableObject {
  /// Where the room should land after a message link, search hit or reply jump.
  public struct MessageJump: Equatable, Sendable {
    public let roomId: String
    public let messageId: String
    /// The open Thread's parent after a reply jump (row 25c). The Thread covers the room, so the room marks it on
    /// arrival and lands on it when the Thread closes; any other jump marks its row once it scrolls into view.
    public let isThreadParent: Bool
    public let requestId = UUID()
  }

  /// The sidebar's "N more unread threads" row asks for the room's thread overview (row 24g2, web's
  /// `?threads=1`); the room's tools open it once that room is on screen.
  public struct ThreadOverviewRequest: Equatable, Sendable {
    public let roomId: String
    public let requestId = UUID()
  }

  /// What the session asks the workspace for: this account's client and slug, sign-out when Core rejects the
  /// session (returning whether it signed out), the read sync after a landed page, the Look before a Thread's first
  /// page, whether any window shows the room, the room as the sidebar lists it now, the reader and their workspace.
  public struct Hooks {
    public var access: () -> (client: Client, organizationSlug: String?)?
    public var failed: (Error) -> Bool
    public var pageLanded: () async -> Void
    public var lookBeforeThread: () async -> Void
    public var isForeground: () -> Bool
    public var listedRoom: () -> Components.Schemas.ChatRoom?
    /// The reader: their id and account name.
    public var viewer: () -> (id: String, name: String)
    public var organizationId: () -> String?

    public init(
      access: @escaping () -> (client: Client, organizationSlug: String?)?,
      failed: @escaping (Error) -> Bool,
      pageLanded: @escaping () async -> Void,
      lookBeforeThread: @escaping () async -> Void,
      isForeground: @escaping () -> Bool,
      listedRoom: @escaping () -> Components.Schemas.ChatRoom?,
      viewer: @escaping () -> (id: String, name: String),
      organizationId: @escaping () -> String?
    ) {
      self.access = access
      self.failed = failed
      self.pageLanded = pageLanded
      self.lookBeforeThread = lookBeforeThread
      self.isForeground = isForeground
      self.listedRoom = listedRoom
      self.viewer = viewer
      self.organizationId = organizationId
    }
  }

  public var hooks = Hooks(access: { nil }, failed: { _ in false }, pageLanded: {}, lookBeforeThread: {}, isForeground: { false },
                           listedRoom: { nil }, viewer: { ("", "") }, organizationId: { nil })
  /// The room's main Transcript: its history, Send queue, realtime updates and recovery.
  public let room: TranscriptSession
  public let thread: ThreadSession
  /// Every loaded copy of a message (the room's history, the open Thread's parent and its replies) and the viewer's
  /// Pending reactions on them.
  public let loaded: LoadedMessages
  public let directStream: DirectStreamSession
  public let pins = PinnedMessages()
  public let threadOverview = RoomThreadOverview()
  public let messageEditing = MessageEditing()
  @Published public private(set) var messageJump: MessageJump?
  @Published public private(set) var threadOverviewRequest: ThreadOverviewRequest?
  /// Pins whose change is in flight.
  @Published public internal(set) var pendingPins: Set<String> = []
  /// Failed mention shells whose retry is in flight, by the visit they started in.
  @Published var pendingMentionRetries: Set<MentionRetry> = []
  let service = ChatService()
  /// The newest message navigation; opening or closing the room supersedes it.
  public private(set) var navigationRequest = UUID()
  /// Bumps whenever the room's Thread unread may have moved (a reply, lost continuity, a Look, a mute or Mark all),
  /// so the Threads trigger counts again. Only ever counts up, across visits: the trigger keys on it together with
  /// the room, so opening another room needs no reset.
  @Published public private(set) var threadAttentionRevision = 0
  /// Whether the socket reports the room's live updates as healthy, which lets recovery poll less.
  public private(set) var realtimeHealthy = false
  private var observations: Set<AnyCancellable> = []

  /// `now`, `makeId` and `sleep` are the Transcripts' clock, ids and timer pacing.
  public init(now: @escaping () -> Date = Date.init, makeId: @escaping () -> String = { UUID().uuidString },
              sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    room = TranscriptSession(now: now, makeId: makeId, sleep: sleep)
    thread = ThreadSession(now: now, makeId: makeId, sleep: sleep)
    loaded = LoadedMessages(room: room, thread: thread)
    directStream = DirectStreamSession(now: now, makeId: makeId)
    for publisher in [threadOverview.objectWillChange, pins.objectWillChange, loaded.objectWillChange, room.objectWillChange,
                      room.timeline.objectWillChange, room.outbox.objectWillChange, thread.objectWillChange,
                      thread.transcript.objectWillChange, thread.transcript.timeline.objectWillChange,
                      thread.transcript.outbox.objectWillChange, directStream.objectWillChange] {
      publisher.sink { [weak self] in self?.objectWillChange.send() }.store(in: &observations)
    }
    // Rows need editor identity changes; draft and save state are observed by the editor itself.
    messageEditing.$source.map { $0?.id }.removeDuplicates().dropFirst()
      .sink { [weak self] _ in self?.objectWillChange.send() }
      .store(in: &observations)
    // Every landed page syncs read attention before the load ends.
    room.hooks = .init(access: { [weak self] in self?.hooks.access() }, failed: { [weak self] in self?.hooks.failed($0) ?? false },
                       pageLanded: { [weak self] page in await self?.roomPageLanded(page) })
    thread.transcript.hooks = .init(access: { [weak self] in self?.hooks.access() }, failed: { [weak self] in self?.hooks.failed($0) ?? false },
                                    pageLanded: { [weak self] _ in await self?.hooks.pageLanded() })
  }

  /// Opens `chatRoom` for `userId` in the workspace `organizationId`: its first page loads, a coworker stream still
  /// running reconnects and recovery starts. Reopening the open room keeps its live health and a Thread overview
  /// request for it; opening any other room drops both.
  public func open(_ chatRoom: Components.Schemas.ChatRoom, userId: String, organizationId: String?) {
    let reopening = room.timeline.roomId == chatRoom.id
    resetVisit(keepingOverviewFor: chatRoom.id)
    directStream.reset(room: chatRoom, userId: userId, organizationId: organizationId)
    realtimeHealthy = reopening && realtimeHealthy
    pins.reset(roomId: chatRoom.id)
    room.open(roomId: chatRoom.id)
    let generation = room.timeline.generation
    room.load(.initial)
    resumeStream()
    room.recovery.start(foreground: hooks.isForeground(), healthy: realtimeHealthy) { [weak self] in
      await self?.recover(generation: generation)
    }
  }

  /// Forgets the room: nothing is open afterwards.
  public func close() {
    resetVisit(keepingOverviewFor: nil)
    directStream.reset()
    realtimeHealthy = false
    pins.reset()
    room.close()
  }

  private func resetVisit(keepingOverviewFor roomId: String?) {
    navigationRequest = UUID()
    messageJump = nil
    if threadOverviewRequest?.roomId != roomId {
      threadOverviewRequest = nil
    }
    messageEditing.reset()
    thread.close()
    threadOverview.reset()
    pendingPins = []
  }

  /// Starts a message navigation and returns its id; a newer one, or a room change, supersedes it.
  public func beginNavigation() -> UUID {
    navigationRequest = UUID()
    return navigationRequest
  }

  /// Lands the room on `messageId` once its row is on screen.
  public func requestJump(to messageId: String, isThreadParent: Bool = false) {
    guard let roomId = room.timeline.roomId else { return }
    messageJump = MessageJump(roomId: roomId, messageId: messageId, isThreadParent: isThreadParent)
  }

  public func consumeMessageJump(_ requestId: UUID) {
    if messageJump?.requestId == requestId {
      messageJump = nil
    }
  }

  /// Asks for `roomId`'s Thread overview; it survives opening that room.
  public func requestThreadOverview(roomId: String) {
    threadOverviewRequest = ThreadOverviewRequest(roomId: roomId)
  }

  public func consumeThreadOverviewRequest(_ requestId: UUID) {
    if threadOverviewRequest?.requestId == requestId {
      threadOverviewRequest = nil
    }
  }

  /// Runs one Core request for this visit: without a client it throws `unauthorized(signIn)`, and a session Core
  /// rejects is signed out. Nil when the room changed, or the task was cancelled, before Core answered; the result
  /// or the failure belongs to a visit that is over. `outlivingTheVisit` keeps both for work whose state is not the
  /// visit's, such as a Pending reaction.
  func request<Value>(
    signIn: String, outlivingTheVisit: Bool = false, _ operation: (ChatService, Client, String?) async throws -> Value
  ) async throws -> Value? {
    guard let access = hooks.access() else { throw ChatServiceError.unauthorized(signIn) }
    let visit = room.timeline.generation
    let isCurrent = { [self] in outlivingTheVisit || (visit == room.timeline.generation && !Task.isCancelled) }
    do {
      let value = try await operation(service, access.client, access.organizationSlug)
      return isCurrent() ? value : nil
    } catch {
      if let error = error as? ChatServiceError {
        _ = hooks.failed(error)
      }
      guard isCurrent() else { return nil }
      throw error
    }
  }

  /// A Look, a mute or Mark all moved the room's Thread unread.
  public func threadAttentionChanged() {
    threadAttentionRevision += 1
  }

  public func setForeground(_ foreground: Bool) {
    thread.transcript.recovery.setForeground(foreground)
    room.recovery.setForeground(foreground)
  }

  // MARK: - History

  /// Re-reads the latest page and merges it (envelope refetch, ADR 0014), the same read as the live poll. It marks
  /// nothing read and never wipes resolved history on failure. While the coworker stream draws the room's newest
  /// rows it waits, unless a Thread is open.
  public func refresh() {
    guard room.timeline.roomId != nil else { return }
    guard !directStream.isBusy || thread.parent != nil else { return }
    room.load(.latest)
  }

  /// The older page for scroll-up; merges by message id and never clears resolved history on failure.
  public func loadOlder() {
    guard !directStream.isBusy else { return }
    room.load(.older)
  }

  /// Waits for history and paging before the recovery read; the scheduler's interval starts after it finishes.
  private func recover(generation: Int) async {
    await room.whenIdle()
    guard generation == room.timeline.generation else { return }
    refresh()
    await room.whenIdle()
  }

  /// The room's fresh copy of an open Thread's parent is the newer one.
  private func roomPageLanded(_ page: RoomTimeline.Page) async {
    if page == .latest, let parent = room.timeline.messages.first(where: { $0.id == thread.parent?.id }) {
      thread.apply(eventType: .update, message: parent)
    }
    await hooks.pageLanded()
  }

  // MARK: - Thread

  /// The parent of the reply the coworker stream is writing, while its Thread is not the open one.
  public var streamingThreadToOpen: Components.Schemas.ChatRoomMessage? {
    guard directStream.isBusy, directStream.phase != .resuming, let parentId = directStream.parentMessageId,
          thread.parent?.id != parentId else { return nil }
    return room.timeline.messages.first { $0.id == parentId }
  }

  /// Opens `parent`'s Thread in this room: its first page loads after the Look, and its recovery starts.
  public func openThread(_ parent: Components.Schemas.ChatRoomMessage) {
    guard parent.roomId == room.timeline.roomId else { return }
    let previousGeneration = thread.transcript.timeline.generation
    guard thread.open(parent) else { return }
    guard thread.transcript.timeline.generation != previousGeneration else { return }
    loadThreadPage(.initial)
    let generation = thread.transcript.timeline.generation
    thread.transcript.recovery.start(foreground: hooks.isForeground(), healthy: realtimeHealthy) { [weak self] in
      guard let self else { return }
      await thread.transcript.whenIdle()
      guard generation == thread.transcript.timeline.generation else { return }
      loadThreadPage(thread.transcript.timeline.hasLoadedHistory ? .latest : .initial)
      await thread.transcript.whenIdle()
    }
  }

  /// The first page's Look comes before its request; later pages sync read attention after they land.
  public func loadThreadPage(_ page: RoomTimeline.Page) {
    guard page != .older || !directStream.isBusy else { return }
    thread.transcript.load(page, before: page == .initial ? { [weak self] in await self?.hooks.lookBeforeThread() } : nil)
  }

  // MARK: - Sending

  /// Whether `draft` can go to the open room now. A quote can be the whole message, except in the coworker stream,
  /// which needs words to answer.
  public func canSend(_ draft: ComposerContent, quoted: Bool) -> Bool {
    guard let roomId = room.timeline.roomId, hooks.access() != nil else { return false }
    return draft.canSend(quoted: quoted && directStream.roomId != roomId)
  }

  /// Queues a local shell at once, then posts in order; in a coworker Direct the stream answers instead. A draft
  /// `canSend` refuses changes nothing; otherwise the room follows the latest page, so a jumped-to page ends.
  @discardableResult
  public func send(
    _ draft: ComposerContent, sender: Components.Schemas.ChatRoomUserParticipant, mentions: [ComposerMention],
    attachments: [ComposeAttachment] = [], quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    skills: [Components.Schemas.ChatRoomMessageSkill] = []
  ) -> Bool {
    guard canSend(draft, quoted: quote != nil), let roomId = room.timeline.roomId, let access = hooks.access() else { return false }
    room.timeline.followLatest()
    if directStream.roomId == roomId {
      return directStream.send(draft.text, client: access.client, organizationSlug: access.organizationSlug, attachments: attachments,
                               quote: quote, settled: streamSettled(room.timeline.generation), failed: streamFailed)
    }
    return room.send(draft.text, client: access.client, organizationSlug: access.organizationSlug, sender: sender,
                     mentions: mentions, quote: quote, skills: skills) { [weak self] result in
      guard case let .failure(error) = result else { return }
      _ = self?.hooks.failed(error)
    }
  }

  /// A reply in the open Thread. A confirmed reply updates the parent's reply bar in the room; the Thread's parent is
  /// a snapshot, so assigning it would put back an unread count a Look already cleared.
  @discardableResult
  public func sendReply(
    _ content: String, sender: Components.Schemas.ChatRoomUserParticipant, mentions: [ComposerMention],
    attachments: [ComposeAttachment] = [], quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    skills: [Components.Schemas.ChatRoomMessageSkill] = []
  ) -> Bool {
    guard let access = hooks.access(), thread.parent?.roomId == room.timeline.roomId else { return false }
    // Like the room's send: the reply joins the latest replies, so a jumped-to page ends.
    thread.transcript.timeline.followLatest()
    if directStream.roomId == room.timeline.roomId, let parentId = thread.parent?.id {
      return directStream.send(content, client: access.client, organizationSlug: access.organizationSlug, attachments: attachments,
                               parentMessageId: parentId, quote: quote, settled: streamSettled(room.timeline.generation),
                               failed: streamFailed)
    }
    return thread.send(content, client: access.client, organizationSlug: access.organizationSlug, sender: sender,
                       mentions: mentions, quote: quote, skills: skills) { [weak self] result in
      guard let self else { return }
      switch result {
      case let .success(reply):
        if let parentId = thread.parent?.id {
          room.update(parentId) { applyingReplyToParentThreadPreview($0, reply: reply) }
        }
      case let .failure(error):
        _ = hooks.failed(error)
      }
    }
  }

  // MARK: - Coworker stream

  /// Reconnects to a coworker stream Core may still be running for the room.
  func resumeStream() {
    guard directStream.roomId != nil, let access = hooks.access() else { return }
    directStream.resume(client: access.client, organizationSlug: access.organizationSlug,
                        settled: streamSettled(room.timeline.generation), failed: streamFailed)
  }

  private func streamSettled(_ generation: Int) -> () async -> Bool {
    { [weak self] in await self?.settleStream(generation: generation) ?? false }
  }

  private var streamFailed: (Error) -> Void {
    { [weak self] error in _ = self?.hooks.failed(error) }
  }

  /// The stream ended: the room re-reads its latest page for the stored turn, and a reply's Thread opens and
  /// catches up. False when the room changed meanwhile or a read failed.
  private func settleStream(generation: Int) async -> Bool {
    await room.whenIdle()
    guard generation == room.timeline.generation, !Task.isCancelled else { return false }
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
    guard generation == room.timeline.generation else { return false }
    guard thread.parent?.id == parentId else { return true }
    // A thread opened after the room refresh already fetched the completed turn.
    if openedGeneration == thread.transcript.timeline.generation, thread.transcript.timeline.hasLoadedHistory,
       thread.transcript.timeline.errorMessage == nil {
      return true
    }
    loadThreadPage(thread.transcript.timeline.hasLoadedHistory ? .latest : .initial)
    _ = await thread.transcript.loadTask?.value
    guard generation == room.timeline.generation else { return false }
    guard thread.parent?.id == parentId else { return true }
    return thread.transcript.timeline.errorMessage == nil
  }

  // MARK: - Realtime

  /// A full-DTO create, update or delete for room `roomId`. Own send and its live create dedupe to one bubble by
  /// client turn id (ADR 0004). While the coworker stream draws the room's newest rows only a delete reaches the
  /// room's history; anything else only moves an open Thread.
  public func apply(eventType: ChatRoomMessageRealtimeEventType, message: Components.Schemas.ChatRoomMessage, roomId: String) {
    if roomId == room.timeline.roomId, message.parentMessageId != nil {
      threadAttentionChanged()
    }
    guard roomId == room.timeline.roomId, message.roomId == roomId, !directStream.isBusy || eventType == .delete else {
      return thread.apply(eventType: eventType, message: message)
    }
    loaded.apply(eventType: eventType, message: message)
  }

  /// An id envelope (ADR 0014): a delete tombstones the row, a create or update refetches. Returns whether the open
  /// room took it, either holding it back behind a running stream or tombstoning or refetching; an envelope it
  /// ignores may still move the Thread's parent, and the workspace may refresh the sidebar for it.
  @discardableResult
  public func apply(_ envelope: ChatRoomMessageIdEnvelope) -> Bool {
    if envelope.roomId == room.timeline.roomId, envelope.parentMessageId != nil {
      threadAttentionChanged()
    }
    let refreshParent = thread.apply(envelope)
    if envelope.roomId == directStream.roomId, directStream.isBusy, envelope.eventType != .delete, !refreshParent {
      return true
    }
    guard room.apply(envelope) == .ignore else { return true }
    if refreshParent || (thread.parent != nil && envelope.roomId == room.timeline.roomId && envelope.parentMessageId == thread.parent?.id) {
      room.recovery.requestRefresh()
    }
    return false
  }

  /// A pin changed here or in another client: the row's pin and the open room's Pins follow.
  public func applyPin(roomId: String, messageId: String, isPinned: Bool) {
    room.timeline.applyPin(roomId: roomId, messageId: messageId, isPinned: isPinned)
    guard pins.roomId == roomId else { return }
    if isPinned {
      pins.invalidate()
    } else {
      pins.remove(messageId: messageId)
    }
  }

  /// The socket's word on the room's live updates; lost continuity re-reads both Transcripts.
  public func applyRealtimeHealth(_ healthy: Bool, continuityLost: Bool) {
    realtimeHealthy = healthy
    thread.transcript.recovery.setHealthy(healthy)
    room.recovery.setHealthy(healthy)
    if continuityLost {
      threadAttentionChanged()
      thread.transcript.recovery.requestRefresh()
      room.recovery.requestRefresh()
    }
  }
}
