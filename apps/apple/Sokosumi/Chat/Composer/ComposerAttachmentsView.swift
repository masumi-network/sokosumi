import SokosumiChat
import SwiftUI

/// The composer's finished uploads as web's `FileChipMiniPreview` tiles, then the native upload
/// progress, Cancel and error rows.
struct ComposerAttachmentsView: View {
  @ObservedObject var uploads: ComposeUploads

  var body: some View {
    if !uploads.attachments.isEmpty {
      WrappingRow(spacing: 8) {
        ForEach(uploads.attachments) { attachment in
          ComposerAttachmentChip(attachment: attachment) { uploads.remove(attachment) }
        }
      }
    }
    if let name = uploads.uploadingName {
      HStack {
        ProgressView().controlSize(.small)
        Text("Uploading \(name)…").font(.callout)
        Button("Cancel", action: uploads.cancel)
      }
    }
    if let error = uploads.errorMessage {
      Text(error).font(.callout).foregroundStyle(.red)
    }
  }
}

/// One 64 pt draft tile: an image crops to a square and opens its own viewer, anything else shows
/// its file-type icon and opens the document viewer. Hovering names the file and its size; the
/// Remove control stays visible on the top-trailing corner.
private struct ComposerAttachmentChip: View {
  let attachment: ComposeAttachment
  let remove: () -> Void

  var body: some View {
    Group {
      if let preview = attachment.preview {
        if preview.kind == .image {
          MessageAttachmentView(attachment: preview, compact: true)
            .help(attachment.metadata())
            .messageImageGallery(MessageImageGallery([preview]))
        } else {
          AttachmentDocumentButton(attachment: preview, help: attachment.metadata())
        }
      } else {
        // Not a web URL, so nothing to preview; the tile stays removable.
        Image(systemName: "doc")
          .font(.title2)
          .foregroundStyle(.secondary)
          .frame(width: 64, height: 64)
          .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 16))
          .help(attachment.metadata())
      }
    }
    .frame(width: 64, height: 64)
    .overlay(alignment: .topTrailing) {
      Button(action: remove) {
        Image(systemName: "xmark")
          .font(.system(size: 8, weight: .bold))
          .frame(width: 20, height: 20)
          .background(.regularMaterial, in: .circle)
          .overlay(Circle().strokeBorder(.separator))
          .shadow(color: .black.opacity(0.15), radius: 1, y: 1)
          .contentShape(.circle)
      }
      .buttonStyle(.plain)
      .padding(4)
      .help("Remove \(attachment.fileName)")
      .accessibilityLabel("Remove \(attachment.fileName)")
    }
  }
}
