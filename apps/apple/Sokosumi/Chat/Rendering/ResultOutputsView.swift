import AVKit
import CoreAPI
import SokosumiChat
import SwiftUI

/// Web's outputs list under a result card (`result-previews.tsx`, row 38e2): a Studio generation's as large previews
/// in two columns, every other result's in a wrapping row. Each output draws inline when web would and the app can
/// load it, else as web's file row; Download follows when Core offers one.
struct ResultOutputsView: View {
  let card: ResultPreviewCard

  var body: some View {
    if card.kind == .studioJob {
      // Web `grid grid-cols-2 gap-3`.
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 12, alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)],
                alignment: .leading, spacing: 12) {
        ForEach(card.outputs) { output in
          ResultOutputView(output: output, large: true)
        }
      }
    } else {
      // Web `flex flex-wrap gap-2`; audio and video take the row.
      WrappingRow(spacing: 8, alignment: .top, constrainsWidth: true) {
        ForEach(card.outputs) { output in
          ResultOutputView(output: output, large: false)
        }
      }
    }
  }
}

/// One output: the inline preview (web `FileChipMiniPreview`, or `FileChip`'s player for audio and video) or the file
/// row, then Download.
private struct ResultOutputView: View {
  let output: ResultPreviewCard.Output
  let large: Bool
  @Environment(\.resultOutputLoader) private var loader

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if loader != nil, let preview = output.preview, let source = output.previewSource {
        switch preview {
        case .image:
          ResultOutputImage(output: output, source: source, large: large)
        case .pdf, .text:
          ResultOutputActionButton(output: output, source: source, webURL: nil, action: .preview) { working in
            ResultOutputTile(size: 80) {
              AttachmentFileIcon(filename: output.fileName)
                .opacity(working ? 0.3 : 1)
                .overlay {
                  if working {
                    ProgressView().controlSize(.small)
                  }
                }
            }
          }
          .help(output.tooltip)
          .accessibilityLabel(Text("View document \(output.name)", tableName: chatResultsTable,
                                   comment: "Accessibility label of a result output's PDF or text tile. Argument: the file name."))
        case .audio, .video:
          ResultOutputMedia(output: output, source: source, video: preview == .video)
        }
      } else {
        ResultOutputActionButton(output: output, source: output.openSource, webURL: output.openURL, action: .preview) { working in
          ResultOutputRowLabel(output: output, working: working)
        }
      }
      if output.downloadURL != nil {
        ResultOutputActionButton(output: output, source: output.downloadSource, webURL: output.downloadURL, action: .save) { working in
          HStack(spacing: 4) {
            if working {
              ProgressView().controlSize(.mini)
            } else {
              Image(systemName: "arrow.down.to.line").accessibilityHidden(true)
            }
            Text("Download", tableName: chatResultsTable, comment: "Downloads a result's output.")
          }
          .foregroundStyle(.secondary)
        }
        .accessibilityLabel(Text("Download \(output.name)", tableName: chatResultsTable,
                                 comment: "Accessibility label of an output's download link. Argument: the file name."))
      }
    }
    .font(.caption)
  }
}

/// A control that loads the output through the coordinator and hands the file to Quick Look or the save panel. While it
/// loads it shows progress in its label; a failure says so in an alert with Core's message. Without a loader, or for
/// an href that names no Core content operation (a web page), it opens the web link, as before row 38e2.
private struct ResultOutputActionButton<Label: View>: View {
  enum Action {
    case preview
    case save
  }

  let output: ResultPreviewCard.Output
  let source: ResultOutputSource?
  let webURL: URL?
  let action: Action
  @ViewBuilder let label: (_ working: Bool) -> Label
  @Environment(\.resultOutputLoader) private var loader
  @Environment(\.resultOutputPresenter) private var presenter
  @Environment(\.openURL) private var openURL
  @State private var working = false
  @State private var failure: String?

  var body: some View {
    Button {
      if loader != nil, source != nil {
        working = true
      } else if let webURL {
        openURL(webURL)
      }
    } label: {
      label(working).contentShape(.rect)
    }
    .buttonStyle(.plain)
    .disabled(working || ((loader == nil || source == nil) && webURL == nil))
    .task(id: working) {
      guard working, let loader, let source else { return }
      defer { working = false }
      do {
        let file = try await loader.file(source, named: output.fileName)
        guard !Task.isCancelled else { return }
        switch action {
        case .preview: presenter.preview(file)
        case .save: try await presenter.save(file)
        }
      } catch {
        if !Task.isCancelled {
          failure = friendlyMessage(for: error, mode: .coreMessage)
        }
      }
    }
    .alert(Text(alertTitle), isPresented: Binding(get: { failure != nil }, set: {
      if !$0 {
        failure = nil
      }
    })) {
      Button("OK", role: .cancel) { failure = nil }
    } message: {
      Text(failure ?? "")
    }
  }

  private var alertTitle: LocalizedStringResource {
    switch action {
    case .preview:
      LocalizedStringResource("Could not open file", table: chatResultsTable,
                              comment: "Alert title when a result output could not be loaded for Quick Look.")
    case .save:
      LocalizedStringResource("Could not download file", table: chatResultsTable,
                              comment: "Alert title when a result output could not be downloaded or saved.")
    }
  }
}

/// Web's file row: the file's name, type and size; it opens the output.
private struct ResultOutputRowLabel: View {
  let output: ResultPreviewCard.Output
  let working: Bool
  @Environment(\.locale) private var locale
  @State private var hovered = false

  var body: some View {
    HStack(spacing: 8) {
      if working {
        ProgressView().controlSize(.mini)
      } else {
        Image(systemName: "doc.text").accessibilityHidden(true)
      }
      Text(description)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(8)
    .background(Color.primary.opacity(hovered ? 0.1 : 0.06), in: .rect(cornerRadius: 6))
    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.12)))
    .onHover { hovered = $0 }
  }

  /// Web: `name · type · N bytes`, each part only when Core knows it.
  private var description: String {
    var parts = [output.name]
    if let type = output.contentType {
      parts.append(type)
    }
    if let size = output.sizeBytes {
      // Resolved in the view's locale, as the `Text`s around it are.
      parts.append(String(localized: LocalizedStringResource("\(size.formatted(.number.locale(locale))) bytes", table: chatResultsTable,
                                                             locale: locale, comment: "An output's size. Argument: the formatted byte count.")))
    }
    return parts.joined(separator: " · ")
  }
}

/// Web's preview frame (`rounded-xl border bg-card-background`): an 80 pt square, or the column's width for a large one.
private struct ResultOutputTile<Content: View>: View {
  /// Nil fills the column's width (a Studio image).
  let size: CGFloat?
  @ViewBuilder let content: Content

  var body: some View {
    content
      .frame(width: size, height: size)
      .frame(maxWidth: size == nil ? .infinity : nil)
      .background(Color.primary.opacity(0.03))
      .clipShape(.rect(cornerRadius: 12))
      .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.12)))
      .contentShape(.rect(cornerRadius: 12))
  }
}

/// Web's image preview: an 80 pt square crop, or a Studio image fitted to its column up to 320 pt high. It loads when
/// it appears; a click opens Quick Look on the loaded file.
private struct ResultOutputImage: View {
  let output: ResultPreviewCard.Output
  let source: ResultOutputSource
  let large: Bool
  @Environment(\.resultOutputLoader) private var loader
  @Environment(\.resultOutputPresenter) private var presenter
  @State private var load: Load = .loading

  private enum Load {
    case loading
    case loaded(ResultOutputFile)
    case failed
  }

  var body: some View {
    Button {
      if case let .loaded(file) = load {
        presenter.preview(file)
      }
    } label: {
      ResultOutputTile(size: large ? nil : 80) {
        switch load {
        case .loading:
          ProgressView().controlSize(.small)
            .frame(height: large ? 160 : nil)
        case let .loaded(file):
          if large {
            MessageImageView(url: file.url, maxSize: CGSize(width: 576, height: 320), alignment: .center)
          } else {
            MessageImageView(url: file.url, maxSize: CGSize(width: 80, height: 80), fills: true, cropAspectRatio: 1)
          }
        case .failed:
          Image(systemName: "photo")
            .font(.title3)
            .foregroundStyle(.secondary)
            .frame(height: large ? 160 : nil)
            .help(Text("Preview unavailable", tableName: chatResultsTable,
                       comment: "A result output's image or player when its file could not be loaded."))
        }
      }
    }
    .buttonStyle(.plain)
    .help(output.tooltip)
    .accessibilityLabel(Text("View image \(output.name)", tableName: chatResultsTable,
                             comment: "Accessibility label of a result output's image. Argument: the file name."))
    .task(id: source) {
      guard let loader else { return }
      load = .loading
      do {
        let file = try await loader.file(source, named: output.fileName)
        guard !Task.isCancelled else { return }
        load = .loaded(file)
      } catch {
        guard !Task.isCancelled else { return }
        load = .failed
      }
    }
  }
}

/// Web `FileChip`'s player for audio and video: the file's icon, name and size over the native player. The bytes load
/// when Play is pressed, so a long video is fetched only for someone who watches it.
private struct ResultOutputMedia: View {
  let output: ResultPreviewCard.Output
  let source: ResultOutputSource
  let video: Bool
  @Environment(\.resultOutputLoader) private var loader
  @State private var player: AVPlayer?
  /// Keeps the playing file until the player goes.
  @State private var file: ResultOutputFile?
  @State private var loading = false
  @State private var failed = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 12) {
        AttachmentFileIcon(filename: output.fileName)
          .scaleEffect(0.8)
          .frame(width: 40, height: 40)
          .background(Color.primary.opacity(0.03), in: .rect(cornerRadius: 4))
        VStack(alignment: .leading, spacing: 2) {
          Text(output.name).font(.callout.weight(.medium)).lineLimit(1)
          if let size = output.formattedSize {
            Text(size).foregroundStyle(.secondary)
          }
        }
      }
      Group {
        if let player {
          ResultOutputPlayer(player: player)
        } else if failed {
          // Not a button any more: the file could not be loaded or the Mac cannot play it; Download stays below.
          ZStack {
            RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.08))
            Label {
              Text("Preview unavailable", tableName: chatResultsTable,
                   comment: "A result output's image or player when its file could not be loaded.")
            } icon: {
              Image(systemName: video ? "film" : "waveform")
            }
            .foregroundStyle(.secondary)
          }
        } else {
          Button { loading = true } label: {
            ZStack {
              RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.08))
              if loading {
                ProgressView().controlSize(.small)
              } else {
                Image(systemName: "play.circle.fill").font(.largeTitle)
              }
            }
            .contentShape(.rect)
          }
          .buttonStyle(.plain)
          .disabled(loading)
          .accessibilityLabel(Text("Play \(output.name)", tableName: chatResultsTable,
                                   comment: "Accessibility label of a result output's audio or video before it plays. Argument: the file name."))
        }
      }
      .frame(height: video ? 216 : 80)
    }
    .padding(8)
    .frame(maxWidth: 384, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.12)))
    .onDisappear { player?.pause() }
    .task(id: loading) {
      guard loading, let loader else { return }
      defer { loading = false }
      do {
        let loaded = try await loader.file(source, named: output.fileName)
        guard !Task.isCancelled else { return }
        // Web lets the browser try any type; AVFoundation plays no WebM and no Ogg video, and an unplayable file says so
        // here while its Download still saves it.
        guard try await AVURLAsset(url: loaded.url).load(.isPlayable), !Task.isCancelled else {
          failed = !Task.isCancelled
          return
        }
        file = loaded
        failed = false
        let created = AVPlayer(url: loaded.url)
        player = created
        created.play()
      } catch {
        if !Task.isCancelled {
          failed = true
        }
      }
    }
  }
}

/// The Mac's inline player. SwiftUI's `VideoPlayer` aborts in the Debug test host while it builds its type metadata
/// (`_AVKit_SwiftUI`, `getSuperclassMetadata`), so the card hosts `AVPlayerView` itself.
private struct ResultOutputPlayer: NSViewRepresentable {
  let player: AVPlayer

  func makeNSView(context _: Context) -> AVPlayerView {
    let view = AVPlayerView()
    view.controlsStyle = .inline
    view.player = player
    return view
  }

  func updateNSView(_ view: AVPlayerView, context _: Context) {
    if view.player !== player {
      view.player = player
    }
  }

  static func dismantleNSView(_ view: AVPlayerView, coordinator _: ()) {
    view.player?.pause()
  }
}

private extension ResultPreviewCard.Output {
  /// The platform's file size (web `formatBytes`), when Core knows it.
  var formattedSize: String? {
    sizeBytes.map { Int64($0).formatted(.byteCount(style: .file)) }
  }

  /// Web's tooltip over a preview: the name, then the size.
  var tooltip: String {
    [name, formattedSize].compactMap(\.self).joined(separator: "\n")
  }
}
