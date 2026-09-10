import SokosumiChat
import SwiftUI

/// Each code block owns its parsing task so hovering or scrolling a message
/// does not run the parser again. A changed stream invalidates only that block.
struct MessageCodeBlock: View {
  let source: String
  let languageHint: String?
  @State private var highlighted: AttributedString?
  @State private var highlightedInput: [String]?

  private var input: [String] {
    [source, languageHint ?? ""]
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let languageHint, !languageHint.isEmpty {
        Text(languageHint).font(.caption).foregroundStyle(.secondary)
      }
      ScrollView(.horizontal) {
        Text(highlightedInput == input ? highlighted ?? AttributedString(source) : AttributedString(source))
          .font(.system(.body, design: .monospaced))
          .fixedSize(horizontal: true, vertical: false)
          .textSelection(.enabled)
      }
    }
    .padding(10)
    .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 6))
    .task(id: input) {
      let snapshot = input
      guard let language = SyntaxLanguage(fenceInfo: languageHint ?? "") else { return }
      let captures = await Task.detached(priority: .userInitiated) {
        try? NativeSyntaxHighlighter.captures(in: snapshot[0], language: language)
      }.value
      guard !Task.isCancelled, let captures else { return }
      highlighted = styledCode(snapshot[0], captures: captures)
      highlightedInput = snapshot
    }
  }

  private func styledCode(_ source: String, captures: [SyntaxCapture]) -> AttributedString {
    var result = AttributedString(source)
    for capture in captures {
      guard let range = Range(capture.range, in: source),
            let start = AttributedString.Index(range.lowerBound, within: result),
            let end = AttributedString.Index(range.upperBound, within: result) else { continue }
      result[start ..< end].foregroundColor = tokenColor(capture.name)
    }
    return result
  }

  private func tokenColor(_ name: String) -> Color {
    switch name.split(separator: ".").first {
    case "comment": .secondary
    case "keyword": .purple
    case "string": .green
    case "number", "float", "constant", "boolean": .orange
    case "type", "constructor": .teal
    case "function": .blue
    default: .primary
    }
  }
}
