#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing
  import UniformTypeIdentifiers

  @MainActor struct ComposerAttachmentIngressTests {
    @Test func fileProvidersKeepOrderAndIgnoreWebLinks() async throws {
      let ingress = ComposerAttachmentIngress()
      let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: source) }
      let first = source.appendingPathComponent("first.pdf")
      let second = source.appendingPathComponent("second.txt")
      try Data("one".utf8).write(to: first)
      try Data("two".utf8).write(to: second)
      var files: [URL] = []
      var scratch: URL?
      let web = try #require(URL(string: "https://example.com/image.png"))
      ingress.receive([NSItemProvider(object: first as NSURL), NSItemProvider(object: web as NSURL), NSItemProvider(object: second as NSURL)], files: { urls, root in
        files = urls
        scratch = root
      }, image: { _ in Issue.record("Unexpected image") }, failure: { Issue.record("\($0)") })
      await ingress.pending?.value
      defer {
        if let scratch {
          try? FileManager.default.removeItem(at: scratch)
        }
      }
      #expect(files.map(\.lastPathComponent) == ["first.pdf", "second.txt"])
      #expect(try files.map { try Data(contentsOf: $0) } == [Data("one".utf8), Data("two".utf8)])
      #expect(files.allSatisfy { $0.resolvingSymlinksInPath() != first.resolvingSymlinksInPath() && $0.resolvingSymlinksInPath() != second.resolvingSymlinksInPath() })
    }

    @Test(arguments: [("empty.txt", 0), ("oversized.pdf", 100 * 1024 * 1024 + 1), ("unsupported.exe", 1)])
    func invalidFilesAreRejectedBeforeHandoff(name: String, size: Int) async throws {
      let ingress = ComposerAttachmentIngress()
      let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: source) }
      let file = source.appendingPathComponent(name)
      try Data().write(to: file)
      let handle = try FileHandle(forWritingTo: file)
      try handle.truncate(atOffset: UInt64(size))
      try handle.close()
      var failed = false
      ingress.receive([NSItemProvider(object: file as NSURL)], files: { _, scratch in
        Issue.record("Invalid file reached upload handoff")
        try? FileManager.default.removeItem(at: scratch)
      }, image: { _ in Issue.record("Unexpected image") }, failure: { error in
        failed = error is AttachmentUpload.Failure
      })
      await ingress.pending?.value
      #expect(failed)
    }

    @Test func editorExitPreservesPaneTargetAndPaneExitPreservesEditorTarget() {
      let ingress = ComposerAttachmentIngress()
      let editor = MacComposerTextInput.InputView()
      editor.attachmentDragChanged = { ingress.isEditorTargeted = $0 }
      ingress.isTargeted = true
      editor.attachmentDragChanged?(true)
      editor.draggingExited(nil)
      #expect(ingress.isDropTargeted)
      ingress.isTargeted = false
      #expect(!ingress.isDropTargeted)
      editor.attachmentDragChanged?(true)
      #expect(ingress.isDropTargeted)
      ingress.isTargeted = true
      ingress.isTargeted = false
      #expect(ingress.isDropTargeted)
      ingress.cancel()
      #expect(!ingress.isDropTargeted)
    }

    @Test func decodingIsBusyAndCancelledCompletionCannotClearNewWork() async {
      let ingress = ComposerAttachmentIngress()
      let started = AsyncStream<Void>.makeStream()
      let release = AsyncStream<Void>.makeStream()
      let provider = NSItemProvider()
      provider.registerDataRepresentation(forTypeIdentifier: UTType.png.identifier, visibility: .all) { completion in
        Task {
          started.continuation.yield()
          for await _ in release.stream {
            break
          }
          completion(Data([1]), nil)
        }
        return nil
      }
      var images: [Data] = []
      ingress.receive([provider], files: { _, _ in Issue.record("Unexpected files") }, image: { images.append($0) }, failure: { Issue.record("\($0)") })
      let oldPending = ingress.pending
      for await _ in started.stream {
        break
      }
      #expect(ingress.isReceiving)
      ingress.cancel()
      #expect(!ingress.isReceiving)
      let newRelease = AsyncStream<Void>.makeStream()
      let newProvider = NSItemProvider()
      newProvider.registerDataRepresentation(forTypeIdentifier: UTType.png.identifier, visibility: .all) { completion in
        Task {
          for await _ in newRelease.stream {
            break
          }
          completion(Data([2]), nil)
        }
        return nil
      }
      ingress.receive([newProvider], files: { _, _ in Issue.record("Unexpected files") }, image: { images.append($0) }, failure: { Issue.record("\($0)") })
      #expect(ingress.isReceiving)
      let newPending = ingress.pending
      release.continuation.yield()
      await oldPending?.value
      #expect(ingress.isReceiving)
      newRelease.continuation.yield()
      await newPending?.value
      #expect(images == [Data([2])])
      #expect(!ingress.isReceiving)
    }

    @Test func directoryProviderIsRejected() async throws {
      let ingress = ComposerAttachmentIngress()
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: directory) }
      var failed = false
      ingress.receive([NSItemProvider(object: directory as NSURL)], files: { _, scratch in
        Issue.record("Unexpected files")
        try? FileManager.default.removeItem(at: scratch)
      }, image: { _ in Issue.record("Unexpected image") }, failure: { _ in failed = true })
      await ingress.pending?.value
      #expect(failed)
    }

    @Test func imageProviderRoutesPNGBytes() async {
      let ingress = ComposerAttachmentIngress()
      let bytes = Data([1, 2, 3])
      var image: Data?
      ingress.receive([NSItemProvider(item: bytes as NSData, typeIdentifier: UTType.png.identifier)], files: { _, _ in Issue.record("Unexpected files") }, image: { image = $0 }, failure: { Issue.record("\($0)") })
      await ingress.pending?.value
      #expect(image == bytes)
    }

    @Test func leavingPaneDiscardsPendingProvider() async {
      let ingress = ComposerAttachmentIngress()
      let provider = NSItemProvider()
      provider.registerDataRepresentation(forTypeIdentifier: UTType.png.identifier, visibility: .all) { completion in
        completion(Data([1]), nil)
        return nil
      }
      var received = false
      ingress.receive([provider], files: { _, _ in received = true }, image: { _ in received = true }, failure: { _ in received = true })
      let pending = ingress.pending
      ingress.cancel()
      await pending?.value
      #expect(!received)
      #expect(!ingress.isTargeted)
    }
  }
#endif
