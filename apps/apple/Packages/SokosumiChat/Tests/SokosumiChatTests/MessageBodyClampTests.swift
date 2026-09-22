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
}
