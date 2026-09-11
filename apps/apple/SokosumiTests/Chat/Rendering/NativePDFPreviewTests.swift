#if os(macOS)
  import AppKit
  import PDFKit
  @testable import Sokosumi
  import SwiftUI
  import Testing

  @MainActor
  struct NativePDFPreviewTests {
    @Test func previewKeepsDocumentAndFitsAvailableSpace() throws {
      let document = PDFDocument()
      document.insert(PDFPage(), at: 0)
      document.insert(PDFPage(), at: 1)
      let host = NSHostingView(rootView: NativePDFPreview(document: document))
      host.frame = NSRect(x: 0, y: 0, width: 800, height: 600)
      host.layoutSubtreeIfNeeded()
      let pdf = try #require(findPDF(in: host))
      #expect(pdf.document === document)
      #expect(pdf.document?.pageCount == 2)
      #expect(pdf.autoScales)
      host.frame.size = NSSize(width: 400, height: 300)
      host.layoutSubtreeIfNeeded()
      #expect(pdf.bounds.width > 0)
      #expect(pdf.bounds.width <= 400)
      #expect(pdf.bounds.height <= 300)
    }

    private func findPDF(in view: NSView) -> PDFView? {
      if let pdf = view as? PDFView {
        return pdf
      }
      return view.subviews.lazy.compactMap { findPDF(in: $0) }.first
    }
  }
#endif
