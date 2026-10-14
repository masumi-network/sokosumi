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
    @Test(arguments: [NSPasteboard.PasteboardType.png, .tiff])
    func anImageAloneOnThePasteboardCanBePasted(type: NSPasteboard.PasteboardType) {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      pasteboard.setData(Data([1, 2, 3]), forType: type)
      let input = MacComposerTextInput.InputView()
      #expect(!input.hasAttachment(on: pasteboard), "Without attachments the composer pastes text only.")
      input.attachImage = { _ in }
      #expect(input.hasAttachment(on: pasteboard))
    }

    @Test func aCopiedFileCanBePastedWhereFilesAttach() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      pasteboard.writeObjects([URL(fileURLWithPath: "/tmp/report.pdf") as NSURL])
      let input = MacComposerTextInput.InputView()
      input.attachImage = { _ in }
      #expect(!input.hasAttachment(on: pasteboard), "An image-only composer takes no files.")
      input.attachFiles = { _ in }
      #expect(input.hasAttachment(on: pasteboard))
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
