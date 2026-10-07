import Combine
import CoreAPI
import Foundation

/// The members panel's Add picker (SOK-1258): organization people, Coworkers and the caller's own Soko Bot who are
/// not in the Channel yet, added together in one request. A failed member page hides only People (web
/// `participant-checkboxes.tsx`); Coworkers and the assistant still add.
@MainActor
public final class ChannelMemberAddition: ObservableObject {
  @Published public private(set) var room: Components.Schemas.ChatRoom
  @Published public var query = ""
  @Published public var selection: Set<DirectRecipient> = []
  @Published public private(set) var roster: ChatRecipientRoster?
  @Published public private(set) var loading = false
  @Published public private(set) var adding = false
  @Published public private(set) var errorMessage: String?
  private var loadGeneration = 0

  public init(room: Components.Schemas.ChatRoom) {
    self.room = room
  }

  /// Everyone already in the Channel, Guests included, never shows in the picker.
  public static func members(of room: Components.Schemas.ChatRoom) -> Set<DirectRecipient> {
    let humans = room.userMembers.map { DirectRecipient.human($0.id) }
    return Set(humans + room.coworkerMembers.map { .coworker($0.id) } + room.sokoBotMembers.map { .sokoBot($0.id) })
  }

  /// Someone added from another window drops out of the list and the selection.
  public func updateRoom(_ room: Components.Schemas.ChatRoom) {
    guard room.id == self.room.id, room != self.room else { return }
    self.room = room
    selection.subtract(Self.members(of: room))
  }

  public var sections: [ChatRecipientSection] {
    let sections = roster?.sections(query: query, excluding: Self.members(of: room)) ?? []
    return [ChatRecipientSection.Kind.people, .coworkers, .assistant].compactMap { kind in sections.first { $0.id == kind } }
  }

  public var membersLoadFailed: Bool {
    roster?.membersLoadFailed == true
  }

  /// Web's "Everyone you can add is already in this channel": a loaded roster, whatever the query, offers nobody. A
  /// failed member page is not that, since people may still be missing.
  public var nobodyToAdd: Bool {
    guard let roster, !roster.membersLoadFailed else { return false }
    return roster.sections(query: "", excluding: Self.members(of: room)).isEmpty
  }

  public var canAdd: Bool {
    !loading && !adding && roster != nil && !selection.isEmpty && ChannelEditPermissions.isEditable(room)
  }

  public func load(using fetch: () async throws -> ChatRecipientRoster) async {
    guard !adding else { return }
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
      errorMessage = friendlyMessage(for: error, mode: .coreMessage)
    }
  }

  /// The submit closure answers false when the coordinator refused to start (another channel mutation is running).
  public func add(using submit: (Set<DirectRecipient>) async throws -> Bool) async -> Bool {
    guard canAdd else { return false }
    adding = true
    errorMessage = nil
    defer { adding = false }
    do {
      let added = try await submit(selection)
      guard !Task.isCancelled else { return false }
      if added {
        selection = []
      } else {
        errorMessage = "Couldn’t add members. Try again."
      }
      return added
    } catch {
      guard !Task.isCancelled, !(error is CancellationError) else { return false }
      errorMessage = friendlyMessage(for: error, mode: .coreMessage)
      return false
    }
  }
}
