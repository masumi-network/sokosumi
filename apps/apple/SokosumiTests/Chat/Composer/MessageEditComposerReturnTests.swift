#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  private struct MessageEditComposerFixture {
    let window: NSWindow
    let editing: MessageEditing
    let input: MacComposerTextInput.InputView
  }

  extension NativeWindowTests {
    /// Row 18a through the real edit composer (room, thread parent and reply share it): Return on an
    /// unchanged or empty draft cancels, as web's `handleCommit`; Shift-Return keeps editing with a new line.
    @MainActor struct MessageEditComposerReturnTests {
      @Test(arguments: ["Original", "  Original  ", ""])
      func returnOnAnUnchangedOrEmptyDraftCancels(draft: String) async throws {
        let fixture = try await Self.fixture()
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = draft
        try await Self.waitForDraft(draft, in: fixture)
        #expect(fixture.editing.source != nil, "Still editing before Return.")
        try fixture.input.keyDown(with: Self.returnEvent())
        #expect(fixture.editing.source == nil)
      }

      @Test func shiftReturnKeepsEditingWithANewLine() async throws {
        let fixture = try await Self.fixture()
        defer { fixture.window.orderOut(nil) }
        fixture.input.setSelectedRange(NSRange(location: fixture.input.string.utf16.count, length: 0))
        try fixture.input.keyDown(with: Self.returnEvent(.shift))
        #expect(fixture.editing.source != nil)
        #expect(fixture.input.captureDraft().hasPrefix("Original\n"))
      }

      private static func fixture() async throws -> MessageEditComposerFixture {
        var message = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: "room_1", content: "Original",
                                                  sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
        message.id = "message_1"
        let editing = MessageEditing()
        editing.start(message, userId: "user")
        let content = MessageEditComposer(editing: editing)
          .environmentObject(WorkspaceState())
          .environmentObject(AuthState())
          .padding(16)
          .frame(width: 480, alignment: .topLeading)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        let input = try await waitForView(in: host, timeoutMessage: "The edit composer did not mount its text view") {
          Self.inputView(in: host).flatMap { $0.serializedDraft == "Original" ? $0 : nil }
        }
        #expect(input.modifierReturnSubmits, "The edit composer puts its text view in edit mode.")
        return MessageEditComposerFixture(window: window, editing: editing, input: input)
      }

      private static func waitForDraft(_ draft: String, in fixture: MessageEditComposerFixture) async throws {
        _ = try await waitForView(in: fixture.input, timeoutMessage: "The draft \(draft.debugDescription) did not reach the text view") {
          fixture.input.serializedDraft == draft ? fixture.input : nil
        }
      }

      private static func inputView(in view: NSView) -> MacComposerTextInput.InputView? {
        if let input = view as? MacComposerTextInput.InputView {
          return input
        }
        return view.subviews.lazy.compactMap { inputView(in: $0) }.first
      }

      private static func returnEvent(_ modifiers: NSEvent.ModifierFlags = []) throws -> NSEvent {
        try #require(NSEvent.keyEvent(
          with: .keyDown, location: .zero, modifierFlags: modifiers,
          timestamp: 0, windowNumber: 0, context: nil,
          characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36
        ))
      }
    }
  }
#endif
