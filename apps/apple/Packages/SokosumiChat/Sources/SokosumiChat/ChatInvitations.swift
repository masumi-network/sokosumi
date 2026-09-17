import Combine
import CoreAPI
import Foundation

public enum InvitationAction: Sendable {
  case accept, decline
}

/// One invitation response at a time, like web's single `respondingInvitation` across the External rows.
public struct InvitationResponse: Equatable, Sendable {
  public let invitationId: String
  public let action: InvitationAction

  public init(invitationId: String, action: InvitationAction) {
    self.invitationId = invitationId
    self.action = action
  }
}

/// Web `organization-chat-list.client.tsx` External section: pending rows above joined external rooms, refreshed on
/// mount and recovery in every workspace. Loads fail soft; a local accept/decline wins over an older response.
@MainActor
public final class PendingInvitations: ObservableObject {
  @Published public private(set) var invitations: [Components.Schemas.ChatRoomInvitation] = []
  private var generation = 0

  public init() {}

  public func load(using fetch: () async throws -> [Components.Schemas.ChatRoomInvitation]) async {
    generation += 1
    let attempt = generation
    guard let loaded = try? await fetch(), attempt == generation, !Task.isCancelled else { return }
    invitations = loaded
  }

  public func reset() {
    generation += 1
    invitations = []
  }

  public func remove(id: String) {
    generation += 1
    invitations.removeAll { $0.id == id }
  }
}

/// Web `/chat/invites/{id}` (`page.tsx` + `chat-room-invitation-card.tsx`): expired invitations and 403/404 lookups
/// render error cards; accepted, declined and revoked invitations render their closed card.
public enum InvitationPresentation: Equatable, Sendable {
  case pending(Components.Schemas.ChatRoomInvitation)
  case accepted(Components.Schemas.ChatRoomInvitation)
  case declined(Components.Schemas.ChatRoomInvitation)
  case revoked(Components.Schemas.ChatRoomInvitation)
  case expired
  case notFound

  public init(_ invitation: Components.Schemas.ChatRoomInvitation) {
    switch invitation.status {
    case .pending: self = .pending(invitation)
    case .accepted: self = .accepted(invitation)
    case .declined: self = .declined(invitation)
    case .revoked: self = .revoked(invitation)
    case .expired: self = .expired
    }
  }
}

@MainActor
public final class InvitationDetail: ObservableObject {
  public let id: String
  @Published public private(set) var presentation: InvitationPresentation?
  @Published public private(set) var loading = false
  @Published public private(set) var loadError: String?
  @Published public private(set) var responding: InvitationAction?
  @Published public private(set) var responseError: String?
  private var generation = 0

  public init(id: String) {
    self.id = id
  }

  public func load(using fetch: (String) async throws -> Components.Schemas.ChatRoomInvitation) async {
    generation += 1
    let attempt = generation
    loading = true
    loadError = nil
    defer {
      if attempt == generation {
        loading = false
      }
    }
    do {
      let invitation = try await fetch(id)
      guard attempt == generation, !Task.isCancelled else { return }
      presentation = InvitationPresentation(invitation)
    } catch {
      guard attempt == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      // Web's `getInvitation` treats 403/404 as "not found"; other failures are retryable.
      if case let ChatServiceError.unprocessable(status, _) = error, status == 403 || status == 404 {
        presentation = .notFound
      } else {
        loadError = friendlyMessage(for: error)
      }
    }
  }

  /// Web disables both buttons while one request runs and re-enables them only on failure, showing Core's message.
  public func respond(_ action: InvitationAction, using respond: (InvitationAction, String) async throws -> Bool) async -> Bool {
    guard responding == nil, case .pending = presentation else { return false }
    responding = action
    responseError = nil
    defer { responding = nil }
    do {
      return try await respond(action, id)
    } catch {
      guard !Task.isCancelled, !(error is CancellationError) else { return false }
      responseError = channelErrorMessage(error)
      return false
    }
  }
}

/// Web `/chat/join/{token}` (`page.tsx`, `chat-join-card.tsx`, `chat-join-actions.tsx`): a public preview, then a
/// guest join for the signed-in user. Web keeps "Joining…" until navigation replaces the page and re-enables the
/// button only on failure.
@MainActor
public final class GuestJoin: ObservableObject {
  public let token: String
  @Published public private(set) var link: Components.Schemas.ResolveChatRoomGuestInviteLink?
  @Published public private(set) var loading = false
  @Published public private(set) var loadError: String?
  @Published public private(set) var joining = false
  @Published public private(set) var joinError: String?
  private var generation = 0

  public init(token: String) {
    self.token = token
  }

  public var room: Components.Schemas.ResolveChatRoomGuestInviteLink.RoomPayload? {
    guard let link, link.status == .valid else { return nil }
    return link.room
  }

  public func resolve(using fetch: (String) async throws -> Components.Schemas.ResolveChatRoomGuestInviteLink) async {
    generation += 1
    let attempt = generation
    loading = true
    loadError = nil
    defer {
      if attempt == generation {
        loading = false
      }
    }
    do {
      let resolved = try await fetch(token)
      guard attempt == generation, !Task.isCancelled else { return }
      link = resolved
    } catch {
      guard attempt == generation, !Task.isCancelled, !(error is CancellationError) else { return }
      loadError = friendlyMessage(for: error)
    }
  }

  public func join(using join: (String) async throws -> Bool) async -> Bool {
    guard !joining, room != nil else { return false }
    joining = true
    joinError = nil
    do {
      let joined = try await join(token)
      if !joined {
        joining = false
      }
      return joined
    } catch {
      joining = false
      guard !Task.isCancelled, !(error is CancellationError) else { return false }
      joinError = channelErrorMessage(error)
      return false
    }
  }
}
