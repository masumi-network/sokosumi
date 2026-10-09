# Scrolling under a resting pointer (M6, M8) and the title bar edge

Two disposable harnesses for what the M6 matrix does not cover: a transcript scrolled with the pointer resting over it, and a light picture under the room's title in the key window. Both copy `apps/apple` into a scratch directory, swap the copy's entry point and never touch the checkout. Use them beside the [M6 harness](scrolling-performance-harness.md), whose parser this one reuses through the app-scoped `swiftui-expert-skill`.

## What they showed (2026-10-09, macOS 27.0.1, Release, ad hoc)

**Hover under a scroll.** `HitchProbe.swift` opens `RoomTimelineView` on 600 fixture messages (bursts, screenshots, quotes of screenshots, code, reactions, Thread bars, day changes), rests a pointer over the list by feeding the hosting view tracking events as the tests' `hover` does, and plays six trackpad flicks (60 changed and 45 momentum events, 16 ms apart). Instruments' Time Profiler, attached, over the 11.5 s of flicks:

| Build | Main thread | `NSHostingView.layout()` | `MessageRowView.body` | Display-link frames over 25 ms |
| --- | --- | --- | --- | --- |
| hover delay (#5898), no pointer | 2,529 ms | 1,453 ms | 109 ms | 8 |
| hover delay (#5898), pointer resting | 3,237 / 3,221 ms | 2,008 / 1,991 ms | 113 / 128 ms | 27 / 20 |
| bar built only on hover, pointer resting | 2,705 / 2,491 ms | 1,664 / 1,509 ms | 84 / 82 ms | 16 / 8 |

The pointer's share is SwiftUI's own hover pass after each scroll step (`EventBindingManager.enqueueHoverUpdateIfNeeded` → `NSHostingView.didRequestHoverUpdate`, about 9 % of the main thread, with the responder-tree build and the hover dispatcher another 4–5 % each) and the layout it drags along. App code stays small: every row's body is under 4 %, the hidden action bar about 1 %. Building the bar only for the row under the pointer removes two `ViewThatFits` variants of about eight controls from every realized row and cuts main-thread work by 16–23 %.

Ruled out on the way: making the list content non-hit-testable while scrolling removed about 40 % of the pointer's cost but stopped the wheel from scrolling the list at all in the hosted tests (SwiftUI routes the wheel through hit testing); `onHover` in place of the row's `onContinuousHover` measured the same as before. Image decoding runs off the main thread already (`png_read_*` on the decode queue). The older-page insertion the user's recording paused on is not in this fixture; every message is loaded up front.

**The title bar.** `TitleApp.swift` is a real SwiftUI `App` like `SokosumiApp`: a `WindowGroup` with the app's `NavigationSplitView` and `RoomNavigationStack` (its `RoomToolsModifier`, header and inspector) on a channel whose screenshots and link previews are near-white pictures. In the key window the automatic and the soft top edge draw nothing, so a picture under the title hides the room's name; an inactive window dims it, which is why an earlier `NSHostingView` capture missed it. A hard top edge keeps the name legible in both. Captures: [title-bar-over-light-picture.png](images/title-bar-over-light-picture.png), the key window before (top) and with the hard edge (bottom).

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
- **Title bar**: `"$H/keycap.sh" "$H/title.app" "$H/title.png"`. It takes the focus for about 6 s; repeat when it prints `"active":false`.

## Sources

<!-- file: setup.py -->
```python
"""Copy apps/apple from a checkout into a disposable harness and swap in the hitch probe.

usage: setup.py <repo root> <output dir> [hover|title]
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
shutil.copy(work / ('TitleApp.swift' if mode == 'title' else 'HitchProbe.swift'), out / 'Sokosumi/App/SokosumiApp.swift')
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
