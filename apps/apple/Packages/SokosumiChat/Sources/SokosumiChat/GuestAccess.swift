import Combine
import CoreAPI
import Foundation

public extension ChannelEditPermissions {
  /// Web `rooms-client.tsx`: host members (`myAccess == member`) of an external channel invite guests; guests never do.
  static func canInviteGuests(_ room: Components.Schemas.ChatRoom) -> Bool {
    room.kind == .channel && room.myAccess == .member && room.discoverability == .external
  }
}

/// Web `guest-invite-section.tsx` link form: expiry and max-uses presets, defaulting to 7 days and unlimited uses.
public struct GuestInviteLinkOptions: Equatable, Sendable {
  /// Days until expiry; nil is "No expiry".
  public static let expiryPresets: [Int?] = [1, 7, 30, 90, nil]
  /// Cap on guest joins; nil is "Unlimited".
  public static let maxUsesPresets: [Int?] = [nil, 1, 5, 10, 25, 50, 100]

  public var expiresInDays: Int?
  public var maxUses: Int?

  public init(expiresInDays: Int? = 7, maxUses: Int? = nil) {
    self.expiresInDays = expiresInDays
    self.maxUses = maxUses
  }
}

public struct GuestAccessSnapshot: Equatable, Sendable {
  public let invitations: [Components.Schemas.ChatRoomInvitation]
  public let links: [Components.Schemas.ChatRoomGuestInviteLink]

  public init(invitations: [Components.Schemas.ChatRoomInvitation], links: [Components.Schemas.ChatRoomGuestInviteLink]) {
    self.invitations = invitations
    self.links = links
  }
}

public extension Components.Schemas.ChatRoomGuestInviteLink {
  /// Web `linkMetaUses` / `linkMetaUsesUnlimited`.
  var usageSummary: String {
    if let maxUses {
      return "\(useCount) / \(maxUses) uses"
    }
    return "\(useCount) \(useCount == 1 ? "use" : "uses") · unlimited"
  }
}

/// Same addresses Core's email check refuses, so they never leave the client.
func isValidGuestEmail(_ email: String) -> Bool {
  let pattern = #/^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/#
  return email.wholeMatch(of: pattern) != nil
}

/// Mounted per open settings dialog, so every open refetches pending invitations and
/// live links; each row action is single-flight; failures surface Core's message; the guest list starts from the room
/// DTO and drops removed guests locally. A local edit wins over an older load response.
@MainActor
public final class GuestAccess: ObservableObject {
  public let roomId: String
  @Published public private(set) var guests: [Components.Schemas.ChatRoomUserParticipant]
  @Published public private(set) var invitations: [Components.Schemas.ChatRoomInvitation] = []
  @Published public private(set) var links: [Components.Schemas.ChatRoomGuestInviteLink] = []
  @Published public private(set) var loading = false
  @Published public private(set) var loadFailed = false
  @Published public var email = ""
  @Published public var linkOptions = GuestInviteLinkOptions()
  @Published public private(set) var sendingInvite = false
  @Published public private(set) var creatingLink = false
  @Published public private(set) var revokingInvitationId: String?
  @Published public private(set) var revokingLinkToken: String?
  @Published public private(set) var removingGuestId: String?
  @Published public private(set) var errorMessage: String?
  private var generation = 0

  public init(room: Components.Schemas.ChatRoom) {
    roomId = room.id
    guests = room.userMembers.filter { $0.access?.value1 == .guest }
  }

  public var canSendInvite: Bool {
    !sendingInvite && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  /// Both lists load together; either failing shows web's load error with Retry and empties both.
  public func load(using fetch: () async throws -> GuestAccessSnapshot) async {
    generation += 1
    let attempt = generation
    loading = true
    loadFailed = false
    defer {
      if attempt == generation {
        loading = false
      }
    }
    do {
      let snapshot = try await fetch()
      guard attempt == generation, !Task.isCancelled else { return }
      invitations = snapshot.invitations.filter { $0.status == .pending }
      // Expired or depleted links stay visible for audit until the host revokes them.
      links = snapshot.links.filter { $0.revokedAt == nil }
    } catch {
      guard attempt == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      loadFailed = true
      invitations = []
      links = []
    }
  }

  /// Web trims and lower-cases the address, refuses invalid ones before sending, then prepends the new invitation.
  @discardableResult
  public func invite(using send: (String) async throws -> Components.Schemas.ChatRoomInvitation) async -> Bool {
    guard canSendInvite else { return false }
    let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard isValidGuestEmail(address) else {
      errorMessage = "Enter a valid email address."
      return false
    }
    sendingInvite = true
    errorMessage = nil
    defer { sendingInvite = false }
    do {
      let invitation = try await send(address)
      guard !Task.isCancelled else { return false }
      generation += 1
      email = ""
      if !invitations.contains(where: { $0.id == invitation.id }) {
        invitations.insert(invitation, at: 0)
      }
      return true
    } catch {
      return record(error)
    }
  }

  public func revokeInvitation(_ id: String, using revoke: (String) async throws -> Void) async {
    guard revokingInvitationId == nil else { return }
    revokingInvitationId = id
    errorMessage = nil
    defer { revokingInvitationId = nil }
    do {
      try await revoke(id)
      guard !Task.isCancelled else { return }
      generation += 1
      invitations.removeAll { $0.id == id }
    } catch {
      record(error)
    }
  }

  /// Returns the new link so the caller can copy it, like web's create-and-copy.
  public func createLink(using create: (GuestInviteLinkOptions) async throws -> Components.Schemas.ChatRoomGuestInviteLink) async -> Components.Schemas.ChatRoomGuestInviteLink? {
    guard !creatingLink else { return nil }
    creatingLink = true
    errorMessage = nil
    defer { creatingLink = false }
    do {
      let link = try await create(linkOptions)
      guard !Task.isCancelled else { return nil }
      generation += 1
      links.insert(link, at: 0)
      return link
    } catch {
      record(error)
      return nil
    }
  }

  public func revokeLink(_ token: String, using revoke: (String) async throws -> Void) async {
    guard revokingLinkToken == nil else { return }
    revokingLinkToken = token
    errorMessage = nil
    defer { revokingLinkToken = nil }
    do {
      try await revoke(token)
      guard !Task.isCancelled else { return }
      generation += 1
      links.removeAll { $0.token == token }
    } catch {
      record(error)
    }
  }

  /// The remove closure answers false when the coordinator refused to start (another channel mutation is running).
  public func removeGuest(_ userId: String, using remove: (String) async throws -> Bool) async {
    guard removingGuestId == nil else { return }
    removingGuestId = userId
    errorMessage = nil
    defer { removingGuestId = nil }
    do {
      let removed = try await remove(userId)
      guard !Task.isCancelled else { return }
      if removed {
        guests.removeAll { $0.id == userId }
      } else {
        errorMessage = "Couldn’t remove the guest. Try again."
      }
    } catch {
      record(error)
    }
  }

  @discardableResult
  private func record(_ error: Error) -> Bool {
    guard !Task.isCancelled, !(error is CancellationError) else { return false }
    errorMessage = chatErrorMessage(error)
    return false
  }
}
