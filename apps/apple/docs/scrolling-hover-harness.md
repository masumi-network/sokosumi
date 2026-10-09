# Scrolling under a resting pointer (M6, M8), older pages and the title bar edge

Three disposable harnesses for what the M6 matrix does not cover: a transcript scrolled with the pointer resting over it, a room scrolled back through older pages, and a light picture under the room's title in the key window. Both copy `apps/apple` into a scratch directory, swap the copy's entry point and never touch the checkout. Use them beside the [M6 harness](scrolling-performance-harness.md), whose parser this one reuses through the app-scoped `swiftui-expert-skill`.

## What they showed (2026-10-09, macOS 27.0.1, Release, ad hoc)

**Hover under a scroll.** `HitchProbe.swift` opens `RoomTimelineView` on 600 fixture messages (bursts, screenshots, quotes of screenshots, code, reactions, Thread bars, day changes), rests a pointer over the list by feeding the hosting view tracking events as the tests' `hover` does, and plays six trackpad flicks (60 changed and 45 momentum events, 16 ms apart). Instruments' Time Profiler, attached, over the 11.5 s of flicks:

| Build | Main thread | `NSHostingView.layout()` | `MessageRowView.body` | Display-link frames over 25 ms |
| --- | --- | --- | --- | --- |
| hover delay (#5898), no pointer | 2,529 ms | 1,453 ms | 109 ms | 8 |
| hover delay (#5898), pointer resting | 3,237 / 3,221 ms | 2,008 / 1,991 ms | 113 / 128 ms | 27 / 20 |
| bar built only on hover, pointer resting | 2,705 / 2,491 ms | 1,664 / 1,509 ms | 84 / 82 ms | 16 / 8 |

The pointer's share is SwiftUI's own hover pass after each scroll step (`EventBindingManager.enqueueHoverUpdateIfNeeded` → `NSHostingView.didRequestHoverUpdate`, about 9 % of the main thread, with the responder-tree build and the hover dispatcher another 4–5 % each) and the layout it drags along. App code stays small: every row's body is under 4 %, the hidden action bar about 1 %. Building the bar only for the row under the pointer removes two `ViewThatFits` variants of about eight controls from every realized row and cuts main-thread work by 16–23 %.

Ruled out on the way: making the list content non-hit-testable while scrolling removed about 40 % of the pointer's cost but stopped the wheel from scrolling the list at all in the hosted tests (SwiftUI routes the wheel through hit testing); `onHover` in place of the row's `onContinuousHover` measured the same as before. Image decoding runs off the main thread already (`png_read_*` on the decode queue). This fixture loads every message up front; the older pages the user's recording paused on have their own harness, below.

**Older pages under a scroll (2026-10-09).** The recording's two content-moving gaps (3.48 s and 3.88 s) sit on "Loading older messages…". `PagingProbe.swift` opens `RoomTimelineView` on the latest page (100 of 600 fixture messages, `transcriptHasMore`) and serves older pages of the size the app asks for from a fake Core at the URLSession transport (`PagedCoreProtocol`, 150 ms per page), then plays six upward flicks with a 300 ms finger lift between them. Each display-link frame records the scroll offset and the document height, so a frame in which a page's rows land (the document grows by 500 pt or more) shows whether content was moving around it.

Every insertion of an older page cost one long frame, 55–65 ms at an 800 pt window, while `PreparedTranscript` preparation took 5–18 ms off the main thread. Time Profiler over the 17 insertion windows names SwiftUI's lazy stack: `LazyStack.measureEstimates` → `lengthAndSpacing` measures every realized row again (14 ms per insertion), on top of the transcript's ordinary update pass. The cost follows the realized rows, not the page: 44 / 64 / 79 ms at 400 / 800 / 1,200 pt windows, and 68 / 61 / 57 ms for pages of 10 / 30 / 60. Controls on the same harness: 30 rows appended below the reader cost 33 ms (one ordinary update); prepending far from the top cost the same as at the top; a bare `ScrollView { LazyVStack { ForEach { Text } } }` with the same texts drops a frame on a prepend and none on an append. Ruled out, each measured against the 55–65 ms baseline with no change beyond noise: `.scrollPosition` and `.scrollTargetLayout` off, a bottom size-change anchor, no row `.id`, a ForEach without `enumerated()`, Equatable message rows (row bodies 750 → 131 per run), unchanged arrays passed through `displayedTranscript` and `overlaying`, no boundary spinner, no `Text.LayoutKey` reader and no hidden clamp text in `ExpandableMessageBody`.

**Reading position (found after the first numbers, from the user's real-trackpad recording).** The probe also checks whether a landing keeps the reader on the rows they saw: the document is flipped, so the offset has to follow the growth above. On `origin/main` it kept 0 of 17: the offset stays while 4,000 pt land above, and the reader is put on the page's own first rows, although the scroll position names the old first row as the page lands. The room now places that row back itself (below).

So the room keeps the insertion but moves it out of the motion: an older page's rows wait until the scroll rests, and a page brings 100 rows instead of 30.

| Build (3 runs each, alternating) | Pages | Landings while content moves | Frames over 25 ms | Over budget |
| --- | --- | --- | --- | --- |
| `origin/main` `6d23da936` | 17 of 30 rows | 14 / 14 / 15 of 17 | 35 / 30 / 30 | 1,095 / 1,059 / 946 ms |
| older pages wait for rest, 100 rows | 5 of 100 rows | 0 / 0 / 0 of 5 | 19 / 20 / 17 | 411 / 427 / 376 ms |

A landing is "while content moves" when any of the five frames either side moved 2 pt or more; after the change every landing sits among frames that moved at most 1 pt (the reader at rest against the top). Both builds load all 600 messages; preparation stays under 20 ms off the main thread. The landing frame itself still costs 44–64 ms.

**What a landing pays per row (2026-10-09, follow-up).** On the paging path a landing frame costs 49–56 ms with full rows and 17–30 ms with every row's content removed (the copy's `MessageRowView` reduced to its header and a plain `Text`). Time Profiler over the landing frames (`insert_stacks.py … landings`): 45 ms of main thread against 19 ms. The difference is SwiftUI building the rows that a landing realizes around the viewport (`DynamicContainerInfo.makeItem` and the views' `makeView` inside `LazyStack.measureEstimates`), measuring them (TextKit 2 for selectable text, 3.6 ms), then AppKit layout and the Core Animation commit of their layers (24.8 against 16.2 ms). No single part of the row carries it: removing any one of them changed the landing frame by less than the run-to-run noise (±5–10 ms with five pages a run).

The row build test (`HITCH_BENCH`) measures that per row without the scroll timing: 30 fresh fixture rows built, laid out and drawn, 30–40 passes, median, interquartile range within about 10 %. Full rows cost 108–118 ms, rows without content 16 ms. Each part removed alone from the copy (ms saved per 30 rows, three alternating runs):

| Removed | Saves |
| --- | --- |
| the Markdown body (a plain `Text` instead) | 61–66 |
| `ExpandableMessageBody` (the clamp: hidden 16-line text 12, `Text.LayoutKey` reader 7–10, `onGeometryChange` 0–6) | 20–25 |
| `.textSelection(.enabled)` on the body | 14–17 |
| quote, Thread bar, reactions (on 1 to 2 of every 9 rows) | 12, 10, 9 |
| the profile button on avatar and name, the header, the avatar | 11, 10, 9 |
| the three `.alert`s, hover tracking, the context-menu `NSView`, accessibility actions, `.popover`s, `.help` | 0–4 each |
| one-paragraph bodies without their nested `VStack`/`ForEach`, the body's `.task`, image gallery, `openURL` | 0–2 each |

By kind (`HITCH_KINDS`, 30 rows of one kind): a plain paragraph 83 ms (39 with a plain `Text` body), a bare link 86, a screenshot 93, reactions 104, a Thread bar 111, a bold paragraph with reactions 121, a code block 134, a quote 137. A code block's horizontal `ScrollView` builds an `NSScrollView` even when the code fits; `ViewThatFits` (the text alone when it fits) saved 14 ms per 30 code rows.

Fixes tried in the copy, against the row build test and then the landings: one 16-line height shared by every body with the same font, lines, type size and scale (−12 ms per 30 rows), the `Text.LayoutKey` reader only on a body that overflows (−10; as a conditional modifier it rebuilds a long body's content the first time it overflows, on every realization), reactions in `WrappingRow` instead of a `LazyVGrid` (−7.5; on `main` since #5924), one `.alert` for the three (−4). Together −15 to −24 ms per 30 rows (15–20 %), but on the paging path, six alternating runs each, the landing frame stayed at 56 against 54 ms (over budget per run 380 against 306 ms), within noise. Not shipped here; the follow-ups are listed in PARITY-LOG's "Slice M6 — row build cost".

`HITCH_PREPEND` misleads on a build with the older-page hold: the inserted rows wait for the scroll to rest and land in bursts, some during momentum, and a reader parked by an AppKit scroll gives `scrollPosition` no row to anchor, so the offset is compensated for a stripped or plain window and not for a full one. Measure landings on the paging path, and per-row cost with `HITCH_BENCH`.

**The title bar.** `TitleApp.swift` is a real SwiftUI `App` like `SokosumiApp`: a `WindowGroup` with the app's `NavigationSplitView` and `RoomNavigationStack` (its `RoomToolsModifier`, header and inspector) on a channel whose screenshots and link previews are near-white pictures. In the key window the automatic and the soft top edge draw nothing, so a picture under the title hides the room's name; an inactive window dims it, which is why an earlier `NSHostingView` capture missed it. A hard top edge keeps the name legible in both; that fix merged as [#5911](https://github.com/masumi-network/sokosumi/pull/5911), and this harness is its cause and check. Captures: [title-bar-over-light-picture.png](images/title-bar-over-light-picture.png), the key window before (top) and with the hard edge (bottom).

These are a Mac's numbers with a person at it: the pointer harness feeds its own events, but a real pointer over the floating window adds its own (hover writes then vary between runs). Run on a quiet machine; compare runs taken back to back, alternating the builds.

## Run

From the repository root, extract the sources:

```sh
H=$(mktemp -d /tmp/soko-hover.XXXXXX)
python3 - "$H" <<'PY'
import pathlib, re, sys
text = pathlib.Path('apps/apple/docs/scrolling-hover-harness.md').read_text()
for name, code in re.findall(r'<!-- file: ([\w.]+) -->\n```\w+\n(.*?)\n```', text, re.S):
    pathlib.Path(sys.argv[1], name).write_text(code + '\n')
PY
chmod +x "$H"/*.sh
python3 "$H/setup.py" "$PWD" "$H/hover"          # or: python3 "$H/setup.py" "$PWD" "$H/title" title
```

Build each copy in Release with ad hoc signing and no sandbox (the copy reads no Keychain: it uses `InMemoryTokenStore`):

```sh
cd "$H/hover" && xcodebuild -workspace Sokosumi.xcworkspace -scheme Sokosumi -configuration Release \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath "$H/DerivedData" -skipPackagePluginValidation \
  ENABLE_CODE_COVERAGE=NO CLANG_ENABLE_CODE_COVERAGE=NO DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- ONLY_ACTIVE_ARCH=YES \
  PRODUCT_BUNDLE_IDENTIFIER=com.sokosumi.hitchprobe ENABLE_APP_SANDBOX=NO CODE_SIGN_ENTITLEMENTS= build
ditto "$H/DerivedData/Build/Products/Release/Sokosumi.app" "$H/hover.app"
```

- **Counters only** (about 15 s, prints one JSON line: row bodies, hover writes, display-link frame intervals): `"$H/hover.app/Contents/MacOS/Sokosumi"`. `HITCH_HOVER=0` runs without the resting pointer.
- **Time Profiler**: `SKILL_DIR=apps/apple/.agents/skills/swiftui-expert-skill HITCH_DEVICE=<this Mac> "$H/trace.sh" "$H/hover.app" "$H/hover.trace"`, then `python3 "$H/hover_stacks.py" "$SKILL_DIR" "$H/hover.trace" 3500 17000` for inclusive main-thread weights over the flicks (check the window with a per-half-second sum first; the flicks start about 5.5 s in). Attach mode leaves the SwiftUI and hitch lanes empty: their tables need a launched process, and `xctrace --launch` with the copy's path opened the installed `/Applications/Sokosumi.app` instead, twice.
- **Older pages**: `python3 "$H/setup.py" "$PWD" "$H/paging" paging`, build it as above (bundle `com.sokosumi.hitchprobe`), then `"$H/paging.app/Contents/MacOS/Sokosumi" > run.json` (about 20 s) and `python3 "$H/paging_table.py" run.json`. For the before build, extract `origin/main`'s `apps/apple` (`git archive origin/main apps/apple | tar -x -C <dir>`) and run `setup.py` on that directory. `HITCH_HEIGHT` (window, 800), `HITCH_PAGE` (serve older pages of this size whatever the app asks for), `HITCH_LATENCY_MS` (150), `HITCH_REST_MS` (finger lift, 300) and `HITCH_FLICKS` (6) vary the run. Controls: `HITCH_COUNT=600 HITCH_INITIAL=600 HITCH_LEAD_PT=40000 HITCH_TOUCH_MS=200` with `HITCH_NOOP=1` (a publish that changes nothing), `HITCH_APPEND=1` / `HITCH_PREPEND=1` (30 rows below / above the reader), and `HITCH_MINIMAL=1` (the same texts in a bare lazy list). With Time Profiler (`trace.sh` as above), `python3 "$H/insert_stacks.py" "$SKILL_DIR" <trace> <trace>.json` sums the main thread over the 120 ms after each insertion.
- **Row build cost**: on the paging build, `HITCH_BENCH=30 "$H/paging.app/Contents/MacOS/Sokosumi"` (about 6 s) prints the median of 30 passes that each build, lay out and draw `HITCH_BENCH_ROWS` (30) fresh rows. `HITCH_KINDS=0` (or `3,7`, any of the fixture's nine kinds) narrows the fixture for this and every other paging run. Compare variants of the copy back to back, alternating, three runs each.
- **Title bar**: `"$H/keycap.sh" "$H/title.app" "$H/title.png"`. It takes the focus for about 6 s; repeat when it prints `"active":false`.

## Sources

<!-- file: setup.py -->
```python
"""Copy apps/apple from a checkout into a disposable harness and swap in the hitch probe.

usage: setup.py <repo root> <output dir> [hover|title|paging]
"""
from pathlib import Path
import shutil
import sys

source = Path(sys.argv[1]).resolve() / 'apps/apple'
out = Path(sys.argv[2]).resolve()
mode = sys.argv[3] if len(sys.argv) > 3 else 'hover'
work = Path(__file__).resolve().parent
if out.exists():
    raise SystemExit(f'Refusing to overwrite {out}')
shutil.copytree(source, out, ignore=shutil.ignore_patterns('.build', '.agents', '.DS_Store'))


def patch(file, old, new, required=True):
    path = out / file
    text = path.read_text()
    if text.count(old) != 1:
        if required:
            raise SystemExit(f'{file}: expected one match of {old!r}, found {text.count(old)}')
        print(f'skipped optional patch in {file}')
        return
    path.write_text(text.replace(old, new))


patch('Sokosumi/Chat/Timeline/MessageRowView.swift',
      '    var body: some View {\n      HStack(alignment: .top, spacing: 14) {',
      '    var body: some View {\n      let _ = { HitchProbe.rowBodies += 1 }()\n      HStack(alignment: .top, spacing: 14) {')
patch('Sokosumi/Chat/Timeline/MessageRowView.swift',
      '          isHovered = hovering\n',
      '          isHovered = hovering\n          HitchProbe.hoverWrites += 1\n')
entry = {'title': 'TitleApp.swift', 'paging': 'PagingProbe.swift'}.get(mode, 'HitchProbe.swift')
shutil.copy(work / entry, out / 'Sokosumi/App/SokosumiApp.swift')
if mode == 'paging':
    # When each prepare starts and returns in the room view (before and after the M6 change alike).
    view = out / 'Sokosumi/Chat/Timeline/RoomTimelineView.swift'
    lines = view.read_text().split('\n')
    task = [i for i, line in enumerate(lines) if line.strip() == '.task(id: input) {']
    done = [i for i, line in enumerate(lines) if 'await PreparedTranscript.prepare(input' in line]
    assert len(task) == 1 and len(done) == 1 and task[0] < done[0], (task, done)
    lines.insert(done[0] + 1, '          HitchProbe.prepares.append((hitchStart, ProcessInfo.processInfo.systemUptime, input.messages.count))')
    lines.insert(task[0] + 1, '          let hitchStart = ProcessInfo.processInfo.systemUptime')
    view.write_text('\n'.join(lines))
shutil.copy(source / 'SokosumiTests/Chat/Timeline/ScrollMediaProtocol.swift', out / 'Sokosumi/App/ScrollMediaProtocol.swift')
if mode == 'title':
    # A light screenshot: near-white rows with a dark line of "text" every 80 px.
    patch('Sokosumi/App/ScrollMediaProtocol.swift',
          '        context.setFillColor(CGColor(red: CGFloat(row % 255) / 255, green: 0.85, blue: 0.15, alpha: 1))',
          '        let shade: CGFloat = row % 80 < 12 && row % 80 > 4 ? 0.2 : 0.97\n'
          '        context.setFillColor(CGColor(red: shade, green: shade, blue: shade, alpha: 1))')
print(out)
```

<!-- file: HitchProbe.swift -->
```swift
import AppKit
import CoreAPI
import Foundation
import OpenAPIRuntime
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Counters the disposable copy's patched sources write to.
@MainActor enum HitchProbe {
  static var rowBodies = 0
  static var hoverWrites = 0
}

@main enum HitchMain {
  @MainActor static func main() {
    let app = NSApplication.shared
    let delegate = HitchDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
  }
}

@MainActor final class HitchDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow?
  var frameTimes: [CFTimeInterval] = []
  var link: CADisplayLink?
  /// The resting pointer, in the window's coordinates, and the view whose hover regions it feeds.
  var pointer = NSPoint.zero
  weak var hoverHost: NSView?

  func applicationDidFinishLaunching(_: Notification) {
    Task {
      await run()
      NSApplication.shared.terminate(nil)
    }
  }

  /// A #Sokosumi-like mix: bursts from people, screenshots, quotes of screenshots, code, links, reactions, Thread
  /// bars and day changes. Deterministic: same ids, text and dates every run.
  static func fixture(_ count: Int) -> [Components.Schemas.ChatRoomMessage] {
    let people = [("u1", "Patrick Tobler"), ("u2", "Francis Luz"), ("u3", "Andreas"), ("u4", "Phil")]
    let start = 1_790_000_000.0
    return (0 ..< count).map { index in
      let person = people[(index / 3) % people.count]
      let kind = index % 9
      let base = "Message \(index). "
      var content: String
      switch kind {
      case 1: content = base + "Should we try to make a ChatGPT Plugin for Sokosumi (and CMO)? https://chatgpt.com/plugins\nThere aren't that many right now and it could give us some visibility."
      case 2: content = base + "Here is the screen:\n\n![Screenshot 2026-10-01 at 03.07.21.png](https://scroll-fixture.invalid/shot-\(index).png)"
      case 4: content = base + "```swift\n" + String(repeating: "let result = values.map { $0 * 2 }\n", count: 6) + "```"
      case 6: content = base + "**Improve channel member management discoverability** is done. CodePat reports that draft PR #5626 adds \"Add members\" to the Members panel, with desktop/mobile preprod tests and keyboard-focus checks completed. It remains a draft and unmerged; no production deployment was made."
      case 7: content = base + "I had this one before but I can more the tasks there. and remove mine"
      default: content = base + String(repeating: "We should definitely do it for all, but we are currently not there yet with CLI / Skills. ", count: 1 + index % 3)
      }
      var message = chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: "fixture", content: content,
                                                createdAt: Date(timeIntervalSince1970: start + Double(index) * 1_800),
                                                sender: .init(id: person.0, name: person.1, email: "\(person.0)@example.com", presence: .online)))
      message.id = "fixture-\(index)"
      if kind == 7 {
        message.quote = .init(messageId: "fixture-\(max(0, index - 5))", authorName: "Patrick Tobler",
                              snippet: "@Francis Luz is there a reason why you didn't just use the Sokosumi Development project?",
                              attachment: .init(fileName: "Screenshot 2026-10-01 at 03.07.21.png",
                                                url: "https://scroll-fixture.invalid/quote-\(index).png", mediaKind: .image))
      }
      if kind == 3 || kind == 6 {
        message.reactions = [.init(emoji: "👍", count: 2, reactedByCurrentUser: false, reactors: [.init(id: "u9", name: "Other")])]
      }
      if kind == 5 {
        message.threadReplyCount = 3
        message.threadLastReplyAt = message.createdAt.addingTimeInterval(600)
      }
      return message
    }
  }

  func scrollViews(_ view: NSView) -> [NSScrollView] {
    (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
  }

  @objc func tick(_ link: CADisplayLink) {
    frameTimes.append(link.timestamp)
  }

  func wheel(_ scroll: NSScrollView, delta: Int32, phase: Int64, momentum: Int64) {
    guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0) else { return }
    event.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
    event.setIntegerValueField(.scrollWheelEventMomentumPhase, value: momentum)
    if let ns = NSEvent(cgEvent: event) {
      scroll.scrollWheel(with: ns)
    }
    restPointer()
  }

  func restPointer() {
    guard let host = hoverHost, let window = host.window,
          let moved = NSEvent.mouseEvent(with: .mouseMoved, location: pointer, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                         windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 0, pressure: 0) else { return }
    host.mouseMoved(with: moved)
  }

  func frame() async {
    try? await Task.sleep(for: .milliseconds(16))
  }

  /// One trackpad flick: 60 changed events, then 45 decaying momentum events.
  func flick(_ scroll: NSScrollView, up: Bool) async {
    let sign: Int32 = up ? 1 : -1
    for index in 0 ..< 60 {
      wheel(scroll, delta: sign * 24, phase: index == 0 ? 1 : 2, momentum: 0)
      await frame()
    }
    wheel(scroll, delta: 0, phase: 4, momentum: 0)
    for index in 0 ..< 45 {
      let delta = Int32(Double(24) * pow(0.95, Double(index)))
      wheel(scroll, delta: sign * max(delta, 1), phase: 0, momentum: index == 0 ? 1 : (index == 44 ? 3 : 2))
      await frame()
    }
  }

  func run() async {
    let env = ProcessInfo.processInfo.environment
    let activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Scroll hitch measurement")
    defer { ProcessInfo.processInfo.endActivity(activity) }
    URLProtocol.registerClass(ScrollMediaProtocol.self)
    let count = Int(env["HITCH_COUNT"] ?? "600") ?? 600
    let state = WorkspaceState(clientProvider: { _ in Client.connecting(to: URL(string: "https://scroll-fixture.invalid")!) })
    state.timeline.reset(roomId: "fixture")
    state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
    state.timeline.messages = Self.fixture(count)
    let host = NSHostingView(rootView: RoomTimelineView(roomId: "fixture")
      .environmentObject(state).environmentObject(AuthState(store: InMemoryTokenStore())))
    let window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 1100, height: 800), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
    window.contentView = host
    window.makeKeyAndOrderFront(nil)
    // Floating, so nothing occludes it and it draws every frame; it never takes the user's focus.
    window.level = .floating
    self.window = window
    var scroll: NSScrollView?
    for _ in 0 ..< 500 {
      host.layoutSubtreeIfNeeded()
      if let found = scrollViews(host).max(by: { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) }),
         (found.documentView?.frame.height ?? 0) > found.frame.height { scroll = found; break }
      try? await Task.sleep(for: .milliseconds(20))
    }
    guard let scroll else { print("{\"error\":\"no transcript\"}"); return }
    try? await Task.sleep(for: .seconds(Double(env["HITCH_SETTLE"] ?? "3") ?? 3))
    // A pointer resting over the middle of the transcript, as in the recording. The harness is not the active
    // app, so AppKit sends no tracking events: enter the hover regions and move to the point by hand (the tests'
    // `hover`), then again after every wheel event, as AppKit does when content moves under a still pointer.
    if env["HITCH_HOVER"] != "0" {
      pointer = host.convert(NSPoint(x: host.bounds.midX, y: host.bounds.midY - 100), to: nil)
      hoverHost = host
      func areas(_ view: NSView) -> [NSTrackingArea] { view.trackingAreas + view.subviews.flatMap(areas) }
      for area in areas(host) {
        if let entered = NSEvent.enterExitEvent(with: .mouseEntered, location: pointer, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: window.windowNumber, context: nil, eventNumber: 0,
                                               trackingNumber: Int(bitPattern: Unmanaged.passUnretained(area).toOpaque()), userData: nil) {
          (area.owner as? NSResponder)?.mouseEntered(with: entered)
        }
      }
      restPointer()
      try? await Task.sleep(for: .milliseconds(500))
    }
    let displayLink = host.displayLink(target: self, selector: #selector(tick(_:)))
    displayLink.add(to: .main, forMode: .common)
    link = displayLink
    HitchProbe.rowBodies = 0
    HitchProbe.hoverWrites = 0
    let started = ProcessInfo.processInfo.systemUptime
    let startOffset = scroll.contentView.bounds.minY
    let flicks = Int(env["HITCH_FLICKS"] ?? "6") ?? 6
    for index in 0 ..< flicks {
      await flick(scroll, up: index % 3 != 2)
    }
    let elapsed = ProcessInfo.processInfo.systemUptime - started
    displayLink.invalidate()
    let intervals = zip(frameTimes.dropFirst(), frameTimes).map { ($0 - $1) * 1000 }.sorted()
    let longFrames = intervals.filter { $0 > 25 }
    let result: [String: Any] = [
      "count": count, "elapsed_s": elapsed, "moved_pt": startOffset - scroll.contentView.bounds.minY,
      "row_bodies": HitchProbe.rowBodies, "hover_writes": HitchProbe.hoverWrites,
      "frames": intervals.count, "p50_ms": intervals.isEmpty ? 0 : intervals[intervals.count / 2],
      "p95_ms": intervals.isEmpty ? 0 : intervals[intervals.count * 95 / 100], "max_ms": intervals.last ?? 0,
      "frames_over_25ms": longFrames.count, "time_over_budget_ms": longFrames.reduce(0) { $0 + $1 - 16.67 }
    ]
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
    fflush(stdout)
  }
}
```

<!-- file: TitleApp.swift -->
```swift
import AppKit
import CoreAPI
import Foundation
import OpenAPIRuntime
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI

/// Item 3 repro as a real SwiftUI scene, like `SokosumiApp`: a `WindowGroup` holding the app's split view with
/// `RoomNavigationStack` on a fixture channel whose screenshots and link previews are light pictures.
@MainActor enum HitchProbe {
  static var rowBodies = 0
  static var hoverWrites = 0
}

@MainActor final class TitleFixture {
  static let shared = TitleFixture()
  let state: WorkspaceState
  let channel: Components.Schemas.ChatRoom

  init() {
    URLProtocol.registerClass(ScrollMediaProtocol.self)
    state = WorkspaceState(clientProvider: { _ in Client.connecting(to: URL(string: "https://scroll-fixture.invalid")!) })
    state.timeline.reset(roomId: "fixture")
    state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
    state.timeline.messages = (0 ..< 80).map { index in
      var content = "Message \(index). We should definitely do it for all, but we are currently not there yet with CLI / Skills."
      if index % 4 == 1 {
        content += "\n\n![Screenshot 2026-10-01 at 03.07.21.png](https://scroll-fixture.invalid/shot-\(index).png)"
      }
      var message = chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: "fixture", content: content,
                                                createdAt: Date(timeIntervalSince1970: 1_790_000_000 + Double(index) * 1_800),
                                                sender: .init(id: "u\(index % 3)", name: ["Andreas", "Albina", "Phil"][index % 3],
                                                              email: "u@example.com", presence: .online)))
      message.id = "fixture-\(index)"
      if index % 4 == 3 {
        message.unfurls = [.init(url: "https://x.com/post/\(index)", title: "SpaceXAI on X", description: "We are glad to support the team",
                                 imageUrl: "https://scroll-fixture.invalid/card-\(index).png")]
      }
      return message
    }
    channel = Components.Schemas.ChatRoom(id: "fixture", name: "Everyone", kind: .channel, isSelfDirect: false, isGroupDirect: false,
                                          isReadOnly: false, topic: "General discussion",
                                          createdByUserId: "u1", createdAt: .now, updatedAt: .now, unreadCount: 0,
                                          unreadMentionCount: 0, markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
                                          userMembers: [], formerUserMembers: [], coworkerMembers: [], sokoBotMembers: [])
    state.rooms = [channel]
  }
}

@main
struct TitleApp: App {
  var body: some Scene {
    WindowGroup {
      NavigationSplitView {
        List { Text("Everyone") }
      } detail: {
        RoomNavigationStack(room: TitleFixture.shared.channel)
      }
      .environmentObject(TitleFixture.shared.state)
      .environmentObject(AuthState(store: InMemoryTokenStore()))
      .task { await TitleDriver.run() }
    }
  }
}

@MainActor enum TitleDriver {
  static func scrollViews(_ view: NSView) -> [NSScrollView] {
    (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
  }

  static func run() async {
    let env = ProcessInfo.processInfo.environment
    try? await Task.sleep(for: .seconds(3))
    guard let window = NSApp.windows.first(where: { $0.isVisible && $0.contentView != nil }),
          let content = window.contentView,
          let scroll = scrollViews(content).max(by: { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) })
    else { print("{\"error\":\"no transcript\"}"); NSApp.terminate(nil); return }
    window.level = .floating
    window.setFrame(NSRect(x: 200, y: 200, width: 1100, height: 800), display: true)
    try? await Task.sleep(for: .seconds(2))
    for _ in 0 ..< Int(env["HITCH_TITLE_STEPS"] ?? "6")! {
      guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 24, wheel2: 0, wheel3: 0) else { break }
      event.setIntegerValueField(.scrollWheelEventScrollPhase, value: 2)
      if let ns = NSEvent(cgEvent: event) { scroll.scrollWheel(with: ns) }
      try? await Task.sleep(for: .milliseconds(16))
    }
    // Key and active, like the window in the reports: the missing edge effect shows only then.
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    try? await Task.sleep(for: .seconds(1))
    print("{\"window\":\(window.windowNumber),\"key\":\(window.isKeyWindow),\"active\":\(NSApp.isActive)}")
    fflush(stdout)
    try? await Task.sleep(for: .seconds(5))
    NSApp.terminate(nil)
  }
}
```

<!-- file: trace.sh -->
```zsh
#!/bin/zsh
# usage: trace.sh <app> <output.trace> [template]
# Starts the harness, attaches Instruments to its pid (launch mode opened the installed Sokosumi.app instead) and
# records 22 s, which covers the 8 s settle and the six flicks. Prints the harness's own counters.
APP=$1; OUT=$2; TEMPLATE=${3:-Time Profiler}
SK=${SKILL_DIR:?set SKILL_DIR to apps/apple/.agents/skills/swiftui-expert-skill}
HITCH_SETTLE=8 HITCH_HOVER=${HITCH_HOVER:-1} "$APP/Contents/MacOS/Sokosumi" > "$OUT.json" 2>/dev/null &
PID=$!
sleep 2
python3 "$SK/scripts/record_trace.py" --device "${HITCH_DEVICE:?set HITCH_DEVICE to this Mac's name}" --template "$TEMPLATE" \
  --attach $PID --time-limit 22s --output "$OUT" > "$OUT.log" 2>&1
wait $PID
cat "$OUT.json"
```

<!-- file: keycap.sh -->
```zsh
#!/bin/zsh
# usage: keycap.sh <title-mode app> <out.png>
# Opens the title repro through LaunchServices, captures its window while it is the key window, and keeps the top
# 180 pt. It prints `"active":false` when another app kept the focus; take that capture again.
OUT=$2
open -n --env HITCH_TITLE_STEPS=${STEPS:-0} --stdout "$OUT.out" "$1"
for i in $(seq 1 60); do grep -q window "$OUT.out" 2>/dev/null && break; sleep 0.5; done
sleep 0.5
cat "$OUT.out"
W=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['window'])" "$OUT.out")
screencapture -x -o -l $W "$OUT.full.png"
sleep 6
ffmpeg -v error -y -i "$OUT.full.png" -vf "crop=iw:360:0:0,scale=1100:-1" "$OUT"
```

<!-- file: hover_stacks.py -->
```python
import collections,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'scripts'))
from instruments_parser import xctrace,xml_utils
trace=Path(sys.argv[2]); cache=trace.with_suffix('.time-profile.xml')
if not cache.exists():cache.write_bytes(xctrace.export_schema(trace,'time-profile'))
window=None if len(sys.argv)<5 else (int(float(sys.argv[3])*1e6),int(float(sys.argv[4])*1e6))
stream=xml_utils.RowStream(cache.read_bytes())
APP_KEYS=('RoomTimelineView','RoomTranscriptContent','MessageRowView','PreparedTranscript','Hitch','MessageMarkdown','ExpandableMessageBody','TranscriptScrollEdges','MessageImageView','MessageQuoteView','QuoteImage','MessageAttachment','MessageReactions','ThreadReplyBar','ParticipantAvatar','ParticipantProfile','DaySeparator','MessageCodeBlock','JumpSpotlight','DeliveryFeedback','SeenBy','MessageContextMenu','TranscriptScrollActivity','Sokosumi','Workspace','Composer','ScrollMedia','loadImageThumbnail','Highlight','TreeSitter')
inclusive=collections.Counter();leaf=collections.Counter();app=collections.Counter();total=0;sample_count=0
for row in stream:
 time=row.get('time');stack=row.get('stack');thread=row.get('thread');weight=row.get('weight')
 if time is None or stack is None or thread is None:continue
 ns=xml_utils.int_text(stream.resolve(time))
 if not xml_utils.in_window(ns,window):continue
 if not xml_utils.extract_thread(thread,stream)['is_main']:continue
 frames=xml_utils.extract_backtrace(stack,stream,max_frames=128)
 names=[f['name'] for f in frames]
 if not names:continue
 w=xml_utils.int_text(stream.resolve(weight)) or 0
 total+=w;sample_count+=1;leaf[names[0]]+=w
 for name in set(names):
  inclusive[name]+=w
  if any(key in name for key in APP_KEYS):app[name]+=w

def top(counter):return [{'symbol':k,'ms':round(v/1e6,3),'percent_main_weight':round(100*v/total,2)} for k,v in counter.most_common(400)]
print(json.dumps({'main_samples':sample_count,'main_weight_ms':round(total/1e6,3),'window_ns':window,'leaf':top(leaf),'inclusive':top(inclusive),'app_inclusive':top(app)},indent=2))
```

<!-- file: PagingProbe.swift -->
```swift
import AppKit
import Combine
import CoreAPI
import Foundation
import OpenAPIRuntime
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI
import Synchronization

/// Counters the disposable copy's patched sources write to.
@MainActor enum HitchProbe {
  static var rowBodies = 0
  static var hoverWrites = 0
  /// (started, finished, messages) of every `PreparedTranscript.prepare` the room view committed.
  static var prepares: [(Double, Double, Int)] = []
}

/// Fake Core at the URLSession transport: the latest page, then older pages of the size the app asks for (or
/// `pageOverride`) behind opaque cursors `c<first index>`, each answered after `latency` seconds, like a Core round trip.
final nonisolated class PagedCoreProtocol: URLProtocol, @unchecked Sendable {
  static let messages = Mutex<[Components.Schemas.ChatRoomMessage]>([])
  static let latestCount = Mutex(100)
  static let pageOverride = Mutex<Int?>(nil)
  static let latency = Mutex(0.15)
  static let requests = Mutex(0)
  private let pending = Mutex<Task<Void, Never>?>(nil)

  override static func canInit(with request: URLRequest) -> Bool {
    request.url?.host == "paging-fixture.invalid"
  }

  override static func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    guard let url = request.url else { return }
    let isPage = url.path.hasSuffix("/messages")
    let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let cursor = query.first { $0.name == "cursor" }?.value
    let data = isPage ? Self.page(cursor: cursor, limit: query.first { $0.name == "limit" }?.value.flatMap { Int($0) }) : nil
    if isPage {
      Self.requests.withLock { $0 += 1 }
    }
    let delay = isPage && cursor != nil ? Self.latency.withLock { $0 } : 0
    let work = Task { @Sendable [self] in
      if delay > 0 {
        do { try await Task.sleep(for: .seconds(delay)) } catch { return }
      }
      guard let response = HTTPURLResponse(url: url, statusCode: data == nil ? 404 : 200, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"]) else { return }
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data ?? Data("{\"message\":\"not found\"}".utf8))
      client?.urlProtocolDidFinishLoading(self)
    }
    pending.withLock { $0 = work }
  }

  override func stopLoading() {
    pending.withLock { $0?.cancel()
      $0 = nil
    }
  }

  static func page(_ messages: [Components.Schemas.ChatRoomMessage], nextCursor: String?) -> Data {
    let encoder = JSONEncoder()
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
    encoder.dateEncodingStrategy = .formatted(formatter)
    return try! JSONSerialization.data(withJSONObject: [
      "data": JSONSerialization.jsonObject(with: encoder.encode(messages)),
      "meta": ["timestamp": "2026-10-09T00:00:00.000Z", "requestId": "fixture",
               "pagination": ["cursor": NSNull(), "limit": messages.count, "total": messages.count, "nextCursor": nextCursor as Any? ?? NSNull()]]
    ])
  }

  static func serve(_ all: [Components.Schemas.ChatRoomMessage], pageOverride: Int?, latest: Int) {
    messages.withLock { $0 = all }
    latestCount.withLock { $0 = latest }
    self.pageOverride.withLock { $0 = pageOverride }
  }

  /// The `latestCount` newest rows without a cursor; otherwise the rows before index `c<end>`.
  static func page(cursor: String?, limit: Int?) -> Data {
    let all = messages.withLock { $0 }
    let end = cursor.map { Int($0.dropFirst()) ?? 0 } ?? all.count
    let size = cursor == nil ? latestCount.withLock { $0 } : pageOverride.withLock { $0 } ?? limit ?? 30
    let start = max(0, end - size)
    return page(Array(all[start ..< end]), nextCursor: start > 0 ? "c\(start)" : nil)
  }
}

/// Control: the same texts in a bare SwiftUI lazy list, with no app code.
@MainActor final class MinimalRows: ObservableObject {
  struct Row: Identifiable {
    let id: String
    let text: String
  }

  @Published var rows: [Row] = []
}

struct MinimalList: View {
  @ObservedObject var model: MinimalRows

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        ForEach(model.rows) { row in
          Text(row.text).padding(.horizontal, 60).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
  }
}

@main enum HitchMain {
  @MainActor static func main() {
    let app = NSApplication.shared
    let delegate = HitchDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
  }
}

@MainActor final class HitchDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow?
  /// (timestamp, offset, document height) per display-link frame.
  var frames: [(CFTimeInterval, CGFloat, CGFloat)] = []
  var link: CADisplayLink?
  weak var scroll: NSScrollView?
  var inserts: [(Double, Int)] = []
  var observation: AnyCancellable?
  /// Each flick's first and last wheel event: frames inside move content.
  var flickWindows: [(Double, Double)] = []
  var begins: [Double] = []
  var beginObservation: AnyCancellable?

  func applicationDidFinishLaunching(_: Notification) {
    Task {
      await run()
      NSApplication.shared.terminate(nil)
    }
  }

  /// The hover harness's #Sokosumi-like mix, oldest first. Deterministic: same ids, text and dates every run.
  /// `HITCH_KINDS` (say `0` or `3,7`) keeps only those of the nine kinds, in turn.
  static func fixture(_ count: Int) -> [Components.Schemas.ChatRoomMessage] {
    let people = [("u1", "Patrick Tobler"), ("u2", "Francis Luz"), ("u3", "Andreas"), ("u4", "Phil")]
    let start = 1_790_000_000.0
    let kinds = (ProcessInfo.processInfo.environment["HITCH_KINDS"] ?? "0,1,2,3,4,5,6,7,8").split(separator: ",").compactMap { Int($0) }
    return (0 ..< count).map { index in
      let person = people[(index / 3) % people.count]
      let kind = kinds[index % kinds.count]
      let base = "Message \(index). "
      var content: String
      switch kind {
      case 1: content = base + "Should we try to make a ChatGPT Plugin for Sokosumi (and CMO)? https://chatgpt.com/plugins\nThere aren't that many right now and it could give us some visibility."
      case 2: content = base + "Here is the screen:\n\n![Screenshot 2026-10-01 at 03.07.21.png](https://scroll-fixture.invalid/shot-\(index).png)"
      case 4: content = base + "```swift\n" + String(repeating: "let result = values.map { $0 * 2 }\n", count: 6) + "```"
      case 6: content = base + "**Improve channel member management discoverability** is done. CodePat reports that draft PR #5626 adds \"Add members\" to the Members panel, with desktop/mobile preprod tests and keyboard-focus checks completed. It remains a draft and unmerged; no production deployment was made."
      case 7: content = base + "I had this one before but I can more the tasks there. and remove mine"
      default: content = base + String(repeating: "We should definitely do it for all, but we are currently not there yet with CLI / Skills. ", count: 1 + index % 3)
      }
      var message = chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: "fixture", content: content,
                                                createdAt: Date(timeIntervalSince1970: start + Double(index) * 1_800),
                                                sender: .init(id: person.0, name: person.1, email: "\(person.0)@example.com", presence: .online)))
      message.id = "fixture-\(index)"
      if kind == 7 {
        message.quote = .init(messageId: "fixture-\(max(0, index - 5))", authorName: "Patrick Tobler",
                              snippet: "@Francis Luz is there a reason why you didn't just use the Sokosumi Development project?",
                              attachment: .init(fileName: "Screenshot 2026-10-01 at 03.07.21.png",
                                                url: "https://scroll-fixture.invalid/quote-\(index).png", mediaKind: .image))
      }
      if kind == 3 || kind == 6 {
        message.reactions = [.init(emoji: "👍", count: 2, reactedByCurrentUser: false, reactors: [.init(id: "u9", name: "Other")])]
      }
      if kind == 5 {
        message.threadReplyCount = 3
        message.threadLastReplyAt = message.createdAt.addingTimeInterval(600)
      }
      return message
    }
  }

  func scrollViews(_ view: NSView) -> [NSScrollView] {
    (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
  }

  @objc func tick(_ link: CADisplayLink) {
    frames.append((link.timestamp, scroll?.contentView.bounds.minY ?? 0, scroll?.documentView?.frame.height ?? 0))
  }

  func wheel(_ scroll: NSScrollView, delta: Int32, phase: Int64, momentum: Int64) {
    guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0) else { return }
    event.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
    event.setIntegerValueField(.scrollWheelEventMomentumPhase, value: momentum)
    if let ns = NSEvent(cgEvent: event) {
      scroll.scrollWheel(with: ns)
    }
  }

  func frame() async {
    try? await Task.sleep(for: .milliseconds(16))
  }

  /// One upward trackpad flick: 60 changed events, then 45 decaying momentum events.
  func flick(_ scroll: NSScrollView) async {
    for index in 0 ..< 60 {
      wheel(scroll, delta: 24, phase: index == 0 ? 1 : 2, momentum: 0)
      await frame()
    }
    wheel(scroll, delta: 0, phase: 4, momentum: 0)
    for index in 0 ..< 45 {
      let delta = Int32(Double(24) * pow(0.95, Double(index)))
      wheel(scroll, delta: max(delta, 1), phase: 0, momentum: index == 0 ? 1 : (index == 44 ? 3 : 2))
      await frame()
    }
  }

  /// Builds, lays out and draws `HITCH_BENCH_ROWS` fresh message rows (the fixture's mix, with the actions the room
  /// passes) in a new hosting view, `HITCH_BENCH` times, and prints the median pass: what building a row costs, the
  /// work a landing does for every row it realizes, without the scroll timing's noise.
  func bench(_ env: [String: String]) async {
    let rows = Int(env["HITCH_BENCH_ROWS"] ?? "30") ?? 30
    let passes = Int(env["HITCH_BENCH"] ?? "40") ?? 40
    let messages = Self.fixture(rows)
    let documents = messages.map { MessageMarkdown($0.content, diagrams: true) }
    let state = WorkspaceState(clientProvider: { _ in Client.connecting(to: URL(string: "https://scroll-fixture.invalid")!) })
    let auth = AuthState(store: InMemoryTokenStore())
    let window = NSWindow(contentRect: NSRect(x: 200, y: 100, width: 1100, height: 900), styleMask: [.titled], backing: .buffered, defer: false)
    window.level = .floating
    window.ignoresMouseEvents = true
    window.orderFront(nil)
    var times: [Double] = []
    for pass in 0 ..< passes + 3 {
      let start = ProcessInfo.processInfo.systemUptime
      let host = NSHostingView(rootView: VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
          MessageRowView(preparedDocument: documents[index], message: message, isContinuation: index % 3 != 0, outbound: nil,
                         onRetry: nil, onRemove: nil, onReply: { _ = pass }, onQuote: { _ = pass }, onToggleReaction: { _ in pass > 0 },
                         onQuoteJump: { _ in _ = pass }, horizontalInset: 12)
        }
      }
      .environmentObject(state).environmentObject(auth))
      host.frame = NSRect(x: 0, y: 0, width: 1100, height: 900)
      window.contentView = host
      host.layoutSubtreeIfNeeded()
      host.displayIfNeeded()
      CATransaction.flush()
      // The first three passes warm caches.
      if pass >= 3 {
        times.append((ProcessInfo.processInfo.systemUptime - start) * 1000)
      }
      window.contentView = nil
      try? await Task.sleep(for: .milliseconds(30))
    }
    times.sort()
    let result: [String: Any] = ["rows": rows, "passes": passes, "median_ms": times[times.count / 2], "p25_ms": times[times.count / 4],
                                 "p75_ms": times[times.count * 3 / 4]]
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
    fflush(stdout)
  }

  func run() async {
    let env = ProcessInfo.processInfo.environment
    let activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Scroll hitch measurement")
    defer { ProcessInfo.processInfo.endActivity(activity) }
    URLProtocol.registerClass(ScrollMediaProtocol.self)
    if env["HITCH_BENCH"] != nil {
      await bench(env)
      return
    }
    let count = Int(env["HITCH_COUNT"] ?? "600") ?? 600
    PagedCoreProtocol.serve(Self.fixture(count), pageOverride: Int(env["HITCH_PAGE"] ?? ""),
                            latest: Int(env["HITCH_INITIAL"] ?? "100") ?? 100)
    PagedCoreProtocol.latency.withLock { $0 = (Double(env["HITCH_LATENCY_MS"] ?? "150") ?? 150) / 1000 }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [PagedCoreProtocol.self]
    let client = Client.connecting(to: URL(string: "https://paging-fixture.invalid/v1")!, session: URLSession(configuration: configuration))
    let state = WorkspaceState(clientProvider: { _ in client })
    state.timeline.reset(roomId: "fixture")
    _ = try? await state.timeline.loadPage(.initial, client: client, organizationSlug: nil, generation: state.timeline.generation)
    let touchEvery = Double(env["HITCH_TOUCH_MS"] ?? "0") ?? 0
    guard state.timeline.messages.count == min(count, Int(env["HITCH_INITIAL"] ?? "100") ?? 100), state.transcriptHasMore || touchEvery > 0 else {
      print("{\"error\":\"initial page: \(state.timeline.messages.count) messages, hasMore \(state.transcriptHasMore)\"}")
      return
    }
    let minimal = MinimalRows()
    minimal.rows = state.timeline.messages.map { .init(id: $0.id, text: $0.content) }
    let host: NSView = env["HITCH_MINIMAL"] == "1" ? NSHostingView(rootView: MinimalList(model: minimal))
      : NSHostingView(rootView: RoomTimelineView(roomId: "fixture")
        .environmentObject(state).environmentObject(AuthState(store: InMemoryTokenStore())))
    let window = NSWindow(contentRect: NSRect(x: 200, y: 100, width: 1100, height: Double(env["HITCH_HEIGHT"] ?? "800") ?? 800), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
    window.contentView = host
    window.makeKeyAndOrderFront(nil)
    // Floating, so nothing occludes it and it draws every frame; it never takes the user's focus.
    window.level = .floating
    window.ignoresMouseEvents = true
    self.window = window
    var found: NSScrollView?
    for _ in 0 ..< 500 {
      host.layoutSubtreeIfNeeded()
      if let candidate = scrollViews(host).max(by: { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) }),
         (candidate.documentView?.frame.height ?? 0) > candidate.frame.height { found = candidate; break }
      try? await Task.sleep(for: .milliseconds(20))
    }
    guard let scroll = found else { print("{\"error\":\"no transcript\"}"); return }
    self.scroll = scroll
    try? await Task.sleep(for: .seconds(Double(env["HITCH_SETTLE"] ?? "3") ?? 3))
    // Skip the latest page without a scroll gesture (no automatic load): park the reader 1,500 pt below the top,
    // so the first flick reaches the older-page boundary.
    if let document = scroll.documentView {
      let lead = CGFloat(Double(env["HITCH_LEAD_PT"] ?? "1500") ?? 1500)
      let y = document.isFlipped ? lead : document.frame.height - scroll.contentView.bounds.height - lead
      scroll.contentView.scroll(to: NSPoint(x: 0, y: y))
      scroll.reflectScrolledClipView(scroll.contentView)
      try? await Task.sleep(for: .seconds(1))
    }
    let started = ProcessInfo.processInfo.systemUptime
    observation = state.timeline.$messages.dropFirst().sink { [weak self] messages in
      self?.inserts.append((ProcessInfo.processInfo.systemUptime, messages.count))
    }
    beginObservation = state.timeline.$isLoadingOlder.removeDuplicates().dropFirst().filter { $0 }.sink { [weak self] _ in
      self?.begins.append(ProcessInfo.processInfo.systemUptime)
    }
    HitchProbe.prepares = []
    HitchProbe.rowBodies = 0
    let displayLink = (host as NSView).displayLink(target: self, selector: #selector(tick(_:)))
    displayLink.add(to: .main, forMode: .common)
    link = displayLink
    // Control: with HITCH_TOUCH_MS, a reaction on the oldest loaded message changes that often instead of pages
    // arriving (run with HITCH_COUNT=100, so there is no older page), and each change counts as an insertion.
    let touches = touchEvery > 0 ? Task { @MainActor in
      var flag = false
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(touchEvery))
        flag.toggle()
        if env["HITCH_APPEND"] == "1" {
          // Thirty newer messages below the reader, as a page landing where they are not reading.
          let base = state.timeline.messages.count
          state.timeline.messages += Self.fixture(base + 30).suffix(30).map { message in
            var newer = message
            newer.id = "append-\(message.id)"
            return newer
          }
          continue
        }
        if env["HITCH_MINIMAL"] == "1" {
          let page = Self.fixture(30).map { MinimalRows.Row(id: "m\(minimal.rows.count)-\($0.id)", text: $0.content) }
          if env["HITCH_APPEND"] == "1" {
            minimal.rows += page
          } else {
            minimal.rows.insert(contentsOf: page, at: 0)
          }
          self.inserts.append((ProcessInfo.processInfo.systemUptime, minimal.rows.count))
          continue
        }
        if env["HITCH_NOOP"] == "1" {
          // A publish that changes nothing: what every workspace change costs the transcript by itself.
          state.objectWillChange.send()
          continue
        }
        if env["HITCH_PREPEND"] == "1" {
          // Thirty older messages above the reader, wherever the reader is.
          let older = Self.fixture(30).map { message in
            var prior = message
            prior.id = "prepend-\(state.timeline.messages.count)-\(message.id)"
            prior.createdAt = message.createdAt.addingTimeInterval(-10_000_000)
            return prior
          }
          state.timeline.messages.insert(contentsOf: older, at: 0)
          continue
        }
        state.timeline.messages[0].reactions = flag ? [.init(emoji: "👀", count: 1, reactedByCurrentUser: false, reactors: [.init(id: "u8", name: "Eyes")])] : []
      }
    } : nil
    let flicks = Int(env["HITCH_FLICKS"] ?? "6") ?? 6
    let rest = Double(env["HITCH_REST_MS"] ?? "300") ?? 300
    for _ in 0 ..< flicks {
      let begin = ProcessInfo.processInfo.systemUptime
      await flick(scroll)
      flickWindows.append((begin, ProcessInfo.processInfo.systemUptime))
      // The finger lifts and lands again.
      try? await Task.sleep(for: .milliseconds(rest))
    }
    touches?.cancel()
    try? await Task.sleep(for: .milliseconds(500))
    let elapsed = ProcessInfo.processInfo.systemUptime - started
    displayLink.invalidate()
    observation = nil
    func ms(_ time: Double) -> Double { ((time - started) * 1000).rounded() }
    let gaps = zip(frames.dropFirst(), frames).map { (at: $0.0, ms: ($0.0 - $1.0) * 1000, jump: $0.1 - $1.1, grew: $0.2 - $1.2) }
    let long = gaps.filter { $0.ms > 25 }
    /// Gaps from 50 ms before to 700 ms after each committed page (its prepared snapshot).
    let insertWindows = inserts.map { insert in
      let prepared = HitchProbe.prepares.first { $0.1 >= insert.0 && $0.2 == insert.1 }
      let near = gaps.filter { $0.at >= insert.0 - 0.05 && $0.at <= insert.0 + 0.7 }
      return [
        "at_ms": ms(insert.0), "messages": insert.1,
        "prepare_ms": prepared.map { (($0.1 - $0.0) * 1000).rounded() } ?? -1,
        "prepared_at_ms": prepared.map { ms($0.1) } ?? -1,
        "max_gap_ms": (near.map(\.ms).max() ?? 0).rounded(),
        "over_25": near.filter { $0.ms > 25 }.map { ["at_ms": ms($0.at), "ms": $0.ms.rounded(), "grew": $0.grew.rounded(), "jump": $0.jump.rounded()] }
      ] as [String: Any]
    }
    /// The frame that draws each older page's "Loading older messages…" (the load starting), up to 60 ms after it.
    let beginFrames = begins.map { begin in gaps.filter { $0.at >= begin && $0.at <= begin + 0.06 }.map(\.ms).max() ?? 0 }
    let moving = long.filter { gap in flickWindows.contains { gap.at >= $0.0 && gap.at <= $0.1 + 0.05 } }
    /// Frames in which an older page's rows landed (the document grew by more than 500 pt), and whether content moved.
    let landings = gaps.enumerated().filter { $0.element.grew > 500 }.map { index, gap in
      // How far content moved in each of the five frames before and after (0 = at rest).
      let around = gaps[max(0, index - 5) ..< min(gaps.count, index + 6)].map { abs($0.jump).rounded() }
      // A flipped document keeps the rows on screen only if the offset follows the growth above them.
      let shifted = gaps[index ..< min(gaps.count, index + 6)].reduce(0) { $0 + $1.jump }
      let kept = (scroll.documentView?.isFlipped ?? false) ? abs(shifted - gap.grew) < 50 : abs(shifted) < 50
      return ["at_ms": ms(gap.at), "ms": gap.ms.rounded(), "grew": gap.grew.rounded(), "moved_pt_around": around,
              "shifted": shifted.rounded(), "kept": kept,
       "moving": flickWindows.contains { gap.at >= $0.0 && gap.at <= $0.1 + 0.05 }] as [String: Any]
    }
    let sorted = gaps.map(\.ms).sorted()
    let result: [String: Any] = [
      "count": count, "elapsed_s": elapsed, "messages_end": state.timeline.messages.count,
      "requests": PagedCoreProtocol.requests.withLock { $0 }, "row_bodies": HitchProbe.rowBodies,
      "frames": sorted.count, "p50_ms": sorted.isEmpty ? 0 : sorted[sorted.count / 2],
      "p95_ms": sorted.isEmpty ? 0 : sorted[sorted.count * 95 / 100], "max_ms": sorted.last ?? 0,
      "frames_over_25ms": long.count, "time_over_budget_ms": long.reduce(0) { $0 + $1.ms - 16.67 }.rounded(),
      "insert_over_25ms": insertWindows.reduce(0) { $0 + (($1["over_25"] as? [Any])?.count ?? 0) },
      "inserts": insertWindows,
      "moving_over_25ms": moving.count, "moving_over_budget_ms": moving.reduce(0) { $0 + $1.ms - 16.67 }.rounded(),
      "landings": landings,
      "document_flipped": scroll.documentView?.isFlipped ?? false,
      "flicks_ms": flickWindows.map { [ms($0.0), ms($0.1)] },
      "begin_frames_ms": beginFrames.map { $0.rounded() },
      "begins_at_ms": begins.map(ms),
      "start_uptime": started
    ]
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
    fflush(stdout)
  }
}
```

<!-- file: paging_table.py -->
```python
"""One line per paging run: page landings (frames where the document grew by 500 pt or more), how many fell while
content moved (2 pt or more in any of the five frames either side), how many kept the reader on the rows they saw
(the offset followed the growth within 50 pt over six frames), and frames over 25 ms.

usage: paging_table.py <run.json>...
"""
import json
import sys

for path in sys.argv[1:]:
    run = json.load(open(path))
    landings = run['landings']
    moving = [l for l in landings if max(l['moved_pt_around'][:5] + l['moved_pt_around'][6:], default=0) >= 2]
    print(f"{path.rsplit('/', 1)[-1]}: pages {run['requests'] - 1}, landings {len(landings)} "
          f"(while moving {len(moving)}, reader kept {sum(1 for l in landings if l.get('kept'))}), landing frame mean {sum(l['ms'] for l in landings) / max(len(landings), 1):.0f} ms, "
          f"frames over 25 ms {run['frames_over_25ms']} ({run['time_over_budget_ms']:.0f} ms over budget), max {run['max_ms']:.0f} ms")
```

<!-- file: insert_stacks.py -->
```python
"""Main-thread stacks in the frames that follow each older-page insertion.

usage: insert_stacks.py <skill dir> <trace> <probe json> [window ms after insert, default 120] [inserts|begins|landings]

Aligns the probe's insertion times (ms after the first flick) to the trace by sliding them over the main thread's
10 ms activity bins and taking the offset with the most busy samples inside the windows, then sums inclusive
weights there. `landings` aligns on, and sums over, the frames in which a page's rows landed instead: with older
pages held for the scroll to rest, those come well after the insertion.
"""
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]) / 'scripts'))
from instruments_parser import xctrace, xml_utils  # noqa: E402

trace = Path(sys.argv[2])
run = json.load(open(sys.argv[3]))
span = int(sys.argv[4]) if len(sys.argv) > 4 else 120
cache = trace.with_suffix('.time-profile.xml')
if not cache.exists():
    cache.write_bytes(xctrace.export_schema(trace, 'time-profile'))
stream = xml_utils.RowStream(cache.read_bytes())
samples = []
for row in stream:
    time, stack, thread, weight = row.get('time'), row.get('stack'), row.get('thread'), row.get('weight')
    if time is None or stack is None or thread is None:
        continue
    if not xml_utils.extract_thread(thread, stream)['is_main']:
        continue
    names = [f['name'] for f in xml_utils.extract_backtrace(stack, stream, max_frames=160)]
    if names:
        samples.append((xml_utils.int_text(stream.resolve(time)) / 1e6, xml_utils.int_text(stream.resolve(weight)) or 0, names))

mode = sys.argv[5] if len(sys.argv) > 5 else 'inserts'
inserts = [i['at_ms'] for i in run['inserts']]
events = run['begins_at_ms'] if mode == 'begins' else inserts
# A landing frame's work runs in the interval that ends at its display-link timestamp.
landings = [(l['at_ms'] - l['ms'], l['at_ms']) for l in run['landings']]
bins = collections.Counter(int(ms // 10) for ms, _, _ in samples)


def score(offset):
    if mode == 'landings':
        return sum(bins[int((offset + start) // 10) + k] for start, end in landings for k in range(max(1, int((end - start) // 10))))
    return sum(bins[int((offset + at) // 10) + k] for at in inserts for k in range(span // 10))


last = max([inserts[-1]] + [end for _, end in landings])
best = max(range(0, int(samples[-1][0]) - int(last), 5), key=score)
windows = ([(best + start - 5, best + end + 5) for start, end in landings] if mode == 'landings'
           else [(best + at, best + at + span) for at in events])
inside = [s for s in samples if any(a <= s[0] < b for a, b in windows)]
total = sum(w for _, w, _ in inside)
inclusive = collections.Counter()
for _, w, names in inside:
    for name in set(names):
        inclusive[name] += w
print(json.dumps({
    'offset_ms': best, 'windows': len(windows), 'window_ms': span, 'main_ms': round(total / 1e6, 1),
    'main_ms_per_insert': round(total / 1e6 / len(windows), 1),
    'inclusive': [{'symbol': k[:160], 'ms': round(v / 1e6, 1), 'pct': round(100 * v / total, 1)} for k, v in inclusive.most_common(1500)]
}, indent=1))
```
