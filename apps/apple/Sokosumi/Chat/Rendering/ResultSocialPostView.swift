import CoreAPI
import SokosumiChat
import SwiftUI

/// The String Catalog for the social post preview's words (`ChatSocialPosts.xcstrings`, web
/// `App.Projects.SocialPosts.preview`).
let chatSocialPostsTable = "ChatSocialPosts"

/// Web `SocialPostPreview` (row 38g) as a chat `social_post` result draws it, in place of the whole result card: the
/// post as the network's own feed shows it, X, LinkedIn and Instagram in their layouts and every other network in a
/// neutral card. The engagement rows are decorative, as on web; the pictures load through Core like 38e2's outputs.
struct ResultSocialPostView: View {
  let post: ResultSocialPost

  var body: some View {
    content
      .font(.callout)
      // The pictures' frames follow the width, never the height on offer.
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      // Web `bg-background rounded-xl border overflow-hidden`, at the result card's `max-w-xl`.
      .background(.background)
      .clipShape(.rect(cornerRadius: 12))
      .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.12)))
      .frame(maxWidth: resultCardMaxWidth, alignment: .leading)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(Text("\(post.providerName) preview", tableName: chatSocialPostsTable,
                               comment: "Spoken label of a social post preview. Argument: the network's name."))
  }

  @ViewBuilder
  private var content: some View {
    switch post.provider {
    case .x: XPostPreview(post: post)
    case .linkedin: LinkedInPostPreview(post: post)
    case .instagram: InstagramPostPreview(post: post)
    case .facebook, .tiktok, .youtube: NeutralPostPreview(post: post)
    }
  }
}

/// Web's X layout: the photo beside the name, handle and day, the text, the pictures in a rounded frame and the
/// reply, repost, like, views, bookmark and share glyphs.
private struct XPostPreview: View {
  let post: ResultSocialPost
  @Environment(\.locale) private var locale
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    let name = post.name(fallback: SocialPostWords.accountFallback(locale))
    let day = SocialPostWords.shortDay(post.timestamp, locale: locale, timeZone: timeZone)
    HStack(alignment: .top, spacing: 12) {
      SocialPostAvatar(url: post.avatarURL, name: name, size: 40)
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 4) {
          Text(verbatim: name).fontWeight(.bold).lineLimit(1)
          Text(verbatim: post.atHandle.map { "\($0) · \(day)" } ?? day)
            .foregroundStyle(.secondary)
            .lineLimit(1)
          Spacer(minLength: 0)
          Image(systemName: "ellipsis").foregroundStyle(.secondary).accessibilityHidden(true)
        }
        if !post.text.isEmpty {
          SocialPostText(text: post.text, linkColor: SocialPostWords.xLink)
            .padding(.top, 2)
        }
        if !post.visibleMedia.isEmpty {
          SocialPostMediaGrid(media: post.visibleMedia)
            .clipShape(.rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.primary.opacity(0.12)))
            .padding(.top, 12)
        }
        HStack(spacing: 0) {
          ForEach(["bubble.left", "arrow.2.squarepath", "heart", "chart.bar"], id: \.self) { symbol in
            Image(systemName: symbol)
            Spacer(minLength: 8)
          }
          HStack(spacing: 12) {
            Image(systemName: "bookmark")
            Image(systemName: "square.and.arrow.up")
          }
        }
        .foregroundStyle(.secondary)
        .padding(.trailing, 32)
        .padding(.top, 12)
        .accessibilityHidden(true)
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 12)
    .padding(.bottom, 8)
  }
}

/// Web's LinkedIn layout: the photo beside the name and "day · globe", the text folded after three lines or 210
/// characters behind "…see more", the pictures edge to edge and the Like, Comment, Repost and Send row.
private struct LinkedInPostPreview: View {
  let post: ResultSocialPost
  @Environment(\.locale) private var locale
  @Environment(\.timeZone) private var timeZone
  @Environment(\.colorScheme) private var colorScheme
  @State private var expanded = false

  var body: some View {
    let name = post.name(fallback: SocialPostWords.accountFallback(locale))
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 8) {
        SocialPostAvatar(url: post.avatarURL, name: name, size: 48)
        VStack(alignment: .leading, spacing: 4) {
          Text(verbatim: name).fontWeight(.semibold).lineLimit(1)
          HStack(spacing: 4) {
            Text(verbatim: "\(SocialPostWords.shortDay(post.timestamp, locale: locale, timeZone: timeZone)) ·")
            Image(systemName: "globe")
              .imageScale(.small)
              .accessibilityLabel(Text("Visible to anyone", tableName: chatSocialPostsTable,
                                       comment: "Spoken label of the globe beside a LinkedIn post's day: the post is public."))
          }
          .font(.caption)
          .foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Image(systemName: "ellipsis").font(.body).foregroundStyle(.secondary).accessibilityHidden(true)
      }
      .padding(.horizontal, 16)
      .padding(.top, 12)
      if post.text.isEmpty {
        Color.clear.frame(height: 12)
      } else {
        let fold = expanded ? nil : ResultSocialPost.fold(post.text, maxChars: ResultSocialPost.linkedInFold.maxChars,
                                                          maxLines: ResultSocialPost.linkedInFold.maxLines)
        VStack(alignment: .leading, spacing: 2) {
          SocialPostText(text: fold?.visibleText ?? post.text, linkColor: SocialPostWords.linkedInLink(colorScheme), linkWeight: .semibold)
          if fold?.isFolded == true {
            Button {
              expanded = true
            } label: {
              Text("…see more", tableName: chatSocialPostsTable, comment: "Unfolds a LinkedIn post's long text in a social post preview.")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .pointerStyle(.link)
          }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
      }
      if !post.visibleMedia.isEmpty {
        SocialPostMediaGrid(media: post.visibleMedia)
      }
      HStack(spacing: 0) {
        action("hand.thumbsup", Text("Like", tableName: chatSocialPostsTable,
                                     comment: "LinkedIn's Like action under a social post preview (decorative)."))
        Spacer(minLength: 0)
        action("message", Text("Comment", tableName: chatSocialPostsTable,
                               comment: "LinkedIn's Comment action under a social post preview (decorative)."))
        Spacer(minLength: 0)
        action("arrow.2.squarepath", Text("Repost", tableName: chatSocialPostsTable,
                                          comment: "LinkedIn's Repost action under a social post preview (decorative)."))
        Spacer(minLength: 0)
        action("paperplane", Text("Send", tableName: chatSocialPostsTable,
                                  comment: "LinkedIn's Send action under a social post preview (decorative)."))
      }
      .foregroundStyle(.secondary)
      .padding(.vertical, 4)
      .overlay(alignment: .top) { Divider() }
      .padding(.horizontal, 16)
      .accessibilityHidden(true)
    }
  }

  private func action(_ symbol: String, _ label: Text) -> some View {
    HStack(spacing: 6) {
      Image(systemName: symbol)
      label.lineLimit(1)
    }
    .fontWeight(.semibold)
    .padding(8)
  }
}

/// Web's Instagram layout: the photo beside the handle, the first picture in a square (or "Instagram needs an image or
/// video."), the like, comment, share and save glyphs, then the caption after the handle, folded after two lines or
/// 125 characters behind "more", and the day.
private struct InstagramPostPreview: View {
  let post: ResultSocialPost
  @Environment(\.locale) private var locale
  @Environment(\.timeZone) private var timeZone
  @Environment(\.colorScheme) private var colorScheme
  @State private var expanded = false

  var body: some View {
    let name = post.instagramName(fallback: SocialPostWords.accountFallback(locale))
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 12) {
        SocialPostAvatar(url: post.avatarURL, name: name, size: 32)
        Text(verbatim: name).fontWeight(.semibold).lineLimit(1)
        Spacer(minLength: 0)
        Image(systemName: "ellipsis").font(.body).accessibilityHidden(true)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      Color.primary.opacity(0.06)
        .aspectRatio(1, contentMode: .fit)
        .overlay {
          if let first = post.media.first {
            SocialPostMediaCell(media: first)
          } else {
            Text("Instagram needs an image or video.", tableName: chatSocialPostsTable,
                 comment: "An Instagram post preview without a picture or video.")
              .font(.caption)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
              .padding(.horizontal, 24)
          }
        }
        .clipped()
      HStack(spacing: 16) {
        Image(systemName: "heart")
        Image(systemName: "bubble.right")
        Image(systemName: "paperplane")
        Spacer(minLength: 0)
        Image(systemName: "bookmark")
      }
      .font(.title2)
      .padding(.horizontal, 12)
      .padding(.top, 12)
      .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        if !post.text.isEmpty {
          caption(name: name)
        }
        Text(verbatim: post.timestamp.formatted(Date.FormatStyle(locale: locale, timeZone: timeZone).month(.wide).day()))
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 12)
      .padding(.top, 8)
      .padding(.bottom, 12)
    }
  }

  @ViewBuilder
  private func caption(name: String) -> some View {
    let fold = expanded ? nil : ResultSocialPost.fold(post.text, maxChars: ResultSocialPost.instagramFold.maxChars,
                                                      maxLines: ResultSocialPost.instagramFold.maxLines)
    let folded = fold?.isFolded == true
    Text(captionText(name: name, text: fold?.visibleText ?? post.text, folded: folded))
      .fixedSize(horizontal: false, vertical: true)
    if folded {
      Button {
        expanded = true
      } label: {
        Text("more", tableName: chatSocialPostsTable, comment: "Unfolds an Instagram post's long caption in a social post preview.")
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .pointerStyle(.link)
    }
  }

  /// The handle in semibold, the caption in its link colours, and web's "…" while folded.
  private func captionText(name: String, text: String, folded: Bool) -> AttributedString {
    var author = AttributedString(name + " ")
    author.font = .callout.weight(.semibold)
    return author + SocialPostText.attributed(text, linkColor: SocialPostWords.instagramLink(colorScheme))
      + AttributedString(folded ? "…" : "")
  }
}

/// Web's neutral card for Facebook, TikTok and YouTube: the photo, name and day beside the network, the plain text and
/// the pictures in a rounded frame.
private struct NeutralPostPreview: View {
  let post: ResultSocialPost
  @Environment(\.locale) private var locale
  @Environment(\.timeZone) private var timeZone

  var body: some View {
    let name = post.name(fallback: SocialPostWords.accountFallback(locale))
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        SocialPostAvatar(url: post.avatarURL, name: name, size: 40)
        VStack(alignment: .leading, spacing: 0) {
          Text(verbatim: name).fontWeight(.semibold).lineLimit(1)
          Text(verbatim: SocialPostWords.shortDay(post.timestamp, locale: locale, timeZone: timeZone))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        // Web draws the network's brand mark; the Mac has no symbol for it, so its name stands there.
        Text(verbatim: post.providerName).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
      }
      if !post.text.isEmpty {
        Text(verbatim: post.text).fixedSize(horizontal: false, vertical: true)
      }
      if !post.visibleMedia.isEmpty {
        SocialPostMediaGrid(media: post.visibleMedia).clipShape(.rect(cornerRadius: 8))
      }
    }
    .padding(16)
  }
}

/// Web `PreviewRichText`: the post's text with links, hashtags and mentions in the network's link colour.
private struct SocialPostText: View {
  let text: String
  let linkColor: Color
  var linkWeight: Font.Weight?

  var body: some View {
    Text(Self.attributed(text, linkColor: linkColor, linkWeight: linkWeight))
      .fixedSize(horizontal: false, vertical: true)
  }

  static func attributed(_ text: String, linkColor: Color, linkWeight: Font.Weight? = nil) -> AttributedString {
    var attributed = AttributedString()
    for run in ResultSocialPost.runs(text) {
      var piece = AttributedString(run.text)
      if run.isToken {
        piece.foregroundColor = linkColor
        if let linkWeight {
          piece.font = .callout.weight(linkWeight)
        }
      }
      attributed += piece
    }
    return attributed
  }
}

/// Web `PreviewMediaGrid`: one picture at its own proportions, at most 512 pt high; two side by side, three with the
/// first on the left and four in a 2×2 grid, all in a 16:9 frame with 2 pt gaps. The caller clips and frames it.
private struct SocialPostMediaGrid: View {
  let media: [ResultSocialPost.Media]

  var body: some View {
    if media.count == 1, let only = media.first {
      SocialPostMediaCell(media: only, keepsProportions: true)
    } else if media.count > 1 {
      Color.clear
        .aspectRatio(16 / 9, contentMode: .fit)
        .overlay {
          HStack(spacing: 2) {
            switch media.count {
            case 2:
              SocialPostMediaCell(media: media[0])
              SocialPostMediaCell(media: media[1])
            case 3:
              SocialPostMediaCell(media: media[0])
              VStack(spacing: 2) {
                SocialPostMediaCell(media: media[1])
                SocialPostMediaCell(media: media[2])
              }
            default:
              VStack(spacing: 2) {
                SocialPostMediaCell(media: media[0])
                SocialPostMediaCell(media: media[2])
              }
              VStack(spacing: 2) {
                SocialPostMediaCell(media: media[1])
                SocialPostMediaCell(media: media[3])
              }
            }
          }
        }
    }
  }
}

/// One picture or video of the post, cropped to its frame. A picture loads through Core when it appears and opens in
/// Quick Look; a video loads only when pressed and then opens there, so a long video is fetched only for someone who
/// watches it. Web draws both and opens neither.
private struct SocialPostMediaCell: View {
  let media: ResultSocialPost.Media
  /// A lone picture: its own proportions, at most 512 pt high (web `max-h-[32rem]` over the card's 576 pt).
  var keepsProportions = false
  @Environment(\.resultOutputLoader) private var loader
  @Environment(\.resultOutputPresenter) private var presenter
  @Environment(\.displayScale) private var displayScale
  @State private var picture: Picture = .loading
  @State private var video: VideoLoad = .idle

  private enum Picture {
    case loading
    case loaded(ResultOutputFile, CGImage)
    case failed
  }

  private enum VideoLoad {
    case idle
    case loading
    case failed
  }

  var body: some View {
    Button(action: open) {
      frame
        .overlay { content }
        .clipped()
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .disabled(!canOpen)
    .help(media.name)
    .accessibilityLabel(label)
    .task(id: media.source) { await loadPicture() }
    .task(id: video == .loading) { await openVideo() }
  }

  @ViewBuilder
  private var frame: some View {
    if keepsProportions {
      // The proportions stop at 576 × 512, so the frame is never taller than 512 pt.
      Color.primary.opacity(0.06)
        .aspectRatio(proportions, contentMode: .fit)
    } else {
      Color.primary.opacity(0.06)
    }
  }

  /// The picture's own width over height, never taller than 576 × 512 allows; 16:9 until it loads.
  private var proportions: CGFloat {
    guard case let .loaded(_, image) = picture, image.height > 0 else { return 16 / 9 }
    return max(CGFloat(image.width) / CGFloat(image.height), resultCardMaxWidth / 512)
  }

  @ViewBuilder
  private var content: some View {
    if media.kind == .video {
      switch video {
      case .idle: Image(systemName: "play.circle.fill").font(.largeTitle).foregroundStyle(.secondary)
      case .loading: ProgressView().controlSize(.small)
      case .failed: unavailable("film")
      }
    } else {
      switch picture {
      case .loading: ProgressView().controlSize(.small)
      case let .loaded(_, image): Image(decorative: image, scale: displayScale).resizable().scaledToFill()
      case .failed: unavailable("photo")
      }
    }
  }

  private func unavailable(_ symbol: String) -> some View {
    Image(systemName: symbol)
      .font(.title3)
      .foregroundStyle(.secondary)
      .help(Text("Preview unavailable", tableName: chatResultsTable,
                 comment: "A result output's image or player when its file could not be loaded."))
  }

  private var label: Text {
    if media.kind == .video {
      Text("Play \(media.name)", tableName: chatResultsTable,
           comment: "Accessibility label of a result output's audio or video before it plays. Argument: the file name.")
    } else {
      Text("View image \(media.name)", tableName: chatResultsTable,
           comment: "Accessibility label of a result output's image. Argument: the file name.")
    }
  }

  private var canOpen: Bool {
    if media.kind == .video {
      return loader != nil && media.source != nil && video != .loading
    }
    if case .loaded = picture {
      return true
    }
    return false
  }

  private func open() {
    if media.kind == .video {
      video = .loading
    } else if case let .loaded(file, _) = picture {
      presenter.preview(file)
    }
  }

  private func loadPicture() async {
    guard media.kind != .video else { return }
    guard let loader, let source = media.source else {
      picture = .failed
      return
    }
    picture = .loading
    do {
      let file = try await loader.file(source, named: media.fileName)
      guard !Task.isCancelled else { return }
      let image = await loadImageThumbnail(urlString: file.url.absoluteString, pointSize: resultCardMaxWidth, scale: displayScale)?.cgImage
      guard !Task.isCancelled else { return }
      picture = image.map { .loaded(file, $0) } ?? .failed
    } catch {
      if !Task.isCancelled {
        picture = .failed
      }
    }
  }

  private func openVideo() async {
    guard video == .loading, let loader, let source = media.source else { return }
    do {
      let file = try await loader.file(source, named: media.fileName)
      guard !Task.isCancelled else { return }
      video = .idle
      presenter.preview(file)
    } catch {
      if !Task.isCancelled {
        video = .failed
      }
    }
  }
}

/// Web `PreviewAvatar`: the account's photo, else web's initials on a muted circle. Decorative, like web's empty `alt`.
private struct SocialPostAvatar: View {
  let url: String?
  let name: String
  let size: CGFloat
  @Environment(\.displayScale) private var displayScale
  @State private var image: CGImage?

  var body: some View {
    Group {
      if let image {
        Image(decorative: image, scale: displayScale)
          .resizable()
          .interpolation(.high)
          .scaledToFill()
      } else {
        Text(verbatim: ResultSocialPost.initials(name))
          .font(.caption.weight(.semibold))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Color.primary.opacity(0.08))
      }
    }
    .frame(width: size, height: size)
    .clipShape(.circle)
    .accessibilityHidden(true)
    .task(id: "\(url ?? "")-\(size)-\(displayScale)") {
      let loaded = await loadImageThumbnail(urlString: url, pointSize: size, scale: displayScale)
      guard !Task.isCancelled else { return }
      image = loaded?.cgImage
    }
  }
}

/// The preview's shared words, days and link colours.
private enum SocialPostWords {
  /// Web `accountFallback`, in the view's language.
  static func accountFallback(_ locale: Locale) -> String {
    String(localized: LocalizedStringResource("Your account", table: chatSocialPostsTable, locale: locale,
                                              comment: "A social post preview's author when the connected account has no name."))
  }

  /// Web `{ month: "short", day: "numeric" }`: "Oct 7".
  static func shortDay(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
    date.formatted(Date.FormatStyle(locale: locale, timeZone: timeZone).month(.abbreviated).day())
  }

  /// Web's `--social-*-link` tokens.
  static let xLink = rgb(0x1D9BF0)

  static func linkedInLink(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? rgb(0x71B7FB) : rgb(0x0A66C2)
  }

  static func instagramLink(_ scheme: ColorScheme) -> Color {
    scheme == .dark ? rgb(0xE0F1FF) : rgb(0x00376B)
  }

  private static func rgb(_ hex: Int) -> Color {
    Color(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }
}
