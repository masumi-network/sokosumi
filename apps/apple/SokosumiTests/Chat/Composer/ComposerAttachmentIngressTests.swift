#if os(macOS)
  import AppKit
  @testable import Sokosumi
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
