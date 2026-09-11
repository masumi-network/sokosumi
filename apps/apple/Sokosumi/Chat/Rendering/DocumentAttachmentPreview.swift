import PDFKit
import SokosumiChat
import SwiftUI

struct DocumentAttachmentPreview: View {
  let attachment: MessageAttachment
  @State private var document: PDFDocument?
  @State private var loading = true
  @State private var errorMessage: String?

  private var isPDF: Bool {
    attachment.url.pathExtension.lowercased() == "pdf"
      || (attachment.filename as NSString).pathExtension.lowercased() == "pdf"
  }

  var body: some View {
    Group {
      if let document {
        NativePDFPreview(document: document)
      } else if loading {
        ProgressView("Loading preview…")
      } else {
        ContentUnavailableView(errorMessage ?? "Preview unavailable", systemImage: "doc", description: Text("Open or save this file using the toolbar."))
      }
    }
    .task(id: attachment.url) {
      document = nil
      errorMessage = nil
      loading = true
      defer { loading = false }
      guard isPDF else { return }
      do {
        let file = try await AttachmentDownload.fetch(attachment.url)
        defer { try? FileManager.default.removeItem(at: file) }
        let data = try Data(contentsOf: file)
        try Task.checkCancellation()
        document = PDFDocument(data: data)
      } catch {
        if !Task.isCancelled {
          errorMessage = friendlyMessage(for: error)
        }
      }
    }
  }
}

#if os(macOS)
  struct NativePDFPreview: NSViewRepresentable {
    let document: PDFDocument

    func makeNSView(context _: Context) -> PDFView {
      let view = PDFView()
      view.autoScales = true
      view.document = document
      return view
    }

    func updateNSView(_ view: PDFView, context _: Context) {
      if view.document !== document {
        view.document = document
      }
    }
  }
#else
  struct NativePDFPreview: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context _: Context) -> PDFView {
      let view = PDFView()
      view.autoScales = true
      view.document = document
      return view
    }

    func updateUIView(_ view: PDFView, context _: Context) {
      if view.document !== document {
        view.document = document
      }
    }
  }
#endif
