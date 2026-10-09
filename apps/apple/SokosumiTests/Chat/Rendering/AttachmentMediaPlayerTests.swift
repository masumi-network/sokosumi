#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// The result-card suite's hosting, waiting and accessibility helpers.
  private typealias Helpers = NativeWindowTests.SokoBotResultPreviewsTests

  extension NativeWindowTests {
    /// An audio or video attachment builds its inline player once Play is pressed. SwiftUI's `VideoPlayer` aborted
    /// the Debug test host here (`_AVKit_SwiftUI`, `getSuperclassMetadata`); `InlineMediaPlayer` hosts `AVPlayerView`.
    @MainActor struct AttachmentMediaPlayerTests {
      @Test(arguments: [("briefing.wav", "Play audio"), ("clip.mp4", "Play video")])
      func playShowsTheInlinePlayer(filename: String, label: String) async throws {
        let url = try #require(URL(string: "https://media-fixture.invalid/\(filename)"))
        let attachment = try #require(MessageAttachment(url: url, label: filename))
        let (window, host) = Helpers.window(MessageAttachmentView(attachment: attachment).padding(12), size: NSSize(width: 520, height: 400))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText(filename, in: host)
        #expect(await Helpers.pressAll(label, in: host) == 1)
        #expect(await Helpers.nodes(labelled: label, in: host).isEmpty)
        #expect(Helpers.hostsPlayer(host))
      }
    }
  }
#endif
