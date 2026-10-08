#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiAuth
  import SokosumiChat
  import SokosumiWorkspace
  import SwiftUI
  import Testing

  /// Row 10d: the renderer behind web's policy. No window: it draws into a bitmap of its own.
  struct MermaidRendererTests {
    private static func accepted(_ source: String) -> SokosumiChat.MermaidDiagram {
      SokosumiChat.MermaidDiagram(source: source, complete: true, overLimit: false)
    }

    /// One node on top fanning out to two below: drawn upright, the top rows hold less ink than the bottom rows.
    /// The package's own AppKit image path draws this upside down.
    @Test func drawsTheDiagramUpright() async throws {
      let output = try await MermaidRenderer.shared.render(
        Self.accepted("flowchart TD\n  A[Start] --> B[Left]\n  A --> C[Right]"), palette: .init(dark: false), displayScale: 2
      )
      #expect(output.scale == 2)
      #expect(abs(CGFloat(output.image.width) - (output.size.width * 2).rounded(.up)) < 1)
      let bitmap = NSBitmapImageRep(cgImage: output.image)
      func inkWidth(rows: Range<Int>) -> Int {
        var columns = Set<Int>()
        for row in rows {
          for column in 0 ..< bitmap.pixelsWide {
            if let color = bitmap.colorAt(x: column, y: row)?.usingColorSpace(.sRGB), color.brightnessComponent < 0.5 {
              columns.insert(column)
            }
          }
        }
        return columns.count
      }
      let quarter = bitmap.pixelsHigh / 4
      let top = inkWidth(rows: 0 ..< quarter)
      let bottom = inkWidth(rows: bitmap.pixelsHigh - quarter ..< bitmap.pixelsHigh)
      #expect(top > 0 && bottom > top * 3 / 2, "Ink columns: top \(top), bottom \(bottom)")
    }

    /// Defense in depth: what the policy refuses, and an unfinished fence, never reach the package.
    @Test(arguments: [
      SokosumiChat.MermaidDiagram(source: "sequenceDiagram\nA->>B: hi", complete: true, overLimit: false),
      SokosumiChat.MermaidDiagram(source: "flowchart TD\nA --> B", complete: false, overLimit: false),
      SokosumiChat.MermaidDiagram(source: "flowchart TD\nA --> B", complete: true, overLimit: true)
    ])
    func refusesWhatThePolicyRefuses(diagram: SokosumiChat.MermaidDiagram) async {
      await #expect(throws: MermaidRenderer.Failure.self) {
        try await MermaidRenderer.shared.render(diagram, palette: .init(dark: false), displayScale: 2)
      }
    }

    /// Requests arriving together are drawn one after another, never at once (the layout engine keeps static state).
    @Test func drawsConcurrentRequestsOneAtATime() async throws {
      let sizes = try await withThrowingTaskGroup(of: CGSize.self) { group in
        for index in 0 ..< 12 {
          group.addTask {
            try await MermaidRenderer.shared.render(
              Self.accepted("flowchart LR\n  A\(index) --> B\(index) --> C\(index)"), palette: .init(dark: index.isMultiple(of: 2)), displayScale: 2
            ).size
          }
        }
        var sizes: [CGSize] = []
        for try await size in group {
          sizes.append(size)
        }
        return sizes
      }
      #expect(sizes.count == 12)
      #expect(sizes.allSatisfy { $0.width > $0.height })
    }

    /// A diagram too large for the display's scale is drawn at a lower one: 16,384 pixels a side, 16 megapixels.
    @Test func capsTheBitmapByLoweringTheScale() {
      #expect(MermaidRenderer.scale(for: CGSize(width: 600, height: 400), displayScale: 2) == 2)
      #expect(MermaidRenderer.scale(for: CGSize(width: 22352, height: 200), displayScale: 2) == 16384.0 / 22352)
      let area = MermaidRenderer.scale(for: CGSize(width: 5000, height: 5000), displayScale: 2)
      #expect(abs(area * area * 25_000_000 - 16_777_216) < 1)
    }

    /// The spike's 3,000-character label: drawn, within the caps.
    @Test func drawsAVeryWideDiagramWithinTheCaps() async throws {
      let output = try await MermaidRenderer.shared.render(
        Self.accepted("flowchart TD\n  " + String(repeating: "x", count: 3000) + " --> B"), palette: .init(dark: true), displayScale: 2
      )
      #expect(output.scale < 2)
      #expect(output.image.width <= 16384 && output.image.height <= 16384)
    }
  }

  extension NativeWindowTests {
    /// Row 10d: the figure in a message body. Words and controls come from the hosted view's accessibility nodes.
    @MainActor struct MermaidFigureTests {
      private static let accepted = "flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|yes| C(Ship it)\n  B -- not yet --> D[[Wait]]"

      private static func body(_ source: String, diagrams: Bool = true) -> some View {
        MessageMarkdownView(source: source, diagrams: diagrams)
          .environmentObject(WorkspaceState())
          .environmentObject(AuthState())
          .padding(12)
      }

      @Test func aClosedFenceDrawsAFigureWithItsSourceTucked() async throws {
        let (window, host) = ComposerSkillsTests.window(Self.body("Here is the plan:\n\n```mermaid\n\(Self.accepted)\n```"),
                                                        size: NSSize(width: 560, height: 520))
        defer { window.orderOut(nil) }
        var texts = try await ComposerSkillsTests.waitForText("Flowchart. The complete text is available under Diagram source.", in: host)
        // The image and the status line update in one view update; the accessibility nodes may lag a moment.
        for _ in 0 ..< 20 where texts.contains("Preparing diagram…") {
          await ComposerSkillsTests.settle(host)
          texts = await hostedTexts(in: host)
        }
        for text in ["Mermaid flowchart", "Copy source", "Enlarge", "Diagram source"] {
          #expect(texts.contains(text), "\(text) missing from \(texts)")
        }
        #expect(!texts.contains("Preparing diagram…"), "\(texts)")
        #expect(!texts.contains("Show more"), "A line of text and a figure are two of web's 16 lines: \(texts)")
        #expect(!texts.contains { $0.contains("A[Start]") }, "The source starts collapsed: \(texts)")
        let enlarge = try #require(await ComposerSkillsTests.element(labelled: "Enlarge", in: host))
        #expect(enlarge.isEnabled)
      }

      /// Web's `line-clamp-[16]` counts line boxes: of a drawn figure only the source summary is one (the caption is a
      /// flex row, the preview an overflow box), so the whole figure stays and fifteen lines of text follow it.
      @Test func theFigureCountsAsWebsLineBoxesTowardTheClamp() async throws {
        let figure = "```mermaid\n\(Self.accepted)\n```"
        let text = (1 ... 30).map { "Line \($0) of a very long chat message." }.joined(separator: "\n")
        let (alone, aloneTexts) = try await Self.settledHeight(of: figure)
        #expect(!aloneTexts.contains("Show more"), "\(aloneTexts)")
        let (clamped, texts) = try await Self.settledHeight(of: figure + "\n\n" + text)
        #expect(texts.contains("Show more"), "Thirty lines after the figure overflow: \(texts)")
        let lines16 = NSHostingView(rootView: Text(String(repeating: "A\n", count: 15) + "A").font(.body)).fittingSize.height
        #expect(clamped >= alone + lines16 * 0.75, "The figure and most of fifteen lines show: \(clamped) pt, figure \(alone) pt")
        #expect(clamped <= alone + lines16 + 48, "No more than the figure, fifteen lines and Show more: \(clamped) pt, figure \(alone) pt, 16 lines \(lines16) pt")
      }

      /// The body's own height once the diagram is drawn and the layout has stopped moving.
      private static func settledHeight(of source: String) async throws -> (CGFloat, [String]) {
        let host = NSHostingView(rootView: body(source).frame(width: 560).environment(\.locale, Locale(identifier: "en_US")))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        _ = try await ComposerSkillsTests.waitForText("Flowchart. The complete text is available under Diagram source.", in: host)
        var last: CGFloat = -1
        var stable = 0
        for _ in 0 ..< 80 where stable < 5 {
          await ComposerSkillsTests.settle(host)
          let height = host.fittingSize.height
          stable = abs(height - last) <= 0.5 ? stable + 1 : 0
          last = height
        }
        return await (last, hostedTexts(in: host))
      }

      @Test func anUnfinishedFenceWaitsWithItsSourceOpen() async throws {
        let (window, host) = ComposerSkillsTests.window(Self.body("```mermaid\nflowchart LR\n  A --> B["),
                                                        size: NSSize(width: 560, height: 320))
        defer { window.orderOut(nil) }
        let texts = try await ComposerSkillsTests.waitForText("Waiting for the diagram to finish…", in: host)
        #expect(texts.contains { $0.contains("A --> B[") }, "\(texts)")
        #expect(!texts.contains("Enlarge"), "\(texts)")
      }

      @Test func refusedSourceExplainsWhyAndShowsTheSource() async throws {
        let ninth = (0 ..< 9).map { "```mermaid\nflowchart LR\n  A\($0) --> B\($0)\n```" }.joined(separator: "\n\n")
        for (source, status, shown) in [
          ("```mermaid\nsequenceDiagram\n  A->>B: hi\n```",
           "This diagram uses unsupported syntax or features. View or copy its source below.", "A->>B: hi"),
          ("```mermaid\nflowchart LR\n" + String(repeating: "A-->B;", count: 51) + "\n```",
           "This diagram exceeds the rendering limit. View or copy its source below.", "A-->B;"),
          (ninth, "Only eight diagrams can render in one message section. View or copy this source below.", "A8 --> B8")
        ] {
          let (window, host) = ComposerSkillsTests.window(Self.body(source), size: NSSize(width: 560, height: 360))
          defer { window.orderOut(nil) }
          let texts = try await ComposerSkillsTests.waitForText(status, in: host)
          #expect(texts.contains { $0.contains(shown) }, "\(shown) missing from \(texts)")
        }
      }

      /// Web `enableMermaid={!quoteOnly}` and the other Markdown consumers: the fence stays code.
      @Test func aBodyThatDoesNotOptInKeepsTheCode() async {
        let (window, host) = ComposerSkillsTests.window(Self.body("```mermaid\n\(Self.accepted)\n```", diagrams: false),
                                                        size: NSSize(width: 560, height: 240))
        defer { window.orderOut(nil) }
        var texts: [String] = []
        for _ in 0 ..< 40 where !texts.contains(where: { $0.contains("A[Start]") }) {
          await ComposerSkillsTests.settle(host)
          texts = await hostedTexts(in: host)
        }
        #expect(texts.contains { $0.contains("A[Start]") }, "\(texts)")
        #expect(!texts.contains("Mermaid flowchart"), "\(texts)")
      }

      @Test func copySourcePutsTheSourceOnThePasteboardAndSaysSo() async throws {
        let pasteboard = NSPasteboard(name: .init("sokosumi-mermaid-\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        let figure = MermaidFigureView(
          diagram: SokosumiChat.MermaidDiagram(source: Self.accepted, complete: true, overLimit: false), pasteboard: pasteboard
        )
        let (window, host) = ComposerSkillsTests.window(figure.padding(12), size: NSSize(width: 560, height: 420))
        defer { window.orderOut(nil) }
        _ = try await ComposerSkillsTests.waitForText("Copy source", in: host)
        let copy = try #require(await ComposerSkillsTests.element(labelled: "Copy source", in: host))
        #expect(copy.press())
        _ = try await ComposerSkillsTests.waitForText("Source copied.", in: host)
        #expect(pasteboard.string(forType: .string) == Self.accepted)
      }

      /// Light beside dark: a message with a drawn flowchart, a refused one with its source open, and the Enlarge
      /// sheet's content at 150 %, each hosted over the window background.
      @Test func rendersTheFigureAndTheEnlargedSheet() async throws {
        var columns: [[CGImage]] = []
        let wide = "flowchart LR\n  W[Web] --> C[Core]\n  M[Mac] --> C\n  C --> D[(Postgres)]\n  C -.-> A((Ably))\n  A ==> M"
        for dark in [false, true] {
          let output = try await MermaidRenderer.shared.render(
            SokosumiChat.MermaidDiagram(source: wide, complete: true, overLimit: false), palette: .init(dark: dark), displayScale: 2
          )
          try await columns.append([
            ComposerSkillsTests.draw(Self.body("Here is how a message reaches the Mac:\n\n```mermaid\n\(wide)\n```"),
                                     size: NSSize(width: 620, height: 470), dark: dark,
                                     until: "Flowchart. The complete text is available under Diagram source."),
            ComposerSkillsTests.draw(Self.body("```mermaid\nflowchart LR\n  A[Plan: ship] --> B\n```"),
                                     size: NSSize(width: 620, height: 210), dark: dark,
                                     until: "This diagram uses unsupported syntax or features. View or copy its source below."),
            ComposerSkillsTests.draw(MermaidEnlargedView(source: wide, output: output, zoom: .constant(1.5), copy: .copied, copySource: {})
              .background(.background), size: NSSize(width: 620, height: 520), dark: dark, until: "Source copied.")
          ])
        }
        let combined = try RoomHeaderTests.stitched(columns)
        try Attachment.record(#require(combined.representation(using: .png, properties: [:])), named: "chat-mermaid-flowcharts.png")
      }
    }
  }
#endif
