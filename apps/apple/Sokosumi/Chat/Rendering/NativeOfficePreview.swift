import SokosumiChat
import SwiftUI

#if os(macOS)
  import QuickLookUI

  struct NativeOfficePreview: NSViewRepresentable {
    let file: AttachmentPreviewFile

    func makeCoordinator() -> Coordinator {
      Coordinator(file: file)
    }

    func makeNSView(context _: Context) -> NSView {
      guard let view = QLPreviewView(frame: .zero, style: .normal) else {
        return NSHostingView(rootView: ContentUnavailableView("Preview unavailable", systemImage: "doc", description: Text("Open or save this file using the toolbar.")))
      }
      view.shouldCloseWithWindow = false
      view.previewItem = file.url as NSURL
      return view
    }

    func updateNSView(_ view: NSView, context: Context) {
      guard let preview = view as? QLPreviewView else { return }
      if context.coordinator.file.url != file.url {
        preview.previewItem = file.url as NSURL
        context.coordinator.file = file
      }
    }

    static func dismantleNSView(_ view: NSView, coordinator _: Coordinator) {
      (view as? QLPreviewView)?.close()
    }

    @MainActor final class Coordinator {
      var file: AttachmentPreviewFile
      init(file: AttachmentPreviewFile) {
        self.file = file
      }
    }
  }
#endif
