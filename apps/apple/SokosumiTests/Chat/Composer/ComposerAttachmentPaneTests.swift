#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing
  import UniformTypeIdentifiers
  import Vision

  extension NativeWindowTests {
    @MainActor struct ComposerAttachmentPaneTests {
      @Test func busyProviderKeepsEditorFileAndImagePasteOutOfDraft() async throws {
        let workspaces = WorkspaceState()
        workspaces.timeline.reset(roomId: "room")
        workspaces.timeline.failInitialLoad(message: "Fixture has no server", generation: workspaces.timeline.generation)
        let userId = UUID().uuidString
        let saved = SavedComposeDraft(userId: userId, organizationId: nil, roomId: "room")
        defer { saved.save("") }
        let uploads = ComposeUploads(savedDraft: saved)
        let ingress = ComposerAttachmentIngress()
        let release = AsyncStream<Void>.makeStream()
        let provider = NSItemProvider()
        provider.registerDataRepresentation(forTypeIdentifier: UTType.png.identifier, visibility: .all) { completion in
          Task {
            for await _ in release.stream {
              break
            }
            completion(Data([1]), nil)
          }
          return nil
        }
        ingress.receive([provider], files: { _, _ in Issue.record("Unexpected file") }, image: { _ in }, failure: { Issue.record("\($0)") })
        let pending = ingress.pending
        defer {
          ingress.cancel()
          release.continuation.yield()
        }
        let content = ChatComposerView(userId: userId, organizationId: nil, roomId: "room")
          .environmentObject(workspaces)
          .environmentObject(AuthState())
          .environmentObject(uploads)
          .environmentObject(ingress)
          .frame(width: 520)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let input = try await waitForView(in: host, timeoutMessage: "Busy composer did not mount") { Self.inputView(in: host) }
        assertAttachmentPastesPreserveDraft(input, uploads: uploads)
        ingress.cancel()
        release.continuation.yield()
        await pending?.value
      }

      private func assertAttachmentPastesPreserveDraft(_ input: MacComposerTextInput.InputView, uploads: ComposeUploads) {
        let pasteboard = NSPasteboard.withUniqueName()
        defer { pasteboard.releaseGlobally() }
        for image in [false, true] {
          pasteboard.clearContents()
          if image {
            pasteboard.setData(Data([2]), forType: .png)
          } else {
            pasteboard.writeObjects([URL(fileURLWithPath: "/tmp/report.pdf") as NSURL])
          }
          pasteboard.setString("unwanted fallback", forType: .string)
          input.restoreDraft("Existing draft")
          input.pasteText(from: pasteboard)
          #expect(input.serializedDraft == "Existing draft")
          #expect(uploads.uploadingName == nil)
        }
      }

      private static func inputView(in view: NSView) -> MacComposerTextInput.InputView? {
        if let input = view as? MacComposerTextInput.InputView {
          return input
        }
        return view.subviews.lazy.compactMap { inputView(in: $0) }.first
      }

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
