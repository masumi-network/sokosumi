import Combine
import CoreAPI
import Foundation

/// A group Direct's Group name as the Name Group sheet edits it (ADR-0040, `CONTEXT.md` Group name).
/// Core enforces the same rules; this only shapes the UI.
public struct GroupNameDraft: Equatable, Sendable {
  /// Core's cap, counted after trimming in UTF-16 units like the channel name.
  public static let maxLength = 80

  /// The Group name the room carries now; empty when unnamed.
  public let current: String
  public private(set) var name: String

  public init(room: Components.Schemas.ChatRoom) {
    current = room.groupName ?? ""
    name = current
  }

  /// Any member may name a Direct started for three or more humans. 1:1, Self, coworker and personal assistant
  /// Directs are never group Directs, and Channels have a Channel name instead. Directs cannot be archived and
  /// archived rooms never reach the room list, so an archived room is never offered.
  public static func canName(_ room: Components.Schemas.ChatRoom) -> Bool {
    room.kind == .direct && room.isGroupDirect
  }

  public mutating func setName(_ raw: String) {
    name = ChannelDraft.limit(raw, to: Self.maxLength)
  }

  /// What the room will be called: trimmed, and nil once empty, which clears it back to the member list.
  public var groupName: String? {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  /// Saving the name the room already has changes nothing.
  public var isUnchanged: Bool {
    groupName == (current.isEmpty ? nil : current)
  }

  /// `groupName` is the one field a Direct accepts. An empty string clears it: a nil optional would drop the key,
  /// which Core reads as a Direct edit with no field.
  public var updateRequest: Components.Schemas.UpdateChatRoomRequest {
    .init(groupName: groupName ?? "")
  }
}

@MainActor
public final class GroupNaming: ObservableObject {
  public let room: Components.Schemas.ChatRoom
  @Published public var draft: GroupNameDraft
  @Published public private(set) var saving = false
  @Published public private(set) var errorMessage: String?

  public init(room: Components.Schemas.ChatRoom) {
    self.room = room
    draft = GroupNameDraft(room: room)
  }

  public var canSave: Bool {
    !saving && GroupNameDraft.canName(room)
  }

  /// True once the sheet may close: saved, or nothing changed, in which case nothing is sent.
  public func save(using submit: (GroupNameDraft) async throws -> Bool) async -> Bool {
    guard canSave else { return false }
    guard !draft.isUnchanged else { return true }
    saving = true
    errorMessage = nil
    defer { saving = false }
    do {
      let saved = try await submit(draft)
      return saved && !Task.isCancelled
    } catch {
      guard !Task.isCancelled, !(error is CancellationError) else { return false }
      errorMessage = channelErrorMessage(error)
      return false
    }
  }
}

public extension Components.Schemas.ChatRoom {
  /// The room once its Group name change row arrives, so an open room's title follows another member's rename
  /// without waiting for the room list. Nil when `message` is not such a row for this room.
  func applyingGroupNameChange(_ message: Components.Schemas.ChatRoomMessage) -> Self? {
    guard kind == .direct, message.roomId == id, let change = message.groupNameChange else { return nil }
    var room = self
    room.groupName = change.action == .named ? change.name : nil
    return room
  }
}
