#if os(macOS)
  import AppKit
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
}
