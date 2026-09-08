import CoreAPI
import Foundation
import OpenAPIRuntime

/// UI-free workspace + rooms flow for SOK-973 (Mac tracer).
///
/// Rules from `MAC-TRACER.md`: only `ready` continues into chat; personal
/// omits `X-Organization-Slug` while organizations send it; rooms walk Core
/// pages (`status=active`) like web's membership-visible walk; unread chrome
/// trusts Core's `unreadCount` / `unreadMentionCount` (ADR 0013 leftover
/// thread unread keeps a room bold — never zeroed locally).
public struct ChatService: Sendable {
  private static let roomListLimit = 100
  private static let roomListMaxPages = 50

  public init() {}

  /// `GET /users/me/workspace-access`.
  public func fetchAccess(client: Client) async throws -> Components.Schemas.WorkspaceAccess {
    let response = try await client.getUsersIdWorkspaceAccess(
      .init(path: .init(id: "me"))
    )
    switch response {
    case .ok(let ok):
      return try ok.body.json.data
    case .unauthorized(let unauthorized):
      throw ChatServiceError.unauthorized(try unauthorized.body.json.message)
    case .undocumented(let statusCode, let payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    default:
      throw ChatServiceError.unexpectedResponse(String(describing: response))
    }
  }

  /// `GET /users/me/organizations`.
  public func fetchOrganizations(client: Client) async throws -> [Components.Schemas.Organization] {
    let response = try await client.getUsersIdOrganizations(
      .init(path: .init(id: "me"))
    )
    switch response {
    case .ok(let ok):
      return try ok.body.json.data
    case .unauthorized(let unauthorized):
      throw ChatServiceError.unauthorized(try unauthorized.body.json.message)
    case .undocumented(let statusCode, let payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    default:
      throw ChatServiceError.unexpectedResponse(String(describing: response))
    }
  }

  /// `PUT /users/me/preferred-organization`. Nil id selects personal.
  public func setPreferredOrganization(
    client: Client,
    organizationId: String?
  ) async throws {
    let response = try await client.putUsersIdPreferredOrganization(
      .init(
        path: .init(id: "me"),
        body: .json(.init(organizationId: organizationId))
      )
    )
    switch response {
    case .ok:
      return
    case .unauthorized(let unauthorized):
      throw ChatServiceError.unauthorized(try unauthorized.body.json.message)
    case .undocumented(let statusCode, let payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    default:
      throw ChatServiceError.unexpectedResponse(String(describing: response))
    }
  }

  /// Session user (`GET /users/me`): id excludes yourself from Direct
  /// display names, name/email feed the "me" section and Settings.
  public func fetchCurrentUser(client: Client) async throws -> Components.Schemas.User {
    let response = try await client.getUsersId(.init(path: .init(id: "me")))
    switch response {
    case .ok(let ok):
      return try ok.body.json.data
    case .unauthorized(let unauthorized):
      throw ChatServiceError.unauthorized(try unauthorized.body.json.message)
    case .undocumented(let statusCode, let payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    default:
      throw ChatServiceError.unexpectedResponse(String(describing: response))
    }
  }

  /// Launch read: access gate, organizations, and user. Performs no
  /// writes — the caller restores `savedWorkspaceId` locally without
  /// persisting it (persistence itself is the caller's job).
  public func loadInitialState(
    client: Client,
    savedWorkspaceId: String? = nil
  ) async throws -> InitialWorkspaceState {
    // Sequential: deterministic against stub transports, and three small
    // reads are cheap next to the rooms walk that follows. Gate first:
    // anything other than `ready` throws `.blocked` without further calls.
    let resolvedAccess = try await fetchAccess(client: client)
    guard resolvedAccess.gate == .ready else {
      throw ChatServiceError.blocked(resolvedAccess.gate)
    }
    let resolvedOrganizations = try await fetchOrganizations(client: client)
    let resolvedUser = try await fetchCurrentUser(client: client)
    return .init(
      access: resolvedAccess,
      organizations: resolvedOrganizations,
      currentUser: resolvedUser,
      defaultSelection: resolveInitialSelection(
        hasPersonalWorkspace: resolvedAccess.hasPersonalWorkspace,
        organizations: resolvedOrganizations,
        savedId: savedWorkspaceId
      )
    )
  }

  /// Explicit user switch only: persist the preference, then reload rooms
  /// under the new workspace.
  public func switchWorkspace(
    client: Client,
    selection: WorkspaceSelection
  ) async throws -> [Components.Schemas.ChatRoom] {
    try await setPreferredOrganization(client: client, organizationId: selection.organizationId)
    return try await listRooms(client: client, organizationSlug: selection.organizationSlug)
  }

  /// Gate first: anything other than `ready` throws `.blocked` without
  /// touching the rooms endpoint.
  public func loadRoomsIfReady(
    client: Client,
    organizationSlug: String?
  ) async throws -> [Components.Schemas.ChatRoom] {
    let access = try await fetchAccess(client: client)
    guard access.gate == .ready else {
      throw ChatServiceError.blocked(access.gate)
    }
    return try await listRooms(client: client, organizationSlug: organizationSlug)
  }

  /// `GET /chats/rooms` walked to completion. Nil slug omits the org header
  /// (personal); a slug sends `X-Organization-Slug`.
  public func listRooms(
    client: Client,
    organizationSlug: String?
  ) async throws -> [Components.Schemas.ChatRoom] {
    var rooms: [Components.Schemas.ChatRoom] = []
    var cursor: String?
    for _ in 0..<Self.roomListMaxPages {
      let response = try await client.getChatsRooms(
        .init(
          query: .init(
            cursor: cursor,
            limit: Self.roomListLimit,
            status: .active
          ),
          headers: .init(xOrganizationSlug: organizationSlug)
        )
      )
      switch response {
      case .ok(let ok):
        let payload = try ok.body.json
        rooms.append(contentsOf: payload.data)
        let nextCursor = payload.meta.pagination.nextCursor
        if let current = cursor, nextCursor == current {
          return rooms
        }
        guard let next = nextCursor else {
          return rooms
        }
        cursor = next
      case .unauthorized(let unauthorized):
        throw ChatServiceError.unauthorized(try unauthorized.body.json.message)
      case .undocumented(let statusCode, let payload):
        throw await unprocessableError(statusCode: statusCode, payload: payload)
      default:
        throw ChatServiceError.unexpectedResponse(String(describing: response))
      }
    }
    return rooms
  }

  /// Best-effort short message for undocumented statuses: Core's `{message}`
  /// when the body parses, otherwise just the rejection.
  private func unprocessableError(
    statusCode: Int,
    payload: OpenAPIRuntime.UndocumentedPayload
  ) async -> ChatServiceError {
    if let body = payload.body,
      let bytes = try? await Array(collecting: body, upTo: 8_192),
      let json = try? JSONSerialization.jsonObject(with: Data(bytes)) as? [String: Any],
      let message = json["message"] as? String,
      !message.isEmpty
    {
      return .unprocessable(statusCode: statusCode, message: message)
    }
    return .unprocessable(statusCode: statusCode, message: "Core rejected the request.")
  }
}
