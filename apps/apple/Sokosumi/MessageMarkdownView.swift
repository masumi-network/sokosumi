import SokosumiChat
import SwiftUI

/// Shared by room and reply-thread rows, including their streamed overlays.
struct MessageMarkdownView: View {
  let source: String
  @State private var document: MessageMarkdown?

  var body: some View {
    Group {
      if let document {
        MarkdownBlocksView(blocks: document.blocks)
      } else {
        Text(source)
      }
    }
    .textSelection(.enabled)
    .frame(maxWidth: .infinity, alignment: .leading)
    .task(id: source) {
      let source = source
      let parsed = await Task.detached(priority: .userInitiated) {
        MessageMarkdown(source)
      }.value
      guard !Task.isCancelled else { return }
      document = parsed
    }
  }
}

private struct MarkdownBlocksView: View {
  let blocks: [MessageMarkdownBlock]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(blocks) { block in
        MarkdownBlockView(block: block)
      }
    }
  }
}

private struct MarkdownBlockView: View {
  let block: MessageMarkdownBlock

  var body: some View {
    switch block.kind {
    case let .header(level):
      Text(block.text)
        .font(headingFont(level))
        .fontWeight(.semibold)
        .accessibilityAddTraits(.isHeader)
    case .orderedList:
      list(ordered: true)
    case .unorderedList:
      list(ordered: false)
    case .blockQuote:
      HStack(alignment: .top, spacing: 10) {
        Rectangle().fill(.secondary.opacity(0.4)).frame(width: 3)
        MarkdownBlocksView(blocks: block.children)
      }
      .fixedSize(horizontal: false, vertical: true)
      .foregroundStyle(.secondary)
    case .thematicBreak:
      Divider().padding(.vertical, 4)
    case let .codeBlock(languageHint):
      VStack(alignment: .leading, spacing: 6) {
        if let languageHint, !languageHint.isEmpty {
          Text(languageHint).font(.caption).foregroundStyle(.secondary)
        }
        ScrollView(.horizontal) {
          Text(block.text)
            .font(.system(.body, design: .monospaced))
            .fixedSize(horizontal: true, vertical: false)
        }
      }
      .padding(10)
      .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 6))
    case let .table(columns):
      ScrollView(.horizontal) {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
          ForEach(block.children) { row in
            GridRow {
              ForEach(columns.indices, id: \.self) { index in
                let cell = row.children.first { $0.kind == .tableCell(columnIndex: index) }
                Text(cell?.text ?? AttributedString())
                  .fontWeight(row.kind == .tableHeaderRow ? .semibold : .regular)
                  .gridColumnAlignment(tableAlignment(columns[index].alignment))
              }
            }
          }
        }
        .padding(10)
      }
      .overlay {
        RoundedRectangle(cornerRadius: 6).stroke(.secondary.opacity(0.3))
      }
    default:
      if block.children.isEmpty {
        Text(block.text)
      } else {
        MarkdownBlocksView(blocks: block.children)
      }
    }
  }

  private func list(ordered: Bool) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(block.children) { item in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          if ordered, case let .listItem(ordinal) = item.kind {
            Text("\(ordinal).").monospacedDigit()
          } else {
            Text("•")
          }
          MarkdownBlocksView(blocks: item.children)
        }
      }
    }
  }

  private func headingFont(_ level: Int) -> Font {
    switch level {
    case 1: .title
    case 2: .title2
    case 3: .title3
    case 4: .headline
    case 5: .subheadline
    default: .footnote
    }
  }

  private func tableAlignment(_ alignment: PresentationIntent.TableColumn.Alignment) -> HorizontalAlignment {
    switch alignment {
    case .left: .leading
    case .center: .center
    case .right: .trailing
    @unknown default: .leading
    }
  }
}

#Preview("Report formatting") {
  MessageMarkdownView(source: """
  ### Operational report

  Finished **analysis** with _results_.

  1. Acquisition
     - **New users:** 20
     - **Organizations:** 4
  2. Engagement

  > Results cover the previous seven days.

  | Metric | Value |
  | :--- | ---: |
  | Messages | 2,340 |

  ```swift
  let greeting = "Hello 👋"
  ```
  """)
  .padding()
  .frame(width: 600)
}
