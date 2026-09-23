#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// The real `MessageEditComposer` in a window, editing "Original", with `WorkspaceState` and `AuthState`
  /// in the environment. Rows 18a (keys) and 18b (chrome) drive it.
  @MainActor struct MessageEditComposerFixture {
    let window: NSWindow
    let host: NSView
    let editing: MessageEditing
    let input: MacComposerTextInput.InputView

    static func make(dark: Bool = false) async throws -> MessageEditComposerFixture {
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
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
      window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      window.contentView = host
      window.makeKeyAndOrderFront(nil)
      let input = try await waitForView(in: host, timeoutMessage: "The edit composer did not mount its text view") {
        inputView(in: host).flatMap { $0.serializedDraft == "Original" ? $0 : nil }
      }
      #expect(input.modifierReturnSubmits, "The edit composer puts its text view in edit mode.")
      return MessageEditComposerFixture(window: window, host: host, editing: editing, input: input)
    }

    func waitForDraft(_ draft: String) async throws {
      _ = try await waitForView(in: input, timeoutMessage: "The draft \(draft.prefix(40).debugDescription) did not reach the text view") {
        input.serializedDraft == draft ? input : nil
      }
    }

    static func returnEvent(_ modifiers: NSEvent.ModifierFlags = []) throws -> NSEvent {
      try #require(NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: modifiers,
        timestamp: 0, windowNumber: 0, context: nil,
        characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36
      ))
    }

    private static func inputView(in view: NSView) -> MacComposerTextInput.InputView? {
      if let input = view as? MacComposerTextInput.InputView {
        return input
      }
      return view.subviews.lazy.compactMap { inputView(in: $0) }.first
    }
  }

  extension NativeWindowTests {
    /// Row 18a through the real edit composer (room, thread parent and reply share it): Return on an
    /// unchanged or empty draft cancels, as web's `handleCommit`; Return on a changed draft takes the save
    /// branch without adding a line; Shift-Return keeps editing with a new line.
    @MainActor struct MessageEditComposerReturnTests {
      @Test(arguments: ["Original", "  Original  ", ""])
      func returnOnAnUnchangedOrEmptyDraftCancels(draft: String) async throws {
        let fixture = try await MessageEditComposerFixture.make()
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = draft
        try await fixture.waitForDraft(draft)
        #expect(fixture.editing.source != nil, "Still editing before Return.")
        try fixture.input.keyDown(with: MessageEditComposerFixture.returnEvent())
        #expect(fixture.editing.source == nil)
      }

      /// The fixture has no signed-in client, so `saveMessageEdit` stops at `resolveClient` and no PATCH is
      /// observable here; `WorkspaceStateTests.savedEditUpdatesRoomParentOrThreadReply` covers that side.
      @Test func returnOnAChangedDraftNeitherCancelsNorAddsALine() async throws {
        let fixture = try await MessageEditComposerFixture.make()
        defer { fixture.window.orderOut(nil) }
        fixture.editing.draft = "Changed"
        try await fixture.waitForDraft("Changed")
        #expect(fixture.editing.canSave)
        // The restored paragraph serializes with its closing newline ("Changed\n"); a Return that
        // inserted a line would leave "Changed\n\n" and a longer text.
        let text = fixture.input.string
        let markdown = fixture.input.captureDraft()
        fixture.input.setSelectedRange(NSRange(location: text.utf16.count, length: 0))
        try fixture.input.keyDown(with: MessageEditComposerFixture.returnEvent())
        #expect(fixture.editing.source != nil, "Return took the save branch, not cancel.")
        #expect(fixture.input.string == text, "Return added no line.")
        #expect(fixture.input.captureDraft() == markdown)
        #expect(markdown.trimmingCharacters(in: .newlines) == "Changed")
      }

      @Test func shiftReturnKeepsEditingWithANewLine() async throws {
        let fixture = try await MessageEditComposerFixture.make()
        defer { fixture.window.orderOut(nil) }
        fixture.input.setSelectedRange(NSRange(location: fixture.input.string.utf16.count, length: 0))
        try fixture.input.keyDown(with: MessageEditComposerFixture.returnEvent(.shift))
        #expect(fixture.editing.source != nil)
        #expect(fixture.input.captureDraft().hasPrefix("Original\n"))
      }
    }
  }
#endif
