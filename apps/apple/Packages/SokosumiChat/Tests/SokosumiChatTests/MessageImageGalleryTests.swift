import Foundation
import SokosumiChat
import Testing

/// Row 15b: web's Message image gallery (`messageImageGallery` in room-message-row.tsx) and the
/// stepping of its `ImageViewer` (image-viewer.tsx). Fixed URLs; no clock or ids involved.
struct MessageImageGalleryTests {
  private static func url(_ name: String) -> URL {
    URL(string: "https://cdn.example/\(name)")!
  }

  private static func names(_ images: [MessageAttachment]) -> [String] {
    images.map(\.url.lastPathComponent)
  }

  private static let three = MessageMarkdown("""
  [a.png](https://cdn.example/a.png) [b.jpg](https://cdn.example/b.jpg)

  Some words between the rows.

  [c.webp](https://cdn.example/c.webp)
  """).imageGallery

  /// Web: every image link across the body's attachment rows, in body order.
  @Test func collectsImagesAcrossRowsInBodyOrder() {
    #expect(Self.names(Self.three.images) == ["a.png", "b.jpg", "c.webp"])
    #expect(Self.three.images.map(\.filename) == ["a.png", "b.jpg", "c.webp"])
  }

  /// Web: "A file linked twice is one image" — keyed by the link's URL, at its first place.
  @Test func aFileLinkedTwiceIsOneImage() {
    let gallery = MessageMarkdown("""
    [a.png](https://cdn.example/a.png) [b.png](https://cdn.example/b.png)

    Again: [a again.png](https://cdn.example/a.png)
    """).imageGallery
    #expect(Self.names(gallery.images) == ["a.png", "b.png"])
    #expect(gallery.images.first?.filename == "a.png", "The first link names it.")
  }

  /// Web classifies each link with `classifyFilePreview(...).isImage`: documents, audio and video
  /// stay out; a code sample is text, not an attachment.
  @Test func onlyImagesEnterTheGallery() {
    let gallery = MessageMarkdown("""
    [notes.pdf](https://cdn.example/notes.pdf) [a.png](https://cdn.example/a.png) [clip.mp4](https://cdn.example/clip.mp4) [song.mp3](https://cdn.example/song.mp3)

    ```
    [sample.png](https://cdn.example/sample.png)
    ```

    - [b.gif](https://cdn.example/b.gif)
    > ![c](https://cdn.example/c.jpeg)
    """).imageGallery
    #expect(Self.names(gallery.images) == ["a.png", "b.gif", "c.jpeg"])
  }

  @Test func aBodyWithoutImagesHasAnEmptyGallery() {
    #expect(MessageMarkdown("Just words and [a link](https://example.com).").imageGallery.images.isEmpty)
  }

  /// Web: the viewer steps without wrapping; its previous/next stop, inert, at the ends.
  @Test func stepsStopAtTheEnds() {
    let gallery = Self.three
    #expect(gallery.previous(before: Self.url("a.png")) == nil)
    #expect(gallery.next(after: Self.url("a.png"))?.url == Self.url("b.jpg"))
    #expect(gallery.previous(before: Self.url("b.jpg"))?.url == Self.url("a.png"))
    #expect(gallery.next(after: Self.url("b.jpg"))?.url == Self.url("c.webp"))
    #expect(gallery.next(after: Self.url("c.webp")) == nil)
    #expect(gallery.next(after: Self.url("gone.png")) == nil, "An image outside the gallery has no neighbour.")
    #expect(gallery.previous(before: Self.url("gone.png")) == nil)
  }

  /// Web: `{current} / {total}` before the file name from two images up, and a step is read out
  /// as "Image {current} of {total}, {name}". One image shows neither.
  @Test func positionFromTwoImagesUp() {
    #expect(Self.three.positionLabel(of: Self.url("b.jpg")) == "2 / 3")
    #expect(Self.three.stepAnnouncement(for: Self.url("c.webp")) == "Image 3 of 3, c.webp")
    let one = MessageImageGallery(Self.three.images.prefix(1).map(\.self))
    #expect(one.positionLabel(of: Self.url("a.png")) == nil)
    #expect(one.stepAnnouncement(for: Self.url("a.png")) == nil)
    #expect(one.next(after: Self.url("a.png")) == nil)
    #expect(Self.three.positionLabel(of: Self.url("gone.png")) == nil)
  }

  /// Web preloads only the previous and the next image beside the open one.
  @Test func preloadsOnlyTheNeighbours() {
    #expect(Self.names(Self.three.preloadWindow(around: Self.url("a.png"))) == ["a.png", "b.jpg"])
    #expect(Self.names(Self.three.preloadWindow(around: Self.url("b.jpg"))) == ["a.png", "b.jpg", "c.webp"])
    #expect(Self.names(Self.three.preloadWindow(around: Self.url("c.webp"))) == ["b.jpg", "c.webp"])
    #expect(Self.three.preloadWindow(around: Self.url("gone.png")).isEmpty)
  }

  /// Web keys the open image by its URL, not an index: an edit that drops another image keeps it
  /// open at its new position; dropping the open image closes the viewer and forgets it.
  @Test func theOpenImageFollowsItsURLWhenTheMessageChanges() {
    let edited = MessageMarkdown("""
    [b.jpg](https://cdn.example/b.jpg)

    [c.webp](https://cdn.example/c.webp)
    """).imageGallery
    #expect(edited.image(for: Self.url("c.webp"))?.url == Self.url("c.webp"))
    #expect(edited.positionLabel(of: Self.url("c.webp")) == "2 / 2", "Was 3 / 3 before the edit.")
    #expect(edited.image(for: Self.url("a.png")) == nil, "The open image left the message: the viewer closes.")
    #expect(edited.image(for: nil) == nil)
    #expect(MessageImageGallery([]).image(for: Self.url("a.png")) == nil, "A deleted body has no images.")
  }

  /// Duplicates and non-images are dropped however the list is built.
  @Test func buildingFromAttachmentsFiltersAndDedupes() throws {
    let image = try #require(MessageAttachment(url: Self.url("a.png"), label: "a.png"))
    let again = try #require(MessageAttachment(url: Self.url("a.png"), label: "copy.png"))
    let file = try #require(MessageAttachment(url: Self.url("n.pdf"), label: "n.pdf"))
    let gallery = MessageImageGallery([file, image, again])
    #expect(gallery.images == [image])
  }
}
