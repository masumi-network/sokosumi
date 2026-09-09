import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

private actor WorkspaceTransport: ClientTransport {
  var pauseRooms = false
  var failRooms = false
  var roomWaiter: CheckedContinuation<Void, Never>?
  var pauseObserver: CheckedContinuation<Void, Never>?
  var gate = "ready"
  var preference: String? = "org_1"
  var paths: [String] = []

  func configure(gate: String = "ready", preference: String? = "org_1", pauseRooms: Bool = false, failRooms: Bool = false) {
    self.gate = gate
    self.preference = preference
    self.pauseRooms = pauseRooms
    self.failRooms = failRooms
  }

  func waitForPause() async {
    if roomWaiter != nil {
      return
    }
    await withCheckedContinuation { pauseObserver = $0 }
  }

  func release() {
    roomWaiter?.resume()
    roomWaiter = nil
  }

  func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    paths.append(operationID)
    let data: String
    switch operationID {
    case "get/users/{id}/workspace-access":
      data = "{\"gate\":\"\(gate)\",\"hasPersonalWorkspace\":true,\"hasOrganizationMembership\":true,\"hasPendingOrganizationInvites\":false}"
    case "get/users/{id}/organizations":
      data = #"[{"id":"org_1","createdAt":"2026-01-01T00:00:00.000Z","name":"Acme","slug":"acme","role":"member"}]"#
    case "get/users/{id}":
      data = #"{"id":"user_1","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","name":"Me","email":"me@example.com","emailVerified":true,"role":"user"}"#
    case "get/users/{id}/preferred-organization", "put/users/{id}/preferred-organization":
      data = "{\"organizationId\":\(preference.map { "\"\($0)\"" } ?? "null")}"
    case "get/chats/rooms":
      if pauseRooms {
        await withCheckedContinuation {
          roomWaiter = $0
          pauseObserver?.resume()
          pauseObserver = nil
        }
      }
      if failRooms {
        return (HTTPResponse(status: .internalServerError), HTTPBody(#"{"error":"Internal Server Error","message":"Unavailable","meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req"}}"#))
      }
      data = "[]"
    default:
      throw URLError(.unsupportedURL)
    }
    let envelope = "{\"data\":\(data),\"meta\":{\"timestamp\":\"2026-01-01T00:00:00.000Z\",\"requestId\":\"req\",\"pagination\":{\"cursor\":null,\"limit\":100,\"total\":0,\"nextCursor\":null}}}"
    return (HTTPResponse(status: .ok), HTTPBody(envelope))
  }
}

@MainActor
struct WorkspaceSessionTests {
  private func client(_ transport: WorkspaceTransport) -> Client {
    Client.connecting(to: URL(string: "https://core.example/v1")!, transport: transport)
  }

  @Test func restoresServerOrganizationWithoutSeatFilteringOrWrites() async throws {
    let transport = WorkspaceTransport()
    let state = WorkspaceSession()
    _ = try await state.load(client: client(transport))
    #expect(state.phase == .ready)
    #expect(state.selection?.workspace == .organization(id: "org_1", slug: "acme"))
    #expect(state.options.map(\.id) == ["personal", "org_1"])
    #expect(await transport.paths.allSatisfy { $0.hasPrefix("get/") })
  }

  @Test(arguments: ["identity-onboarding", "pending-invites"])
  func setupStopsBeforeReadingSelection(gate: String) async throws {
    let transport = WorkspaceTransport()
    await transport.configure(gate: gate)
    let state = WorkspaceSession()
    await #expect(throws: ChatServiceError.self) { try await state.load(client: client(transport)) }
    #expect(await transport.paths == ["get/users/{id}/workspace-access"])
    #expect(state.currentUser == nil)
  }

  @Test func lateLoadCannotRestoreSignedOutAccount() async throws {
    let transport = WorkspaceTransport()
    await transport.configure(pauseRooms: true)
    let state = WorkspaceSession()
    let load = Task { try await state.load(client: client(transport)) }
    await transport.waitForPause()
    state.reset()
    await transport.release()
    #expect(try await load.value == nil)
    #expect(state.phase == .idle)
    #expect(state.options.isEmpty)
    #expect(state.currentUser == nil)
  }

  @Test func lateSwitchCannotRestoreSignedOutAccount() async throws {
    let transport = WorkspaceTransport()
    let state = WorkspaceSession()
    _ = try await state.load(client: client(transport))
    let personal = try #require(state.options.first { $0.id == "personal" })
    await transport.configure(preference: nil, pauseRooms: true)
    let switching = Task { try await state.select(personal, client: client(transport)) }
    await transport.waitForPause()
    state.reset()
    await transport.release()
    #expect(try await switching.value == nil)
    #expect(state.phase == .idle)
    #expect(state.selectionId == nil)
    #expect(!state.isSwitching)
  }

  @Test func cancellingSwitchCallerPreventsLateRollback() async throws {
    let transport = WorkspaceTransport()
    let state = WorkspaceSession()
    _ = try await state.load(client: client(transport))
    let personal = try #require(state.options.first { $0.id == "personal" })
    await transport.configure(preference: nil, pauseRooms: true, failRooms: true)
    let switching = Task { try await state.select(personal, client: client(transport)) }
    await transport.waitForPause()
    switching.cancel()
    await transport.release()
    #expect(try await switching.value == nil)
    #expect(await transport.paths.filter { $0 == "put/users/{id}/preferred-organization" }.count == 1)
    #expect(!state.isSwitching)
  }

  @Test func roomSelectionIsIsolatedByAccountAndWorkspace() throws {
    let suite = "workspace-room-tests.\(UUID())"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = SavedRoomSelection(defaults: defaults)
    store.save("personal-room", userId: "a", organizationId: nil)
    store.save("org-room", userId: "a", organizationId: "org")
    #expect(store.load(userId: "a", organizationId: nil) == "personal-room")
    #expect(store.load(userId: "a", organizationId: "org") == "org-room")
    #expect(store.load(userId: "b", organizationId: "org") == nil)
  }
}
