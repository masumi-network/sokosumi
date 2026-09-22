#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct MessageImageLoadingTests {
      @Test(arguments: [false, true], [CGFloat(320), 700])
      func loadingAndRemountingImagesPreservesSpace(unfurl: Bool, width: CGFloat) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let url = try #require(URL(string: "https://scroll-fixture.invalid/\(UUID()).png"))
        let attachment = try #require(MessageAttachment(url: url, label: "Image"))
        let content = Group {
          if unfurl {
            MessageUnfurlView(preview: .init(url: "https://example.com", title: "Preview", imageUrl: url.absoluteString))
          } else {
            MessageAttachmentView(attachment: attachment)
          }
        }
        .frame(width: width, alignment: .leading)
        .background(.background)
        .environment(\.colorScheme, .dark)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        let loadingHeight = host.fittingSize.height
        try await waitForImage(in: host)
        let loadedHeight = host.fittingSize.height
        #expect(loadedHeight > 100)
        #expect(loadingHeight + 1 >= loadedHeight, "Loading an image must not grow the message from a small spinner.")

        let remounted = NSHostingView(rootView: content)
        window.contentView = remounted
        remounted.layoutSubtreeIfNeeded()
        #expect(abs(remounted.fittingSize.height - loadedHeight) <= 1, "A returning row must reserve its known image proportions before the download finishes.")
        window.setContentSize(NSSize(width: width, height: loadedHeight))
        try await waitForImage(in: remounted)
        #expect(abs(remounted.fittingSize.height - loadedHeight) <= 1)
      }

      @Test func unfurlPortraitImageFillsTheTextColumn() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let url = try #require(URL(string: "https://scroll-fixture.invalid/\(UUID())?format=svg&shape=portrait"))
        let content = MessageUnfurlView(preview: .init(url: "https://example.com", title: "Preview", imageUrl: url.absoluteString))
          .frame(maxWidth: 700, alignment: .leading)
          .environment(\.colorScheme, .dark)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await waitForImage(in: host)
        host.layoutSubtreeIfNeeded()
        // Fill uses the 380pt image budget; fit of 80×160 would be ~100pt plus padding.
        #expect(host.fittingSize.width >= 360)
      }

      @Test(arguments: ["landscape", "portrait", "wide"])
      func nativeSVGWithoutFilenameExtensionPreservesProportions(shape: String) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let url = try #require(URL(string: "https://scroll-fixture.invalid/\(UUID())?format=svg&shape=\(shape)"))
        let content = MessageImageView(url: url, maxSize: CGSize(width: 640, height: 360))
          .frame(width: 320, alignment: .leading)
        let host = NSHostingView(rootView: content)
        let window = imageWindow(host)
        defer { window.orderOut(nil) }
        try await waitForImage(in: host)
        let expectedHeight: CGFloat = shape == "portrait" ? 360 : (shape == "wide" ? 40 : 320 / 1.5)
        #expect(abs(host.fittingSize.height - expectedHeight) <= 1)
      }

      @Test func cancelledFailureDoesNotReplaceNewImage() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let oldURL = try #require(URL(string: "https://scroll-fixture.invalid/\(UUID()).png?failure&delay=0.4"))
        let newURL = try #require(URL(string: "https://scroll-fixture.invalid/\(UUID()).png"))
        var failures: [URL] = []
        func content(_ url: URL) -> some View {
          MessageImageView(url: url, maxSize: CGSize(width: 640, height: 360)) { failures.append($0) }
            .frame(width: 320, alignment: .leading)
        }
        let host = NSHostingView(rootView: content(oldURL))
        let window = imageWindow(host)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(50))
        host.rootView = content(newURL)
        try await waitForImage(in: host)
        try await Task.sleep(for: .milliseconds(450))
        #expect(failures.isEmpty)
        try await waitForImage(in: host)
        #expect(abs(host.fittingSize.height - 320 / 1.5) <= 1)
      }

      @Test func unfurlImageCanRecoverAfterURLChanges() async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let oldURL = "https://scroll-fixture.invalid/\(UUID()).png?failure"
        let newURL = "https://scroll-fixture.invalid/\(UUID()).png"
        func content(_ url: String) -> some View {
          MessageUnfurlView(preview: .init(url: "https://example.com", title: "Preview", imageUrl: url))
            .frame(width: 320, alignment: .leading)
        }
        let host = NSHostingView(rootView: content(oldURL))
        let window = imageWindow(host)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 100 {
          try await Task.sleep(for: .milliseconds(20))
          host.layoutSubtreeIfNeeded()
          if host.fittingSize.height == 0 {
            break
          }
        }
        #expect(host.fittingSize.height == 0, "An image-only card disappears after a failed download.")
        host.rootView = content(newURL)
        // Keep a real viewport after the empty card shrinks this isolated hosting window.
        window.setContentSize(NSSize(width: 320, height: 500))
        try await waitForImage(in: host)
        #expect(host.fittingSize.height > 100)
      }

      private func imageWindow(_ host: NSView) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        return window
      }

      @discardableResult
      private func waitForImage(in host: NSView) async throws -> NSBitmapImageRep {
        for _ in 0 ..< 150 {
          host.layoutSubtreeIfNeeded()
          if let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
            host.cacheDisplay(in: host.bounds, to: bitmap)
            // Saturated green is distinct from the loading chrome and the link accent.
            for row in stride(from: 0, to: bitmap.pixelsHigh, by: 20) {
              for column in stride(from: 0, to: bitmap.pixelsWide, by: 20) {
                if let color = bitmap.colorAt(x: column, y: row),
                   color.greenComponent > 0.7, color.blueComponent < 0.35,
                   color.redComponent < 0.6, color.alphaComponent > 0.9 {
                  return bitmap
                }
              }
            }
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        Issue.record("The delayed fixture image never rendered (frame: \(host.frame), fitting: \(host.fittingSize)).")
        throw CocoaError(.fileReadUnknown)
      }
    }
  }
#endif
