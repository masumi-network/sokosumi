#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import Testing

  /// A room clicked in the sidebar opens ready to type, as web's room composer focuses on mount; one reached with the
  /// arrow keys leaves focus on the list, so the next key keeps moving through it.
  @MainActor struct ComposerFocusRequestTests {
    static func mouse(_ type: NSEvent.EventType) throws -> NSEvent {
      try #require(NSEvent.mouseEvent(
        with: type, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
        eventNumber: 0, clickCount: 1, pressure: 1
      ))
    }

    private static func downArrow() throws -> NSEvent {
      try #require(NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
        characters: "\u{F701}", charactersIgnoringModifiers: "\u{F701}", isARepeat: false, keyCode: 125
      ))
    }

    @Test(arguments: [NSEvent.EventType.leftMouseDown, .leftMouseUp])
    func aClickedRoomsComposerTakesFocusOnce(type: NSEvent.EventType) throws {
      let request = ComposerFocusRequest()
      try request.roomPicked("launch", by: Self.mouse(type))
      #expect(request.take("launch"))
      #expect(!request.take("launch"), "A second mount of the same composer must not steal focus again")
    }

    @Test func anotherRoomOpeningFirstEndsTheRequest() throws {
      let request = ComposerFocusRequest()
      try request.roomPicked("launch", by: Self.mouse(.leftMouseDown))
      #expect(!request.take("general"), "Another room's composer must not take the focus")
      #expect(!request.take("launch"), "The clicked room, opened later some other way, must not take it either")
    }

    @Test func anArrowKeyPickLeavesFocusOnTheList() throws {
      let request = ComposerFocusRequest()
      try request.roomPicked("launch", by: Self.mouse(.leftMouseDown))
      try request.roomPicked("general", by: Self.downArrow())
      #expect(!request.take("general"))
      #expect(!request.take("launch"), "The arrow key replaces the click's request")
    }

    @Test func aPickWithNoEventLeavesFocusOnTheList() {
      let request = ComposerFocusRequest()
      request.roomPicked("launch", by: nil)
      #expect(!request.take("launch"))
    }
  }
#endif
