import SwiftUI
#if os(macOS)
  import AppKit
  import UniformTypeIdentifiers
#endif

struct AttachmentFileIcon: View {
  let filename: String
  let url: URL

  private var fileExtension: String {
    let ext = (filename as NSString).pathExtension
    return ext.isEmpty ? url.pathExtension : ext
  }

  var body: some View {
    #if os(macOS)
      Image(nsImage: NSWorkspace.shared.icon(for: UTType(filenameExtension: fileExtension) ?? .data))
        .resizable()
        .scaledToFit()
        .frame(width: 40, height: 40)
        .accessibilityHidden(true)
    #else
      VStack(spacing: 2) {
        Image(systemName: "doc.richtext").font(.title)
        Text(fileExtension.uppercased()).font(.caption2.bold()).lineLimit(1)
      }
      .accessibilityHidden(true)
    #endif
  }
}
