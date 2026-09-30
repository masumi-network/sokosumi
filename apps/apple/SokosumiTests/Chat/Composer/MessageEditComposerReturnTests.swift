#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import Testing

  extension NativeWindowTests {
    /// Rows 18a and 18c through the real edit composer (room, thread parent and reply share it): Return on
    /// an unchanged or empty draft cancels, as web's `handleCommit`; Return on a changed draft takes the save
    /// branch without adding a line; Shift-, Command- and Control-Return keep editing with a new line.
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

      /// Row 18c: Command and Control insert a line like Shift since web #5324; before, they saved, which on
      /// this unchanged draft ended the edit.
      @Test(arguments: [NSEvent.ModifierFlags.shift, .command, .control])
      func modifiedReturnKeepsEditingWithANewLine(_ modifiers: NSEvent.ModifierFlags) async throws {
        let fixture = try await MessageEditComposerFixture.make()
        defer { fixture.window.orderOut(nil) }
        fixture.input.setSelectedRange(NSRange(location: fixture.input.string.utf16.count, length: 0))
        try fixture.input.keyDown(with: MessageEditComposerFixture.returnEvent(modifiers))
        #expect(fixture.editing.source != nil)
        #expect(fixture.input.captureDraft().hasPrefix("Original\n"))
      }

      /// Command- and Control-Return on a changed draft send nothing; Return does (`bothAreDisabledWhileSaving`).
      @Test(arguments: [NSEvent.ModifierFlags.command, .control])
      func commandOrControlReturnOnAChangedDraftDoesNotSave(_ modifiers: NSEvent.ModifierFlags) async throws {
        EditRequestProtocol.reset()
        let fixture = try await MessageEditComposerFixture.make(client: MessageEditComposerFixture.heldClient())
        defer {
          fixture.editing.reset()
          fixture.window.orderOut(nil)
        }
        fixture.editing.draft = "Changed"
        try await fixture.waitForDraft("Changed")
        fixture.input.setSelectedRange(NSRange(location: fixture.input.string.utf16.count, length: 0))
        try fixture.input.keyDown(with: MessageEditComposerFixture.returnEvent(modifiers))
        // The new line reaches the draft through the binding, a turn after any save the key had started.
        _ = try await waitForView(in: fixture.host, timeoutMessage: "The new line did not reach the draft") {
          fixture.editing.draft.hasPrefix("Changed\n") ? fixture.input : nil
        }
        #expect(fixture.editing.source != nil)
        #expect(!fixture.editing.isSaving, "A modified Return started a save.")
        #expect(EditRequestProtocol.requests.isEmpty)
      }
    }
  }
#endif
