#if os(macOS)
  import CoreAPI
  import Foundation
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import Testing

  extension NativeWindowTests {
    /// SOK-1201: the View menu's Unreads commands (⌘⇧U and Mark all as read) read and call the same state the
    /// sidebar's rows do. The menu wiring itself is SwiftUI and stays untested, as ever; these drive what the
    /// commands are built from: the Toggle's `setUnreadsFilter`, Mark all's enablement `showsMarkAll`, and its
    /// action `markAllUnreadRead(auth:)`.
    @MainActor struct UnreadsMenuCommandsTests {
      private static let fixedDate = Date(timeIntervalSince1970: 1_790_000_000)

      private static func room(_ name: String, channel: Int = 0) -> Components.Schemas.ChatRoom {
        .init(
          id: "room-\(name)", name: name, kind: .channel, isSelfDirect: false, isGroupDirect: false, discoverability: ._public,
          createdByUserId: "user_1", createdAt: fixedDate, updatedAt: fixedDate,
          unreadCount: channel, channelUnreadCount: channel, threadUnreadCount: 0, unreadThreadCount: 0, unreadThreads: [],
          unreadMentionCount: 0, starredAt: nil, mutedAt: nil, markedUnread: false, myAccess: .member,
          userMembers: [], coworkerMembers: [], sokoBotMembers: []
        )
      }

      @Test func markAllIsOfferedUnderTheSidebarRowsRule() {
        let state = WorkspaceState()
        // Off, the Toggle reads false and Mark all stands disabled even with unread rooms in the list.
        #expect(!state.sidebar.unreadsFilterOn && state.unreadsFilter?.showsMarkAll != true)

        // The Toggle's action. Unread rooms stand, so Mark all is offered as the row's button is.
        state.rooms = [Self.room("launch", channel: 2), Self.room("general")]
        state.sidebar.setUnreadsFilter(true)
        #expect(state.sidebar.unreadsFilterOn)
        #expect(state.unreadsFilter?.showsMarkAll == true)

        // Read rooms only: the same rule that withdraws the row's button.
        state.rooms = [Self.room("general")]
        #expect(state.unreadsFilter?.showsMarkAll != true)
      }

      @Test func markAllRunsTheCommandAction() async throws {
        let transport = ReadsTransport()
        let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
        let state = WorkspaceState(clientProvider: { _ in client })
        state.rooms = [Self.room("launch", channel: 2)]
        state.sidebar.readAttention.setVisible(true, window: UUID())
        state.sidebar.setUnreadsFilter(true)

        await state.markAllUnreadRead(auth: AuthState())

        // The state is not `phase == .ready`, so the rooms re-read that follows
        // a Mark all stays away and the transport sees the read alone.
        #expect(await transport.paths == ["/chats/rooms/room-launch/read"], "The command's action runs the room's read.")
        #expect(await transport.operationIDs == ["post/chats/rooms/{id}/read"])
        #expect(!state.sidebar.isMarkingAllUnreadRead && state.sidebar.actionError == nil)
      }
    }
  }

  /// Answers a room read with that room read, and records the requests it was asked to run. It speaks the one
  /// operation the test needs; anything else fails loudly rather than answering a wrong-shaped body.
  private actor ReadsTransport: ClientTransport {
    private(set) var operationIDs: [String] = []
    private(set) var paths: [String] = []

    func send(
      _ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
      guard operationID == "post/chats/rooms/{id}/read" else {
        throw ChatServiceError.unexpectedResponse("UnreadsMenuCommandsTests transport got \(operationID)")
      }
      operationIDs.append(operationID)
      paths.append(request.path ?? "")
      // "/chats/rooms/<roomId>/read": the room is the fourth part.
      let parts = (request.path ?? "").split(separator: "/").map(String.init)
      let roomId = parts.count >= 4 ? parts[3] : ""
      let room = """
      {"id":"\(roomId)","organizationId":null,"organizationName":null,"name":"launch","slug":null,"kind":"channel",\
      "isSelfDirect":false,"directKey":null,"isGroupDirect":false,"groupName":null,"topic":null,"discoverability":null,\
      "createdByUserId":"user_1","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",\
      "unreadCount":0,"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,\
      "myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
      """
      return (
        HTTPResponse(status: .ok),
        HTTPBody(#"{"data":\#(room),"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req-1"}}"#)
      )
    }
  }
#endif
