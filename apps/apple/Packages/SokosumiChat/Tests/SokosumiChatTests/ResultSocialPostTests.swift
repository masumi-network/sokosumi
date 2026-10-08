import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Row 38g: a `social_post` result draws web's `SocialPostPreview` (`social-post-preview.tsx`) from the preview's
/// `social` object, the post's text and its image and video outputs. Fixed ids and times; the cards decode through
/// the real generated client. Expectations follow web's helpers (`accountName`, `accountHandle`, `getInitials`,
/// `useFold`, `PreviewRichText`) as their tests and source state them.
@MainActor struct ResultSocialPostTests {
  private static let postId = "7d1f0c2a-0000-4000-8000-000000000031"
  private static let bareId = "7d1f0c2a-0000-4000-8000-000000000032"
  private static let objectlessId = "7d1f0c2a-0000-4000-8000-000000000033"
  private static let strayId = "7d1f0c2a-0000-4000-8000-000000000034"

  private static func drive(_ id: String, _ query: String = "scope=me") -> String {
    "/api/drive/files/\(id)/content?\(query)"
  }

  private static func output(_ name: String, _ type: String?, preview: String?) -> String {
    let contentType = type.map { #""\#($0)""# } ?? "null"
    let previewHref = preview.map { #""\#($0)""# } ?? "null"
    return #"{"name":"\#(name)","contentType":\#(contentType),"sizeBytes":1024,"openHref":"/drive/files/\#(name)?scope=me","previewHref":\#(previewHref)}"#
  }

  /// An X post with every field Core fills: the account, its publish time, three pictures and a video among a PDF
  /// and a picture without a preview, which web leaves out.
  private static let postJSON = """
  {"id":"\(postId)","state":"available","capturedAt":"2026-10-07T14:07:00.000Z","kind":"social_post",\
  "title":"Launch day #sokosumi","status":"PUBLISHED","summary":"Launch day #sokosumi\\nSee you there.",\
  "sourceHref":"/social?projectId=p1&postId=post-1","destination":"x · sokosumi","scheduledAt":"2026-10-07T09:00:00.000Z",\
  "timezone":"Europe/Berlin","outputs":[\(output("a.png", "image/png", preview: drive("f1"))),\
  \(output("brief.pdf", "application/pdf", preview: drive("f2"))),\(output("b.gif", "image/gif", preview: drive("f3"))),\
  \(output("c.png", "image/png", preview: nil)),\(output("clip.mp4", "video/mp4", preview: drive("f5"))),\
  \(output("d.jpg", "image/jpeg", preview: drive("f6", "scope=org&organizationId=org_1")))],\
  "social":{"provider":"x","account":{"handle":"sokosumi","displayName":"Sokosumi HQ","avatarUrl":"https://cdn.example/hq.png"},\
  "timestamp":"2026-10-07T09:00:00.000Z"}}
  """

  /// A LinkedIn draft: no account, no time, no summary, no media.
  private static let bareJSON = """
  {"id":"\(bareId)","state":"available","capturedAt":"2026-10-07T14:08:00.000Z","kind":"social_post",\
  "title":"Hello","status":"DRAFT","summary":null,"sourceHref":"/social?projectId=p1&postId=post-2",\
  "social":{"provider":"linkedin","account":null,"timestamp":null}}
  """

  /// A `social_post` result without its `social` object keeps web's generic card.
  private static let objectlessJSON = """
  {"id":"\(objectlessId)","state":"available","capturedAt":"2026-10-07T14:09:00.000Z","kind":"social_post",\
  "title":"Old post","status":"SCHEDULED","summary":"Old post","sourceHref":"/social?projectId=p1&postId=post-3",\
  "destination":"linkedin · Ada","social":null}
  """

  /// Web reads `social` only for a `social_post` result.
  private static let strayJSON = """
  {"id":"\(strayId)","state":"available","capturedAt":"2026-10-07T14:10:00.000Z","kind":"file","title":"a.png",\
  "status":null,"sourceHref":"/drive/files/f1?scope=me",\
  "social":{"provider":"x","account":null,"timestamp":null}}
  """

  private static func cards(_ items: [String], ids: [String]) async throws -> [ResultPreviewCard] {
    let previews = try await ResultFixture.previews(items)
    return MessageResultPreviews.items(previews, descriptorIds: ids, webBaseURL: ResultFixture.web).compactMap {
      if case let .available(card) = $0 {
        card
      } else {
        nil
      }
    }
  }

  private static func post(handle: String?, displayName: String?) -> ResultSocialPost {
    ResultSocialPost(provider: .x, handle: handle, displayName: displayName, avatarURL: nil, text: "", timestamp: Date(timeIntervalSince1970: 0), media: [])
  }

  // MARK: Which card

  @Test func aSocialPostResultCarriesWebsPreview() async throws {
    let card = try #require(await Self.cards([Self.postJSON], ids: [Self.postId]).first)
    let post = try #require(card.social)
    #expect(post.provider == .x)
    #expect(post.handle == "sokosumi")
    #expect(post.displayName == "Sokosumi HQ")
    #expect(post.avatarURL == "https://cdn.example/hq.png")
    // Web: `result.summary ?? result.title` (Core's summary is the whole text, the title its first 160 characters).
    #expect(post.text == "Launch day #sokosumi\nSee you there.")
    #expect(post.timestamp == Date(timeIntervalSince1970: 1_791_363_600))
    // Only outputs with a preview and an image or video type, in Core's order, keeping the card's output ids.
    #expect(post.media.map(\.name) == ["a.png", "b.gif", "clip.mp4", "d.jpg"])
    #expect(post.media.map(\.kind) == [.image, .gif, .video, .image])
    #expect(post.media.map(\.id) == ["/drive/files/a.png?scope=me-0", "/drive/files/b.gif?scope=me-2",
                                     "/drive/files/clip.mp4?scope=me-4", "/drive/files/d.jpg?scope=me-5"])
    #expect(post.media.first?.source == .driveFile(id: "f1", scope: .personal, organizationId: nil, download: false))
    #expect(post.media.last?.source == .driveFile(id: "f6", scope: .organization, organizationId: "org_1", download: false))
    #expect(post.media.map(\.fileName) == ["a.png", "b.gif", "clip.mp4", "d.jpg"])
    #expect(post.visibleMedia.count == 4)
  }

  @Test func withoutTimeOrSummaryThePreviewUsesTheRecordingAndTheTitle() async throws {
    let card = try #require(await Self.cards([Self.bareJSON], ids: [Self.bareId]).first)
    let post = try #require(card.social)
    #expect(post.provider == .linkedin)
    #expect(post.handle == nil && post.displayName == nil && post.avatarURL == nil)
    #expect(post.text == "Hello")
    #expect(post.timestamp == Date(timeIntervalSince1970: 1_791_382_080))
    #expect(post.media.isEmpty)
    #expect(post.name(fallback: "Your account") == "Your account")
    #expect(post.atHandle == nil)
  }

  @Test func onlyASocialPostResultWithItsObjectDrawsThePreview() async throws {
    let cards = try await Self.cards([Self.objectlessJSON, Self.strayJSON], ids: [Self.objectlessId, Self.strayId])
    #expect(cards.count == 2)
    #expect(cards.allSatisfy { $0.social == nil })
    // The object-less post keeps the generic card's chip and rows.
    #expect(cards.first?.status == .result("SCHEDULED"))
    #expect(cards.first?.details == [.destination("linkedin · Ada")])
  }

  // MARK: Web's helpers

  @Test func theAccountIsNamedAsWebNamesIt() {
    #expect(Self.post(handle: "sokosumi", displayName: "Sokosumi HQ").name(fallback: "Your account") == "Sokosumi HQ")
    #expect(Self.post(handle: "@sokosumi", displayName: nil).name(fallback: "Your account") == "sokosumi")
    #expect(Self.post(handle: nil, displayName: nil).name(fallback: "Your account") == "Your account")
    #expect(Self.post(handle: "sokosumi", displayName: nil).atHandle == "@sokosumi")
    #expect(Self.post(handle: "@sokosumi", displayName: nil).atHandle == "@sokosumi")
    #expect(Self.post(handle: "", displayName: "HQ").atHandle == nil)
    // Instagram heads the post with the handle first.
    #expect(Self.post(handle: "@sokosumi", displayName: "Sokosumi HQ").instagramName(fallback: "Your account") == "sokosumi")
    #expect(Self.post(handle: nil, displayName: "Sokosumi HQ").instagramName(fallback: "Your account") == "Sokosumi HQ")
  }

  @Test func initialsFollowWebsGetInitials() {
    #expect(ResultSocialPost.initials("Sokosumi HQ") == "SH")
    #expect(ResultSocialPost.initials("sokosumi") == "SO")
    #expect(ResultSocialPost.initials("ada lovelace king") == "AL")
    #expect(ResultSocialPost.initials("  ") == "?")
    #expect(ResultSocialPost.initials("é") == "É")
  }

  @Test func longTextFoldsAtTheNetworksBudget() {
    let (chars, lines) = ResultSocialPost.linkedInFold
    #expect(chars == 210 && lines == 3)
    #expect(ResultSocialPost.instagramFold.maxChars == 125 && ResultSocialPost.instagramFold.maxLines == 2)
    // Short text stays whole.
    #expect(ResultSocialPost.fold("Hello", maxChars: 210, maxLines: 3) == .init(visibleText: "Hello", isFolded: false))
    // Past the character budget: the head, its trailing space trimmed.
    let words = String(repeating: "word ", count: 80)
    let folded = ResultSocialPost.fold(words, maxChars: 210, maxLines: 3)
    #expect(folded.isFolded)
    #expect(folded.visibleText == String(String(repeating: "word ", count: 42).dropLast()))
    // Past the line budget: the first lines only.
    #expect(ResultSocialPost.fold("one\ntwo\nthree", maxChars: 125, maxLines: 2) == .init(visibleText: "one\ntwo", isFolded: true))
    #expect(ResultSocialPost.fold("one\ntwo\n", maxChars: 125, maxLines: 2) == .init(visibleText: "one\ntwo", isFolded: true))
    #expect(ResultSocialPost.fold("one\ntwo", maxChars: 125, maxLines: 2) == .init(visibleText: "one\ntwo", isFolded: false))
  }

  @Test func linksTagsAndMentionsAreTokens() {
    #expect(ResultSocialPost.runs("Launch day #sokosumi https://www.example.com/a/very/long/path/here") == [
      .init("Launch day "), .init("#sokosumi", isToken: true), .init(" "), .init("example.com/a/very/long/…", isToken: true)
    ])
    #expect(ResultSocialPost.runs("Thanks @ada.l and #café! http://x.co") == [
      .init("Thanks "), .init("@ada.l", isToken: true), .init(" and "), .init("#café", isToken: true), .init("! "),
      .init("x.co", isToken: true)
    ])
    #expect(ResultSocialPost.runs("plain") == [.init("plain")])
    #expect(ResultSocialPost.runs("").isEmpty)
  }

  @Test func theGridShowsFourPicturesAndTheNetworkHasItsName() {
    let media = (0 ..< 6).map {
      ResultSocialPost.Media(id: "m\($0)", name: "m\($0).png", kind: .image, source: nil, fileName: "m\($0).png")
    }
    let post = ResultSocialPost(provider: .x, handle: nil, displayName: nil, avatarURL: nil, text: "", timestamp: .init(timeIntervalSince1970: 0),
                                media: media)
    #expect(post.visibleMedia.map(\.id) == ["m0", "m1", "m2", "m3"])
    let names = [ResultSocialPost.Provider.x, .linkedin, .facebook, .instagram, .tiktok, .youtube].map {
      ResultSocialPost(provider: $0, handle: nil, displayName: nil, avatarURL: nil, text: "", timestamp: .init(timeIntervalSince1970: 0), media: [])
        .providerName
    }
    #expect(names == ["X", "LinkedIn", "Facebook", "Instagram", "TikTok", "YouTube"])
  }
}
