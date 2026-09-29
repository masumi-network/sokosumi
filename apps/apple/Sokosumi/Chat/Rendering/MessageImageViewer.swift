import SokosumiChat
import SwiftUI

/// Which of a message's images its viewer shows. The body's image buttons open it through the
/// environment; the gallery host owns it, one per message, as web's `ChannelMessageText` owns `openImageSrc`.
@MainActor @Observable final class MessageImageViewerPresentation {
  var openURL: URL?
}

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
/// preloaded. Open and Save follow the shown image.
struct MessageImageViewer: View {
  let gallery: MessageImageGallery
  @Binding var openURL: URL?

  private static let imageSize = CGSize(width: 1600, height: 1000)

  var body: some View {
    if let image = gallery.image(for: openURL) {
      VStack(spacing: 16) {
        // Keyed by the image, as web keys its chrome, so a Save in flight belongs to its own image.
        AttachmentViewerToolbar(attachment: image, position: gallery.positionLabel(of: image.url)) { openURL = nil }
          .id(image.url)
        ZStack {
          // The neighbours load hidden beside the shown image, so a step shows a loaded image.
          ForEach(gallery.preloadWindow(around: image.url), id: \.url) { shown in
            let isShown = shown.url == image.url
            MessageImageView(url: shown.url, maxSize: Self.imageSize, alignment: .center)
              .opacity(isShown ? 1 : 0)
              .accessibilityHidden(!isShown)
          }
        }
        .frame(minWidth: 300, idealWidth: 800, maxWidth: .infinity, minHeight: 200, idealHeight: 560, maxHeight: .infinity)
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
      }
      .padding()
      #if os(macOS)
        .frame(minWidth: 640, minHeight: 480)
      #endif
    }
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
