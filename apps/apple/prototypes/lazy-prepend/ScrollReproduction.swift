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
  #endif

  init(probe: FrameProbe) {
    self.probe = probe
    _rows = State(initialValue: probe.richRows ? Array(0 ..< (probe.insertsPages ? 100 : 600)) : Array(500 ..< 600))
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
    .task {
      #if RICH_ROWS
        RichRowFixture.installMedia()
        probe.inputFingerprint = RichRowFixture.fingerprint
        do {
          prepared = try await PreparedTranscript.prepare(
            .init(scope: ["portable-reproduction"], messages: RichRowFixture.messages,
                  mentions: nil, channels: [], baseURL: CoreSettings.webBaseURL), reusing: nil
          )
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
          if revealing {
            boundedRow(row).id(row)
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
        if let prepared {
          let message = RichRowFixture.messages[row]
          MessageRowView(preparedDocument: prepared.document(for: message), message: message,
                         isContinuation: false, outbound: nil, onRetry: nil, onRemove: nil,
                         horizontalInset: 12)
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
}

@MainActor final class FrameProbe: NSObject {
  let direction: String
  let singleLine: Bool
  let pageSize: Int
  let revealRows: Bool
  let fixedRowHeight: Bool
  let omittedComponent: String
  var insertsPages: Bool {
    direction != "no-insertion"
  }

  var visibleRows: Set<Int> = []
  var inputFingerprint: String?
  var richRows: Bool {
    #if RICH_ROWS
      true
    #else
      false
    #endif
  }

  private var link: CADisplayLink?
  private var callbacks: [Double] = []
  private struct Publication {
    let time: Double
    let page: Int
    let rows: Int
    var revealedRow: Int?
    var visibleRowIDs: [Int] = []
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
    pageSize = Int(env["REPRO_PAGE_SIZE"] ?? "100") ?? 100
    precondition(["prepend", "append", "no-insertion"].contains(direction))
    precondition((1 ... 100).contains(pageSize))
    super.init()
    precondition(["none", "body-selection", "clamp", "code-highlighting"].contains(omittedComponent))
    precondition(richRows || omittedComponent == "none")
    precondition(insertsPages || (richRows && revealRows), "No-insertion control needs visible rich rows")
    precondition(!richRows || !singleLine, "Single-line mode applies only to the bare control")
  }

  func start(_ host: NSView) {
    let displayLink = host.displayLink(target: self, selector: #selector(tick))
    displayLink.add(to: .main, forMode: .common)
    link = displayLink
  }

  @objc private func tick() {
    // Actual main-thread callback time; not the display's nominal timestamp or presentation time.
    callbacks.append(ProcessInfo.processInfo.systemUptime)
  }

  func mark(page: Int, rows: Int) {
    marks.append(Publication(time: ProcessInfo.processInfo.systemUptime, page: page, rows: rows, revealedRow: nil))
    if insertsPages {
      os_signpost(.event, log: log, name: "Insert page", "page=%d rows=%d", page, rows)
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
  }

  func finish(rows: Int) {
    link?.invalidate()
    let gaps = zip(callbacks, callbacks.dropFirst()).map { (start: $0.0, end: $0.1, ms: ($0.1 - $0.0) * 1000) }
    let insertions: [[String: Any]] = marks.map { mark in
      // Include any callback interval overlapping the operation through +700 ms.
      let near = gaps.filter { $0.end >= mark.time && $0.start <= mark.time + 0.7 }
      var result: [String: Any] = ["page": mark.page, "rows": mark.rows, "uptime": mark.time,
                                   "inserted_rows": insertsPages ? pageSize : 0,
                                   "max_callback_gap_ms": near.map(\.ms).max() ?? 0,
                                   "over_25_ms": near.filter { $0.ms > 25 }.count]
      if let longest = near.max(by: { $0.ms < $1.ms }) {
        result["gap_start_uptime"] = longest.start
        result["gap_end_uptime"] = longest.end
      }
      if let row = mark.revealedRow {
        result["revealed_row"] = row
        result["visible_row_ids"] = mark.visibleRowIDs
      }
      return result
    }
    let nonpublication = gaps.filter { gap in
      !marks.contains { gap.end >= $0.time - 0.1 && gap.start <= $0.time + 0.8 }
    }
    var result: [String: Any] = ["direction": direction, "single_line": singleLine,
                                 "row_kind": richRows ? "production-rich" : "plain", "reveal_rows": revealRows,
                                 "fixed_row_height": fixedRowHeight,
                                 "omitted_component": omittedComponent,
                                 "page_size": pageSize, "final_rows": rows, "callback_count": callbacks.count,
                                 "nonpublication_max_callback_gap_ms": nonpublication.map(\.ms).max() ?? 0,
                                 "insertions": insertions]
    if let inputFingerprint {
      result["input_fingerprint_sha256"] = inputFingerprint
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
