#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing
  import Vision

  extension NativeWindowTests {
    @MainActor struct ComposerAttachmentPaneTests {
      @Test(arguments: [false, true])
      func rendersDropOverlayOverTheWholePane(dark: Bool) async throws {
        let ingress = ComposerAttachmentIngress()
        let content = VStack(alignment: .leading, spacing: 16) {
          Text("Design review").font(.title2.bold())
          Divider()
          Text("Ada  ·  10:24").font(.headline)
          Text("Drop the revised files anywhere in this conversation.")
          Spacer()
          ComposerTextInput(text: .constant("Here are the revised files."), submit: { false })
        }
        .padding(16)
        .frame(width: 520, height: 320)
        .background(Color(nsColor: .windowBackgroundColor))
        .modifier(ComposerAttachmentDropZone(ingress: ingress, enabled: true, receive: { _ in }))
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 320), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        _ = try await waitForView(in: host, timeoutMessage: "Composer did not mount") { host.subviews.isEmpty ? nil : host }
        ingress.isTargeted = true
        var bitmap: NSBitmapImageRep?
        _ = try await waitForView(in: host, timeoutMessage: "Drop overlay did not draw") {
          guard let shot = try? fittedBitmap(of: host, in: window), let image = shot.cgImage else { return nil }
          let request = VNRecognizeTextRequest()
          request.recognitionLevel = .accurate
          guard (try? VNImageRequestHandler(cgImage: image).perform([request])) != nil else { return host }
          let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
          guard text.contains("Drop files to attach"), text.contains("Design review") else { return nil }
          bitmap = shot
          return host
        }
        let shot = try bitmap ?? fittedBitmap(of: host, in: window)
        #expect(shot.colorAt(x: 0, y: 0)?.alphaComponent == 1)
        try Attachment.record(#require(shot.representation(using: .png, properties: [:])), named: "room-file-drop-\(dark ? "dark" : "light").png")
      }
    }
  }
#endif
