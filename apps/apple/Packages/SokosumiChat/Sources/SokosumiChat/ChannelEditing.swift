import Combine
import CoreAPI
import Foundation

/// Web `rooms-client.tsx`: host channel members rewrite the roster; guests and
/// matched channels cannot. Name/topic/visibility need an organization owner
/// or admin. Core enforces the same split; this only shapes the UI.
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
    room.kind == .channel && room.organizationId != nil && room.myAccess != .guest && room.discoverability != .matched
  }
}

public struct ChannelEditDraft: Equatable, Sendable {
  public private(set) var name: String
  public private(set) var topic: String
  public var visibility: ChannelDraft.Visibility
  public var recipients: Set<DirectRecipient>

  public init(room: Components.Schemas.ChatRoom) {
    name = room.name
    topic = room.topic ?? ""
    visibility = ChannelDraft.Visibility(rawValue: room.discoverability?.rawValue ?? "") ?? .public
    // Host-org roster only: guests are room-scoped and must never be sent as memberUserIds (web `hostRosterUserIds`).
    let humans = room.userMembers.filter { $0.access?.value1 != .guest }.map { DirectRecipient.human($0.id) }
    recipients = Set(humans + room.coworkerMembers.map { .coworker($0.id) } + room.sokoBotMembers.map { .sokoBot($0.id) })
  }

  public var isValid: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  public mutating func setName(_ raw: String) {
    name = ChannelDraft.limit(raw, to: 80)
  }

  public mutating func setTopic(_ raw: String) {
    topic = ChannelDraft.limit(raw, to: 200)
  }
}

@MainActor
public final class ChannelEditing: ObservableObject {
  public let room: Components.Schemas.ChatRoom
  @Published public var draft: ChannelEditDraft
  @Published public var query = ""
  @Published public private(set) var roster: ChannelRoster?
  @Published public private(set) var loading = false
  @Published public private(set) var saving = false
  @Published public private(set) var errorMessage: String?
  private var loadGeneration = 0

  public init(room: Components.Schemas.ChatRoom) {
    self.room = room
    draft = ChannelEditDraft(room: room)
  }

  public var permissions: ChannelEditPermissions? {
    roster.map { ChannelEditPermissions(room: room, isOwnerOrAdmin: $0.isOwnerOrAdmin) }
  }

  public var sections: [ChatRecipientSection] {
    let sections = roster?.recipients.sections(query: query) ?? []
    return [ChatRecipientSection.Kind.people, .coworkers, .assistant].compactMap { kind in sections.first { $0.id == kind } }
  }

  public var canSave: Bool {
    !loading && !saving && roster?.recipients.membersLoadFailed == false && permissions?.canEditMembers == true && draft.isValid
  }

  public func load(using fetch: () async throws -> ChannelRoster) async {
    guard !saving else { return }
    loadGeneration += 1
    let attempt = loadGeneration
    loading = true
    errorMessage = nil
    defer {
      if attempt == loadGeneration {
        loading = false
      }
    }
    do {
      let result = try await fetch()
      guard attempt == loadGeneration, !Task.isCancelled else { return }
      roster = result
    } catch {
      guard attempt == loadGeneration, !Task.isCancelled, !(error is CancellationError) else { return }
      roster = nil
      errorMessage = chatErrorMessage(error)
    }
  }

  public func save(using submit: (ChannelEditDraft, ChannelEditPermissions) async throws -> Bool) async -> Bool {
    guard canSave, let permissions else { return false }
    saving = true
    errorMessage = nil
    defer { saving = false }
    do {
      let saved = try await submit(draft, permissions)
      guard !Task.isCancelled else { return false }
      if !saved {
        errorMessage = "Couldn’t update the channel. Try again."
      }
      return saved
    } catch {
      guard !Task.isCancelled, !(error is CancellationError) else { return false }
      errorMessage = chatErrorMessage(error)
      return false
    }
  }
}
