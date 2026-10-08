import SokosumiChat
import Testing

/// Row 10d: web's source policy (`mermaid-policy.ts` and its test), the fence model (`markdown-mermaid.ts`) and the
/// figure's states (`mermaid-block.tsx`). Cases named "Web:" mirror a web test; the rest follow from web's code.
struct MermaidDiagramTests {
  /// Web `__tests__/regression.ts`.
  private static let regression =
    "flowchart LR\n    Schedule[Vercel schedule] --> EVE[EVE + Claude Haiku]\n    EVE --> Proposal[Proposed action]\n    Proposal --> Controller[Controller checks]\n    Controller --> City[Midnight City API]\n    City --> Evidence[Outcome verification]\n    Evidence --> DB[(Neon PostgreSQL)]\n    DB --> Dashboard[Owner dashboard]\n    DB --> EVE"

  // MARK: - Source policy

  /// Web: "accepts the exact regression with arrows, labels, cycle and database".
  @Test func acceptsTheRegression() {
    #expect(MermaidDiagram.sourceRefusal(Self.regression) == nil)
  }

  /// Web: "rejects active/unsupported source before DOM work".
  @Test(arguments: [
    "%%{init: {\"securityLevel\":\"loose\"}}%%\nflowchart LR\nA-->B",
    "---\nconfig:\n securityLevel: loose\n---\nflowchart LR\nA-->B",
    "flowchart LR\nA[\"<img src=x onerror=alert(1)>\"]",
    "flowchart LR\nclick A \"javascript:alert(1)\"",
    "flowchart LR\nA@{img: \"https://example.com/leak\"}",
    "flowchart LR\nstyle A fill:url(//example.com/leak)",
    "flowchart LR\nclassDef default fill:red",
    "flowchart LR\nA[\"&#60;script&#62;\"]",
    "flowchart LR\nA[\"#60;img src=x#62;\"]",
    "flowchart LR\nA[\"`![x](https://example.com)`\"]",
    "flowchart LR\nA[<!-- comment --!>]",
    "flowchart LR\nA --!> B",
    "sequenceDiagram\nA->>B: hi"
  ])
  func rejectsActiveOrUnsupportedSource(source: String) {
    #expect(MermaidDiagram.sourceRefusal(source) == .unsupported)
  }

  /// Web: "bounds bytes, tokens, lines and edges".
  @Test(arguments: [
    "flowchart LR\nA[" + String(repeating: "x", count: 4000) + "]",
    "flowchart LR\n" + String(repeating: "A ", count: 501),
    "flowchart LR\n" + String(repeating: "A\n", count: 101),
    "flowchart LR\n" + String(repeating: "A-->B;", count: 51)
  ])
  func boundsLengthTokensLinesAndEdges(source: String) {
    #expect(MermaidDiagram.sourceRefusal(source) == .tooLarge)
  }

  /// The size checks run before the header and refusals; the edge count runs after them.
  @Test func sizeIsDecidedBeforeSyntaxAndEdgesAfterIt() {
    #expect(MermaidDiagram.sourceRefusal("sequenceDiagram\n" + String(repeating: "A\n", count: 100)) == .tooLarge)
    #expect(MermaidDiagram.sourceRefusal("flowchart LR\n" + String(repeating: "A-->B;", count: 51) + "\nA[x:y]") == .unsupported)
  }

  /// Exactly at each limit is accepted: 4,000 UTF-16 units (an emoji counts two), 200 word tokens of any script,
  /// 100 lines (a CRLF is one break) and 50 edges of any of the four arrow forms.
  @Test func eachLimitIsInclusive() {
    let rocket = "\u{1F680}"
    #expect(MermaidDiagram.sourceRefusal("flowchart LR\nA[" + String(repeating: rocket, count: 1992) + "]") == nil)
    #expect(MermaidDiagram.sourceRefusal("flowchart LR\nA[" + String(repeating: rocket, count: 1993) + "]") == .tooLarge)
    #expect(MermaidDiagram.sourceRefusal("flowchart LR\n" + String(repeating: "ü ", count: 198)) == nil)
    #expect(MermaidDiagram.sourceRefusal("flowchart LR\n" + String(repeating: "ü ", count: 199)) == .tooLarge)
    #expect(MermaidDiagram.sourceRefusal("flowchart LR" + String(repeating: "\r\nA", count: 99)) == nil)
    #expect(MermaidDiagram.sourceRefusal("flowchart LR" + String(repeating: "\r\nA", count: 100)) == .tooLarge)
    let edges = ["A-->B;", "A---B;", "A==>B;", "A-.->B;", "A--x-->B;"]
    #expect(MermaidDiagram.sourceRefusal("flowchart LR\n" + String(repeating: edges.joined(), count: 10)) == nil)
    #expect(MermaidDiagram.sourceRefusal("flowchart LR\n" + String(repeating: edges.joined(), count: 10) + "A==>B") == .tooLarge)
  }

  /// The header needs a direction after optional leading whitespace, in lower-case keywords and upper-case directions.
  @Test(arguments: [
    ("  graph TD\nA-->B", nil),
    ("flowchart\tBT\nA-->B", nil),
    ("graph TD;A-->B", nil),
    ("flowchart TDX\nA-->B", MermaidDiagram.Refusal.unsupported),
    ("flowchart td\nA-->B", .unsupported),
    ("Flowchart TD\nA-->B", .unsupported),
    ("flowchart\nA-->B", .unsupported),
    ("A-->B\nflowchart TD", .unsupported)
  ])
  func headerNeedsADirection(source: String, refusal: MermaidDiagram.Refusal?) {
    #expect(MermaidDiagram.sourceRefusal(source) == refusal)
  }

  /// Keywords match whole ASCII words in any ASCII case, as JavaScript's `\b` and `/i` do without the `u` flag:
  /// a letter outside ASCII is a boundary, a longer ASCII word is not.
  @Test(arguments: [
    ("flowchart LR\nA[CLICK me]", MermaidDiagram.Refusal.unsupported),
    ("flowchart LR\nA[Icon]", .unsupported),
    ("flowchart LR\nA[éclick]", .unsupported),
    ("flowchart LR\nA[clicked]", nil),
    ("flowchart LR\nA[classes]", nil),
    ("flowchart LR\nA[my_url]", nil),
    ("flowchart LR\nA[$$x$$]", .unsupported),
    ("flowchart LR\nA[50%]", .unsupported)
  ])
  func keywordsAreWholeAsciiWords(source: String, refusal: MermaidDiagram.Refusal?) {
    #expect(MermaidDiagram.sourceRefusal(source) == refusal)
  }

  // MARK: - Fences in message bodies

  private func diagrams(_ source: String, enabled: Bool = true) -> [MermaidDiagram] {
    func collect(_ blocks: [MessageMarkdownBlock]) -> [MermaidDiagram] {
      blocks.flatMap { [$0.diagram].compactMap(\.self) + collect($0.children) }
    }
    return MessageMarkdown(source, diagrams: enabled).segments.flatMap { collect($0.blocks) }
  }

  /// Web: "leaves non-chat Mermaid fences as ordinary code" — only bodies that opt in draw diagrams.
  @Test func onlyBodiesThatOptInDrawDiagrams() {
    let source = "```mermaid\nflowchart TD\nA --> B\n```"
    #expect(diagrams(source, enabled: false).isEmpty)
    #expect(diagrams(source) == [MermaidDiagram(source: "flowchart TD\nA --> B", complete: true, overLimit: false)])
    #expect(diagrams("```swift\nlet a = 1\n```").isEmpty)
    #expect(diagrams("`mermaid` inline").isEmpty)
  }

  /// remark's `lang` is the info string's first word, compared case-insensitively; tildes fence too.
  @Test(arguments: ["```Mermaid title\nflowchart TD\n```", "~~~mermaid\nflowchart TD\n~~~", "```MERMAID\nflowchart TD\n```"])
  func recognisesTheFenceLanguage(source: String) {
    #expect(diagrams(source) == [MermaidDiagram(source: "flowchart TD", complete: true, overLimit: false)])
  }

  /// Web: "preserves identities across normal, quoted and list fences".
  @Test(arguments: [
    "> ```mermaid\n> flowchart TD\n> A-->B\n> ```",
    "- ```mermaid\n  flowchart TD\n  A-->B\n  ```",
    "  ```mermaid\nflowchart TD\nA-->B\n  ```"
  ])
  func quotedListedAndIndentedFencesComplete(source: String) {
    #expect(diagrams(source) == [MermaidDiagram(source: "flowchart TD\nA-->B", complete: true, overLimit: false)])
  }

  /// Web: "keeps partial source quiet" — a fence is complete only when its own closing fence ends it.
  @Test(arguments: [
    "```mermaid\nflowchart LR\n A[",
    "```mermaid\nflowchart TD\nA-->B\n",
    "```mermaid",
    "````mermaid\nflowchart TD\n```",
    "```mermaid\nflowchart TD\n~~~"
  ])
  func anUnclosedFenceIsWaiting(source: String) throws {
    let diagram = try #require(diagrams(source).first)
    #expect(!diagram.complete)
  }

  /// An empty closed fence is complete and refused by the header check.
  @Test func anEmptyClosedFenceIsCompleteAndUnsupported() throws {
    let diagram = try #require(diagrams("```mermaid\n```").first)
    #expect(diagram.complete)
    #expect(diagram.refusal == .unsupported)
  }

  /// Web: "separates multiple blocks and limits rendering after eight".
  @Test func limitsRenderingAfterEightInASection() {
    let source = (0 ..< 9).map { "```mermaid\nflowchart LR\n A\($0) --> B\($0)\n```" }.joined(separator: "\n\n")
    let found = diagrams(source)
    #expect(found.count == 9)
    #expect(found.first?.source == "flowchart LR\n A0 --> B0")
    #expect(found.prefix(8).allSatisfy { !$0.overLimit && $0.refusal == nil })
    #expect(found.last?.overLimit == true)
    #expect(found.last?.refusal == .tooMany)
  }

  /// A section is the text between file runs (web `segmentRoomMessageContent`): each counts its own eight.
  @Test func eachSectionCountsItsOwnEight() {
    let five = (0 ..< 5).map { "```mermaid\nflowchart LR\n A\($0) --> B\($0)\n```" }.joined(separator: "\n\n")
    let source = five + "\n\n[report.pdf](https://cdn.example/report.pdf)\n\n" + five
    let found = diagrams(source)
    #expect(found.count == 10)
    #expect(found.allSatisfy { !$0.overLimit })
  }

  /// Refused source keeps its refusal on the block, decided once.
  @Test func aRefusedFenceCarriesItsRefusal() {
    #expect(diagrams("```mermaid\nsequenceDiagram\nA->>B: hi\n```").first?.refusal == .unsupported)
    #expect(diagrams("```mermaid\n" + Self.regression + "\n```").first?.refusal == nil)
  }

  /// Web `ChannelMessageBody` clamps every body but a large solo image, a diagram's included
  /// (room-message-row.tsx:832, :869); how much of the figure counts toward the 16 lines is the view's business.
  @Test func aBodyThatDrawsADiagramStillClamps() {
    let source = "Here is the plan:\n\n```mermaid\n" + Self.regression + "\n```"
    #expect(MessageMarkdown(source, diagrams: true).clampsLongBody)
    #expect(MessageMarkdown(source).clampsLongBody)
  }

  // MARK: - The figure

  private let accepted = MermaidDiagram(source: "flowchart TD\nA --> B", complete: true, overLimit: false)

  @Test func anUnfinishedFenceWaitsWithItsSourceOpen() {
    let figure = MermaidFigure(diagram: MermaidDiagram(source: "flowchart TD\n<b>", complete: false, overLimit: false), render: .pending)
    #expect(figure.status == .waiting)
    #expect(!figure.drawsDiagram)
    #expect(!figure.canEnlarge)
    #expect(figure.sourceStartsOpen)
  }

  @Test func anAcceptedFenceLoadsThenDrawsWithItsSourceClosed() {
    let loading = MermaidFigure(diagram: accepted, render: .pending)
    #expect(loading.status == .loading)
    #expect(loading.drawsDiagram)
    #expect(!loading.canEnlarge)
    #expect(!loading.sourceStartsOpen)
    let ready = MermaidFigure(diagram: accepted, render: .ready)
    #expect(ready.status == nil)
    #expect(ready.drawsDiagram)
    #expect(ready.canEnlarge)
    #expect(!ready.sourceStartsOpen)
  }

  @Test func aFailedRenderShowsItsSource() {
    let figure = MermaidFigure(diagram: accepted, render: .failed)
    #expect(figure.status == .failed)
    #expect(!figure.drawsDiagram)
    #expect(figure.sourceStartsOpen)
  }

  @Test func aRefusedFenceExplainsWhy() {
    let unsupported = MermaidFigure(diagram: MermaidDiagram(source: "sequenceDiagram", complete: true, overLimit: false), render: .pending)
    #expect(unsupported.status == .refused(.unsupported))
    #expect(!unsupported.drawsDiagram)
    #expect(unsupported.sourceStartsOpen)
    let ninth = MermaidFigure(diagram: MermaidDiagram(source: accepted.source, complete: true, overLimit: true), render: .pending)
    #expect(ninth.status == .refused(.tooMany))
  }

  /// Web: "handles clipboard denial" — a failed copy opens the source for a manual copy.
  @Test func aFailedCopyOpensTheSource() {
    #expect(MermaidFigure(diagram: accepted, render: .ready, copy: .copyFailed).sourceStartsOpen)
    #expect(!MermaidFigure(diagram: accepted, render: .ready, copy: .copied).sourceStartsOpen)
  }

  /// Enlarge zooms from 50 % to 300 % in 25 % steps.
  @Test func zoomStepsAQuarterBetweenHalfAndThreefold() {
    #expect(MermaidFigure.zoomedIn(1) == 1.25)
    #expect(MermaidFigure.zoomedOut(1) == 0.75)
    #expect(MermaidFigure.zoomedIn(3) == 3)
    #expect(MermaidFigure.zoomedOut(0.5) == 0.5)
    #expect(MermaidFigure.zoomedIn(2.9) == 3)
  }
}
