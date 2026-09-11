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
