import SokosumiChat
import SwiftUI

struct ParticipantAvatar: View {
  let imageURL: String?
  let name: String
  var size: CGFloat = 20

  @Environment(\.displayScale) private var displayScale
  @State private var cgImage: CGImage?

  var body: some View {
    fill
      .frame(width: size, height: size)
      .compositingGroup()
      .clipShape(Circle())
      .task(id: "\(imageURL ?? "")-\(size)-\(displayScale)") {
        let loaded = await loadThumbnailCGImage(
          urlString: imageURL,
          pointSize: size,
          scale: displayScale
        )
        guard !Task.isCancelled else { return }
        cgImage = loaded
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

  private var initialsView: some View {
    Text(avatarInitials(from: name))
      .font(size >= 24 ? .caption : .caption2)
      .fontWeight(.semibold)
      .foregroundStyle(.white)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Circle().fill(Color.accentColor))
  }
}
