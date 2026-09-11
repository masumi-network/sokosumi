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
    .frame(maxWidth: .infinity, alignment: .leading)
    .sheet(isPresented: $imagePresented) {
      VStack(spacing: 16) {
        HStack {
          Button { imagePresented = false } label: {
            Label("Close", systemImage: "xmark")
          }
          .keyboardShortcut(.cancelAction)
          .help("Close")
          Text(attachment.filename).lineLimit(1)
          Spacer()
          Link(destination: attachment.url) {
            Label("Open in Browser", systemImage: "arrow.up.right.square")
          }
          .help("Open in Browser")
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
        VideoPlayer(player: player)
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
  let wrapper: FileWrapper

  init(url: URL) throws {
    wrapper = try FileWrapper(url: url, options: .immediate)
  }

  init(configuration _: ReadConfiguration) throws {
    throw CocoaError(.fileReadUnsupportedScheme)
  }

  func fileWrapper(configuration _: WriteConfiguration) throws -> FileWrapper {
    wrapper
  }
}
