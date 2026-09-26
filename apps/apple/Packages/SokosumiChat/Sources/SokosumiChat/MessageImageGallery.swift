import Foundation

/// Web's Message image gallery (`messageImageGallery`, room-message-row.tsx): every image
/// attachment across the body's attachment rows, in body order, a file linked twice counted
/// once. Quote and link-preview images are not in the body's attachments, so never in it.
/// The viewer keys the open image by its URL, as web keys it by `src`.
public struct MessageImageGallery: Equatable, Sendable {
  public let images: [MessageAttachment]

  public init(_ attachments: [MessageAttachment]) {
    var seen = Set<URL>()
    images = attachments.filter { $0.kind == .image && seen.insert($0.url).inserted }
  }

  /// The attachments the body renders, in document order (code samples stay text).
  public init(blocks: [MessageMarkdownBlock]) {
    self.init(MessageMarkdown.attachmentRows(in: blocks).flatMap(\.self))
  }

  private func index(of url: URL?) -> Int? {
    url.flatMap { url in images.firstIndex { $0.url == url } }
  }

  /// The open image, or nil once it left the gallery: web forgets it, so an edit that brings
  /// the file back does not reopen the viewer by itself.
  public func image(for url: URL?) -> MessageAttachment? {
    index(of: url).map { images[$0] }
  }

  public func previous(before url: URL) -> MessageAttachment? {
    guard let index = index(of: url), index > 0 else { return nil }
    return images[index - 1]
  }

  public func next(after url: URL) -> MessageAttachment? {
    guard let index = index(of: url), index + 1 < images.count else { return nil }
    return images[index + 1]
  }

  /// The open image with its neighbours, which web preloads so a step shows a loaded image.
  public func preloadWindow(around url: URL) -> [MessageAttachment] {
    guard let index = index(of: url) else { return [] }
    return Array(images[max(index - 1, 0) ... min(index + 1, images.count - 1)])
  }

  /// "2 / 3" from two images up (web's `Components.ImageViewer.position`); nil for one image.
  public func positionLabel(of url: URL) -> String? {
    guard images.count > 1, let index = index(of: url) else { return nil }
    return "\(index + 1) / \(images.count)"
  }

  /// Web's `stepAnnouncement`: "Image 2 of 3, name".
  public func stepAnnouncement(for url: URL) -> String? {
    guard images.count > 1, let index = index(of: url) else { return nil }
    return "Image \(index + 1) of \(images.count), \(images[index].filename)"
  }
}
