import Combine
import CoreAPI
import Foundation

/// One member advanced their Room last-read (web `ChatRoomReadEventData`). Core publishes it on the room
/// channel when that member reads the room (`POST /chats/rooms/{id}/read`), never for a room with a guest on
/// it; `SokosumiRealtime` decodes it.
public struct ChatRoomReadEvent: Equatable, Sendable {
  public let roomId: String
  public let userId: String
  public let lastReadAt: Date

  public init(roomId: String, userId: String, lastReadAt: Date) {
    self.roomId = roomId
    self.userId = userId
    self.lastReadAt = lastReadAt
  }
}

/// One roster human and when they last read the room (web `RoomReader`).
public struct RoomReader: Equatable, Sendable {
  public let participant: Components.Schemas.ChatRoomUserParticipant
  public let lastReadAt: Date

  public init(participant: Components.Schemas.ChatRoomUserParticipant, lastReadAt: Date) {
    self.participant = participant
    self.lastReadAt = lastReadAt
  }
}

/// Room read receipts for the open room (web `useRoomReadReceipts`): the room payload's per-member Room
/// last-read is the floor and the live marks the ceiling, so a dropped connection leaves the last values
/// standing and the next room payload heals them. Receipts count people: Coworkers and Soko Bots are not on
/// `userMembers`, and the viewer is left out because posting advances their own mark.
public struct RoomReadReceipts: Equatable, Sendable {
  public typealias Participant = Components.Schemas.ChatRoomUserParticipant

  /// Roster humans who have read the room, most-recent-read first; equal marks keep roster order.
  public let readers: [RoomReader]
  /// Roster humans with no Room last-read at all, in roster order. Every member, for a guest viewer.
  public let nonReaders: [Participant]

  public init(room: Components.Schemas.ChatRoom?, currentUserId: String, liveReads: [String: Date]) {
    guard let room else {
      readers = []
      nonReaders = []
      return
    }
    // Read times do not cross the organization boundary: Core already empties the payload for a guest, and
    // this keeps a live mark that reached one out too.
    let isGuestViewer = room.myAccess.value1 == .guest
    var readers: [(order: Int, reader: RoomReader)] = []
    var nonReaders: [Participant] = []
    for (order, participant) in room.userMembers.enumerated() where participant.id != currentUserId {
      let marks = isGuestViewer ? [] : [participant.lastReadAt, liveReads[participant.id]].compactMap(\.self)
      if let mark = marks.max() {
        readers.append((order, RoomReader(participant: participant, lastReadAt: mark)))
      } else {
        nonReaders.append(participant)
      }
    }
    self.readers = readers.sorted { left, right in
      left.reader.lastReadAt != right.reader.lastReadAt ? left.reader.lastReadAt > right.reader.lastReadAt : left.order < right.order
    }.map(\.reader)
    self.nonReaders = nonReaders
  }

  /// The readers whose mark had reached `moment` (an equal mark counts), most-recent-read first.
  public func readers(asOf moment: Date) -> [RoomReader] {
    readers.filter { $0.lastReadAt >= moment }
  }

  /// Seen by for one transcript row (web `seenByReadersFor`): the newest message only, nil anywhere else and
  /// whenever nobody has read that far.
  public func seenBy(messageId: String, createdAt: Date, newestMessageId: String?) -> SeenBy? {
    guard messageId == newestMessageId else { return nil }
    let readThisFar = readers(asOf: createdAt)
    guard !readThisFar.isEmpty else { return nil }
    return SeenBy(readers: readThisFar, pending: seenByPending(readers: readThisFar, allReaders: readers, nonReaders: nonReaders))
  }
}

/// What the faces under the newest message say (web `RoomSeenByLine`): who read it and when, and who has not.
public struct SeenBy: Equatable, Sendable {
  /// Web's `READ_RECEIPT_FACE_CAP`: faces shown before the rest collapse into a `+N`.
  public static let faceCap = 3

  /// Readers as of the message, most-recent-read first.
  public let readers: [RoomReader]
  /// Everyone else on the human roster, lagging readers before the never-read.
  public let pending: [RoomReadReceipts.Participant]

  public init(readers: [RoomReader], pending: [RoomReadReceipts.Participant]) {
    self.readers = readers
    self.pending = pending
  }

  public var faces: [RoomReader] {
    Array(readers.prefix(Self.faceCap))
  }

  public var overflowCount: Int {
    readers.count - faces.count
  }

  /// Web `participantName`: what to call a member, their name or the email until they have one.
  public static func name(of participant: RoomReadReceipts.Participant) -> String {
    participant.name.isEmpty ? participant.email : participant.name
  }

  /// Web `App.Channels.SeenBy.summary`: the faces' accessible name and tooltip.
  public var summary: String {
    readers.count == 1 ? "Seen by 1 person" : "Seen by \(readers.count) people"
  }
}

/// Who has not read this far (web `seenByPendingFor`): every roster human the faces leave out. Not only the
/// never-read — someone who read yesterday has read something, but not this — and lagging readers come first,
/// so the list runs from nearly caught up to never here.
public func seenByPending(
  readers: [RoomReader], allReaders: [RoomReader], nonReaders: [RoomReadReceipts.Participant]
) -> [RoomReadReceipts.Participant] {
  let readThisFar = Set(readers.map(\.participant.id))
  return allReaders.filter { !readThisFar.contains($0.participant.id) }.map(\.participant) + nonReaders
}

/// The open room's live read marks (the event half of web `useRoomReadReceipts`), keyed by user. A mark only
/// moves forward, so events arriving out of order cannot un-read a room; a new room starts empty, because the
/// previous room's events say nothing about it.
@MainActor
public final class RoomReadMarks: ObservableObject {
  public private(set) var roomId: String?
  @Published public private(set) var marks: [String: Date] = [:]

  public init() {}

  /// The open room changed (nil: none). Reopening the room that is open keeps what it heard.
  public func open(roomId: String?) {
    guard roomId != self.roomId else { return }
    self.roomId = roomId
    if !marks.isEmpty {
      marks = [:]
    }
  }

  /// One read event; ignored for any room but the open one and when it would rewind a mark.
  public func apply(_ event: ChatRoomReadEvent) {
    guard event.roomId == roomId, marks[event.userId].map({ $0 < event.lastReadAt }) ?? true else { return }
    marks[event.userId] = event.lastReadAt
  }
}
