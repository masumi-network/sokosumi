#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct AdjacentAttachmentTests {
      private func link(_ name: String) -> String {
        "[\(name).svg](https://scroll-fixture.invalid/attachment-row/\(name).svg?format=svg&shape=portrait)"
      }

      @Test(arguments: [CGFloat(300), 110])
      func adjacentImagesAreSquaresAndWrap(width: CGFloat) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let source = link("a") + "\n\n" + link("b")
        let host = NSHostingView(rootView: content(source, width: width, dark: false))
        let window = window(host, width: width)
        defer { window.orderOut(nil) }
        var bounds = CGRect.zero
        for _ in 0 ..< 250 {
          try await Task.sleep(for: .milliseconds(20))
          bounds = try greenBounds(bitmap(host))
          let scale = try CGFloat(bitmap(host).pixelsWide) / host.bounds.width
          if abs(bounds.width / scale - (width == 300 ? 136 : 64)) < 3,
             abs(bounds.height / scale - (width == 300 ? 64 : 136)) < 3 {
            break
          }
        }
        let scale = try CGFloat(bitmap(host).pixelsWide) / host.bounds.width
        #expect(abs(bounds.width / scale - (width == 300 ? 136 : 64)) < 3)
        #expect(abs(bounds.height / scale - (width == 300 ? 64 : 136)) < 3)
      }

      @Test(arguments: ["portrait", "landscape"])
      func fittedImageRoundsEveryCorner(shape: String) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let url = try #require(URL(string: "https://scroll-fixture.invalid/attachment-corners/\(shape).svg?format=svg&shape=\(shape)"))
        let attachment = try #require(MessageAttachment(url: url, label: "photo"))
        let host = NSHostingView(rootView: MessageAttachmentView(attachment: attachment).frame(width: 400).background(.background))
        let window = window(host, width: 400)
        defer { window.orderOut(nil) }
        var shot = try bitmap(host)
        var bounds = CGRect.zero
        for _ in 0 ..< 250 {
          try await Task.sleep(for: .milliseconds(20))
          shot = try bitmap(host)
          bounds = greenBounds(shot)
          if bounds.width > 0 {
            break
          }
        }
        try #require(bounds.width > 0)
        for column in [bounds.minX + 2, bounds.maxX - 4] {
          for row in [bounds.minY + 2, bounds.maxY - 4] {
            #expect(!isGreen(shot, column: Int(column), row: Int(row)), "The fitted image's corner must be clipped, including its trailing edge.")
          }
        }
      }

      @Test(arguments: [false, true])
      func rendersMixedRunAndSoloImage(dark: Bool) async throws {
        URLProtocol.registerClass(ScrollMediaProtocol.self)
        defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self) }
        let source = "### Files from Friday\n\n" + link("a") + " " + link("b")
          + " [notes.pdf](https://example.com/notes.pdf)\n\nOne image keeps its large preview.\n\n" + link("c")
        let host = NSHostingView(rootView: content(source, width: 420, dark: dark))
        let window = window(host, width: 420, dark: dark)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 250 {
          try await Task.sleep(for: .milliseconds(20))
          if try greenBounds(bitmap(host)).height > 300 {
            break
          }
        }
        host.frame.size.height = host.fittingSize.height
        window.setContentSize(host.fittingSize)
        let shot = try bitmap(host)
        #expect(host.fittingSize.height < 580, "The first two images share a compact tile row.")
        let data = try #require(shot.representation(using: .png, properties: [:]))
        try Attachment.record(data, named: "adjacent-attachments-\(dark ? "dark" : "light").png")
      }

      private func content(_ source: String, width: CGFloat, dark: Bool) -> some View {
        MessageMarkdownView(source: source, preparedDocument: MessageMarkdown(source))
          .padding(12)
          .frame(width: width, alignment: .leading)
          .background(Color(nsColor: .windowBackgroundColor))
          .environmentObject(WorkspaceState()).environmentObject(AuthState())
          .environment(\.colorScheme, dark ? .dark : .light)
      }

      private func window(_ host: NSView, width: CGFloat, dark: Bool = false) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 800), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        return window
      }

      private func bitmap(_ view: NSView) throws -> NSBitmapImageRep {
        view.layoutSubtreeIfNeeded()
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return bitmap
      }

      private func isGreen(_ bitmap: NSBitmapImageRep, column: Int, row: Int) -> Bool {
        var pixel = [Int](repeating: 0, count: max(bitmap.samplesPerPixel, 4))
        bitmap.getPixel(&pixel, atX: column, y: row)
        let top = Double((1 << bitmap.bitsPerSample) - 1)
        return Double(pixel[0]) / top < 0.6 && Double(pixel[1]) / top > 0.7 && Double(pixel[2]) / top < 0.35
      }

      private func greenBounds(_ bitmap: NSBitmapImageRep) -> CGRect {
        var bounds = CGRect.null
        for row in stride(from: 0, to: bitmap.pixelsHigh, by: 2) {
          for column in stride(from: 0, to: bitmap.pixelsWide, by: 2) where isGreen(bitmap, column: column, row: row) {
            bounds = bounds.union(CGRect(x: column, y: row, width: 2, height: 2))
          }
        }
        return bounds.isNull ? .zero : bounds
      }
    }
  }
#endif
