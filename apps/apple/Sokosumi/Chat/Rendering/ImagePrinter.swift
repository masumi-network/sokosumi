#if os(macOS)
  import AppKit
  import SwiftUI

  /// Prints one image by itself, as web's `printImage` (`image-viewer.tsx`) prints the shown image
  /// alone. The viewer's Print reaches it through the environment; tests record the jobs instead.
  protocol ImagePrinting: Sendable {
    @MainActor func print(_ image: NSImage, title: String)
  }

  /// The system print panel over the image, scaled down to fit the page and never up, centred
  /// horizontally at the top, as web's print document places it (`max-width: 100%`,
  /// `max-height: 100dvh`, `margin: 0 auto`). The job carries the file name, as web's document title.
  struct SystemImagePrinter: ImagePrinting {
    @MainActor func print(_ image: NSImage, title: String) {
      guard let info = NSPrintInfo.shared.copy() as? NSPrintInfo else { return }
      info.horizontalPagination = .fit
      info.verticalPagination = .fit
      info.isHorizontallyCentered = true
      info.isVerticallyCentered = false
      let page = NSSize(width: info.paperSize.width - info.leftMargin - info.rightMargin,
                        height: info.paperSize.height - info.topMargin - info.bottomMargin)
      let view = NSImageView(frame: NSRect(origin: .zero, size: page))
      view.image = image
      view.imageScaling = .scaleProportionallyDown
      view.imageAlignment = .alignTop
      let operation = NSPrintOperation(view: view, printInfo: info)
      operation.jobTitle = title
      if let window = NSApp.keyWindow {
        operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
      } else {
        operation.run()
      }
    }
  }

  extension EnvironmentValues {
    /// Where the viewer's Print sends the shown image; tests pass a recorder.
    @Entry var imagePrinter: any ImagePrinting = SystemImagePrinter()
  }
#endif
