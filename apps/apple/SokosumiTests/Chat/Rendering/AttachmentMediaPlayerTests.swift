#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// The result-card suite's hosting, waiting and accessibility helpers.
  private typealias Helpers = NativeWindowTests.SokoBotResultPreviewsTests

  extension NativeWindowTests {
    /// A video attachment builds its inline player once Play is pressed. SwiftUI's `VideoPlayer` aborted the Debug
    /// test host here (`_AVKit_SwiftUI`, `getSuperclassMetadata`); `InlineMediaPlayer` hosts `AVPlayerView`.
    /// Audio is web's compact voice card instead.
    @MainActor struct AttachmentMediaPlayerTests {
      @Test(arguments: [("clip.mp4", "Play video")])
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

      /// Web's `VoicePlayer`: Play turns into Pause in place, no AVPlayerView, and speed steps 1×, 1.5×, 2×.
      @Test func aVoiceMessagePlaysInItsCardAndChangesSpeed() async throws {
        let url = try #require(URL(string: "https://media-fixture.invalid/briefing.m4a"))
        let attachment = try #require(MessageAttachment(url: url, label: "briefing.m4a"))
        let (window, host) = Helpers.window(MessageAttachmentView(attachment: attachment).padding(12), size: NSSize(width: 520, height: 200))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("0:00", in: host)
        #expect(await Helpers.pressAll("Play briefing.m4a", in: host) == 1)
        #expect(await Helpers.nodes(labelled: "Pause", in: host).count == 1)
        #expect(!Helpers.hostsPlayer(host))
        #expect(await Helpers.pressAll("Playback speed 1×", in: host) == 1)
        #expect(await Helpers.pressAll("Playback speed 1.5×", in: host) == 1)
        #expect(await Helpers.nodes(labelled: "Playback speed 2×", in: host).count == 1)
      }

      /// A Firefox WebM recording cannot play in AVFoundation, so the card says so instead of a dead Play button.
      @Test func aWebMVoiceMessageSaysItCannotPlay() async throws {
        let url = try #require(URL(string: "https://media-fixture.invalid/briefing.weba"))
        let attachment = try #require(MessageAttachment(url: url, label: "briefing.weba"))
        let (window, host) = Helpers.window(MessageAttachmentView(attachment: attachment).padding(12), size: NSSize(width: 520, height: 200))
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("This recording's format can't play in the app.", in: host)
        #expect(await Helpers.nodes(labelled: "Play briefing.weba", in: host).isEmpty)
      }
    }
  }
#endif
