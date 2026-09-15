#if os(macOS)
  @testable import Sokosumi
  import Testing

  struct RoomToolsModifierTests {
    @Test(arguments: [
      (0, "Threads"),
      (1, "Threads, 1 unread"),
      (99, "Threads, 99 unread"),
      (100, "Threads, more than 99 unread"),
      (150, "Threads, more than 99 unread")
    ])
    func threadsTriggerSpeaksUnreadLikeWeb(example: (Int, String)) {
      #expect(roomThreadsAccessibilityLabel(unreadCount: example.0) == example.1)
    }

    @Test func inspectorHidesWhileAThreadIsOpenAndKeepsThreadsRequested() {
      #expect(roomToolsInspectorPresented(showsPins: false, showsSearch: false, showsThreads: true, threadParentId: nil))
      #expect(!roomToolsInspectorPresented(showsPins: false, showsSearch: false, showsThreads: true, threadParentId: "parent"))
      #expect(!roomToolsClearsThreadsOnInspectorDismiss(threadParentId: "parent"))
      #expect(roomToolsClearsThreadsOnInspectorDismiss(threadParentId: nil))
    }
  }
#endif
