import Combine
import CoreAPI
import Foundation

/// Core `channel-membership.ts` (SOK-1258): any host member of an organization Channel that is not matched adds people,
/// Coworkers and their own Soko Bots and removes Guests and Coworkers; guests and matched channels manage nobody.
/// Name/topic/visibility, Archive and removing host members need an organization owner or admin. Core enforces the
/// same matrix; this only hides what Core would reject.
public struct ChannelEditPermissions: Equatable, Sendable {
  public let canEditMembers: Bool
  public let canManageSettings: Bool

  public init(canEditMembers: Bool, canManageSettings: Bool) {
    self.canEditMembers = canEditMembers
    self.canManageSettings = canManageSettings
  }

  public init(room: Components.Schemas.ChatRoom, isOwnerOrAdmin: Bool) {
    let editable = Self.isEditable(room)
    self.init(canEditMembers: editable, canManageSettings: editable && isOwnerOrAdmin)
  }

  public static func isEditable(_ room: Components.Schemas.ChatRoom) -> Bool {
    room.kind == .channel && room.organizationId != nil && room.myAccess.value1 != .guest && room.discoverability != .matched
  }

  /// A row's Remove action. Nobody removes themselves (that is Leave); a Guest or Coworker needs any host member, a
  /// host member needs an owner or admin, and a Soko Bot only its owner.
  public func canRemove(_ member: DirectRecipient, in room: Components.Schemas.ChatRoom, currentUserId: String) -> Bool {
    guard canEditMembers else { return false }
    switch member {
    case let .human(id):
      guard id != currentUserId, let user = room.userMembers.first(where: { $0.id == id }) else { return false }
      return user.access == .guest || canManageSettings
    case let .coworker(id):
      return room.coworkerMembers.contains { $0.id == id }
    case let .sokoBot(id):
      return room.sokoBotMembers.contains { $0.id == id && $0.ownerUserId == currentUserId }
    }
  }
}

/// The admin-only settings sheet: name, topic and visibility. Membership lives in the members panel.
public struct ChannelEditDraft: Equatable, Sendable {
  public private(set) var name: String
  public private(set) var topic: String
  public var visibility: ChannelDraft.Visibility

  public init(room: Components.Schemas.ChatRoom) {
    name = room.name
    topic = room.topic ?? ""
    visibility = ChannelDraft.Visibility(rawValue: room.discoverability?.rawValue ?? "") ?? .public
  }

  public var isValid: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  public mutating func setName(_ raw: String) {
    name = ChannelDraft.limit(raw, to: ChannelDraft.nameLimit)
  }

  public mutating func setTopic(_ raw: String) {
    topic = ChannelDraft.limit(raw, to: ChannelDraft.topicLimit)
  }
}

@MainActor
public final class ChannelEditing: ObservableObject {
  @Published public private(set) var room: Components.Schemas.ChatRoom
  @Published public var draft: ChannelEditDraft
  @Published public private(set) var saving = false
  @Published public private(set) var errorMessage: String?

  public init(room: Components.Schemas.ChatRoom) {
    self.room = room
    draft = ChannelEditDraft(room: room)
  }

  /// Room updates can arrive from another window or a sidebar refresh; the draft keeps the edits in progress.
  public func updateRoom(_ room: Components.Schemas.ChatRoom) {
    guard room.id == self.room.id, room != self.room else { return }
    self.room = room
  }

  public var canSave: Bool {
    !saving && ChannelEditPermissions.isEditable(room) && draft.isValid
  }

  public func save(using submit: (ChannelEditDraft) async throws -> Bool) async -> Bool {
    guard canSave else { return false }
    saving = true
    errorMessage = nil
    defer { saving = false }
    do {
      let saved = try await submit(draft)
      guard !Task.isCancelled else { return false }
      if !saved {
        errorMessage = "Couldn’t update the channel. Try again."
      }
      return saved
    } catch {
      guard !Task.isCancelled, !(error is CancellationError) else { return false }
      errorMessage = friendlyMessage(for: error, mode: .coreMessage)
      return false
    }
  }
}
