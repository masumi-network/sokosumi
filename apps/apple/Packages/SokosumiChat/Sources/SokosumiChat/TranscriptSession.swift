import Combine
import CoreAPI
import Foundation

/// One Transcript: a Room's or a Thread's messages as the reader sees them, confirmed history plus the Send queue's
/// Pending messages and Failed sends, with its page loads, sends, realtime updates and jump. `open` scopes it to a
/// room, or to a Thread's replies with `parentMessageId`; `close` drops only local state.
@MainActor
public final class TranscriptSession: ObservableObject {
  public typealias Message = Components.Schemas.ChatRoomMessage

  public struct JumpTarget: Equatable, Sendable {
    public let requestId = UUID()
    public let messageId: String
    /// Nil until the prepared row is ready to land. Its hold must not consume a pending jump. A covered target is
    /// marked at once and keeps no mark once that hold has run out.
    public fileprivate(set) var mark: JumpMark?
    /// Marked while something covers the row (row 25c: the Thread's parent behind the open Thread); the list lands on
    /// it once nothing does, without restarting the mark.
    public fileprivate(set) var isCovered = false
    /// Whether the list has reached the row.
    public fileprivate(set) var hasLanded = false
  }

  /// What the Transcript needs from its owner to load on its own.
  public struct Hooks {
    /// The client and workspace slug to read with; nil when no one is signed in.
    public var access: () -> (client: Client, organizationSlug: String?)?
    /// Returns whether the failure ended the session, so its banner gives way to sign-in.
    public var failed: (Error) -> Bool
    /// Runs after a page applied, inside the load, before the next page may start. A latest refresh a gap page held
    /// back lands inside that gap's load.
    public var pageLanded: (RoomTimeline.Page) async -> Void

    public init(
      access: @escaping () -> (client: Client, organizationSlug: String?)?,
      failed: @escaping (Error) -> Bool,
      pageLanded: @escaping (RoomTimeline.Page) async -> Void
    ) {
      self.access = access
      self.failed = failed
      self.pageLanded = pageLanded
    }
  }

  static let signInMissing = "Sign-in is not configured."

  @Published public private(set) var jumpTarget: JumpTarget?
  public let timeline = RoomTimeline()
  public let outbox: RoomOutbox
  public let recovery: ChatRefreshScheduler
  public var hooks = Hooks(access: { nil }, failed: { _ in false }, pageLanded: { _ in })
  /// The page load in flight. Only one runs; gap pages queue on `gapTask` instead.
  public private(set) var loadTask: Task<Bool, Never>?
  /// The chained history gap loads (row 04a).
  public private(set) var gapTask: Task<Void, Never>?
  private var gapRequest = 0
  private var transcriptObservation: AnyCancellable?
  /// The caller of `jump(to:)` waiting for the list to land.
  private var landing: CheckedContinuation<Bool, Never>?
  private let service = ChatService()
  private let now: () -> Date
  private let makeId: () -> String

  /// `sleep` paces the recovery timer and the Send queue's timers.
  public init(now: @escaping () -> Date = Date.init, makeId: @escaping () -> String = { UUID().uuidString },
              sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    self.now = now
    self.makeId = makeId
    recovery = ChatRefreshScheduler(sleep: sleep)
    outbox = RoomOutbox(now: now, sleep: sleep)
    transcriptObservation = timeline.$messages.sink { [weak outbox] in outbox?.reconcile(messages: $0) }
  }

  /// Confirmed history with unresolved Pending messages and Failed sends at the end.
  public var displayedMessages: [Message] {
    displayedTranscript(messages: timeline.messages, shells: outbox.shells)
  }

  public func open(roomId: String, parentMessageId: String? = nil) {
    stop()
    timeline.reset(roomId: roomId, parentMessageId: parentMessageId)
  }

  public func close() {
    stop()
    timeline.reset()
  }

  /// Drops what the previous scope left running: its jump, page and gap loads, recovery and Send queue. The timeline resets
  /// once, in `open` or `close`, so it never publishes an empty scope between two rooms.
  private func stop() {
    clearJump()
    loadTask?.cancel()
    loadTask = nil
    gapTask?.cancel()
    gapTask = nil
    recovery.stop()
    outbox.reset()
  }

  public func requestJump(to messageId: String) {
    guard timeline.messages.contains(where: { $0.id == messageId }) else { return }
    // RoomTools is already waiting in `jump(to:)` when the room view's messageJump task requests this same row.
    // Replacing that request would answer false before the list lands.
    if let current = jumpTarget, landing != nil, current.messageId == messageId, !current.hasLanded, !current.isCovered {
      return
    }
    replaceJump(with: JumpTarget(messageId: messageId))
  }

  /// Marks a row something covers now, on this Transcript's clock, so its hold runs under the cover (web's `landOn`).
  public func markCovered(_ messageId: String) {
    guard timeline.messages.contains(where: { $0.id == messageId }) else { return }
    replaceJump(with: JumpTarget(messageId: messageId, mark: JumpMark(messageId: messageId, landedAt: now()), isCovered: true))
  }

  /// Requests a jump and answers once the list lands on the row: false when another jump, a close or a dropped row
  /// replaces it first.
  public func jump(to messageId: String) async -> Bool {
    requestJump(to: messageId)
    guard let target = jumpTarget, target.messageId == messageId, !target.hasLanded else { return false }
    // A second wait on this same row takes the answer; the request above kept the target.
    finishLanding(false)
    return await withCheckedContinuation { landing = $0 }
  }

  /// Start the hold only after the view has issued the scroll to the prepared row. A late acknowledgement
  /// cannot mark a replacement request, and another layout pass cannot restart an existing hold.
  public func landJump(_ requestId: UUID) {
    guard let target = jumpTarget, target.requestId == requestId, !target.hasLanded else { return }
    if target.isCovered, target.mark == nil {
      // The covered row's hold ran out before the list reached it: nothing is left to show.
      jumpTarget = nil
    } else {
      jumpTarget?.hasLanded = true
      if !target.isCovered {
        jumpTarget?.mark = JumpMark(messageId: target.messageId, landedAt: now())
      }
    }
    finishLanding(true)
  }

  /// A reader scroll (web `fadeOutHighlight`): the mark fades out, or ends outright outside its full-strength stretch.
  public func readerScrolled() {
    guard let target = jumpTarget, let currentMark = target.mark else { return }
    guard let mark = currentMark.readerScrolled(at: now()) else { return markEnded() }
    if mark != target.mark {
      jumpTarget?.mark = mark
    }
  }

  /// Drop the jump once its mark has run out (web `landOn`'s timer).
  public func endJumpIfMarkEnded() {
    if jumpTarget?.mark?.stage(at: now()) == .ended {
      markEnded()
    }
  }

  public func clearJump() {
    finishLanding(false)
    guard jumpTarget != nil else { return }
    jumpTarget = nil
  }

  /// A landed jump ends with its mark; a covered one still waits for the list, unmarked.
  private func markEnded() {
    if jumpTarget?.hasLanded == false, jumpTarget?.isCovered == true {
      jumpTarget?.mark = nil
    } else {
      clearJump()
    }
  }

  private func replaceJump(with target: JumpTarget) {
    finishLanding(false)
    jumpTarget = target
  }

  private func finishLanding(_ landed: Bool) {
    landing?.resume(returning: landed)
    landing = nil
  }

  /// Starts a page read unless one is running. A refresh or older page asked for while another runs is dropped: the
  /// next recovery tick or scroll edge asks again. A refresh during a gap page is held by the timeline instead.
  /// `before` runs inside the load ahead of the request, so nothing else starts meanwhile. The task answers whether
  /// the page applied to this Transcript.
  @discardableResult
  public func load(_ page: RoomTimeline.Page, before: (() async -> Void)? = nil) -> Task<Bool, Never>? {
    guard timeline.roomId != nil, loadTask == nil, admits(page) else { return nil }
    let generation = timeline.generation
    let task = Task { [weak self] () -> Bool in
      guard let self, timeline.generation == generation else { return false }
      defer {
        if timeline.generation == generation {
          loadTask = nil
        }
      }
      if let before {
        await before()
      }
      guard timeline.generation == generation, !Task.isCancelled else { return false }
      return await run(page, generation: generation)
    }
    loadTask = task
    return task
  }

  /// Loads the page around a message the reader jumps to. Not queued: it answers its caller directly, and the timeline
  /// refuses it while another page runs.
  public func loadAround(_ messageId: String) async throws -> Bool {
    try await loadDirectly(.around(messageId))
  }

  /// Leaves a jump's history window for the latest page; true when the list already shows it.
  public func returnToLatest() async throws -> Bool {
    guard timeline.historicalAnchor != nil else { return true }
    return try await loadDirectly(.returnToLatest)
  }

  private func loadDirectly(_ page: RoomTimeline.Page) async throws -> Bool {
    guard let access = hooks.access() else { throw ChatServiceError.unauthorized(Self.signInMissing) }
    return try await timeline.loadPage(page, client: access.client, organizationSlug: access.organizationSlug, generation: timeline.generation)
  }

  /// Waits until no page load runs for this Transcript.
  public func whenIdle() async {
    let generation = timeline.generation
    while generation == timeline.generation, let task = loadTask {
      _ = await task.value
    }
  }

  /// A gap row scrolled into or out of view (web's `useLoadWhenVisible`): in view and idle, it loads itself once.
  public func setGapVisible(before messageId: String, _ isVisible: Bool) {
    guard timeline.roomId != nil else { return }
    timeline.boundaryLoads.setVisible(messageId, isVisible)
    loadNextVisibleGap()
  }

  /// A tap on a gap row, or Try again after a failure. The outcome stays on the row.
  public func loadGap(before messageId: String) {
    guard timeline.roomId != nil, timeline.historyGapMessageIds.contains(messageId),
          hooks.access() != nil, timeline.boundaryLoads.begin(messageId) else { return }
    startGapLoad(messageId)
  }

  private func admits(_ page: RoomTimeline.Page) -> Bool {
    let busy = timeline.isLoading || timeline.isLoadingOlder || timeline.isRefreshing
    switch page {
    case .older: return !busy && timeline.hasMore && timeline.cursor != nil
    case .latest: return !busy || timeline.isFillingGap
    default: return true
    }
  }

  private func run(_ page: RoomTimeline.Page, generation: Int) async -> Bool {
    guard let access = hooks.access() else {
      if page == .initial {
        timeline.failInitialLoad(message: Self.signInMissing, generation: generation)
      } else {
        timeline.errorMessage = Self.signInMissing
      }
      return false
    }
    do {
      guard try await timeline.loadPage(page, client: access.client, organizationSlug: access.organizationSlug, generation: generation) else {
        return false
      }
      await hooks.pageLanded(page)
      return timeline.generation == generation && !Task.isCancelled
    } catch {
      guard timeline.generation == generation, !Task.isCancelled else { return false }
      if hooks.failed(error) {
        timeline.errorMessage = nil
      }
      return false
    }
  }

  private func loadNextVisibleGap() {
    guard hooks.access() != nil, timeline.boundaryLoads.loadingCursorMessageId == nil,
          let messageId = timeline.boundaryLoads.nextAutomaticLoad() else { return }
    guard timeline.historyGapMessageIds.contains(messageId) else {
      timeline.boundaryLoads.release(messageId)
      return
    }
    startGapLoad(messageId)
  }

  /// Gap pages queue behind the page load in flight (the timeline admits one page at a time) and behind each other,
  /// so a tap on a second gap is not refused. When one settles, the next visible idle gap follows.
  private func startGapLoad(_ messageId: String) {
    let generation = timeline.generation
    gapRequest += 1
    let request = gapRequest
    gapTask = Task { [previous = gapTask] in
      await previous?.value
      defer {
        if gapRequest == request {
          gapTask = nil
        }
      }
      await whenIdle()
      guard generation == timeline.generation, !Task.isCancelled, let access = hooks.access() else { return }
      do {
        // A latest refresh the gap held back lands like any latest page.
        let applied = try await timeline.loadPage(
          .boundary(messageId), client: access.client, organizationSlug: access.organizationSlug, generation: generation,
          heldRefreshLanded: { await hooks.pageLanded(.latest) }
        )
        if !applied, generation == timeline.generation {
          // Refused by an untracked page (a jump in flight): the row goes back to Load missing messages for a tap.
          timeline.boundaryLoads.release(messageId)
        }
      } catch {
        _ = hooks.failed(error)
      }
      guard generation == timeline.generation, !Task.isCancelled else { return }
      loadNextVisibleGap()
    }
  }

  /// Queue a Pending message at once, then POST in order. Invalid drafts stay with the composer; accepted sends keep
  /// a stable client turn id for safe retries.
  @discardableResult
  public func send(
    _ content: String, client: Client, organizationSlug: String?,
    sender: Components.Schemas.ChatRoomUserParticipant,
    mentions: [ComposerMention] = [],
    quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    skills: [Components.Schemas.ChatRoomMessageSkill] = [],
    settled: @escaping (Result<Message, Error>) -> Void
  ) -> Bool {
    let draft = ComposerContent(content)
    guard let roomId = timeline.roomId, draft.canSend(quoted: quote != nil) else { return false }
    let parentMessageId = timeline.parentMessageId
    let id = makeId()
    let shell = OutboundShell(
      clientTurnId: id, roomId: roomId, parentMessageId: parentMessageId,
      content: draft.text, quote: quote, skills: skills, createdAt: now(), sender: sender
    )
    outbox.enqueue(shell, send: { [service] in
      try await service.createMessage(
        client: client, roomId: roomId, content: draft.text, clientMessageId: id,
        parentMessageId: parentMessageId, mentions: mentions, quote: quote, skillIds: skills.map(\.id),
        organizationSlug: organizationSlug
      )
    }, confirmed: { [weak self] message in
      guard let self else { return }
      timeline.messages = confirmOutbound(
        messages: timeline.messages, shells: [], confirmed: message, clientTurnId: id
      ).messages
      settled(.success(message))
    }, failed: { settled(.failure($0)) })
    return true
  }

  public func apply(eventType: ChatRoomMessageRealtimeEventType, message: Message) {
    guard let roomId = timeline.roomId, message.roomId == roomId else { return }
    let result = applyRealtimeFullEvent(
      messages: timeline.messages, shells: outbox.shells,
      eventType: eventType, message: message, parentMessageId: timeline.parentMessageId
    )
    timeline.messages = result.messages
    outbox.reconcile(result.shells, confirmed: message)
  }

  /// Applies `transform` to this Transcript's loaded copy of a message; a message that is not loaded stays absent.
  public func update(_ id: String, _ transform: (Message) -> Message) {
    guard let index = timeline.messages.firstIndex(where: { $0.id == id }) else { return }
    timeline.messages[index] = transform(timeline.messages[index])
  }

  public func apply(_ patch: RealtimeMessagePatch) {
    guard let roomId = timeline.roomId, patch.roomId == roomId else { return }
    timeline.messages = applyRealtimePatch(patch, messages: timeline.messages, parentMessageId: timeline.parentMessageId)
  }

  /// A tombstone applies at once; anything that needs the message's content asks recovery to refetch. Returns how the
  /// envelope resolved, so a caller can act on one this Transcript ignores.
  @discardableResult
  public func apply(_ envelope: ChatRoomMessageIdEnvelope) -> ChatRoomMessageEnvelopeResolution {
    guard let roomId = timeline.roomId, envelope.roomId == roomId else { return .ignore }
    let resolution = resolveRealtimeEnvelope(envelope, focusedRoomId: roomId, parentMessageId: timeline.parentMessageId)
    switch resolution {
    case let .tombstone(id):
      timeline.messages = applyRealtimeTombstone(messages: timeline.messages, messageId: id, now: now())
    case .needsRefetch:
      recovery.requestRefresh()
    case .ignore: break
    }
    return resolution
  }
}
