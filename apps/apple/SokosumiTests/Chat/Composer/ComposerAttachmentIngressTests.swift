#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing
  import UniformTypeIdentifiers

  @MainActor struct ComposerAttachmentIngressTests {
    @Test func fileProvidersKeepOrderAndIgnoreWebLinks() async throws {
      let ingress = ComposerAttachmentIngress()
      var files: [URL] = []
      let first = URL(fileURLWithPath: "/tmp/first.pdf")
      let second = URL(fileURLWithPath: "/tmp/second.txt")
      let web = try #require(URL(string: "https://example.com/image.png"))
      ingress.receive([NSItemProvider(object: first as NSURL), NSItemProvider(object: web as NSURL), NSItemProvider(object: second as NSURL)], files: { files = $0 }, image: { _ in Issue.record("Unexpected image") }, failure: { Issue.record("\($0)") })
      await ingress.pending?.value
      #expect(files == [first, second])
    }

    @Test func imageProviderRoutesPNGBytes() async {
      let ingress = ComposerAttachmentIngress()
      let bytes = Data([1, 2, 3])
      var image: Data?
      ingress.receive([NSItemProvider(item: bytes as NSData, typeIdentifier: UTType.png.identifier)], files: { _ in Issue.record("Unexpected files") }, image: { image = $0 }, failure: { Issue.record("\($0)") })
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
      ingress.receive([provider], files: { _ in received = true }, image: { _ in received = true }, failure: { _ in received = true })
      let pending = ingress.pending
      ingress.cancel()
      await pending?.value
      #expect(!received)
      #expect(!ingress.isTargeted)
    }
  }
#endif
