import PDFKit
import SokosumiChat
import SwiftUI

struct DocumentAttachmentPreview: View {
  let attachment: MessageAttachment
  @State private var document: PDFDocument?
  @State private var textDocument: MessageMarkdown?
  @State private var loading = true
  @State private var errorMessage: String?

  var body: some View {
    Group {
      if let document {
        NativePDFPreview(document: document)
      } else if let textDocument {
        ScrollView {
          MarkdownBlocksView(blocks: textDocument.blocks, presentsFileAttachments: false)
            .textSelection(.enabled)
            .frame(maxWidth: 680, alignment: .leading)
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .center)
        }
      } else if loading {
        ProgressView("Loading preview…")
      } else {
        ContentUnavailableView(errorMessage ?? "Preview unavailable", systemImage: "doc", description: Text("Open or save this file using the toolbar."))
      }
    }
    .task(id: attachment) {
      document = nil
      textDocument = nil
      errorMessage = nil
      loading = true
      defer {
        if !Task.isCancelled {
          loading = false
        }
      }
      guard let kind = attachment.documentPreviewKind else { return }
      do {
        if kind == .text {
          let source = try await AttachmentDownload.text(attachment.url)
          let parsed = await Task.detached(priority: .userInitiated) { MessageMarkdown(source) }.value
          try Task.checkCancellation()
          textDocument = parsed
          return
        }
        let file = try await AttachmentDownload.fetch(attachment.url)
        defer { try? FileManager.default.removeItem(at: file) }
        let data = try Data(contentsOf: file)
        try Task.checkCancellation()
        document = PDFDocument(data: data)
      } catch {
        if !Task.isCancelled {
          errorMessage = (error as? AttachmentDownload.Failure)?.errorDescription ?? "The file preview could not be loaded. Try again or open the original link."
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
