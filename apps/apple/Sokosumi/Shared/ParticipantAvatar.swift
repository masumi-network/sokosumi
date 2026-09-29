import SokosumiChat
import SwiftUI

struct ParticipantAvatar: View {
  let imageURL: String?
  let name: String
  var size: CGFloat = 20
  /// A face too small for two initials (web's `monogram` on a reply bar): one initial, quiet grey.
  var monogram = false

  @Environment(\.displayScale) private var displayScale
  @State private var cgImage: CGImage?

  var body: some View {
    fill
      .frame(width: size, height: size)
      .compositingGroup()
      .clipShape(Circle())
      .task(id: "\(imageURL ?? "")-\(size)-\(displayScale)") {
        let loaded = await loadImageThumbnail(
          urlString: imageURL,
          pointSize: size,
          scale: displayScale
        )
        guard !Task.isCancelled else { return }
        cgImage = loaded?.cgImage
      }
  }

  @ViewBuilder
  private var fill: some View {
    if let cgImage {
      Image(decorative: cgImage, scale: displayScale)
        .resizable()
        .interpolation(.high)
        .scaledToFill()
    } else {
      initialsView
    }
  }

  @ViewBuilder
  private var initialsView: some View {
    if monogram {
      Text(String(initials(for: name).prefix(1)))
        .font(.system(size: size * 0.55, weight: .semibold))
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // Opaque, so a tinted bar behind it does not show through.
        .background(Circle().fill(.quaternary).background(.background, in: .circle))
    } else {
      Text(initials(for: name))
        .font(size >= 24 ? .caption : .caption2)
        .fontWeight(.semibold)
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Circle().fill(Color.accentColor))
    }
  }
}
