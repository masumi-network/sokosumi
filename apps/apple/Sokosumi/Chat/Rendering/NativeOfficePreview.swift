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
        return NSHostingView(rootView: Text("Preview unavailable"))
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
#else
  import QuickLook

  struct NativeOfficePreview: UIViewControllerRepresentable {
    let file: AttachmentPreviewFile

    func makeCoordinator() -> Coordinator {
      Coordinator(file: file)
    }

    func makeUIViewController(context: Context) -> QLPreviewController {
      let controller = QLPreviewController()
      controller.dataSource = context.coordinator
      return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
      if context.coordinator.file.url != file.url {
        context.coordinator.file = file
        controller.reloadData()
      }
    }

    @MainActor final class Coordinator: NSObject, QLPreviewControllerDataSource {
      var file: AttachmentPreviewFile
      init(file: AttachmentPreviewFile) {
        self.file = file
      }

      func numberOfPreviewItems(in _: QLPreviewController) -> Int {
        1
      }

      func previewController(_: QLPreviewController, previewItemAt _: Int) -> any QLPreviewItem {
        file.url as NSURL
      }
    }
  }
#endif
