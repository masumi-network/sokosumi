#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// The result-card suite's hosting, waiting and accessibility helpers.
  private typealias Helpers = NativeWindowTests.SokoBotResultPreviewsTests
  private typealias Social = Components.Schemas.ChatResultAvailable.SocialPayload

  extension NativeWindowTests {
    /// Row 38g: a Soko Bot's `social_post` result draws web's `SocialPostPreview` (`social-post-preview.tsx`, as
    /// `result-previews.tsx` passes it) in place of the whole result card. Words and controls come from the hosted
    /// view's accessibility nodes; the pictures load through a stub of the coordinator's protected-output loader.
    @MainActor struct SokoBotSocialPostPreviewTests {
      /// 2026-10-07 09:00 UTC: "Oct 7" in every zone the suite runs in.
      private static let published = Date(timeIntervalSince1970: 1_791_363_600)
      private static let recorded = Date(timeIntervalSince1970: 1_791_381_900)
      private static let hqImage = Helpers.fixtureImage("social-hq", red: 0.15, green: 0.35, blue: 0.75)
      private static let picture = Helpers.fixturePNG(width: 320, height: 200, red: 0.85, green: 0.45, blue: 0.2) ?? Data()

      private static func drive(_ id: String) -> String {
        "/api/drive/files/\(id)/content?scope=me"
      }

      private static func output(_ name: String, _ type: String, _ id: String) -> Components.Schemas.ChatResultOutput {
        .init(name: name, contentType: type, sizeBytes: 182_000, openHref: "/drive/files/\(id)?scope=me", previewHref: drive(id),
              downloadHref: drive(id) + "&download=true")
      }

      private static func card(_ id: String, title: String, text: String?, social: Social,
                               outputs: [Components.Schemas.ChatResultOutput] = []) -> ResultPreviewCard {
        ResultPreviewCard(.init(
          id: id, state: .available, capturedAt: recorded, kind: .socialPost, title: title, status: "PUBLISHED", summary: text,
          sourceHref: "/social?projectId=p1&postId=\(id)", destination: "\(social.provider.rawValue) · sokosumi", scheduledAt: published,
          timezone: "Europe/Berlin", outputs: outputs, social: social
        ), webBaseURL: CoreSettings.webBaseURL)
      }

      private static let xText = "Launch day #sokosumi https://www.example.com/a/very/long/path/here\nDoors open at nine."
      /// An X post with its account's photo, a link, a tag and two pictures.
      private static let xCard = card(
        "7d1f0c2a-0000-4000-8000-000000000041", title: "Launch day #sokosumi", text: xText,
        social: .init(provider: .x, account: .init(handle: "sokosumi", displayName: "Sokosumi HQ", avatarUrl: hqImage), timestamp: published),
        outputs: [output("a.png", "image/png", "f1"), output("b.png", "image/png", "f2")]
      )

      private static let linkedInText = """
      We shipped the autumn release today. Thank you to everyone who tested the betas, filed issues and sent ideas. \
      The new Studio, the calendar and the agent marketplace are live for every workspace, and the changelog lists \
      everything else that changed. @ada.l led the launch.
      """
      /// A LinkedIn post without a photo or handle, long enough to fold, with three pictures.
      private static let linkedInCard = card(
        "7d1f0c2a-0000-4000-8000-000000000042", title: "We shipped the autumn release today.", text: linkedInText,
        social: .init(provider: .linkedin, account: .init(displayName: "Ada Lovelace"), timestamp: published),
        outputs: [output("c.png", "image/png", "f3"), output("d.png", "image/png", "f4"), output("e.png", "image/png", "f5")]
      )

      private static let instagramText = """
      Behind the scenes of the autumn shoot: three days, two cities and one very patient dog. Swipe for the outtakes \
      #sokosumi #autumn
      """
      /// An Instagram post with one picture and a caption long enough to fold.
      private static let instagramCard = card(
        "7d1f0c2a-0000-4000-8000-000000000043", title: "Behind the scenes", text: instagramText,
        social: .init(provider: .instagram, account: .init(handle: "@sokosumi", displayName: "Sokosumi HQ", avatarUrl: hqImage),
                      timestamp: published),
        outputs: [output("f.png", "image/png", "f6")]
      )

      /// An Instagram draft without a picture.
      private static let bareInstagramCard = card(
        "7d1f0c2a-0000-4000-8000-000000000044", title: "Caption", text: "Caption",
        social: .init(provider: .instagram, account: .init(handle: "sokosumi"), timestamp: published)
      )

      /// A TikTok post (web's neutral card): a video, which loads only when played.
      private static let tiktokCard = card(
        "7d1f0c2a-0000-4000-8000-000000000045", title: "Clip", text: "Clip of the week",
        social: .init(provider: .tiktok, account: .init(handle: "sokosumi", displayName: "Sokosumi HQ"), timestamp: published),
        outputs: [output("clip.mp4", "video/mp4", "f7")]
      )

      private static func host(_ card: ResultPreviewCard, recorder: OutputRecorder? = nil, height: CGFloat = 700) -> (NSWindow, NSView) {
        let view = ResultPreviewCardView(item: .available(card))
          .environment(\.resultOutputLoader, recorder)
          .environment(\.resultOutputPresenter, recorder ?? OutputRecorder(image: Data()))
          .padding(12)
        return Helpers.window(view, size: NSSize(width: 620, height: height))
      }

      /// Polls until `condition` holds, failing after ten seconds.
      private static func until(_ condition: () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !condition() {
          guard ContinuousClock.now < deadline else {
            Issue.record("the condition never held", sourceLocation: sourceLocation)
            return
          }
          try await Task.sleep(for: .milliseconds(25))
        }
      }

      // MARK: What it shows

      /// Web's X layout: the name, the handle and day, the text with its link shortened, the pictures; none of the
      /// result card's header, status, rows, recorded time or source link.
      @Test func anXPostDrawsWebsPreviewInPlaceOfTheResultCard() async throws {
        let recorder = OutputRecorder(image: Self.picture)
        let (window, host) = Self.host(Self.xCard, recorder: recorder)
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText("Sokosumi HQ", in: host)
        for text in ["X preview", "@sokosumi · Oct 7"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        #expect(texts.contains { $0.hasPrefix("Launch day #sokosumi example.com/a/very/long/…") }, "\(texts)")
        for text in ["Social post", "Published", "Account", "Scheduled for", "Open source: Launch day #sokosumi"] {
          #expect(!texts.contains(text), "\(text) shown in \(texts)")
        }
        #expect(!texts.contains { $0.hasPrefix("Recorded") }, "\(texts)")
        // Both pictures load through Core with the session, as 38e2's outputs do.
        try await Self.until { recorder.answered == 2 }
        #expect(Set(recorder.loads) == [.driveFile(id: "f1", scope: .personal, organizationId: nil, download: false),
                                        .driveFile(id: "f2", scope: .personal, organizationId: nil, download: false)])
      }

      /// LinkedIn folds the text after 210 characters behind "…see more", which unfolds it; a missing photo shows
      /// the name's initials and the day carries web's "Visible to anyone" globe.
      @Test func linkedInFoldsLongTextBehindSeeMore() async throws {
        let (window, host) = Self.host(Self.linkedInCard, recorder: OutputRecorder(image: Self.picture))
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText("Ada Lovelace", in: host)
        for text in ["LinkedIn preview", "Oct 7 ·", "Visible to anyone", "…see more"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        #expect(!texts.contains { $0.hasSuffix("@ada.l led the launch.") }, "\(texts)")
        #expect(try #require(await Helpers.nodes(labelled: "…see more", in: host).first).press())
        let unfolded = try await Helpers.waitForText(Self.linkedInText, in: host)
        #expect(!unfolded.contains("…see more"), "\(unfolded)")
      }

      /// Instagram heads the post with the handle, draws the first picture in a square and folds the caption after
      /// 125 characters behind "more"; without a picture the square asks for one.
      @Test func instagramShowsItsSquareAndAsksForMedia() async throws {
        let (window, host) = Self.host(Self.instagramCard, recorder: OutputRecorder(image: Self.picture), height: 900)
        defer { window.orderOut(nil) }
        let texts = try await Helpers.waitForText("Instagram preview", in: host)
        for text in ["sokosumi", "October 7", "more", "View image f.png"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        #expect(try #require(await Helpers.nodes(labelled: "more", in: host).first).press())
        _ = try await Helpers.waitForText("sokosumi " + Self.instagramText, in: host)

        let (bareWindow, bareHost) = Self.host(Self.bareInstagramCard, height: 900)
        defer { bareWindow.orderOut(nil) }
        let bare = try await Helpers.waitForText("Instagram needs an image or video.", in: bareHost)
        #expect(!bare.contains("more"), "\(bare)")
      }

      // MARK: The media

      /// A picture opens in Quick Look once loaded; a video loads only when it is played, then opens there too.
      @Test func picturesAndVideosOpenInQuickLook() async throws {
        let recorder = OutputRecorder(image: Self.picture)
        let (window, host) = Self.host(Self.xCard, recorder: recorder)
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Sokosumi HQ", in: host)
        try await Self.until { recorder.answered == 2 }
        // The picture becomes a button once its file has also decoded, a moment after the load answers.
        var pressed = false
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !pressed, ContinuousClock.now < deadline {
          await Helpers.settle(host)
          pressed = await Helpers.nodes(labelled: "View image b.png", in: host).first?.press() == true
        }
        #expect(pressed)
        try await Self.until { recorder.previewed == ["b.png"] }

        let videoRecorder = OutputRecorder(image: Self.picture)
        let (videoWindow, videoHost) = Self.host(Self.tiktokCard, recorder: videoRecorder)
        defer { videoWindow.orderOut(nil) }
        let texts = try await Helpers.waitForText("TikTok preview", in: videoHost)
        for text in ["Sokosumi HQ", "TikTok", "Oct 7", "Clip of the week"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        await Helpers.settle(videoHost)
        #expect(videoRecorder.loads.isEmpty)
        #expect(try #require(await Helpers.nodes(labelled: "Play clip.mp4", in: videoHost).first).press())
        try await Self.until { videoRecorder.previewed == ["clip.mp4"] }
        #expect(videoRecorder.loads == [.driveFile(id: "f7", scope: .personal, organizationId: nil, download: false)])
      }

      /// Four pictures sit in web's 2×2 grid row by row, so VoiceOver and the keyboard reach them in the post's order.
      @Test func fourPicturesAreReadRowByRow() async throws {
        let names = ["p1.png", "p2.png", "p3.png", "p4.png"]
        let card = Self.card(
          "7d1f0c2a-0000-4000-8000-000000000046", title: "Four", text: "Four pictures",
          social: .init(provider: .x, account: .init(handle: "sokosumi"), timestamp: Self.published),
          outputs: names.enumerated().map { Self.output($1, "image/png", "g\($0)") }
        )
        let recorder = OutputRecorder(image: Self.picture)
        let (window, host) = Self.host(card, recorder: recorder)
        defer { window.orderOut(nil) }
        _ = try await Helpers.waitForText("Four pictures", in: host)
        try await Self.until { recorder.answered == 4 }
        await Helpers.settle(host)
        let order = await Helpers.nodes(in: host) { $0.hasPrefix("View image ") }
          .compactMap { $0.object.value(forKey: "accessibilityLabel") as? String }
        #expect(order == names.map { "View image \($0)" }, "\(order)")
      }

      // MARK: Render

      /// Light beside dark: an X post with two pictures, a folded LinkedIn post with three, an Instagram post's square
      /// and a TikTok video, each hosted over the window background.
      @Test func rendersTheSocialPostPreviews() async throws {
        var columns: [[CGImage]] = []
        for dark in [false, true] {
          let recorder = OutputRecorder(image: Self.picture)
          let content = VStack(alignment: .leading, spacing: 16) {
            ResultPreviewCardView(item: .available(Self.xCard))
            ResultPreviewCardView(item: .available(Self.linkedInCard))
            ResultPreviewCardView(item: .available(Self.instagramCard))
            ResultPreviewCardView(item: .available(Self.tiktokCard))
          }
          .environment(\.resultOutputLoader, recorder)
          .padding(12)
          try await columns.append([
            Helpers.draw(content, size: NSSize(width: 440, height: 1900), dark: dark, until: "Clip of the week") {} ready: {
              try await Self.until { recorder.answered == 6 }
              // The pictures and the photo still decode off the main thread.
              try await Task.sleep(for: .milliseconds(600))
            }
          ])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "soko-bot-social-posts.png")
      }
    }
  }
#endif
