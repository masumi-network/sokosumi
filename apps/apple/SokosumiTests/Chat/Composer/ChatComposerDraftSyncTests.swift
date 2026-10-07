#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  @MainActor private final class OutsideDraft: ObservableObject {
    @Published var replacement = "Saved"
  }

  /// A draft held in `@State`, as `ChatComposerView` holds it, that something outside the editor replaces.
  private struct DraftHost: View {
    @ObservedObject var outside: OutsideDraft
    @State private var draft = "Saved"

    var body: some View {
      ComposerTextInput(text: $draft, submit: { false })
        .onChange(of: outside.replacement) { _, text in draft = text }
    }
  }

  extension NativeWindowTests {
    /// The editor and the draft binding agree on who wrote last: the person's typing is never
    /// replaced by an older draft, and a draft written from outside still replaces the text.
    @MainActor struct ChatComposerDraftSyncTests {
      /// SwiftUI gives each pending transaction the `@State` as it stood before the later ones.
      /// A workspace change queued just ahead of a keystroke therefore updates the composer with
      /// the draft before that keystroke; restoring it rewrote the text with a line break at its
      /// end and the caret below it, as if Shift-Return had been pressed.
      @Test func aWorkspaceChangeQueuedAheadOfAKeystrokeLeavesTheTypedTextAlone() async throws {
        let roomId = "draft-sync-room"
        let userId = UUID().uuidString
        let state = WorkspaceState()
        let saved = SavedComposeDraft(userId: userId, organizationId: nil, roomId: roomId)
        defer { saved.save("") }
        state.timeline.reset(roomId: roomId)
        state.timeline.failInitialLoad(message: "Fixture has no server", generation: state.timeline.generation)
        let content = ChatComposerView(userId: userId, organizationId: nil, roomId: roomId)
          .environmentObject(state).environmentObject(AuthState())
          .environmentObject(ComposeUploads(savedDraft: saved)).environmentObject(ComposerAttachmentIngress())
          .frame(width: 520)
        let (window, host) = Self.window(content)
        defer { window.orderOut(nil) }
        let input = try await waitForView(in: host, timeoutMessage: "The composer did not mount") { Self.inputView(in: host) }
        window.makeFirstResponder(input)

        var typed = ""
        for character in "asd" {
          // Its own transaction, queued before the keystroke's and flushed with it.
          withAnimation { state.objectWillChange.send() }
          input.insertText(String(character), replacementRange: input.selectedRange())
          typed.append(character)
          await Self.settle(host)
          #expect(input.string == typed)
          #expect(input.selectedRange() == NSRange(location: typed.utf16.count, length: 0))
        }
        #expect(saved.load() == "asd\n")
      }

      @Test func aDraftWrittenFromOutsideStillReplacesTheText() async throws {
        let outside = OutsideDraft()
        let (window, host) = Self.window(DraftHost(outside: outside).frame(width: 520))
        defer { window.orderOut(nil) }
        let input = try await waitForView(in: host, timeoutMessage: "The saved draft did not reach the editor") {
          Self.inputView(in: host).flatMap { $0.serializedDraft == "Saved" ? $0 : nil }
        }
        outside.replacement = "Failed send\n\nSaved"
        _ = try await waitForView(in: host, timeoutMessage: "The restored draft did not reach the editor; it holds \(input.string.debugDescription)") {
          input.serializedDraft == "Failed send\n\nSaved" ? input : nil
        }
        outside.replacement = ""
        _ = try await waitForView(in: host, timeoutMessage: "The cleared draft did not reach the editor; it holds \(input.string.debugDescription)") {
          input.string.isEmpty ? input : nil
        }
      }

      private static func window(_ content: some View) -> (NSWindow, NSView) {
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        return (window, host)
      }

      /// Lets the queued transactions flush and the editor catch up with them.
      private static func settle(_ host: NSView) async {
        for _ in 0 ..< 3 {
          await Task.yield()
          host.layoutSubtreeIfNeeded()
        }
        try? await Task.sleep(for: .milliseconds(20))
      }

      private static func inputView(in view: NSView) -> MacComposerTextInput.InputView? {
        if let input = view as? MacComposerTextInput.InputView {
          return input
        }
        return view.subviews.lazy.compactMap { inputView(in: $0) }.first
      }
    }
  }
#endif
