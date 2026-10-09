#if os(macOS)
  import AppKit
#endif
import AVKit
import SokosumiChat
import SwiftUI
import UniformTypeIdentifiers

struct MessageAttachmentView: View {
  let attachment: MessageAttachment
  var compact = false
  /// The message's image viewer; an image opens it on itself.
  @Environment(MessageImageViewerPresentation.self) private var imageViewer: MessageImageViewerPresentation?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      switch attachment.kind {
      case .image:
        Button { imageViewer?.openURL = attachment.url } label: {
          MessageImageView(url: attachment.url,
                           maxSize: compact ? CGSize(width: 64, height: 64) : CGSize(width: 640, height: 320),
                           fills: compact, cropAspectRatio: compact ? 1 : nil, cornerRadius: 8)
            .frame(width: compact ? 64 : nil, height: compact ? 64 : nil)
            .clipped()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Preview \(attachment.filename)")
      case .audio, .video:
        AttachmentMediaView(url: attachment.url, audioOnly: attachment.kind == .audio)
      case .file:
        AttachmentDocumentButton(attachment: attachment)
      }
      if attachment.kind == .audio || attachment.kind == .video {
        HStack(spacing: 8) {
          Image(systemName: attachment.kind == .audio ? "waveform" : "doc")
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 2) {
            Text(attachment.filename).lineLimit(2)
            Text(attachment.url.host ?? "").font(.caption).foregroundStyle(.secondary)
          }
          Link("Open", destination: attachment.url)
          AttachmentSaveButton(attachment: attachment)
        }
        .font(.callout)
      }
    }
    .frame(maxWidth: compact ? (attachment.kind == .image || attachment.kind == .file ? 64 : 384) : .infinity, alignment: .leading)
  }
}

/// A 64 pt file-type tile that opens the document viewer; a file it cannot preview offers Open and Save there.
/// `help` replaces the file-name tooltip (a draft adds its size).
struct AttachmentDocumentButton: View {
  let attachment: MessageAttachment
  var help: String?
  @State private var previewPresented = false

  var body: some View {
    Button { previewPresented = true } label: {
      AttachmentFileIcon(filename: attachment.filename, url: attachment.url)
        .frame(width: 64, height: 64)
        .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.secondary.opacity(0.25)))
        .contentShape(.rect(cornerRadius: 16))
    }
    .buttonStyle(.plain)
    .help(help ?? attachment.filename)
    .accessibilityLabel("Preview \(attachment.filename)")
    .sheet(isPresented: $previewPresented) {
      VStack(spacing: 16) {
        AttachmentViewerToolbar(attachment: attachment) { previewPresented = false }
        DocumentAttachmentPreview(attachment: attachment)
          .frame(minWidth: 300, idealWidth: 800, maxWidth: .infinity, minHeight: 200, idealHeight: 560, maxHeight: .infinity)
      }
      .padding()
      #if os(macOS)
        .frame(minWidth: 640, minHeight: 480)
      #endif
    }
  }
}

/// The document and image viewers' bar: Close, the file name (after the image's position when the
/// message has several), Open in Browser, Copy Image and Print (the image viewer) and Save.
struct AttachmentViewerToolbar: View {
  let attachment: MessageAttachment
  var position: String?
  /// The image viewer's Copy Image and Print; the document viewer has neither, as on web.
  var offersImageActions = false
  let close: () -> Void

  var body: some View {
    HStack {
      Button(action: close) {
        Label("Close", systemImage: "xmark")
      }
      .keyboardShortcut(.cancelAction)
      .help("Close")
      if let position {
        Text(position)
          .monospacedDigit()
          .foregroundStyle(.secondary)
      }
      Text(attachment.filename).lineLimit(1)
      Spacer()
      Link(destination: attachment.url) {
        Label("Open in Browser", systemImage: "arrow.up.right.square")
      }
      .help("Open in Browser")
      #if os(macOS)
        if offersImageActions {
          AttachmentCopyImageButton(url: attachment.url)
          AttachmentPrintImageButton(attachment: attachment)
        }
      #endif
      AttachmentSaveButton(attachment: attachment)
    }
    .labelStyle(.iconOnly)
    .buttonStyle(.borderless)
  }
}

#if os(macOS)
  /// Web's Copy image: the image itself, else its link, with no message either way. It shows
  /// progress while the image downloads, as Save does.
  private struct AttachmentCopyImageButton: View {
    let url: URL
    @Environment(\.imageCopyPasteboard) private var pasteboard
    @State private var copying = false

    var body: some View {
      Button { copying = true } label: {
        if copying {
          ProgressView().controlSize(.small)
        } else {
          Label("Copy Image", systemImage: "doc.on.doc")
        }
      }
      .keyboardShortcut("c", modifiers: .command)
      .help("Copy Image")
      .disabled(copying)
      .task(id: copying) {
        guard copying else { return }
        defer { copying = false }
        let image = await ImageFetch.image(at: url)
        guard !Task.isCancelled else { return }
        PlatformPasteboard.copyImage(image, from: url, to: pasteboard)
      }
    }
  }

  /// Web's Print: the shown image by itself, through the system print panel, from the same fetch as
  /// Copy Image. Web fails silently; an image that cannot be downloaded or read says so here, as Save does.
  private struct AttachmentPrintImageButton: View {
    let attachment: MessageAttachment
    @Environment(\.imagePrinter) private var printer
    @State private var preparing = false
    @State private var failed = false

    var body: some View {
      Button { preparing = true } label: {
        if preparing {
          ProgressView().controlSize(.small)
        } else {
          Label("Print…", systemImage: "printer")
        }
      }
      .keyboardShortcut("p", modifiers: .command)
      .help("Print")
      .disabled(preparing)
      .alert("Could not print image", isPresented: $failed) {
        Button("OK", role: .cancel) {}
      } message: {
        Text("The image could not be downloaded. Try again or open it in the browser.")
      }
      .task(id: preparing) {
        guard preparing else { return }
        defer { preparing = false }
        let fetched = await ImageFetch.image(at: attachment.url)
        guard !Task.isCancelled else { return }
        guard let data = fetched?.data, let image = NSImage(data: data) else {
          failed = true
          return
        }
        printer.print(image, title: attachment.filename)
      }
    }
  }
#endif

private struct AttachmentSaveButton: View {
  let attachment: MessageAttachment
  @State private var downloading = false
  @State private var exportPresented = false
  @State private var exportDocument: DownloadedAttachment?
  @State private var errorMessage: String?

  private var exportFilename: String {
    let name = attachment.filename.trimmingCharacters(in: .whitespacesAndNewlines)
    let ext = attachment.url.pathExtension
    if (name as NSString).pathExtension.isEmpty, !ext.isEmpty {
      return "\(name.isEmpty ? "file" : name).\(ext)"
    }
    return name.isEmpty ? (attachment.url.lastPathComponent.isEmpty ? "file" : attachment.url.lastPathComponent) : name
  }

  var body: some View {
    Button { downloading = true } label: {
      if downloading {
        ProgressView().controlSize(.small)
      } else {
        Label("Save…", systemImage: "arrow.down.to.line")
      }
    }
    .help("Save attachment")
    .disabled(downloading)
    .alert("Could not save attachment", isPresented: Binding(get: { errorMessage != nil }, set: {
      if !$0 {
        errorMessage = nil
      }
    })) {
      Button("OK", role: .cancel) { errorMessage = nil }
    } message: {
      Text(errorMessage ?? "")
    }
    .task(id: downloading) {
      guard downloading else { return }
      defer { downloading = false }
      do {
        let file = try await AttachmentDownload.fetch(attachment.url)
        defer { try? FileManager.default.removeItem(at: file) }
        guard !Task.isCancelled else { return }
        exportDocument = try DownloadedAttachment(url: file)
        errorMessage = nil
        exportPresented = true
      } catch {
        if !Task.isCancelled {
          errorMessage = error.localizedDescription
        }
      }
    }
    .fileExporter(isPresented: $exportPresented, document: exportDocument, contentType: .data, defaultFilename: exportFilename) { result in
      if case let .failure(error) = result, (error as? CocoaError)?.code != .userCancelled {
        errorMessage = error.localizedDescription
      }
      exportDocument = nil
    }
  }
}

private struct AttachmentMediaView: View {
  let url: URL
  let audioOnly: Bool
  @State private var player: AVPlayer?

  var body: some View {
    Group {
      if let player {
        InlineMediaPlayer(player: player)
      } else {
        Button {
          let created = AVPlayer(url: url)
          player = created
          created.play()
        } label: {
          ZStack {
            RoundedRectangle(cornerRadius: 8).fill(.secondary.opacity(0.15))
            Image(systemName: "play.circle.fill").font(.largeTitle)
          }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(audioOnly ? "Play audio" : "Play video")
      }
    }
    .frame(maxWidth: 480)
    .frame(height: audioOnly ? 80 : 270)
    .onDisappear { player?.pause() }
  }
}

private struct DownloadedAttachment: FileDocument {
  static let readableContentTypes: [UTType] = [.data]
  let data: Data

  init(url: URL) throws {
    data = try Data(contentsOf: url)
  }

  init(configuration _: ReadConfiguration) throws {
    throw CocoaError(.fileReadUnsupportedScheme)
  }

  func fileWrapper(configuration _: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}
