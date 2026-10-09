import CoreAPI
import Foundation
import OpenAPIRuntime

/// UI-free workspace + rooms + transcript + classic send.
/// Only a non-empty workspaces list continues into chat. Personal omits `X-Organization-Slug`;
/// organizations send it. Unread chrome trusts Core; never zero it locally.
public struct ChatService: Sendable {
  static let roomListLimit = 100
  static let roomListMaxPages = 50

  public init() {}

  /// `GET /users/me/workspaces`.
  private func fetchWorkspaces(client: Client) async throws -> Components.Schemas.UserWorkspaces {
    let response = try await client.getUsersIdWorkspaces(.init(path: .init(id: "me")))
    switch response {
    case let .ok(okResponse):
      return try okResponse.body.json.data
    case let .badRequest(value):
      throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value):
      throw try unauthorized(value.body.json.message)
    case let .forbidden(forbidden):
      throw try rejected(status: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try rejected(status: 404, message: notFound.body.json.message)
    case let .internalServerError(serverError):
      throw try rejected(status: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// `PUT /users/me/workspaces/preferred`: the workspace a new session opens.
  func setPreferredWorkspace(client: Client, workspaceId: String) async throws {
    let response = try await client.putUsersIdWorkspacesPreferred(
      .init(path: .init(id: "me"), body: .json(.init(workspaceId: workspaceId)))
    )
    switch response {
    case .ok:
      return
    case let .unauthorized(value):
      throw try unauthorized(value.body.json.message)
    case let .forbidden(forbidden):
      throw try rejected(status: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try rejected(status: 404, message: notFound.body.json.message)
    case let .unprocessableContent(invalid):
      throw try rejected(status: 422, message: invalid.body.json.message)
    case let .internalServerError(serverError):
      throw try rejected(status: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// Session user (`GET /users/me`): id excludes yourself from Direct
  /// display names, name/email feed the "me" section and Settings.
  private func fetchCurrentUser(client: Client) async throws -> Components.Schemas.User {
    let response = try await client.getUsersId(.init(path: .init(id: "me")))
    switch response {
    case let .ok(okResponse):
      return try okResponse.body.json.data
    case let .badRequest(value):
      throw try rejected(status: 400, message: value.body.json.message)
    case let .unauthorized(value):
      throw try unauthorized(value.body.json.message)
    case let .forbidden(forbidden):
      throw try rejected(status: 403, message: forbidden.body.json.message)
    case let .notFound(notFound):
      throw try rejected(status: 404, message: notFound.body.json.message)
    case let .internalServerError(serverError):
      throw try rejected(status: 500, message: serverError.body.json.message)
    case let .undocumented(statusCode, payload):
      throw await unprocessableError(statusCode: statusCode, payload: payload)
    }
  }

  /// Restores the server-selected workspace without writing a preference.
  func loadInitialState(client: Client) async throws -> InitialWorkspaceState {
    let workspaces = try await fetchWorkspaces(client: client)
    if let gate = WorkspaceGate(workspaces) {
      throw ChatServiceError.blocked(gate)
    }
    let user = try await fetchCurrentUser(client: client)
    let options = workspaces.workspaces.compactMap(WorkspaceSession.Option.init)
    let preferred = workspaces.workspaces.first(where: \.preferred).flatMap(WorkspaceSession.Option.init)
    guard let selection = preferred ?? options.first else {
      throw ChatServiceError.unexpectedResponse("Workspace access changed. Try again.")
    }
    return .init(options: options, currentUser: user, defaultSelection: selection)
  }

  /// Explicit user switch only: persist the preference, then reload rooms
  /// under the new workspace. If rooms fail after a successful PUT, restore
  /// `previous` so Core does not keep a preference the UI never committed.
  func switchWorkspace(
    client: Client,
    to option: WorkspaceSession.Option,
    previous: WorkspaceSession.Option? = nil
  ) async throws -> [Components.Schemas.ChatRoom] {
    try Task.checkCancellation()
    try await setPreferredWorkspace(client: client, workspaceId: option.workspaceId)
    do {
      try Task.checkCancellation()
      let rooms = try await listRooms(client: client, organizationSlug: option.workspace.organizationSlug)
      try Task.checkCancellation()
      return rooms
    } catch {
      if let previous, !Task.isCancelled {
        try? await setPreferredWorkspace(client: client, workspaceId: previous.workspaceId)
      }
      throw error
    }
  }

  /// `GET /chats/rooms` walked to completion. Nil slug omits the org header
  /// (personal); a slug sends `X-Organization-Slug`. Web's archived list walks
  /// the same route with `kind=channel&status=archived`.
  func listRooms(
    client: Client,
    organizationSlug: String?,
    kind: Components.Schemas.ChatRoomKind? = nil,
    status: Components.Schemas.ChatRoomListStatus = .active
  ) async throws -> [Components.Schemas.ChatRoom] {
    var rooms: [Components.Schemas.ChatRoom] = []
    var cursor: String?
    for _ in 0 ..< Self.roomListMaxPages {
      let response = try await client.getChatsRooms(
        .init(
          query: .init(
            cursor: cursor,
            limit: Self.roomListLimit,
            kind: kind,
            status: status
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
      case let .unauthorized(value):
        throw try unauthorized(value.body.json.message)
      case let .badRequest(badRequest):
        throw try rejected(status: 400, message: badRequest.body.json.message)
      case let .forbidden(forbidden):
        throw try rejected(status: 403, message: forbidden.body.json.message)
      case let .notFound(notFound):
        throw try rejected(status: 404, message: notFound.body.json.message)
      case let .internalServerError(serverError):
        throw try rejected(status: 500, message: serverError.body.json.message)
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

  func unauthorized(_ message: String) -> ChatServiceError {
    ChatServiceError.unauthorized(message)
  }

  func rejected(status: Int, message: String) -> ChatServiceError {
    .unprocessable(statusCode: status, message: message)
  }
}
