#if os(macOS)
  import AppKit
#endif
import SokosumiChat
import SwiftUI

/// Which of a message's images its viewer shows. The body's image buttons open it through the
/// environment; the gallery host owns it, one per message, as web's `ChannelMessageText` owns `openImageSrc`.
@MainActor @Observable final class MessageImageViewerPresentation {
  var openURL: URL?
}

#if os(macOS)
  extension EnvironmentValues {
    /// The pasteboard the viewer's Copy Image writes to; tests pass a private one.
    @Entry var imageCopyPasteboard: NSPasteboard.Name = .general
  }
#endif

extension View {
  /// Presents the viewer over `gallery` for the image buttons inside this view.
  @ViewBuilder func messageImageGallery(_ gallery: MessageImageGallery?) -> some View {
    if let gallery, !gallery.images.isEmpty {
      modifier(MessageImageGalleryHost(gallery: gallery))
    } else {
      self
    }
  }
}

private struct MessageImageGalleryHost: ViewModifier {
  let gallery: MessageImageGallery
  @State private var presentation = MessageImageViewerPresentation()

  func body(content: Content) -> some View {
    @Bindable var presentation = presentation
    content
      .environment(presentation)
      // The open image left the live message (edited out): forget it, so an edit that brings the
      // file back does not reopen the viewer by itself.
      .onChange(of: gallery) { _, gallery in
        presentation.openURL = gallery.image(for: presentation.openURL)?.url
      }
      .sheet(isPresented: Binding(
        get: { gallery.image(for: presentation.openURL) != nil },
        set: {
          if !$0 {
            presentation.openURL = nil
          }
        }
      )) {
        MessageImageViewer(gallery: gallery, openURL: $presentation.openURL)
      }
  }
}

/// Web's `ImageViewer` over one message's images: the file name with its position from two images
/// up, previous/next controls on the image edges and ← / → that stop at the ends, the neighbours
/// preloaded, and zoom controls on the image. Open, Copy Image and Save follow the shown image.
struct MessageImageViewer: View {
  let gallery: MessageImageGallery
  @Binding var openURL: URL?
  /// The zoom belongs to `zoomedURL` only: web keys its chrome by the image, so every image,
  /// including one stepped back to, opens at 100 %. Reopening the sheet starts fresh as well.
  @State private var zoom = ImageViewerZoom()
  @State private var zoomedURL: URL?
  @State private var pinchStart: ImageViewerZoom?

  private static let imageSize = CGSize(width: 1600, height: 1000)

  var body: some View {
    if let image = gallery.image(for: openURL) {
      let imageZoom = zoomBinding(for: image.url)
      VStack(spacing: 16) {
        // Keyed by the image, as web keys its chrome, so a Save or Copy in flight belongs to its own image.
        AttachmentViewerToolbar(attachment: image, position: gallery.positionLabel(of: image.url), offersImageActions: true) { openURL = nil }
          .id(image.url)
        ZStack {
          // The neighbours load hidden beside the shown image, so a step shows a loaded image.
          ForEach(gallery.preloadWindow(around: image.url), id: \.url) { shown in
            let isShown = shown.url == image.url
            MessageImageView(url: shown.url, maxSize: Self.imageSize, alignment: .center)
              .scaleEffect(isShown ? imageZoom.wrappedValue.scale : 1)
              .animation(.easeOut(duration: 0.15), value: isShown ? imageZoom.wrappedValue.scale : 1)
              .opacity(isShown ? 1 : 0)
              .accessibilityHidden(!isShown)
          }
        }
        .frame(minWidth: 300, idealWidth: 800, maxWidth: .infinity, minHeight: 200, idealHeight: 560, maxHeight: .infinity)
        // As web's stage: a zoomed image stays centred and is cut at the image area.
        .clipped()
        .contentShape(.rect)
        .simultaneousGesture(MagnifyGesture()
          .onChanged { value in
            let start = pinchStart ?? imageZoom.wrappedValue
            pinchStart = start
            imageZoom.wrappedValue = .magnified(start, by: value.magnification)
          }
          .onEnded { _ in pinchStart = nil })
        .overlay {
          if gallery.images.count > 1 {
            HStack {
              MessageImageStepButton(edge: .leading, isEnabled: gallery.previous(before: image.url) != nil) { step(.leading) }
              Spacer(minLength: 0)
              MessageImageStepButton(edge: .trailing, isEnabled: gallery.next(after: image.url) != nil) { step(.trailing) }
            }
            .padding(.horizontal, 16)
          }
        }
        .overlay(alignment: .bottom) {
          MessageImageZoomControls(zoom: imageZoom)
            .padding(.bottom, 16)
        }
      }
      .padding()
      #if os(macOS)
        .frame(minWidth: 640, minHeight: 480)
      #endif
        // Leaving an image forgets its zoom, so stepping back shows it at 100 % again.
        .onChange(of: image.url) {
          zoomedURL = nil
          pinchStart = nil
        }
    }
  }

  private func zoomBinding(for url: URL) -> Binding<ImageViewerZoom> {
    Binding(
      get: { zoomedURL == url ? zoom : ImageViewerZoom() },
      set: {
        zoom = $0
        zoomedURL = url
      }
    )
  }

  /// Steps from the image open now, not the one a render captured: a key equivalent can run an
  /// action registered before the last step.
  private func step(_ edge: HorizontalEdge) {
    guard let current = openURL,
          let image = edge == .leading ? gallery.previous(before: current) : gallery.next(after: current) else { return }
    openURL = image.url
    if let announcement = gallery.stepAnnouncement(for: image.url) {
      AccessibilityNotification.Announcement(announcement).post()
    }
  }
}

/// Web's round previous/next control on the media scrim; inert at the end it points past.
private struct MessageImageStepButton: View {
  let edge: HorizontalEdge
  let isEnabled: Bool
  let action: () -> Void

  private var title: String {
    edge == .leading ? "Previous image" : "Next image"
  }

  var body: some View {
    Button(action: action) {
      Image(systemName: edge == .leading ? "chevron.left" : "chevron.right")
        .font(.title3.weight(.semibold))
        .foregroundStyle(.white)
        .frame(width: 44, height: 44)
        .background(.black.opacity(0.55), in: .circle)
        .contentShape(.circle)
    }
    .buttonStyle(.plain)
    .keyboardShortcut(edge == .leading ? .leftArrow : .rightArrow, modifiers: [])
    .disabled(!isEnabled)
    .opacity(isEnabled ? 1 : 0.5)
    .help(title)
    .accessibilityLabel(title)
  }
}

/// Web's zoom bar at the bottom of the image: Zoom out, Reset zoom and Zoom in on the media scrim,
/// the outer two disabled at 25 % and 400 %. Their keys are ⌘−, ⌘0 and ⌘+ (also ⌘=, the unshifted
/// key on layouts that put + above it).
private struct MessageImageZoomControls: View {
  @Binding var zoom: ImageViewerZoom

  var body: some View {
    HStack(spacing: 4) {
      control("Zoom Out", systemImage: "minus", key: "-", isEnabled: zoom.canZoomOut) { zoom.zoomOut() }
      control("Reset Zoom", systemImage: "magnifyingglass", key: "0", isEnabled: true) { zoom.reset() }
      control("Zoom In", systemImage: "plus", key: "+", isEnabled: zoom.canZoomIn) { zoom.zoomIn() }
        .background {
          Button("Zoom In") { zoom.zoomIn() }
            .keyboardShortcut("=", modifiers: .command)
            .disabled(!zoom.canZoomIn)
            .opacity(0)
            .accessibilityHidden(true)
        }
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(.black.opacity(0.55), in: .capsule)
  }

  private func control(_ title: String, systemImage: String, key: KeyEquivalent, isEnabled: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.body.weight(.semibold))
        .foregroundStyle(.white)
        .frame(width: 36, height: 36)
        .contentShape(.circle)
    }
    .buttonStyle(.plain)
    .keyboardShortcut(key, modifiers: .command)
    .disabled(!isEnabled)
    .opacity(isEnabled ? 1 : 0.5)
    .help(title)
    .accessibilityLabel(title)
  }
}
