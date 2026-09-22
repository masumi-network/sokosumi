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

    @Test(arguments: [
      RoomToolsInspectorDestination.search,
      .pins,
      .threads,
      .members
    ])
    func inspectorPresentsDestinationUntilAReplyThreadOpens(destination: RoomToolsInspectorDestination) {
      #expect(roomToolsInspectorPresented(destination: destination, threadParentId: nil))
      #expect(!roomToolsInspectorPresented(destination: destination, threadParentId: "parent"))
    }

    @Test func inspectorStaysHiddenWithNoDestination() {
      #expect(!roomToolsInspectorPresented(destination: nil, threadParentId: nil))
    }

    @Test func inspectorHidesWhileAThreadIsOpenAndKeepsThreadsRequested() {
      #expect(roomToolsInspectorDestinationAfterDismiss(.threads, threadParentId: "parent") == .threads)
      #expect(roomToolsInspectorDestinationAfterDismiss(.threads, threadParentId: nil) == nil)
      #expect(roomToolsInspectorDestinationAfterDismiss(.search, threadParentId: "parent") == nil)
      #expect(roomToolsInspectorDestinationAfterDismiss(.members, threadParentId: nil) == nil)
    }
  }
#endif
