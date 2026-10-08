import AppKit
import SokosumiChat
import SwiftUI

/// The String Catalog for Mermaid figures (`ChatMermaid.xcstrings`, web `Components.Mermaid`).
let mermaidTable = "ChatMermaid"

/// Web `MermaidBlock` (row 10d): a fenced `mermaid` block in a message body, drawn as a flowchart once its fence
/// closes and web's policy accepts it, with its source always one disclosure away. Each figure owns its render task,
/// as `MessageCodeBlock` owns its highlighting, so hovering or scrolling never draws it again.
struct MermaidFigureView: View {
  let diagram: MermaidDiagram
  /// Injected so tests copy to a pasteboard of their own.
  var pasteboard: NSPasteboard = .general
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.displayScale) private var displayScale
  @State private var rendered: Rendered?
  @State private var failedInput: RenderInput?
  @State private var copyResult: CopyAttempt?
  @State private var sourceExpanded: Bool
  @State private var enlarging = false
  @State private var zoom = 1.0
  @State private var height: CGFloat = 0
  @State private var statusHeight: CGFloat = 0
  @State private var summaryHeight: CGFloat = 0

  init(diagram: MermaidDiagram, pasteboard: NSPasteboard = .general) {
    self.diagram = diagram
    self.pasteboard = pasteboard
    // A one-time seed: later changes to the open rule move it in `onChange`, as React moves `details open`.
    _sourceExpanded = State(initialValue: MermaidFigure(diagram: diagram, render: .pending).sourceStartsOpen)
  }

  private struct RenderInput: Hashable {
    let source: String
    /// A streamed fence closing changes nothing else, so it must restart the task.
    let renderable: Bool
    let dark: Bool
    let displayScale: CGFloat
  }

  private struct Rendered {
    let input: RenderInput
    let output: MermaidRenderer.Output
  }

  private struct CopyAttempt {
    let source: String
    let result: MermaidFigure.CopyResult
  }

  private var input: RenderInput {
    RenderInput(
      source: diagram.source,
      renderable: diagram.complete && diagram.refusal == nil,
      dark: colorScheme == .dark,
      displayScale: displayScale
    )
  }

  /// The image for this source and appearance; an older one is not shown while its replacement draws.
  private var current: MermaidRenderer.Output? {
    rendered?.input == input ? rendered?.output : nil
  }

  private var figure: MermaidFigure {
    let render: MermaidFigure.Render = current != nil ? .ready : failedInput == input ? .failed : .pending
    return MermaidFigure(diagram: diagram, render: render, copy: copyResult?.source == diagram.source ? copyResult?.result : nil)
  }

  var body: some View {
    let figure = figure
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text("Mermaid flowchart", tableName: mermaidTable, comment: "Title of a Mermaid flowchart in a message.")
          .fontWeight(.medium)
          .frame(maxWidth: .infinity, alignment: .leading)
        Button(action: copySource) {
          Text("Copy source", tableName: mermaidTable, comment: "Copies a Mermaid diagram's source text.")
        }
        if figure.drawsDiagram {
          Button {
            enlarging = true
          } label: {
            Text("Enlarge", tableName: mermaidTable, comment: "Opens a Mermaid diagram in a larger, zoomable sheet.")
          }
          .disabled(!figure.canEnlarge)
        }
      }
      .controlSize(.small)
      MermaidStatusLine(status: figure.status, copy: figure.copy)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { statusHeight = $0 }
      if figure.drawsDiagram {
        MermaidImageScroller(output: current, zoom: 1)
          .frame(height: 256)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      MermaidSourceDisclosure(source: diagram.source, isExpanded: $sourceExpanded) { summaryHeight = $0 }
    }
    .font(.callout)
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(nsColor: .controlBackgroundColor), in: .rect(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
    // Web's line clamp counts only the figure's line boxes: the status text and the source summary. The flex
    // caption, the scrolling preview, an open source's scrolling `pre` and the padding are height, not lines.
    .messageClampAllowance(max(0, height - summaryHeight - (figure.status == nil && figure.copy == nil ? 0 : statusHeight)))
    .onChange(of: figure.sourceStartsOpen) { _, open in
      sourceExpanded = open
    }
    .task(id: input) {
      let snapshot = input
      guard snapshot.renderable, current == nil else { return }
      let palette = MermaidRenderer.Palette(dark: snapshot.dark)
      do {
        let output = try await MermaidRenderer.shared.render(diagram, palette: palette, displayScale: snapshot.displayScale)
        guard !Task.isCancelled else { return }
        rendered = Rendered(input: snapshot, output: output)
      } catch {
        guard !Task.isCancelled else { return }
        failedInput = snapshot
      }
    }
    .sheet(isPresented: $enlarging) {
      MermaidEnlargedView(
        source: diagram.source,
        output: current,
        zoom: $zoom,
        copy: figure.copy,
        copySource: copySource
      )
    }
  }

  private func copySource() {
    pasteboard.clearContents()
    let copied = pasteboard.setString(diagram.source, forType: .string)
    copyResult = CopyAttempt(source: diagram.source, result: copied ? .copied : .copyFailed)
  }
}

/// The figure's quiet line: what the diagram is waiting for or why it shows source, then the last copy's result.
/// It keeps a line's height while empty, so the figure does not jump when the image arrives.
private struct MermaidStatusLine: View {
  let status: MermaidFigure.Status?
  let copy: MermaidFigure.CopyResult?
  @Environment(\.locale) private var locale

  var body: some View {
    let text = [status.map(Self.text), copy.map(Self.text)].compactMap(\.self).map { resource in
      var resource = resource
      resource.locale = locale
      return String(localized: resource)
    }.joined(separator: " ")
    if text.isEmpty {
      Text(verbatim: " ").hidden()
    } else {
      Text(verbatim: text)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  static func text(_ status: MermaidFigure.Status) -> LocalizedStringResource {
    switch status {
    case .waiting:
      LocalizedStringResource("Waiting for the diagram to finish…", table: mermaidTable,
                              comment: "Status of a Mermaid diagram whose fence has not closed yet, while a reply streams.")
    case .loading:
      LocalizedStringResource("Preparing diagram…", table: mermaidTable, comment: "Status of a Mermaid diagram while it draws.")
    case .failed:
      LocalizedStringResource("This diagram could not be rendered. Check its syntax in the source below.", table: mermaidTable,
                              comment: "Status of a Mermaid diagram the renderer could not draw.")
    case .refused(.unsupported):
      LocalizedStringResource("This diagram uses unsupported syntax or features. View or copy its source below.", table: mermaidTable,
                              comment: "Status of a Mermaid diagram the source policy refuses.")
    case .refused(.tooLarge):
      LocalizedStringResource("This diagram exceeds the rendering limit. View or copy its source below.", table: mermaidTable,
                              comment: "Status of a Mermaid diagram over the size, line, word or edge limit.")
    case .refused(.tooMany):
      LocalizedStringResource("Only eight diagrams can render in one message section. View or copy this source below.", table: mermaidTable,
                              comment: "Status of the ninth or later Mermaid diagram in one message section.")
    }
  }

  static func text(_ copy: MermaidFigure.CopyResult) -> LocalizedStringResource {
    switch copy {
    case .copied:
      LocalizedStringResource("Source copied.", table: mermaidTable, comment: "After copying a Mermaid diagram's source.")
    case .copyFailed:
      LocalizedStringResource("Could not copy. Select the diagram source below and copy it manually.", table: mermaidTable,
                              comment: "After copying a Mermaid diagram's source failed.")
    }
  }
}

/// The drawn diagram at its own size (times `zoom`), scrolling inside a bounded region.
private struct MermaidImageScroller: View {
  let output: MermaidRenderer.Output?
  let zoom: Double

  var body: some View {
    ScrollView([.horizontal, .vertical]) {
      if let output {
        Image(output.image, scale: output.scale, label: Text(
          "Flowchart. The complete text is available under Diagram source.", tableName: mermaidTable,
          comment: "Accessibility description of a drawn Mermaid flowchart."
        ))
        .resizable()
        .frame(width: output.size.width * zoom, height: output.size.height * zoom)
      }
    }
    .defaultScrollAnchor(.topLeading)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text("Mermaid flowchart", tableName: mermaidTable, comment: "Title of a Mermaid flowchart in a message."))
  }
}

/// Web's `details` with the source: selectable monospaced text, scrolling past 320 points.
private struct MermaidSourceDisclosure: View {
  let source: String
  @Binding var isExpanded: Bool
  /// The summary row's height, the one line web's clamp counts for the disclosure.
  var summaryHeight: (CGFloat) -> Void = { _ in }

  var body: some View {
    DisclosureGroup(isExpanded: $isExpanded) {
      ScrollView([.horizontal, .vertical]) {
        Text(source)
          .font(.system(.callout, design: .monospaced))
          .textSelection(.enabled)
          .fixedSize()
          .padding(8)
      }
      .frame(maxWidth: .infinity, maxHeight: 320, alignment: .leading)
      .fixedSize(horizontal: false, vertical: true)
    } label: {
      Text("Diagram source", tableName: mermaidTable, comment: "Disclosure that shows a Mermaid diagram's source text.")
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { summaryHeight($0) }
    }
  }
}

/// Web's Enlarge dialog as a sheet: the diagram from 50 % to 300 % in 25 % steps (⌘− and ⌘+ too), Copy source,
/// the source when a copy failed and Close (Escape).
struct MermaidEnlargedView: View {
  let source: String
  let output: MermaidRenderer.Output?
  @Binding var zoom: Double
  let copy: MermaidFigure.CopyResult?
  let copySource: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var sourceExpanded = false

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Mermaid flowchart", tableName: mermaidTable, comment: "Title of a Mermaid flowchart in a message.")
        .font(.headline)
      Text("Scroll to inspect the diagram. Use zoom controls to adjust its size.", tableName: mermaidTable,
           comment: "Explains the enlarged Mermaid diagram sheet.")
        .foregroundStyle(.secondary)
      HStack(spacing: 8) {
        Button {
          zoom = MermaidFigure.zoomedOut(zoom)
        } label: {
          Text("Zoom out", tableName: mermaidTable, comment: "Makes the enlarged Mermaid diagram smaller.")
        }
        .keyboardShortcut("-")
        .disabled(zoom <= MermaidFigure.zoomRange.lowerBound)
        Button {
          zoom = MermaidFigure.zoomedIn(zoom)
        } label: {
          Text("Zoom in", tableName: mermaidTable, comment: "Makes the enlarged Mermaid diagram larger.")
        }
        .keyboardShortcut("+")
        .disabled(zoom >= MermaidFigure.zoomRange.upperBound)
        Button(action: copySource) {
          Text("Copy source", tableName: mermaidTable, comment: "Copies a Mermaid diagram's source text.")
        }
        Spacer()
        Button {
          dismiss()
        } label: {
          Text("Close", tableName: mermaidTable, comment: "Closes the enlarged Mermaid diagram sheet.")
        }
        .keyboardShortcut(.cancelAction)
      }
      MermaidImageScroller(output: output, zoom: zoom)
        .frame(minWidth: 480, idealWidth: 760, maxWidth: .infinity, minHeight: 240, idealHeight: 480, maxHeight: .infinity)
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
      MermaidSourceDisclosure(source: source, isExpanded: $sourceExpanded)
      MermaidStatusLine(status: nil, copy: copy)
    }
    .padding(20)
    .onChange(of: copy == .copyFailed, initial: true) { _, failed in
      sourceExpanded = failed
    }
  }
}
