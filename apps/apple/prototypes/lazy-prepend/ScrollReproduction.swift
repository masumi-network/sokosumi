import AppKit
import os
import QuartzCore
import SwiftUI
#if RICH_ROWS
  import SokosumiChat
#endif

/// The same insertion loop serves the bare control and the production-row fixture.
struct ScrollReproduction: View {
  @State private var rows: [Int]
  let probe: FrameProbe
  #if RICH_ROWS
    @State private var prepared: PreparedTranscript?
  #endif

  init(probe: FrameProbe) {
    self.probe = probe
    _rows = State(initialValue: probe.richRows ? Array(0 ..< 100) : Array(500 ..< 600))
  }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        ForEach(rows, id: \.self) { row in
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
      probe.mark(page: page, rows: rows.count + incoming.count)
      if probe.direction == "prepend" {
        rows.insert(contentsOf: incoming, at: 0)
      } else {
        rows.append(contentsOf: incoming)
      }
      try? await Task.sleep(for: .seconds(1))
    }
    probe.finish(rows: rows.count)
    NSApplication.shared.terminate(nil)
  }
}

@MainActor final class FrameProbe: NSObject {
  let direction: String
  let singleLine: Bool
  let pageSize: Int
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
  }

  private var marks: [Publication] = []
  private let log = OSLog(subsystem: "com.sokosumi.swiftui-prepend-reproduction", category: .pointsOfInterest)

  override init() {
    let env = ProcessInfo.processInfo.environment
    direction = env["REPRO_DIRECTION"] ?? "prepend"
    singleLine = env["REPRO_SINGLE_LINE"] == "1"
    pageSize = Int(env["REPRO_PAGE_SIZE"] ?? "100") ?? 100
    precondition(["prepend", "append"].contains(direction))
    precondition((1 ... 100).contains(pageSize))
    super.init()
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
    marks.append(Publication(time: ProcessInfo.processInfo.systemUptime, page: page, rows: rows))
    os_signpost(.event, log: log, name: "Insert page", "page=%d rows=%d", page, rows)
  }

  func finish(rows: Int) {
    link?.invalidate()
    let gaps = zip(callbacks, callbacks.dropFirst()).map { (start: $0.0, end: $0.1, ms: ($0.1 - $0.0) * 1000) }
    let insertions: [[String: Any]] = marks.map { mark in
      // Include any callback interval overlapping the publication through +700 ms.
      let near = gaps.filter { $0.end >= mark.time && $0.start <= mark.time + 0.7 }
      return ["page": mark.page, "rows": mark.rows, "uptime": mark.time,
              "max_callback_gap_ms": near.map(\.ms).max() ?? 0,
              "over_25_ms": near.filter { $0.ms > 25 }.count]
    }
    let nonpublication = gaps.filter { gap in
      !marks.contains { gap.end >= $0.time - 0.1 && gap.start <= $0.time + 0.8 }
    }
    var result: [String: Any] = ["direction": direction, "single_line": singleLine,
                                 "row_kind": richRows ? "production-rich" : "plain",
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
