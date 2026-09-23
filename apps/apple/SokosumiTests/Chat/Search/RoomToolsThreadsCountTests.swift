#if os(macOS)
  import AppKit
  import CoreAPI
  import HTTPTypes
  import OpenAPIRuntime
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Synchronization
  import Testing

  extension NativeWindowTests {
    /// The room toolbar's Threads trigger counts unread threads from Core. The package tests prove that Mark
    /// all, a thread Look and a mute bump `threadAttentionRevision`; this proves the bump reaches the toolbar:
    /// `RoomToolsModifier` keys its count task on the revision, so a bump sends one more
    /// `GET /chats/rooms/{id}/threads/unread-count` and the trigger shows Core's new count.
    @MainActor struct RoomToolsThreadsCountTests {
      @Test func anAttentionBumpRefetchesTheTriggerCountOnce() async throws {
        let transport = ThreadsCountTransport(counts: [3, 1])
        let client = try Client.connecting(to: #require(URL(string: "https://threads-count.invalid/v1")), transport: transport)
        let state = WorkspaceState(clientProvider: { _ in client })
        state.timeline.reset(roomId: "room")
        let auth = AuthState()
        let renders = RenderCount()
        let content = NavigationStack {
          RenderProbe(renders: renders)
            .frame(width: 420, height: 120)
            .modifier(RoomToolsModifier(roomId: "room", jump: { _ in .unavailable }))
        }
        .environmentObject(state)
        .environmentObject(auth)
        // The real window toolbar, as the room declares it, so the Threads trigger is mounted.
        let controller = NSHostingController(rootView: content)
        controller.sceneBridgingOptions = [.toolbars, .title]
        let window = NSWindow(contentViewController: controller)
        window.styleMask = [.titled, .closable]
        window.setContentSize(NSSize(width: 420, height: 120))
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let host = controller.view

        try await waitUntil("the first count; \(Self.describe(transport, state))", in: host) {
          transport.countRequests == 1 && state.threadOverview.unreadCount == 3
        }
        #expect(!(window.toolbar?.items.isEmpty ?? true), "The room puts the Threads trigger in the window toolbar.")

        // Mark all, as the overview's button runs it: Core accepts, the room bumps the revision.
        let revision = state.threadAttentionRevision
        await state.updateThreadOverview(.markAllRead, roomId: "room", auth: auth)
        try #require(state.threadAttentionRevision == revision + 1, "Mark all bumps the Threads attention revision.")
        try #require(transport.countRequests == 1, "Mark all itself does not count; the toolbar's task does.")

        try await waitUntil("the re-count after the bump; \(Self.describe(transport, state))", in: host) {
          transport.countRequests >= 2 && state.threadOverview.unreadCount == 1
        }
        #expect(transport.countRequests == 2, "One bump sends exactly one more count request.")
        #expect(roomThreadsAccessibilityLabel(unreadCount: state.threadOverview.unreadCount) == "Threads, 1 unread")

        // Render again with no bump: the task id is unchanged, so nothing is re-counted.
        let rendered = renders.value
        state.objectWillChange.send()
        try await waitUntil("a second render", in: host) { renders.value > rendered }
        try await expectQuiet(for: RoomToolsThreadsCountTests.countDebounce * 3) { transport.countRequests == 2 }
        #expect(transport.countRequests == 2, "A render without a bump sends no count request.")
        #expect(state.threadOverview.unreadCount == 1)
      }

      /// `RoomToolsModifier` waits this long before it counts, so a burst of bumps sends one request.
      private static let countDebounce = Duration.milliseconds(150)

      private func waitUntil(_ what: @autoclosure () -> String, in host: NSView, _ condition: () -> Bool) async throws {
        _ = try await waitForView(in: host, timeoutMessage: what()) { condition() ? host : nil }
      }

      private static func describe(_ transport: ThreadsCountTransport, _ state: WorkspaceState) -> String {
        "\(transport.countRequests) unread-count requests, trigger shows \(state.threadOverview.unreadCount)"
      }

      /// A request that must not happen has no event to wait for. Watch for three debounce windows, which any
      /// re-count started by the render would have to fall inside, and stop at the first change.
      private func expectQuiet(for window: Duration, _ unchanged: () -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: window)
        while clock.now < deadline, unchanged() {
          try await Task.sleep(for: .milliseconds(20))
        }
      }
    }
  }

  @MainActor private final class RenderCount {
    var value = 0
  }

  /// Reads the same workspace as the toolbar, and counts its renders.
  private struct RenderProbe: View {
    let renders: RenderCount
    @EnvironmentObject private var workspaces: WorkspaceState

    var body: some View {
      renders.value += 1
      return Text("Threads \(workspaces.threadOverview.unreadCount)")
    }
  }

  /// Core for one open room: answers the Threads count from `counts` in order (repeating the last), Mark all,
  /// the reloaded thread list and the display preferences. Counts only the unread-count requests.
  private final nonisolated class ThreadsCountTransport: ClientTransport, Sendable {
    private let counts: Mutex<[Int]>
    private let countRequestTotal = Mutex(0)

    init(counts: [Int]) {
      self.counts = Mutex(counts)
    }

    var countRequests: Int {
      countRequestTotal.withLock { $0 }
    }

    func send(_: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
      let meta = #""meta":{"timestamp":"2026-09-23T12:00:00.000Z","requestId":"fixture"}"#
      let data: String
      switch operationID {
      case "get/chats/rooms/{id}/threads/unread-count":
        countRequestTotal.withLock { $0 += 1 }
        let count = counts.withLock { $0.count > 1 ? $0.removeFirst() : $0.first ?? 0 }
        data = #"{"count":\#(count)}"#
      case "post/chats/rooms/{id}/threads/read":
        data = #"{"markedCount":2}"#
      case "get/chats/rooms/{id}/threads":
        return (HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]), HTTPBody(
          #"{"data":[],"meta":{"timestamp":"2026-09-23T12:00:00.000Z","requestId":"fixture","pagination":{"cursor":null,"limit":50,"total":0,"nextCursor":null}}}"#
        ))
      case "get/users/{id}/preferences":
        data = #"{"marketingOptIn":false,"notificationsOptIn":false,"pushOptIn":false,"showRoomUnreadCount":true,"notificationPreferences":[]}"#
      default:
        return (HTTPResponse(status: .notFound), nil)
      }
      return (HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]), HTTPBody(#"{"data":\#(data),\#(meta)}"#))
    }
  }
#endif
