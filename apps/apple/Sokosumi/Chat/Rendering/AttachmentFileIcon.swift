import SwiftUI
#if os(macOS)
  import AppKit
  import UniformTypeIdentifiers
#endif

struct AttachmentFileIcon: View {
  let filename: String
  /// Names the type when the file name has no extension.
  var url: URL?
  var size: CGFloat = 40

  private var fileExtension: String {
    let ext = (filename as NSString).pathExtension
    return ext.isEmpty ? url?.pathExtension ?? "" : ext
  }

  var body: some View {
    #if os(macOS)
      Image(nsImage: NSWorkspace.shared.icon(for: UTType(filenameExtension: fileExtension) ?? .data))
        .resizable()
        .scaledToFit()
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    #endif
  }
}
