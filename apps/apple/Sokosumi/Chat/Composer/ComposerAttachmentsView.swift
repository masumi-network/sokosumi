import SokosumiChat
import SwiftUI

struct ComposerAttachmentsView: View {
  @ObservedObject var uploads: ComposeUploads

  var body: some View {
    if !uploads.attachments.isEmpty {
      ScrollView(.horizontal) {
        HStack {
          ForEach(uploads.attachments) { attachment in
            HStack(spacing: 6) {
              Label(attachment.fileName, systemImage: "doc")
                .lineLimit(1)
              Button("Remove \(attachment.fileName)", systemImage: "xmark") { uploads.remove(attachment) }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
            }
            .font(.callout)
            .padding(8)
            .background(.quaternary, in: .rect(cornerRadius: 8))
          }
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
