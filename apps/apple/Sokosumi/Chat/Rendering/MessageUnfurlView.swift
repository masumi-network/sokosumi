import CoreAPI
import SokosumiChat
import SwiftUI

struct MessageUnfurlView: View {
  let preview: Components.Schemas.ChatRoomMessageUnfurl
  var remove: (() async throws -> Void)?
  @State private var imageFailed = false
  @State private var removing = false
  @State private var hovered = false
  @State private var errorMessage: String?

  private var description: String {
    preview.description?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  private var imageURL: URL? {
    guard !imageFailed else { return nil }
    return preview.imageUrl.flatMap(URL.init(string:))
  }

  var body: some View {
    if !description.isEmpty || imageURL != nil, let destination = URL(string: preview.url) {
      Link(destination: destination) {
        VStack(alignment: .leading, spacing: 4) {
          if let site = preview.siteName, !site.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text(site.uppercased()).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
          }
          Text(preview.title).font(.callout.weight(.semibold)).lineLimit(2)
          if !description.isEmpty {
            Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          }
          if let imageURL {
            AsyncImage(url: imageURL) { phase in
              switch phase {
              case let .success(image): image.resizable().scaledToFit().frame(maxHeight: 200).clipShape(.rect(cornerRadius: 4))
              case .failure: Color.clear.frame(height: 0).task { imageFailed = true }
              default: ProgressView().frame(height: 60)
              }
            }
          }
        }
        .padding(10)
        .frame(maxWidth: 400, alignment: .leading)
        .background(.primary.opacity(hovered ? 0.08 : 0.04), in: .rect(cornerRadius: 6))
        .overlay(alignment: .leading) { Rectangle().fill(.tint.opacity(0.6)).frame(width: 2) }
        .clipShape(.rect(cornerRadius: 6))
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Open link: \(preview.title)")
      .overlay(alignment: .topTrailing) {
        if let remove {
          Button {
            removing = true
            Task { @MainActor in
              defer { removing = false }
              do { try await remove() } catch { errorMessage = friendlyMessage(for: error) }
            }
          } label: {
            Image(systemName: "xmark").font(.caption).frame(width: 16, height: 16)
          }
          .buttonStyle(.bordered)
          .controlSize(.mini)
          .buttonBorderShape(.circle)
          .offset(x: 8, y: -8)
          .disabled(removing)
          .help("Remove preview")
          .accessibilityLabel("Remove preview: \(preview.title)")
        }
      }
      .padding(.top, remove == nil ? 0 : 8)
      .padding(.trailing, remove == nil ? 0 : 8)
      .onHover { hovered = $0 }
      .alert("Unable to remove preview", isPresented: Binding(get: { errorMessage != nil }, set: {
        if !$0 {
          errorMessage = nil
        }
      })) {
        Button("OK") { errorMessage = nil }
      } message: { Text(errorMessage ?? "") }
    }
  }
}
