import Foundation

/// Applies links only to unambiguous channel names/slugs in Markdown prose.
public enum MessageChannels {
  public static func applying(to text: AttributedString, channels: [ComposerChannel]) -> AttributedString {
    let source = String(text.characters)
    var output = text
    for (match, channel) in ComposerChannel.referenceRanges(in: source, channels: channels) {
      guard let range = Range(match, in: source), let attributedRange = Range(range, in: output) else { continue }
      let runs = output[attributedRange].runs
      guard !runs.contains(where: { $0.link != nil || $0.inlinePresentationIntent?.contains(.code) == true }) else { continue }
      var url = URLComponents()
      url.scheme = "sokosumi-channel"
      url.host = "room"
      url.queryItems = [URLQueryItem(name: "id", value: channel.id)]
      output[attributedRange].link = url.url
    }
    return output
  }

  public static func roomId(for url: URL, channels: [ComposerChannel]) -> String? {
    guard url.scheme == "sokosumi-channel", url.host == "room",
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let id = components.queryItems?.first(where: { $0.name == "id" })?.value,
          channels.contains(where: { $0.id == id }) else { return nil }
    return id
  }
}
