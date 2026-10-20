import AppKit
import os
import QuartzCore
import SwiftUI
#if RICH_ROWS
  import SokosumiChat
#endif

/// The same measurement loop serves insertion and preloaded-row reveal controls.
struct ScrollReproduction: View {
  @State private var rows: [Int]
  @State private var revealTarget: Int?
  let probe: FrameProbe
  #if RICH_ROWS
    @State private var prepared: PreparedTranscript?
    @State private var clampMeasurementHeight: CGFloat = 0
  #endif

  init(probe: FrameProbe) {
    self.probe = probe
    if let count = probe.repeatRowCount {
      // Initial estimation may realize group zero; warm it explicitly before measuring five untouched groups.
      _rows = State(initialValue: [-1] + (0 ..< 6).flatMap { group in
        Array(group * count ..< (group + 1) * count) + [-group - 2]
      } + Array(count * 6 ..< 48))
    } else {
      _rows = State(initialValue: probe.richRows ? Array(0 ..< (probe.insertsPages ? 100 : 600)) : Array(500 ..< 600))
    }
  }

  var body: some View {
    Group {
      if probe.revealRows {
        ScrollViewReader { proxy in
          transcript(revealing: true)
            .onChange(of: revealTarget) { _, target in
              guard let target else { return }
              probe.reveal(target)
              proxy.scrollTo(target, anchor: .top)
            }
        }
      } else {
        transcript(revealing: false)
      }
    }
    #if RICH_ROWS
    .background(alignment: .topLeading) {
      if probe.repeatRowCount != nil {
        // Calibrate equally in every mode, before row realization and timing.
        Text(String(repeating: "A\n", count: 15) + "A")
          .font(.body).fixedSize().hidden()
          .textSelection(.enabled).accessibilityHidden(true).allowsHitTesting(false)
          .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            RichRowFixture.clampMeasurementHeight = height
            clampMeasurementHeight = height
          }
      }
    }
    #endif
    .task {
      #if RICH_ROWS
        RichRowFixture.installMedia()
        probe.inputFingerprint = RichRowFixture.fingerprint
        do {
          prepared = try await PreparedTranscript.prepare(
            .init(scope: ["portable-reproduction"], messages: RichRowFixture.messages,
                  mentions: nil, channels: [], baseURL: CoreSettings.webBaseURL), reusing: nil
          )
          if let prepared {
            RichRowFixture.prepareText(prepared)
          }
        } catch { fatalError("Cannot prepare rich rows: \(error)") }
      #endif
      guard ProcessInfo.processInfo.environment["REPRO_INSPECT"] != "1" else { return }
      await measure()
    }
  }

  private func transcript(revealing: Bool) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        ForEach(rows, id: \.self) { row in
          if probe.repeatRowCount != nil, row < 0 {
            Color.clear.frame(height: 8000).id(row)
          } else if revealing {
            measuredRow(row).id(row)
              .onDisappear { probe.visibleRows.remove(row) }
              .onScrollVisibilityChange(threshold: 0.1) { visible in
                if visible {
                  probe.visibleRows.insert(row)
                } else {
                  probe.visibleRows.remove(row)
                }
              }
          } else {
            boundedRow(row)
          }
        }
      }
    }
    #if RICH_ROWS
    .modifier(ReproductionActionMetricsScope())
    #endif
  }

  @ViewBuilder private func measuredRow(_ row: Int) -> some View {
    if probe.diagnostics {
      boundedRow(row)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
          probe.rowHeights[row] = height
        }
    } else {
      boundedRow(row)
    }
  }

  @ViewBuilder private func boundedRow(_ row: Int) -> some View {
    if probe.fixedRowHeight {
      renderedRow(row).frame(height: 160, alignment: .top).clipped()
    } else {
      renderedRow(row)
    }
  }

  @ViewBuilder private func renderedRow(_ row: Int) -> some View {
    #if RICH_ROWS
      VStack(alignment: .leading, spacing: 0) {
        if let prepared, probe.repeatRowCount == nil || clampMeasurementHeight > 0 {
          let message = RichRowFixture.message(at: row)
          if probe.omittedComponent == "content-only" {
            FixtureContentRow(message: message, document: prepared.document(for: message))
          } else if probe.omittedComponent == "row-state" {
            GroupedMessageRowView(preparedDocument: prepared.document(for: message), message: message,
                                  isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                  horizontalInset: 12)
          } else if probe.omittedComponent == "row-metrics" {
            SharedMetricsMessageRowView(preparedDocument: prepared.document(for: message), message: message,
                                        isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                        horizontalInset: 12)
          } else if probe.omittedComponent == "original-row" {
            if probe.repeatRowCount != nil, probe.diagnostics {
              LifecycleMessageRowView(preparedDocument: prepared.document(for: message), message: message,
                                      isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                      horizontalInset: 12)
            } else {
              OriginalMessageRowView(preparedDocument: prepared.document(for: message), message: message,
                                     isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                                     horizontalInset: 12)
            }
          } else {
            MessageRowView(preparedDocument: prepared.document(for: message), message: message,
                           isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                           horizontalInset: 12)
          }
        }
      }
    #else
      Text(text(row))
        .padding(.horizontal, 60)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    #endif
  }

  private func text(_ row: Int) -> String {
    if probe.singleLine {
      return "Row \(row)"
    }
    let paragraph = "A plain text message with enough words to wrap naturally inside the scroll view. "
    return "Row \(row). " + String(repeating: paragraph, count: row % 9 + 1)
  }

  @MainActor private func measure() async {
    try? await Task.sleep(for: .seconds(3))
    guard let window = NSApplication.shared.windows.first(where: \.isVisible),
          let host = window.contentView else { fatalError("No visible window") }
    if let count = probe.repeatRowCount {
      revealTarget = 0
      try? await Task.sleep(for: .seconds(1))
      precondition(probe.visibleRows.sorted() == Array(0 ..< count), "Warm-up group was not revealed")
      revealTarget = -1
      try? await Task.sleep(for: .seconds(1))
      precondition(probe.visibleRows.isEmpty, "Warm-up rows remain visible")
      probe.start(host)
      await measureRepeats(count: count)
      probe.finish(rows: rows.filter { $0 >= 0 }.count)
      NSApplication.shared.terminate(nil)
      return
    }
    probe.start(host)
    for page in 1 ... 5 {
      try? await Task.sleep(for: .seconds(1))
      // Generate the page before the measurement boundary.
      let first = probe.richRows ? 100 + (page - 1) * probe.pageSize
        : (probe.direction == "prepend" ? 500 - page * probe.pageSize : 600 + (page - 1) * probe.pageSize)
      let incoming = Array(first ..< first + probe.pageSize)
      probe.mark(page: page, rows: rows.count + (probe.insertsPages ? incoming.count : 0))
      if probe.insertsPages {
        if probe.direction == "prepend" {
          rows.insert(contentsOf: incoming, at: 0)
        } else {
          rows.append(contentsOf: incoming)
        }
      }
      if probe.revealRows {
        revealTarget = first
      }
      try? await Task.sleep(for: .seconds(1))
      if probe.revealRows {
        probe.verifyReveal(page: page, row: first)
      }
    }
    probe.finish(rows: rows.count)
    NSApplication.shared.terminate(nil)
  }

  @MainActor private func measureRepeats(count: Int) async {
    for group in 1 ... 5 {
      let target = group * count
      // Moving to an empty viewport is outside the cold/repeat measurement windows.
      revealTarget = -group - 1
      try? await Task.sleep(for: .seconds(1))
      precondition(probe.visibleRows.isEmpty, "Blank viewport still shows rich rows")
      for phase in ["cold", "repeat"] {
        let page = (group - 1) * 2 + (phase == "cold" ? 1 : 2)
        probe.mark(page: page, rows: 48, phase: phase, target: target)
        revealTarget = target
        try? await Task.sleep(for: .seconds(1))
        probe.verifyReveal(page: page, row: target)
        precondition(probe.visibleRows.sorted() == Array(target ..< target + count), "Wrong visible rich-row count")
        revealTarget = -group - 1
        try? await Task.sleep(for: .seconds(1))
        precondition(probe.visibleRows.isEmpty, "Rows did not leave the viewport")
      }
    }
  }
}

@MainActor final class FrameProbe: NSObject {
  let direction: String
  let singleLine: Bool
  let pageSize: Int
  let revealRows: Bool
  let fixedRowHeight: Bool
  let omittedComponent: String
  let contentRenderer: String
  let diagnostics: Bool
  let repeatRowCount: Int?
  var insertsPages: Bool {
    direction != "no-insertion"
  }

  var visibleRows: Set<Int> = []
  var rowHeights: [Int: CGFloat] = [:]
  var inputFingerprint: String?
  private var viewportSize = CGSize.zero
  var richRows: Bool {
    #if RICH_ROWS
      true
    #else
      false
    #endif
  }

  private var link: CADisplayLink?
  private var callbacks: [Double] = []
  private struct CallbackGap {
    let start: Double
    let end: Double
    var milliseconds: Double {
      (end - start) * 1000
    }
  }

  private struct Publication {
    let time: Double
    let page: Int
    let rows: Int
    var revealedRow: Int?
    var visibleRowIDs: [Int] = []
    var visibleRowHeights: [Double] = []
    var renderEvaluations: [Int: Int] = [:]
    var bodyEvaluations: [String: Int] = [:]
    var phase: String?
    var previouslyEvaluated: [String] = []
    var stateTokens: [String: String] = [:]
  }

  private var marks: [Publication] = []
  private let log = OSLog(subsystem: "com.sokosumi.swiftui-prepend-reproduction", category: .pointsOfInterest)

  override init() {
    let env = ProcessInfo.processInfo.environment
    direction = env["REPRO_DIRECTION"] ?? "prepend"
    singleLine = env["REPRO_SINGLE_LINE"] == "1"
    revealRows = env["REPRO_REVEAL_ROWS"] == "1"
    fixedRowHeight = env["REPRO_FIXED_ROW_HEIGHT"] == "1"
    omittedComponent = env["REPRO_OMIT"] ?? "none"
    contentRenderer = env["REPRO_CONTENT_RENDERER"] ?? "markdown"
    diagnostics = env["REPRO_DIAGNOSTICS"] == "1"
    if let value = env["REPRO_REPEAT_ROW_COUNT"] {
      guard let count = Int(value) else { preconditionFailure("Invalid repeat row count") }
      repeatRowCount = count
    } else {
      repeatRowCount = nil
    }
    pageSize = Int(env["REPRO_PAGE_SIZE"] ?? "100") ?? 100
    precondition(["prepend", "append", "no-insertion"].contains(direction))
    precondition((1 ... 100).contains(pageSize))
    super.init()
    precondition(["markdown", "prepared-text", "no-hidden-text", "no-clamp"].contains(contentRenderer))
    #if CLAMP_ISOLATION
      precondition(["markdown", "no-hidden-text", "no-clamp"].contains(contentRenderer))
    #else
      precondition(["markdown", "prepared-text"].contains(contentRenderer), "Use the --rich-clamp build for clamp controls")
    #endif
    precondition(contentRenderer == "markdown" || repeatRowCount != nil)
    precondition(["none", "body-selection", "clamp", "code-highlighting", "all-selection", "row-interactions", "row-alerts", "flat-text", "flat-markdown", "content-only", "row-content", "hover-events", "hover-writes", "row-state", "row-metrics", "row-accessibility", "menu-sizing", "alert-host", "original-row", "row-overlays"].contains(omittedComponent))
    precondition(richRows || omittedComponent == "none")
    precondition(insertsPages || (richRows && revealRows), "No-insertion control needs visible rich rows")
    precondition(!richRows || !singleLine, "Single-line mode applies only to the bare control")
    if let repeatRowCount {
      precondition([1, 2, 4, 8].contains(repeatRowCount))
      precondition(richRows && revealRows && !insertsPages && omittedComponent == "original-row" && !fixedRowHeight)
    }
  }

  func start(_ host: NSView) {
    viewportSize = host.bounds.size
    let displayLink = host.displayLink(target: self, selector: #selector(tick))
    displayLink.add(to: .main, forMode: .common)
    link = displayLink
  }

  @objc private func tick() {
    // Actual main-thread callback time; not the display's nominal timestamp or presentation time.
    callbacks.append(ProcessInfo.processInfo.systemUptime)
  }

  func mark(page: Int, rows: Int, phase: String? = nil, target: Int? = nil) {
    #if RICH_ROWS
      RichRowFixture.renderEvaluations = [:]
      RichRowFixture.bodyEvaluations = [:]
    #endif
    marks.append(Publication(time: ProcessInfo.processInfo.systemUptime, page: page, rows: rows, revealedRow: nil))
    marks[page - 1].phase = phase
    #if RICH_ROWS
      if diagnostics, let target, let count = repeatRowCount {
        marks[page - 1].previouslyEvaluated = (target ..< target + count).map { "repeat-\($0)" }.filter { RichRowFixture.stateTokens[$0] != nil }
      }
    #endif
    if insertsPages {
      os_signpost(.event, log: log, name: "Insert page", "page=%d rows=%d", page, rows)
    } else if let phase {
      os_signpost(.event, log: log, name: "Repeat reveal", "page=%d count=%d phase=%{public}s", page, repeatRowCount ?? 0, phase)
    } else {
      os_signpost(.event, log: log, name: "Reveal page", "page=%d rows=%d", page, rows)
    }
  }

  func reveal(_ row: Int) {
    os_signpost(.event, log: log, name: "Reveal row", "row=%d", row)
  }

  func verifyReveal(page: Int, row: Int) {
    precondition(visibleRows.contains(row), "Incoming row \(row) was not revealed")
    marks[page - 1].revealedRow = row
    marks[page - 1].visibleRowIDs = visibleRows.sorted()
    if diagnostics {
      marks[page - 1].visibleRowHeights = visibleRows.sorted().map { Double(rowHeights[$0]!) }
    }
    #if RICH_ROWS
      marks[page - 1].renderEvaluations = RichRowFixture.renderEvaluations
      marks[page - 1].bodyEvaluations = RichRowFixture.bodyEvaluations
      if diagnostics, repeatRowCount != nil {
        marks[page - 1].stateTokens = Dictionary(uniqueKeysWithValues: visibleRows.sorted().map { ("repeat-\($0)", RichRowFixture.stateTokens["repeat-\($0)"]!) })
      }
    #endif
  }

  private func measurement(_ mark: Publication, gaps: [CallbackGap]) -> [String: Any] {
    // Include any callback interval overlapping the operation through +700 ms.
    let near = gaps.filter { $0.end >= mark.time && $0.start <= mark.time + 0.7 }
    var result: [String: Any] = ["page": mark.page, "rows": mark.rows, "uptime": mark.time,
                                 "inserted_rows": insertsPages ? pageSize : 0,
                                 "max_callback_gap_ms": near.map(\.milliseconds).max() ?? 0,
                                 "over_25_ms": near.filter { $0.milliseconds > 25 }.count]
    if let longest = near.max(by: { $0.milliseconds < $1.milliseconds }) {
      result["gap_start_uptime"] = longest.start
      result["gap_end_uptime"] = longest.end
    }
    if let row = mark.revealedRow {
      result["revealed_row"] = row
      result["visible_row_ids"] = mark.visibleRowIDs
      if diagnostics {
        result["visible_row_heights"] = mark.visibleRowHeights
      }
      if richRows, diagnostics {
        result["render_evaluations"] = Dictionary(uniqueKeysWithValues: mark.renderEvaluations.map { (String($0.key), $0.value) })
        result["body_evaluations"] = mark.bodyEvaluations
      }
    }
    if let phase = mark.phase {
      result["phase"] = phase
      if diagnostics {
        result["previously_evaluated_ids"] = mark.previouslyEvaluated
        result["state_tokens"] = mark.stateTokens
      }
    }
    return result
  }

  func finish(rows: Int) {
    link?.invalidate()
    let gaps = zip(callbacks, callbacks.dropFirst()).map { CallbackGap(start: $0.0, end: $0.1) }
    let insertions = marks.map { measurement($0, gaps: gaps) }
    let nonpublication = gaps.filter { gap in
      !marks.contains { gap.end >= $0.time - 0.1 && gap.start <= $0.time + 0.8 }
    }
    var result: [String: Any] = ["direction": direction, "single_line": singleLine,
                                 "row_kind": richRows ? "production-rich" : "plain", "reveal_rows": revealRows,
                                 "fixed_row_height": fixedRowHeight,
                                 "omitted_component": omittedComponent,
                                 "content_renderer": contentRenderer,
                                 "diagnostics": diagnostics,
                                 "page_size": pageSize, "final_rows": rows, "callback_count": callbacks.count,
                                 "viewport_width": viewportSize.width, "viewport_height": viewportSize.height,
                                 "nonpublication_max_callback_gap_ms": nonpublication.map(\.milliseconds).max() ?? 0,
                                 "insertions": insertions]
    if let inputFingerprint {
      result["input_fingerprint_sha256"] = inputFingerprint
    }
    #if CLAMP_ISOLATION
      result["clamp_isolation_build"] = true
    #endif
    if let repeatRowCount {
      result["repeat_row_count"] = repeatRowCount
      #if RICH_ROWS
        result["shared_clamp_height"] = Double(RichRowFixture.clampMeasurementHeight)
        if diagnostics {
          result["observed_clamp_heights"] = RichRowFixture.observedClampHeights.sorted()
          result["lifecycle_events"] = RichRowFixture.lifecycleEvents
        }
      #endif
    }
    do {
      let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
      if let output = ProcessInfo.processInfo.environment["REPRO_OUTPUT"] {
        try data.write(to: URL(fileURLWithPath: output))
      }
      print(String(bytes: data, encoding: .utf8)!)
    } catch { fatalError("Cannot write measurements: \(error)") }
  }
}

@main enum ReproductionMain {
  @MainActor static func main() {
    let app = NSApplication.shared
    let delegate = ReproductionDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
  }
}

@MainActor final class ReproductionDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow?

  func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool {
    true
  }

  func applicationDidFinishLaunching(_: Notification) {
    let probe = FrameProbe()
    let window = NSWindow(contentRect: NSRect(x: 200, y: 100, width: 1100, height: 800),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window.title = "SwiftUI \(probe.direction) reproduction"
    #if RICH_ROWS
      window.contentView = NSHostingView(rootView: ScrollReproduction(probe: probe)
        .environmentObject(RichRowFixture.auth).environmentObject(RichRowFixture.workspace))
    #else
      window.contentView = NSHostingView(rootView: ScrollReproduction(probe: probe))
    #endif
    window.level = .floating
    window.makeKeyAndOrderFront(nil)
    NSApplication.shared.activate()
    self.window = window
  }
}
