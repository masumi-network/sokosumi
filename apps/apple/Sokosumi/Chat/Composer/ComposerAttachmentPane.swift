#if os(macOS)
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import UniformTypeIdentifiers

  /// The room or reply pane owns one upload queue; every ingress reaches its composer.
  struct ComposerAttachmentPane: ViewModifier {
    @EnvironmentObject private var workspaces: WorkspaceState
    @EnvironmentObject private var auth: AuthState
    @StateObject private var uploads: ComposeUploads
    @StateObject private var ingress = ComposerAttachmentIngress()
    let roomId: String

    init(userId: String, organizationId: String?, roomId: String, parentMessageId: String? = nil) {
      self.roomId = roomId
      _uploads = StateObject(wrappedValue: ComposeUploads(savedDraft: SavedComposeDraft(userId: userId, organizationId: organizationId, roomId: roomId, parentMessageId: parentMessageId)))
    }

    private var enabled: Bool {
      workspaces.canAttachFiles(roomId: roomId) && uploads.uploadingName == nil
    }

    func body(content: Content) -> some View {
      content
        .environmentObject(uploads)
        .environmentObject(ingress)
        .modifier(ComposerAttachmentDropZone(ingress: ingress, enabled: enabled, receive: receive))
        .onDisappear {
          Task { @MainActor in
            ingress.cancel()
            uploads.cancel()
          }
        }
    }

    private func receive(_ providers: [NSItemProvider]) {
      guard enabled else { return }
      ingress.receive(providers, files: { files in
        guard enabled else { return }
        uploads.upload(files) { file in try await workspaces.uploadAttachment(file, roomId: roomId, auth: auth) }
      }, image: { data in
        guard enabled else { return }
        uploads.upload(data, filename: "image.png", using: { file in try await workspaces.uploadAttachment(file, roomId: roomId, auth: auth) })
      }, failure: uploads.report)
    }
  }

  struct ComposerAttachmentDropZone: ViewModifier {
    @ObservedObject var ingress: ComposerAttachmentIngress
    let enabled: Bool
    let receive: ([NSItemProvider]) -> Void

    func body(content: Content) -> some View {
      content
        .focusable()
        .focusEffectDisabled()
        .onPasteCommand(of: enabled ? [.fileURL, .png, .tiff] : []) { receive($0) }
        .onDrop(of: [.fileURL], isTargeted: $ingress.isTargeted) { providers in
          guard enabled else { return false }
          ingress.isTargeted = false
          receive(providers)
          return true
        }
        .overlay {
          if enabled, ingress.isTargeted {
            ComposerAttachmentDropOverlay()
          }
        }
        .onChange(of: enabled) { _, enabled in
          if !enabled {
            Task { @MainActor in ingress.cancel() }
          }
        }
    }
  }

  struct ComposerAttachmentDropOverlay: View {
    var body: some View {
      ZStack {
        Color.accentColor.opacity(0.12)
        Label("Drop files to attach", systemImage: "paperclip")
          .font(.headline)
          .padding()
          .background(.background, in: .rect(cornerRadius: 8))
          .overlay { RoundedRectangle(cornerRadius: 8).stroke(.separator) }
      }
      .allowsHitTesting(false)
      .accessibilityHidden(true)
    }
  }
#endif
