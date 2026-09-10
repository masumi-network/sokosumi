import CoreAPI
import Foundation
import OpenAPIRuntime

/// UI-free workspace + rooms + transcript + classic send (SOK-973–975).
///
/// Workspace and room rules: only `ready` continues into chat; personal
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
    case let .ok(okResponse):
      return try okResponse.body.json.data
    case let .unauthorized(unauthorized):
      throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
    case let .forbidden(forbidden):
      throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try ChatServiceError.unprocessable(statusCode: 404, message: notFound.body.json.message)
    case let .internalServerError(serverError):
      throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `GET /users/me/organizations`.
  public func fetchOrganizations(client: Client) async throws -> [Components.Schemas.Organization] {
    let response = try await client.getUsersIdOrganizations(
      .init(path: .init(id: "me"))
    )
    switch response {
    case let .ok(okResponse):
      return try okResponse.body.json.data
    case let .unauthorized(unauthorized):
      throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
    case let .forbidden(forbidden):
      throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try ChatServiceError.unprocessable(statusCode: 404, message: notFound.body.json.message)
    case let .internalServerError(serverError):
      throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
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
    case let .unauthorized(unauthorized):
      throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
    case let .badRequest(badRequest):
      throw try ChatServiceError.unprocessable(statusCode: 400, message: badRequest.body.json.message)
    case let .forbidden(forbidden):
      throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try ChatServiceError.unprocessable(statusCode: 404, message: notFound.body.json.message)
    case let .unprocessableContent(invalid):
      throw try ChatServiceError.unprocessable(statusCode: 422, message: invalid.body.json.message)
    case let .internalServerError(serverError):
      throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// Session user (`GET /users/me`): id excludes yourself from Direct
  /// display names, name/email feed the "me" section and Settings.
  public func fetchCurrentUser(client: Client) async throws -> Components.Schemas.User {
    let response = try await client.getUsersId(.init(path: .init(id: "me")))
    switch response {
    case let .ok(okResponse):
      return try okResponse.body.json.data
    case let .unauthorized(unauthorized):
      throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
    case let .forbidden(forbidden):
      throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try ChatServiceError.unprocessable(statusCode: 404, message: notFound.body.json.message)
    case let .internalServerError(serverError):
      throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// Restores the server-selected workspace without writing a preference.
  public func loadInitialState(client: Client) async throws -> InitialWorkspaceState {
    let access = try await fetchAccess(client: client)
    guard access.gate == .ready else { throw ChatServiceError.blocked(access.gate) }
    let organizations = try await fetchOrganizations(client: client)
    let user = try await fetchCurrentUser(client: client)
    let organizationId = try await fetchPreferredOrganization(client: client)
    let selection: WorkspaceSelection
    if let organizationId, let organization = organizations.first(where: { $0.id == organizationId }) {
      selection = .organization(id: organization.id, slug: organization.slug)
    } else if organizationId == nil, access.hasPersonalWorkspace {
      selection = .personal
    } else {
      // Membership may change between the reads. Retry the whole gate instead
      // of inventing a personal workspace or reusing an inaccessible selection.
      throw ChatServiceError.unexpectedResponse("Workspace access changed. Try again.")
    }
    return .init(access: access, organizations: organizations, currentUser: user, defaultSelection: selection)
  }

  public func fetchPreferredOrganization(client: Client) async throws -> String? {
    let response = try await client.getUsersIdPreferredOrganization(.init(path: .init(id: "me")))
    switch response {
    case let .ok(value): return try value.body.json.data.organizationId
    case let .unauthorized(value): throw try ChatServiceError.unauthorized(value.body.json.message)
    case let .forbidden(value): throw try ChatServiceError.unprocessable(statusCode: 403, message: value.body.json.message)
    case let .notFound(value): throw try ChatServiceError.unprocessable(statusCode: 404, message: value.body.json.message)
    case let .internalServerError(value): throw try ChatServiceError.unprocessable(statusCode: 500, message: value.body.json.message)
    case let .undocumented(code, payload): throw await unprocessableError(statusCode: code, payload: payload)
    }
  }

  /// Explicit user switch only: persist the preference, then reload rooms
  /// under the new workspace. If rooms fail after a successful PUT, restore
  /// `previous` so Core does not keep a preference the UI never committed.
  public func switchWorkspace(
    client: Client,
    selection: WorkspaceSelection,
    previous: WorkspaceSelection? = nil
  ) async throws -> [Components.Schemas.ChatRoom] {
    try Task.checkCancellation()
    try await setPreferredOrganization(client: client, organizationId: selection.organizationId)
    do {
      try Task.checkCancellation()
      let rooms = try await listRooms(client: client, organizationSlug: selection.organizationSlug)
      try Task.checkCancellation()
      return rooms
    } catch {
      if let previous, !Task.isCancelled {
        try? await setPreferredOrganization(client: client, organizationId: previous.organizationId)
      }
      throw error
    }
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
    for _ in 0 ..< Self.roomListMaxPages {
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
      case let .ok(okResponse):
        let payload = try okResponse.body.json
        let nextCursor = payload.meta.pagination.nextCursor
        if let current = cursor, nextCursor == current {
          return rooms
        }
        rooms.append(contentsOf: payload.data)
        guard let next = nextCursor else {
          return rooms
        }
        cursor = next
      case let .unauthorized(unauthorized):
        throw try ChatServiceError.unauthorized(unauthorized.body.json.message)
      case let .badRequest(badRequest):
        throw try ChatServiceError.unprocessable(statusCode: 400, message: badRequest.body.json.message)
      case let .forbidden(forbidden):
        throw try ChatServiceError.unprocessable(statusCode: 403, message: forbidden.body.json.message)
      case let .notFound(notFound):
        throw try ChatServiceError.unprocessable(statusCode: 404, message: notFound.body.json.message)
      case let .internalServerError(serverError):
        throw try ChatServiceError.unprocessable(statusCode: 500, message: serverError.body.json.message)
      case let .undocumented(statusCode, payload):
        throw await unprocessableError(statusCode: statusCode, payload: payload)
      }
    }
    return rooms
  }

  /// Best-effort short message for undocumented statuses: Core's `{message}`
  /// when the body parses, otherwise just the rejection.
  func unprocessableError(
    statusCode: Int,
    payload: OpenAPIRuntime.UndocumentedPayload
  ) async -> ChatServiceError {
    if let body = payload.body,
       let bytes = try? await Array(collecting: body, upTo: 8192),
       let json = try? JSONSerialization.jsonObject(with: Data(bytes)) as? [String: Any],
       let message = json["message"] as? String,
       !message.isEmpty {
      return .unprocessable(statusCode: statusCode, message: message)
    }
    return .unprocessable(statusCode: statusCode, message: "Core rejected the request.")
  }
}
