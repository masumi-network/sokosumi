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
    try await call { try await client.getUsersIdWorkspaces(.init(path: .init(id: "me"))) }.ok.body.json.data
  }

  /// `PUT /users/me/workspaces/preferred`: the workspace a new session opens.
  func setPreferredWorkspace(client: Client, workspaceId: String) async throws {
    _ = try await call {
      try await client.putUsersIdWorkspacesPreferred(
        .init(path: .init(id: "me"), body: .json(.init(workspaceId: workspaceId)))
      )
    }.ok
  }

  /// Session user (`GET /users/me`): id excludes yourself from Direct
  /// display names, name/email feed the "me" section and Settings.
  private func fetchCurrentUser(client: Client) async throws -> Components.Schemas.User {
    try await call { try await client.getUsersId(.init(path: .init(id: "me"))) }.ok.body.json.data
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
      let okResponse = try await call {
        try await client.getChatsRooms(
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
      }.ok
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
    }
    return rooms
  }

  /// Runs one generated operation. The generated client wraps `CoreErrorMiddleware`'s `ChatServiceError` and
  /// `ClientBuildMiddleware`'s `CoreUpdateRequired` in `ClientError`; callers match the plain errors instead.
  func call<Output>(_ operation: () async throws -> Output) async throws -> Output {
    do {
      return try await operation()
    } catch let error as ClientError {
      if let failure = error.underlyingError as? ChatServiceError {
        throw failure
      }
      if let update = error.underlyingError as? CoreUpdateRequired {
        throw update
      }
      throw error
    }
  }
}
