#if os(macOS)
  import AppKit
  import SokosumiChat
  import UniformTypeIdentifiers
#elseif os(iOS)
  import UIKit
#endif

/// The one place chat presentation touches the system clipboard; portable models never do.
enum PlatformPasteboard {
  @discardableResult
  static func copy(_ text: String) -> Bool {
    #if os(macOS)
      NSPasteboard.general.clearContents()
      return NSPasteboard.general.setString(text, forType: .string)
    #elseif os(iOS)
      UIPasteboard.general.string = text
      return true
    #else
      return false
    #endif
  }

  #if os(macOS)
    /// Web's Copy image: the image as the system image (for any app) plus its original bytes under
    /// their type; bytes that are not an image, or no bytes at all, copy the image's link instead.
    @discardableResult
    static func copyImage(_ content: ImageCopyContent, from url: URL, to name: NSPasteboard.Name = .general) -> Bool {
      let pasteboard = NSPasteboard(name: name)
      pasteboard.clearContents()
      if case let .image(data, contentType) = content, let tiff = NSImage(data: data)?.tiffRepresentation {
        let item = NSPasteboardItem()
        item.setData(tiff, forType: .tiff)
        if let type = UTType(mimeType: contentType), type.conforms(to: .image), type != .tiff {
          item.setData(data, forType: NSPasteboard.PasteboardType(type.identifier))
        }
        if pasteboard.writeObjects([item]) {
          return true
        }
      }
      return pasteboard.setString(url.absoluteString, forType: .string)
    }
  #endif
}
