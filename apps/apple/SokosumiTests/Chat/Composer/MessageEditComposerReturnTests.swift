#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import Testing

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
