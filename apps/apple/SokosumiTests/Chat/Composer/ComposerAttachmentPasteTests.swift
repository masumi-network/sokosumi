#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import Testing

  @MainActor
  struct ComposerAttachmentPasteTests {
    @Test func filePasteRoutesToUploadsInsteadOfInsertingPath() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let file = URL(fileURLWithPath: "/tmp/report.pdf")
      pasteboard.writeObjects([file as NSURL])
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("Existing draft")
      var selected: [URL] = []
      input.attachFiles = { selected = $0 }
      input.pasteText(from: pasteboard)
      #expect(selected == [file])
      #expect(input.serializedDraft == "Existing draft")
    }

    /// A screenshot puts only image data on the pasteboard. AppKit enables Paste for text types alone, so without
    /// this the composer's own paste never ran and the image was not attached.
    @Test func anImageAloneOnThePasteboardCanBePasted() throws {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let png = try #require(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1, pixelsHigh: 1, bitsPerSample: 8, samplesPerPixel: 4,
                                              hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
      try pasteboard.setData(#require(png.tiffRepresentation), forType: .tiff)
      let input = MacComposerTextInput.InputView()
      let paste = #selector(NSText.paste(_:))
      #expect(!input.pastesAttachment(paste, from: pasteboard), "Without attachments the composer pastes text only.")
      input.attachImage = { _ in }
      for action in [paste, #selector(NSTextView.pasteAsPlainText(_:)), #selector(NSTextView.pasteAsRichText(_:))] {
        #expect(input.pastesAttachment(action, from: pasteboard))
      }
      #expect(!input.pastesAttachment(#selector(NSText.copy(_:)), from: pasteboard), "Only the pastes.")
      input.isEditable = false
      #expect(!input.pastesAttachment(paste, from: pasteboard), "A read-only composer takes no paste.")
    }

    /// Paste enables only for what the paste itself would attach: TIFF bytes that are no image enable nothing.
    @Test func anUnreadableImageDoesNotEnablePaste() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      pasteboard.setData(Data([1, 2, 3]), forType: .tiff)
      let input = MacComposerTextInput.InputView()
      input.attachImage = { _ in }
      #expect(input.pastedAttachment(on: pasteboard) == nil)
      #expect(!input.pastesAttachment(#selector(NSText.paste(_:)), from: pasteboard))
    }

    @Test func aCopiedFileCanBePastedWhereFilesAttach() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let file = URL(fileURLWithPath: "/tmp/report.pdf")
      pasteboard.writeObjects([file as NSURL])
      let input = MacComposerTextInput.InputView()
      input.attachImage = { _ in }
      #expect(input.pastedAttachment(on: pasteboard) == nil, "An image-only composer takes no files.")
      input.attachFiles = { _ in }
      #expect(input.pastedAttachment(on: pasteboard) == .files([file]))
    }

    @Test func imagePasteRoutesToUploadAndDisabledAttachmentsKeepTextPaste() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let bytes = Data([1, 2, 3])
      pasteboard.setData(bytes, forType: .png)
      pasteboard.setString("fallback", forType: .string)
      let input = MacComposerTextInput.InputView()
      input.isRichText = true
      var image: Data?
      input.attachImage = { image = $0 }
      input.pasteText(from: pasteboard)
      #expect(image == bytes)
      #expect(input.serializedDraft.isEmpty)
      input.attachImage = nil
      input.pasteText(from: pasteboard)
      #expect(input.captureDraft() == "fallback\n")
    }
  }
#endif
