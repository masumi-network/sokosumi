import Combine
import CoreAPI
import Foundation

/// Everything that lives and dies with the Open room: its Transcript, the open Thread, the coworker stream, Pins,
/// the Thread overview, the message being edited and where a jump should land. Opening another room or closing this
/// one resets all of it in one place; the workspace starts the loads and owns what spans rooms.
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
  @Published public private(set) var pendingPins: Set<String> = []
  /// The newest message navigation; opening or closing the room supersedes it.
  public private(set) var navigationRequest = UUID()
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
  }

  /// Opens `chatRoom` for `userId` in the workspace `organizationId`. Reopening the open room keeps its live health
  /// and a Thread overview request for it; opening any other room drops both.
  public func open(_ chatRoom: Components.Schemas.ChatRoom, userId: String, organizationId: String?) {
    let reopening = room.timeline.roomId == chatRoom.id
    resetVisit(keepingOverviewFor: chatRoom.id)
    directStream.reset(room: chatRoom, userId: userId, organizationId: organizationId)
    realtimeHealthy = reopening && realtimeHealthy
    pins.reset(roomId: chatRoom.id)
    room.open(roomId: chatRoom.id)
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

  /// Marks a pin change for `messageId` in flight; false when one already is.
  public func startPinChange(_ messageId: String) -> Bool {
    pendingPins.insert(messageId).inserted
  }

  public func finishPinChange(_ messageId: String) {
    pendingPins.remove(messageId)
  }

  public func setRealtimeHealthy(_ healthy: Bool) {
    realtimeHealthy = healthy
  }
}
