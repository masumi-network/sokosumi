import Foundation

/// A fenced `mermaid` block in a message body (row 10d; web `markdown-mermaid.ts`). Web's source policy decides
/// what may reach the renderer, before it sees any input.
public struct MermaidDiagram: Equatable, Sendable {
  public enum Refusal: Equatable, Sendable {
    /// Not a text-only `flowchart`/`graph` with a direction, or uses refused syntax.
    case unsupported
    /// Over 4,000 UTF-16 units, 200 word tokens, 100 lines or 50 edges.
    case tooLarge
    /// The ninth or later diagram in one message section.
    case tooMany
  }

  /// Web `MAX_MERMAID_LENGTH`, `MAX_MERMAID_EDGES` and the inline token and line limits.
  public static let maxLength = 4000
  public static let maxEdges = 50
  public static let maxWords = 200
  public static let maxLines = 100
  /// Diagrams drawn per message section; later fences keep their source.
  public static let maxPerSection = 8

  /// The fence's content, without the fences.
  public let source: String
  /// The fence's own closing fence ends it; while a reply streams the block is still open.
  public let complete: Bool
  public let overLimit: Bool
  public let refusal: Refusal?

  public init(source: String, complete: Bool, overLimit: Bool) {
    self.source = source
    self.complete = complete
    self.overLimit = overLimit
    refusal = overLimit ? .tooMany : Self.sourceRefusal(source)
  }

  /// Web `mermaidSourceError`, in its order: size, then the header, then the refused syntax, then the edges.
  /// Lengths count UTF-16 units and patterns run over UTF-16 as JavaScript's do; keywords match whole ASCII words
  /// in any ASCII case, as `\b` and `/i` do without the `u` flag.
  public static func sourceRefusal(_ source: String) -> Refusal? {
    let lines = source.utf16.count(where: { $0 == 0x0A }) + 1
    if source.utf16.count > maxLength || wordCount(source) > maxWords || lines > maxLines {
      return .tooLarge
    }
    guard matches(header, in: source) else { return .unsupported }
    if matches(refusedCharacters, in: source) || matches(refusedKeywords, in: asciiLowercased(source))
      || matches(refusedSequences, in: source) {
      return .unsupported
    }
    return edges.numberOfMatches(in: source, range: NSRange(location: 0, length: source.utf16.count)) > maxEdges
      ? .tooLarge : nil
  }

  /// JavaScript's `\s`, which differs from ICU's at U+0085 and U+FEFF.
  private static let space = #"[\t-\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]"#
  private static let header = pattern(#"\A"# + space + #"*(flowchart|graph)"# + space + #"+(TB|TD|BT|RL|LR)(?![A-Za-z0-9_])"#)
  private static let refusedCharacters = pattern(#"[<&#\\`@:%]"#)
  private static let refusedKeywords = pattern(
    #"(?<![A-Za-z0-9_])(click|style|classdef|class|linkstyle|href|callback|call|url|image|icon)(?![A-Za-z0-9_])"#
  )
  private static let refusedSequences = pattern(#"\$\$|//|--!>"#)
  private static let edges = pattern(#"--!?>|---|==>|-\.->"#)

  private static func pattern(_ text: String) -> NSRegularExpression {
    do {
      return try NSRegularExpression(pattern: text)
    } catch {
      preconditionFailure("Invalid Mermaid policy pattern: \(error)")
    }
  }

  private static func matches(_ regex: NSRegularExpression, in text: String) -> Bool {
    regex.firstMatch(in: text, range: NSRange(location: 0, length: text.utf16.count)) != nil
  }

  /// Web `/[\p{L}\p{N}_]+/gu`: runs of letters, numbers and underscores, by code point.
  private static func wordCount(_ source: String) -> Int {
    var count = 0
    var inWord = false
    for scalar in source.unicodeScalars {
      let isWord = scalar == "_" || wordCategories.contains(scalar.properties.generalCategory)
      if isWord, !inWord {
        count += 1
      }
      inWord = isWord
    }
    return count
  }

  private static let wordCategories: Set<Unicode.GeneralCategory> = [
    .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
    .decimalNumber, .letterNumber, .otherNumber
  ]

  /// JavaScript's non-Unicode `/i` folds only ASCII letters onto the pattern's ASCII keywords.
  private static func asciiLowercased(_ source: String) -> String {
    String(String.UnicodeScalarView(source.unicodeScalars.map { scalar in
      (65 ... 90).contains(scalar.value) ? Unicode.Scalar(scalar.value + 32) ?? scalar : scalar
    }))
  }
}

/// What a diagram's figure shows (web `MermaidDiagram` in `mermaid-block.tsx`).
public struct MermaidFigure: Equatable, Sendable {
  public enum Render: Equatable, Sendable {
    case pending, ready, failed
  }

  /// The status line; nil once the diagram is drawn.
  public enum Status: Equatable, Sendable {
    case waiting, loading, failed, refused(MermaidDiagram.Refusal)
  }

  public enum CopyResult: Equatable, Sendable {
    case copied, copyFailed
  }

  public let diagram: MermaidDiagram
  public let render: Render
  public let copy: CopyResult?

  public init(diagram: MermaidDiagram, render: Render, copy: CopyResult? = nil) {
    self.diagram = diagram
    self.render = render
    self.copy = copy
  }

  public var status: Status? {
    guard diagram.complete else { return .waiting }
    if let refusal = diagram.refusal {
      return .refused(refusal)
    }
    switch render {
    case .pending: return .loading
    case .failed: return .failed
    case .ready: return nil
    }
  }

  /// The preview area and Enlarge: a complete, accepted diagram that has not failed.
  public var drawsDiagram: Bool {
    diagram.complete && diagram.refusal == nil && render != .failed
  }

  /// Enlarge is enabled once the image exists.
  public var canEnlarge: Bool {
    drawsDiagram && render == .ready
  }

  /// The source opens for anything but a renderable complete diagram, and after a failed copy.
  public var sourceStartsOpen: Bool {
    !drawsDiagram || copy == .copyFailed
  }

  public static let zoomRange = 0.5 ... 3.0
  public static let zoomStep = 0.25

  public static func zoomedIn(_ zoom: Double) -> Double {
    min(zoomRange.upperBound, zoom + zoomStep)
  }

  public static func zoomedOut(_ zoom: Double) -> Double {
    max(zoomRange.lowerBound, zoom - zoomStep)
  }
}
