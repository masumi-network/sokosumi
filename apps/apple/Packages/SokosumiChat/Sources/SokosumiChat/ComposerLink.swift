import Foundation

public enum ComposerLink {
  /// Composer links accept absolute web URLs and mailto, unlike rendered relative links.
  public static func normalizedURL(_ source: String) -> String? {
    let source = ComposerContent(source).text
    if source.lowercased().hasPrefix("mailto:") {
      return source
    }
    guard var url = URLComponents(string: source),
          let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme),
          let host = url.host, !host.isEmpty, host.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
    url.scheme = scheme
    url.host = host.lowercased()
    if url.path.isEmpty {
      url.path = "/"
    }
    return url.url?.absoluteString
  }
}
