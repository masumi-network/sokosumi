import SokosumiChat
import Testing

/// Row 10c: web clamps every body at 16 lines unless it holds a large solo image
/// (`ChannelMessageBody` / `hasLargeSoloImageAttachment` in `room-message-row.tsx`).
/// Each case names the web test it mirrors; the rest follow from the rule itself.
struct MessageBodyClampTests {
  private let longText = (1 ... 20).map { "Line \($0) of a very long chat message." }.joined(separator: "\n")

  /// Web: "clamps long message bodies and expands with Show more/Show less".
  @Test func longTextAloneClamps() {
    #expect(MessageMarkdown(longText).clampsLongBody)
  }

  /// Web: "hides Show more when the message body does not overflow" — the clamp class is on the
  /// body; whether it overflows is layout, so the rule applies and the view shows no control.
  @Test func shortTextIsStillUnderTheRule() {
    #expect(MessageMarkdown("Short message").clampsLongBody)
  }

  /// Web: "does not line-clamp bodies that include a large solo image attachment" and
  /// "uses large variant for a single image attachment".
  @Test(arguments: [
    "[photo.png](https://cdn.example/photo.png)\n",
    "![photo](https://cdn.example/photo.png)"
  ])
  func aSingleLargeImageIsNotClamped(source: String) {
    #expect(!MessageMarkdown(source).clampsLongBody)
  }

  /// Web: "keeps thumb size-16 for multiple consecutive image attachments" — two chips in one row
  /// are thumbs, and a body of thumbs clamps.
  @Test func twoImagesSideBySideClamp() {
    #expect(MessageMarkdown("[a.png](https://cdn.example/a.png)\n[b.png](https://cdn.example/b.png)\n").clampsLongBody)
  }

  /// Web: "keeps thumb size-16 for a single non-image attachment".
  @Test func aSingleFileClamps() {
    #expect(MessageMarkdown("[notes.pdf](https://cdn.example/notes.pdf)\n").clampsLongBody)
  }

  /// The row's defect: Apple exempted any attachment. Web clamps a long body with a file.
  @Test func longTextWithAFileClamps() {
    #expect(MessageMarkdown(longText + "\n\n[report.pdf](https://cdn.example/report.pdf)").clampsLongBody)
  }

  /// `hasLargeSoloImageAttachment` looks at every files segment, so text around the image changes nothing.
  @Test(arguments: [
    "\n\n[photo.png](https://cdn.example/photo.png)",
    "\n\n[photo.png](https://cdn.example/photo.png)\n\nand a closing line"
  ])
  func longTextWithOneImageIsNotClamped(suffix: String) {
    #expect(!MessageMarkdown(longText + suffix).clampsLongBody)
  }

  /// A file beside the image makes a two-chip row; the image is no longer solo.
  @Test func anImageBesideAFileClamps() {
    #expect(MessageMarkdown("[photo.png](https://cdn.example/photo.png)\n[notes.pdf](https://cdn.example/notes.pdf)").clampsLongBody)
  }

  /// Text between them keeps the image solo in its own row, and one solo image exempts the body.
  @Test func anImageSeparatedFromAFileByTextIsNotClamped() {
    #expect(!MessageMarkdown("[photo.png](https://cdn.example/photo.png)\n\nsee also\n\n[notes.pdf](https://cdn.example/notes.pdf)").clampsLongBody)
  }

  /// Web: "keeps thumb size-16 for a single non-image attachment" applies to any non-image kind.
  @Test(arguments: ["clip.mp4", "song.mp3", "archive.zip"])
  func aSoloNonImageAttachmentClamps(name: String) {
    #expect(MessageMarkdown("[\(name)](https://cdn.example/\(name))").clampsLongBody)
  }

  /// An ordinary link is not an attachment; the body clamps like text.
  @Test func anOrdinaryLinkClamps() {
    #expect(MessageMarkdown("hello [site](https://example.com)").clampsLongBody)
  }

  /// A blank line is whitespace, so the two images stay one row and the body clamps.
  @Test func twoImagesWithABlankLineClamp() {
    #expect(MessageMarkdown("[a.png](https://cdn.example/a.png)\n\n[b.png](https://cdn.example/b.png)").clampsLongBody)
  }

  /// Web's raw scan sees the list marker. Each image is its own solo row, so the body is exempt.
  @Test func twoImagesInAListAreNotClamped() {
    #expect(!MessageMarkdown("- [a.png](https://cdn.example/a.png)\n- [b.png](https://cdn.example/b.png)").clampsLongBody)
  }

  /// A quote marker is not whitespace either, even though the parser deletes it.
  @Test func twoImagesInAQuoteAreNotClamped() {
    #expect(!MessageMarkdown("> [a.png](https://cdn.example/a.png)\n> [b.png](https://cdn.example/b.png)").clampsLongBody)
  }

  /// A rule between images is its own block on web and splits the row.
  @Test func aRuleBetweenImagesDoesNotClamp() {
    #expect(!MessageMarkdown("[a.png](https://cdn.example/a.png)\n\n---\n\n[b.png](https://cdn.example/b.png)").clampsLongBody)
  }

  /// A sample link inside a fence is not an attachment.
  @Test func aLinkInsideAFenceClamps() {
    #expect(MessageMarkdown("```\n[photo.png](https://cdn.example/photo.png)\n```").clampsLongBody)
  }

  /// `<img>` is not a Markdown file link. The parsed document still exempts a solo image.
  @Test func anHTMLImageIsNotClamped() {
    #expect(!MessageMarkdown("<img src=\"https://cdn.example/photo.png\" alt=\"photo\">").clampsLongBody)
  }

  /// A backtick run inside a fence line does not close the fence (CommonMark: a closer starts its own
  /// line), so the image link that follows it is still code and the body clamps.
  @Test func aBacktickRunInsideAFenceDoesNotEndTheSkip() {
    let source = longText + "\n\n```\nwrap samples in ``` fences\n![photo](https://cdn.example/photo.png)\n```"
    #expect(MessageMarkdown(source).clampsLongBody)
  }

  /// A closer indented up to three spaces still closes; the solo image after it exempts the body.
  @Test func anIndentedCloserEndsTheFence() {
    let source = "```\n[sample.png](https://cdn.example/sample.png)\n  ```\n\n![photo](https://cdn.example/photo.png)"
    #expect(!MessageMarkdown(source).clampsLongBody)
  }

  /// A closer with text after the run is not a closer.
  @Test func aCloserFollowedByTextDoesNotEndTheFence() {
    let source = "```\n[sample.png](https://cdn.example/sample.png)\n``` not yet\n![photo](https://cdn.example/photo.png)\n```"
    #expect(MessageMarkdown(source).clampsLongBody)
  }

  /// A fence without a closer runs to the end of the body.
  @Test func anUnclosedFenceRunsToTheEnd() {
    let source = "```\ntext\n![photo](https://cdn.example/photo.png)"
    #expect(MessageMarkdown(source).clampsLongBody)
  }

  /// Indented (four-space) code is scanned like any text. Web's raw scan counts a link there too;
  /// the fenced-code skip above is the only deviation from web.
  @Test func aSoloImageInIndentedCodeIsNotClamped() {
    #expect(!MessageMarkdown(longText + "\n\n    [photo.png](https://cdn.example/photo.png)").clampsLongBody)
  }
}
