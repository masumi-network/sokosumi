import AVKit
import SokosumiChat
import SwiftUI
import UniformTypeIdentifiers

struct MessageAttachmentView: View {
  let attachment: MessageAttachment
  @State private var imagePresented = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      switch attachment.kind {
      case .image:
        Button { imagePresented = true } label: {
          attachmentImage
            .frame(maxWidth: 640, maxHeight: 360)
            .clipShape(.rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Preview \(attachment.filename)")
      case .audio, .video:
        AttachmentMediaView(url: attachment.url, audioOnly: attachment.kind == .audio)
      case .file:
        EmptyView()
      }
      if attachment.kind != .image {
        HStack(spacing: 8) {
          Image(systemName: attachment.kind == .audio ? "waveform" : "doc")
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
    .frame(maxWidth: .infinity, alignment: .leading)
    .sheet(isPresented: $imagePresented) {
      VStack(spacing: 16) {
        HStack {
          Button { imagePresented = false } label: {
            Label("Close", systemImage: "xmark")
          }
          .keyboardShortcut(.cancelAction)
          Text(attachment.filename).lineLimit(1)
          Spacer()
          Link(destination: attachment.url) {
            Label("Open in Browser", systemImage: "arrow.up.right.square")
          }
          AttachmentSaveButton(attachment: attachment)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        attachmentImage.frame(minWidth: 300, idealWidth: 800, maxWidth: .infinity, minHeight: 200, idealHeight: 560, maxHeight: .infinity)
      }
      .padding()
      #if os(macOS)
        .frame(minWidth: 640, minHeight: 480)
      #endif
    }
  }

  private var attachmentImage: some View {
    AsyncImage(url: attachment.url) { phase in
      switch phase {
      case let .success(image): image.resizable().scaledToFit()
      case .failure: Label("Preview unavailable", systemImage: "photo")
      default: ProgressView().frame(width: 160, height: 100)
      }
    }
  }
}

private struct AttachmentSaveButton: View {
  let attachment: MessageAttachment
  @State private var downloading = false
  @State private var exportPresented = false
  @State private var downloaded: URL?
  @State private var errorMessage: String?

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
      removeDownload()
      do {
        let file = try await AttachmentDownload.fetch(attachment.url)
        guard !Task.isCancelled else {
          try? FileManager.default.removeItem(at: file)
          return
        }
        downloaded = file
        errorMessage = nil
        exportPresented = true
      } catch {
        if !Task.isCancelled {
          errorMessage = error.localizedDescription
        }
      }
      downloading = false
    }
    .fileExporter(isPresented: $exportPresented, document: downloaded.map(DownloadedAttachment.init), contentType: UTType(filenameExtension: attachment.url.pathExtension) ?? .data, defaultFilename: attachment.filename) { result in
      if case let .failure(error) = result {
        errorMessage = error.localizedDescription
      }
      removeDownload()
    }
    .onDisappear { Task { @MainActor in removeDownload() } }
  }

  private func removeDownload() {
    if let downloaded {
      try? FileManager.default.removeItem(at: downloaded)
    }
    downloaded = nil
  }
}

private struct AttachmentMediaView: View {
  let url: URL
  let audioOnly: Bool
  @State private var player: AVPlayer?

  var body: some View {
    VideoPlayer(player: player)
      .frame(maxWidth: 480)
      .frame(height: audioOnly ? 80 : 270)
      .task(id: url) { player = AVPlayer(url: url) }
      .onDisappear { player?.pause() }
  }
}

private struct DownloadedAttachment: FileDocument {
  static let readableContentTypes: [UTType] = [.data]
  let url: URL

  init(_ url: URL) {
    self.url = url
  }

  init(configuration _: ReadConfiguration) throws {
    throw CocoaError(.fileReadUnsupportedScheme)
  }

  func fileWrapper(configuration _: WriteConfiguration) throws -> FileWrapper {
    try FileWrapper(url: url)
  }
}
