# Re-running the M6 scrolling measurement

This harness runs the real `RoomTimelineView`, `MessageRowView`, composer, renderers, and coordinator without an account. It adapts the window/scroll/media seam in `SokosumiTests/Chat/Timeline/TranscriptScrollingTests.swift`. It copies `apps/apple` into a disposable directory, inserts probes into that copy, and replaces only the copied app entry point. It never writes product sources in the checkout or adds package products to `SokosumiTests`.

The probes and fixtures are inlined below. They use existing dependencies and system frameworks. Source replacements assert an exact match and stop if the implementation changes. Review a failed match against the new source; do not remove the assertion. The original measured source baseline is `85524b023fc44ee13ce92d848e25c5cc23b08487`. The retry-guard follow-up compares `e7ec006938a2f0a9f419da39e236b2eb24282468` with the guard applied. For a before/after comparison, use a separate fresh harness directory for each source checkout; pass that checkout’s repository root to `setup.py`. The counter probes are identical on both sides.

## One-command regression check

From the repository root on a Mac with Xcode 27 and a visible desktop:

```sh
python3 apps/apple/scripts/run-scrolling-performance.py
```

The runner extracts the five sources below, copies Apple sources, checks the workspace scheme, builds one Release app, and preserves its binary before measuring. It runs the complete **12-case short matrix** (room/thread × 50/500/2,000 messages × plain/mixed content), then the **24 live-update checks**. Mixed content includes text, markdown, code, images, unfurls and reactions. This is the stable-projection regression check; it does not run the original 21-case timing study or measure presented-frame smoothness.

Allow roughly 5–10 minutes including a build on the audited host; cache and machine load affect this. Keep the window visible, avoid moving the pointer over it, and run no other build or UI benchmark concurrently. The runner serializes its own invocations and clears inherited `M6_*` filters so a prior smoke-test setting cannot shrink the matrix. A missing/duplicate case, shortened scroll phase, failed counter assertion or failed subprocess produces a nonzero exit. Interrupted/timed-out subprocess groups are terminated.

Xcode resolves the original workspace's DerivedData cache by default. To select an existing cache or a new artifact directory explicitly:

```sh
python3 apps/apple/scripts/run-scrolling-performance.py \
  --derived-data /absolute/path/to/existing/DerivedData \
  --output /tmp/sokosumi-scrolling-run
```

`--output` must not exist; both paths must be outside `apps/apple`. Without `--output`, a fresh temporary directory is retained. The runner prints its location immediately and leaves `summary.json`, the raw `projection-*.jsonl` / `updates-*.jsonl`, checker/build logs, extracted probes, copied sources and app binary there. The report records source revision, Apple working-tree changes, probe/binary hashes, case counts and pass/fail status. A successful report explicitly records **CPU-work checks passed; smoothness unmeasured**. Failures retain their logs and a failed report; earlier results are never overwritten.

The runner/checker tests take a few seconds, require no Xcode or UI, and run in the existing Apple lint job:

```sh
python3 apps/apple/scripts/test-scrolling-performance.py
```

The detailed commands below remain available for historical comparisons, the longer matrix, preparation/lookup timings and Instruments captures.

## Manual measurement and historical comparisons

From the repository root, extract the five files to a fresh temporary directory:

```sh
M6_WORK=$(mktemp -d /tmp/soko-m6.XXXXXX)
python3 - "$M6_WORK" <<'PY'
import pathlib, re, sys
text = pathlib.Path('apps/apple/docs/scrolling-performance-harness.md').read_text()
for name, code in re.findall(r'<!-- file: ([\w.]+) -->\n```\w+\n(.*?)\n```', text, re.S):
    pathlib.Path(sys.argv[1], name).write_text(code + '\n')
print(sys.argv[1])
PY
python3 "$M6_WORK/setup.py" "$PWD"
```

Set `M6_DERIVED` to an existing DerivedData directory's absolute path, or a new directory for an uncached build. Ask Xcode for the copied workspace's schemes, then build the copied app. The audited Release build required both coverage settings below; `CLANG_ENABLE_CODE_COVERAGE=NO` alone left Swift coverage instrumentation enabled.

```sh
M6_DERIVED="$M6_WORK/DerivedData"
xcodebuild -workspace "$M6_WORK/apple/Sokosumi.xcworkspace" -list
xcodebuild -workspace "$M6_WORK/apple/Sokosumi.xcworkspace" -scheme Sokosumi \
  -configuration Release -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$M6_DERIVED" -skipPackagePluginValidation \
  ENABLE_CODE_COVERAGE=NO CLANG_ENABLE_CODE_COVERAGE=NO \
  DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- ONLY_ACTIVE_ARCH=YES \
  PRODUCT_BUNDLE_IDENTIFIER=com.sokosumi.m6probe ENABLE_APP_SANDBOX=NO \
  CODE_SIGN_ENTITLEMENTS= build > "$M6_WORK/build.log" 2>&1
M6_APP="$M6_DERIVED/Build/Products/Release/Sokosumi.app/Contents/MacOS/Sokosumi"
"$M6_APP" > "$M6_WORK/ui-results.jsonl" 2> "$M6_WORK/ui-stderr.log"
M6_ONLY=prepare "$M6_APP" > "$M6_WORK/prepare-results.jsonl" 2> "$M6_WORK/prepare-stderr.log"
cat "$M6_WORK/ui-results.jsonl" "$M6_WORK/prepare-results.jsonl" > "$M6_WORK/results.jsonl"
python3 "$M6_WORK/summarize.py" "$M6_WORK/results.jsonl" --check --stable-projection
M6_ONLY=lookup M6_MIXES=plain "$M6_APP" > "$M6_WORK/lookup.jsonl" 2> "$M6_WORK/lookup-stderr.log"
python3 "$M6_WORK/summarize.py" "$M6_WORK/lookup.jsonl" --retry-guard
```

Each invocation exits itself. The default UI matrix produces 126 records; the separate preparation process adds 63 for the checker's 189 total. The lookup process produces six. Do not run another UI benchmark or build concurrently. Keep the window visible, avoid moving the pointer over it, and use the same display configuration. Filter a smoke test with `M6_COUNTS=50 M6_MIXES=plain`; omit `--check` when summarizing a partial matrix. The default is 50/500/2000 messages and six homogeneous mixes plus an equal-cycle mixed transcript. Expect roughly 20 minutes for the full UI matrix on the audited host; cached build, preparation and lookup take additional time.

When sharing a DerivedData directory between before/after builds, preserve each binary before building the next variant (the projection follow-up used this):

```sh
ditto "$M6_DERIVED/Build/Products/Release/Sokosumi.app" "$M6_WORK/Sokosumi.app"
M6_APP="$M6_WORK/Sokosumi.app/Contents/MacOS/Sokosumi"
```

For the historical once-per-evaluation projection follow-up (#4970), run both real views with plain and mixed content (12 cases, 72 phase records). `M6_VIEW=thread` keeps one parent and N−1 replies, so N remains the total prepared message count. Use identical extracted probes against separate before/after source checkouts and build each copied app as above:

```sh
for M6_VIEW in room thread; do
  M6_VIEW="$M6_VIEW" M6_MIXES=plain,mixed "$M6_APP" \
    > "$M6_WORK/projection-$M6_VIEW.jsonl" 2> "$M6_WORK/projection-$M6_VIEW-stderr.log"
done
cat "$M6_WORK/projection-room.jsonl" "$M6_WORK/projection-thread.jsonl" > "$M6_WORK/projection.jsonl"
python3 "$M6_WORK/summarize.py" "$M6_WORK/projection.jsonl" --projection
```

The `--projection` check intentionally fails before the optimization. It requires exactly one `preparedMessages` getter call per room/thread body evaluation during scroll/idle phases, with no timing threshold. `view_bodies` counts the selected view; `room_bodies` retains its original room-only meaning. `projection_ms` summarizes the selected view's getter calls. Only the room has the original geometry/input timers; empty thread geometry fields mean uninstrumented, not zero cost. The check also requires real scrolling, reaching the top, unchanged preparation counts, inactive distant rows, and zero ordinary retry-source copies. This is reuse within one view evaluation, not a persistent cache or a claim that projection cost is independent of message count.

In the historical #4970 comparison, the conditional room/thread host records **two room preparations at startup on both sides** (first parses N, second reparses zero), **one thread preparation at startup**, and one preparation after each reaction. There are none during scrolling/idle. Separate fresh-process 50-message mixed-room runs reproduce the second startup pass before and after the product change. This differs from the earlier direct-room host's single startup pass; it is not evidence of a regression introduced by projection reuse. The thread initially realizes only the final row consistently (some mixed cases skip the preceding row on both sides), so its distant-row check uses that verified final ID; the room retains both final IDs as sentinels. The checker distinguishes the historical records without a `view` field from the current host and retains strict visit/parse assertions for every pass.

For the isolated geometry comparison:

```sh
xcrun swiftc -O -parse-as-library "$M6_WORK/Geometry.swift" -o "$M6_WORK/M6Geometry"
"$M6_WORK/M6Geometry" > "$M6_WORK/geometry.jsonl" 2> "$M6_WORK/geometry-stderr.log"
```

## Stable transcript projection regression

The stable-projection follow-up separates data preparation from scroll state. Compare baseline `ccc120c80` with the change, using the same extracted files on both sides. `overlay_builds` counts the actual `PreparedTranscript.overlaying` array/dictionary construction, regardless of where the caller lives. `view_bodies` counts the view owning the scroll state: the original view before the split, the content view afterward. The legacy `projection_ms` getter timer has no samples after that getter is removed; use `overlay_builds` for this regression. The input timer still records the room's preparation-input construction. These counters do not measure presented frames.

After building, this short check takes about 4–6 seconds per case on the audited host:

```sh
M6_ONLY=projection M6_VIEW=room M6_COUNTS=50 M6_MIXES=plain "$M6_APP" > "$M6_WORK/stable.jsonl"
python3 "$M6_WORK/summarize.py" "$M6_WORK/stable.jsonl" --stable-projection
```

It drives 30 native wheel events after the real transcript settles, requires actual movement and view evaluations, and fails if an unchanged transcript triggers any projection rebuild or preparation. The baseline fails this check. For the complete short matrix, run `M6_ONLY=projection M6_MIXES=plain,mixed` once for each `M6_VIEW=room` and `M6_VIEW=thread`, leaving `M6_COUNTS` unset (50/500/2000), then concatenate the two JSONL files and run the same check. Omit `M6_ONLY` to retain the longer early/traverse/late/idle/reaction phases. Use `--check --stable-projection` for the full 21-case UI/preparation dataset on the new layout; historical datasets retain `--check` alone. The new room layout prepares once at startup, instead of the prior conditional host's two preparations.

Verify live updates separately, outside the scrolling measurement:

```sh
for M6_VIEW in room thread; do
  M6_ONLY=updates M6_VIEW="$M6_VIEW" M6_COUNTS=50 M6_MIXES=plain "$M6_APP" > "$M6_WORK/updates-$M6_VIEW.jsonl"
done
cat "$M6_WORK/updates-room.jsonl" "$M6_WORK/updates-thread.jsonl" > "$M6_WORK/updates.jsonl"
python3 "$M6_WORK/summarize.py" "$M6_WORK/updates.jsonl" --updates
```

In this mode only, probes inspect the actual arrays passed to the transcript rows and the message/document values received by `MessageRowView.body`. Each pane checks initial display, edits with prepared markdown, optimistic reactions before the delayed response, confirmation, optimistic removal, rollback after HTTP 500, arrivals, deletions, pending sends, removal of an outbound shell, and generation/thread-parent replacement. The failed-send check observes the outbox state; it does not assert the rendered failure indicator. The old scope must never enter the replacement's projected rows. These are live view-boundary checks; they do not call the projection directly or substitute a mock view. The observation probes return immediately in measurement mode.

## Capture and analyse Instruments

Use the app-scoped `swiftui-expert-skill`. Confirm the host Mac using `--list-devices`; attach to the **harness PID**, not an unrelated signed Sokosumi process. Run a dedicated traced case separately from the untraced matrix. `SwiftUI` was attempted first in this audit but failed to finalize/export for the native transcript; `Time Profiler` yielded a valid capture. The explicit row-body counters supply the SwiftUI-lane fallback.

```sh
M6_SKILL=apps/apple/.agents/skills/swiftui-expert-skill
python3 "$M6_SKILL/scripts/record_trace.py" --list-devices
M6_COUNTS=2000 M6_MIXES=plain M6_START_DELAY=5000 "$M6_APP" \
  > "$M6_WORK/traced.jsonl" 2> "$M6_WORK/traced-stderr.log" &
M6_PID=$!
python3 "$M6_SKILL/scripts/record_trace.py" --device Homer --attach "$M6_PID" \
  --template 'Time Profiler' --time-limit 15s --output "$M6_WORK/native-time.trace"
wait "$M6_PID"
python3 "$M6_SKILL/scripts/analyze_trace.py" --trace "$M6_WORK/native-time.trace" \
  --list-runs > "$M6_WORK/trace-runs.json"
python3 "$M6_SKILL/scripts/analyze_trace.py" --trace "$M6_WORK/native-time.trace" \
  --list-logs --log-subsystem com.sokosumi.m6 > "$M6_WORK/trace-phases.json"
```

Replace `Homer` with the discovered host. To repeat the SwiftUI attempt, use a separate run and output path with `--template SwiftUI --time-limit 25s`. An unexportable trace or empty SwiftUI table is **missing data**, not zero view updates. Stop only this task's recorder if it cannot finalize; keep the error in the measurement record.

Phase BEGIN/END messages identify scroll windows. If the trace's log table is empty, query process-scoped unified logs immediately after the run:

```sh
/usr/bin/log show --last 30m --info --style json \
  --predicate "processIdentifier == $M6_PID AND subsystem == 'com.sokosumi.m6'" \
  > "$M6_WORK/system-phases.json"
```

Subtract the capture start time from the phase timestamps to select a window in milliseconds. The audit used 4,000–9,000 ms, wholly inside early scrolling; **recompute these bounds for a new run**. Analyse that window with both the expert parser and the supplemental inclusive-stack extractor:

```sh
python3 "$M6_SKILL/scripts/analyze_trace.py" --trace "$M6_WORK/native-time.trace" \
  --window 4000:9000 --json-only > "$M6_WORK/trace-analysis.json"
python3 "$M6_WORK/trace_stacks.py" "$M6_SKILL" "$M6_WORK/native-time.trace" \
  4000 9000 > "$M6_WORK/trace-stacks.json"
```

The supplemental extractor reuses the skill's XML parser, caps stacks at 128 frames and reports inclusive sample weight. Inclusive frames overlap; do not add their shares. It caches the exported time-profile XML beside the trace. Binary traces are intentionally outside the repository; the [parsed evidence](scrolling-performance-evidence.json) retains the analysed metrics and phase boundaries.

## Meaning of the measurements

`layout_ms` times event delivery plus synchronous `layoutSubtreeIfNeeded`. `step_ms` includes the following 16 ms async sleep and scheduling delay. Neither is presented-frame latency. `bodies_per_display_callback` counts `MessageRowView.body` entries between `NSView.displayLink` callbacks; `display_interval_ms` records their timestamp intervals. These callbacks also do not prove that a frame was presented. `summary` sorts values, uses index `(n-1)/2` for p50 and integer index `(n-1)*95/100` for p95.

`early` scrolls upward for up to 120 wheel ticks, stopping at the top. `traverse` continues toward the top with larger wheel deltas, stopping at the top or a cap of three ticks per loaded message. `late` alternates direction every 30 ticks for 120 ticks near the traversal endpoint. `idle` runs 60 ticks without events. Each scroll phase ends its gesture and allows 500 ms for settling outside its reported measurements. The output includes offsets and per-ID body counts. Initial realization includes a few top rows as well as bottom rows during anchoring. The audit uses the last **two** message IDs, verified present at load, as distant-row sentinels; the initial realization set's aggregate (`retired_bodies`) is not an offscreen count. Retained state, memory use, body evaluation and view creation are different quantities; this counter measures body evaluation only.

`prepare` reports each actual detached preparation: worker duration, messages visited and documents reparsed. The reaction calls the real coordinator method behind the button, with an in-process 250 ms HTTP response containing the confirmed reaction. No account or server is involved; this is not a literal button hit-test or tap-to-paint measurement. `M6_ONLY=prepare` runs seven direct API samples each for cold, unchanged-reuse and reaction-only preparation, in a fresh process with no hosted views. `wall_ms` includes task scheduling; `worker.ms` measures the detached body. Counts in the UI phases distinguish preparation frequency from cost. The final results replace earlier same-process post-UI preparation samples, which were contaminated by remaining UI/media and host scheduling effects.

`scans_ms` measures the unmodified synchronous `preparationInput` and `preparedMessages` getters in the copied room view. Geometry transform/action timers surround their original code. Timers and dictionary counters add overhead; microsecond timings should not be interpreted beyond their precision. `M6_ONLY=lookup` compares the real retry-eligibility method with a harness-only failed-shell predicate before that method. It uses ordinary messages and the account-free state, and asserts that both paths deny them. The added `retry_source_collections` counter instruments the real source getter only in the disposable copy. `--retry-guard` asserts that the existing method constructs zero source arrays for ordinary messages at 50/500/2000 messages; it fails on the pre-guard baseline. This checks the avoided work without a timing threshold. Package tests separately cover positive-case permission correctness.

The separate geometry app has one tall rectangle, the same scroll-position/default-bottom-anchor/inset APIs, and either no observer or a full-geometry observer with an empty action apart from counters. It compares stable and growing insets across three rounds, reversing order in round 2. The inset grows during initial layout, before the measured scroll loop. This control does not replace the warning's layout-transition reproduction or test pagination correctness.

The retained harness holds a scoped process activity token and publishes phase names in logs. The original 21-case UI matrix predates the activity/log refinements and the later retry-source counter. Its original row/prepare counters are unchanged; older records do not include `retry_source_collections`. Activity tokens did **not** eliminate delayed scheduled steps in the empty control. Do not interpret driver gaps as product FPS or assume App Nap caused them. Use body/prepare counts and the valid trace for the audit's conclusions.

## Sources

### setup.py

<!-- file: setup.py -->
```python
from pathlib import Path
import shutil,sys
source=Path(sys.argv[1]).resolve()/ 'apps/apple'
work=Path(__file__).resolve().parent
out=work/'apple'
if out.exists(): raise SystemExit('Refusing to overwrite existing harness')
shutil.copytree(source,out,ignore=shutil.ignore_patterns('.build','.agents','.DS_Store'))
def patch(file,old,new):
 p=out/file;s=p.read_text();assert s.count(old)==1,(file,s.count(old),old);p.write_text(s.replace(old,new))
patch('Sokosumi/Chat/Timeline/MessageRowView.swift','    var body: some View {\n      HStack(alignment: .top, spacing: 14) {','    var body: some View {\n      let _ = M6Probe.body(message.id)\n      HStack(alignment: .top, spacing: 14) {')
patch('Sokosumi/Chat/Timeline/RoomTimelineView.swift','    var body: some View {\n      transcriptBody','    var body: some View {\n      let _ = M6Probe.roomBody()\n      transcriptBody')
patch('Sokosumi/Chat/Timeline/RoomTimelineView.swift','.onScrollGeometryChange(for: TranscriptScrollEdges.self) { TranscriptScrollEdges($0) } action: { oldEdges, edges in','.onScrollGeometryChange(for: TranscriptScrollEdges.self) { geometry in\n          let start = ProcessInfo.processInfo.systemUptime\n          defer { M6Probe.geometryTransform.append((ProcessInfo.processInfo.systemUptime - start) * 1000) }\n          return TranscriptScrollEdges(geometry)\n        } action: { oldEdges, edges in\n          let start = ProcessInfo.processInfo.systemUptime\n          defer { M6Probe.geometryAction.append((ProcessInfo.processInfo.systemUptime - start) * 1000) }')
# Only the disposable copy receives probes. Original package/project files remain untouched.
patch('Packages/SokosumiChat/Sources/SokosumiChat/PreparedTranscript.swift','import Foundation','import Foundation\nimport Synchronization\n\npublic enum M6Preparation {\n  private static let records = Mutex<[[String: Double]]>([])\n  public static func take() -> [[String: Double]] { records.withLock { let result = $0; $0 = []; return result } }\n  static func record(_ value: [String: Double]) { records.withLock { $0.append(value) } }\n}')
patch('Packages/SokosumiChat/Sources/SokosumiChat/PreparedTranscript.swift','    let task = Task.detached(priority: .userInitiated) {','    let task = Task.detached(priority: .userInitiated) {\n      let start = ProcessInfo.processInfo.systemUptime\n      var visited = 0\n      var parsed = 0\n      defer { M6Preparation.record(["ms": (ProcessInfo.processInfo.systemUptime - start) * 1000, "visited": Double(visited), "parsed": Double(parsed)]) }')
patch('Packages/SokosumiChat/Sources/SokosumiChat/PreparedTranscript.swift','      for message in input.messages {','      for message in input.messages {\n        visited += 1')
patch('Packages/SokosumiChat/Sources/SokosumiChat/PreparedTranscript.swift','          documents[message.id] = MessageMarkdown','          parsed += 1\n          documents[message.id] = MessageMarkdown')
p=out/'Sokosumi/Chat/Timeline/RoomTimelineView.swift'
if '    private var preparationInput: PreparedTranscript.Input {\n      .init' in p.read_text():
 patch('Sokosumi/Chat/Timeline/RoomTimelineView.swift','    private var preparationInput: PreparedTranscript.Input {\n      .init','    private var preparationInput: PreparedTranscript.Input {\n      let start = ProcessInfo.processInfo.systemUptime\n      defer { M6Probe.scans["input", default: []].append((ProcessInfo.processInfo.systemUptime - start) * 1000) }\n      return .init')
else:
 patch('Sokosumi/Chat/Timeline/RoomTimelineView.swift','    private var preparationInput: PreparedTranscript.Input {','    private var preparationInput: PreparedTranscript.Input {\n      let start = ProcessInfo.processInfo.systemUptime\n      defer { M6Probe.scans["input", default: []].append((ProcessInfo.processInfo.systemUptime - start) * 1000) }')
if '    private var preparedMessages:' in (out/'Sokosumi/Chat/Timeline/RoomTimelineView.swift').read_text():
 patch('Sokosumi/Chat/Timeline/RoomTimelineView.swift','    private var preparedMessages: [Components.Schemas.ChatRoomMessage] {','    private var preparedMessages: [Components.Schemas.ChatRoomMessage] {\n      let start = ProcessInfo.processInfo.systemUptime\n      defer { M6Probe.scans["preparedMessages", default: []].append((ProcessInfo.processInfo.systemUptime - start) * 1000) }')
shutil.copy(work/'Probe.swift',out/'Sokosumi/App/SokosumiApp.swift')
shutil.copy(source/'SokosumiTests/Chat/Timeline/ScrollMediaProtocol.swift',out/'Sokosumi/App/ScrollMediaProtocol.swift')

patch('Packages/SokosumiWorkspace/Sources/SokosumiWorkspace/WorkspaceState+Mentions.swift','struct MentionRetryRequest: Hashable {','@MainActor public enum M6MentionRetryProbe {\n  public static var sourceCollections = 0\n}\n\nstruct MentionRetryRequest: Hashable {')
patch('Packages/SokosumiWorkspace/Sources/SokosumiWorkspace/WorkspaceState+Mentions.swift','    transcriptMessages + (thread.parent.map { [$0] } ?? []) + thread.timeline.messages','    M6MentionRetryProbe.sourceCollections += 1\n    return transcriptMessages + (thread.parent.map { [$0] } ?? []) + thread.timeline.messages')
patch('Sokosumi/Chat/Threads/ReplyThreadView.swift','    var body: some View {\n      content','    var body: some View {\n      let _ = M6Probe.threadBody()\n      content')
if '    private var preparedMessages:' in (out/'Sokosumi/Chat/Threads/ReplyThreadView.swift').read_text():
 patch('Sokosumi/Chat/Threads/ReplyThreadView.swift','    private var preparedMessages: [Components.Schemas.ChatRoomMessage] {','    private var preparedMessages: [Components.Schemas.ChatRoomMessage] {\n      let start = ProcessInfo.processInfo.systemUptime\n      defer { M6Probe.scans["preparedMessages", default: []].append((ProcessInfo.processInfo.systemUptime - start) * 1000) }')
print(out)

patch('Packages/SokosumiChat/Sources/SokosumiChat/PreparedTranscript.swift', 'public enum M6Preparation {', 'public enum M6Preparation {\n  private static let overlayBuilds = Mutex(0)\n  public static func takeOverlayBuilds() -> Int { overlayBuilds.withLock { let value = $0; $0 = 0; return value } }\n  static func overlayBuilt() { overlayBuilds.withLock { $0 += 1 } }')
patch('Packages/SokosumiChat/Sources/SokosumiChat/PreparedTranscript.swift', '    let byId = Dictionary(live.map', '    M6Preparation.overlayBuilt()\n    let byId = Dictionary(live.map')

patch('Sokosumi/Chat/Timeline/MessageRowView.swift', '      let _ = M6Probe.body(message.id)', '      let _ = M6Probe.body(message.id)\n      let _ = M6Probe.observe(message, document: preparedDocument)')
if 'let messages = preparedMessages' in (out/'Sokosumi/Chat/Timeline/RoomTimelineView.swift').read_text():
 patch('Sokosumi/Chat/Timeline/RoomTimelineView.swift', 'let messages = preparedMessages', 'let messages = preparedMessages\n      let _ = M6Probe.projected(messages)')
else:
 patch('Sokosumi/Chat/Timeline/RoomTimelineView.swift', '      if workspaces.transcriptRoomId != roomId || workspaces.transcriptLoading {', '      let _ = M6Probe.projected(messages)\n      if workspaces.transcriptRoomId != roomId || workspaces.transcriptLoading {')
patch('Sokosumi/Chat/Threads/ReplyThreadView.swift', '      if let parent = messages.first {', '      let _ = M6Probe.projected(messages)\n      if let parent = messages.first {')
```

### Probe.swift

<!-- file: Probe.swift -->
```swift
import AppKit
import CoreAPI
import Foundation
import SokosumiAuth
import SokosumiChat
import SokosumiWorkspace
import SwiftUI
import os
import QuartzCore
import Synchronization

@MainActor enum M6Probe {
  static var bodies: [String: Int] = [:]
  static let validatesUpdates = ProcessInfo.processInfo.environment["M6_ONLY"] == "updates"
  static var projectedRows: [Components.Schemas.ChatRoomMessage] = []
  static var projectedHistory: [[String]] = []
  static var observedRows: [String: Components.Schemas.ChatRoomMessage] = [:]
  static var observedDocuments: [String: String] = [:]
  static func projected(_ messages: [Components.Schemas.ChatRoomMessage]) {
    guard validatesUpdates else { return }
    projectedRows = messages
    projectedHistory.append(messages.map(\.id))
  }
  static func observe(_ message: Components.Schemas.ChatRoomMessage, document: MessageMarkdown?) {
    guard validatesUpdates else { return }
    observedRows[message.id] = message
    observedDocuments[message.id] = document.map { $0.blocks.map { String($0.text.characters) }.joined(separator: "\n") }
  }
  static var totalBodies = 0
  static var scans: [String: [Double]] = [:]
  static var roomBodies = 0
  static var threadBodies = 0
  static var geometryTransform: [Double] = []
  static var geometryAction: [Double] = []
  static let logger = Logger(subsystem: "com.sokosumi.m6", category: "measurement")
  static func body(_ id: String) { bodies[id, default: 0] += 1; totalBodies += 1 }
  static func roomBody() { roomBodies += 1 }
  static func threadBody() { threadBodies += 1 }
  static func reset() { _ = M6Preparation.takeOverlayBuilds(); M6MentionRetryProbe.sourceCollections = 0; bodies = [:]; totalBodies = 0; scans = [:]; roomBodies = 0; threadBodies = 0; geometryTransform = []; geometryAction = []; _ = M6Preparation.take() }
  static func summary(_ values: [Double]) -> [String: Double] {
    let sorted = values.sorted()
    guard !sorted.isEmpty else { return ["n": 0, "total": 0, "p50": 0, "p95": 0, "max": 0] }
    return ["n": Double(sorted.count), "total": sorted.reduce(0,+), "p50": sorted[(sorted.count-1)/2], "p95": sorted[(sorted.count-1)*95/100], "max": sorted.last!]
  }
  static func emit(_ input: [String: Any]) {
    var value = input
    value["retry_source_collections"] = M6MentionRetryProbe.sourceCollections
    value["view"] = ProcessInfo.processInfo.environment["M6_VIEW"] ?? "room"
    value["overlay_builds"] = M6Preparation.takeOverlayBuilds()
    value["view_bodies"] = roomBodies + threadBodies
    value["projection_ms"] = summary(scans["preparedMessages"] ?? [])
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self)); fflush(stdout)
  }
}

@main enum M6Main {
  @MainActor static func main() {
    let app = NSApplication.shared
    let delegate = M6Delegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
  }
}

@MainActor final class M6Delegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    Task { await run(); NSApplication.shared.terminate(nil) }
  }
  func messages(_ count: Int, mix: String) -> [Components.Schemas.ChatRoomMessage] {
    (0..<count).map { index in
      let kind = mix == "mixed" ? ["plain", "markdown", "code", "images", "unfurls", "reactions"][index % 6] : mix
      let base = "Message \(index). "
      var content = base + String(repeating: "A short paragraph for the scrolling benchmark. ", count: 4)
      if kind == "markdown" { content = base + "\n\n## Heading\n\n" + String(repeating: "**Bold** and *italic* with [a link](https://example.com) and `inline code`.\n\n", count: 3) }
      if kind == "code" { content = base + "\n\n```swift\n" + String(repeating: "let result = values.map { $0 * 2 }\n", count: 8) + "```" }
      if kind == "images" { content = base + "\n\n![Fixture](https://scroll-fixture.invalid/\(mix)-\(count)-\(index).png)" }
      var value = chatRoomMessage(from: .init(clientTurnId: "fixture-\(index)", roomId: "fixture", content: content,
        sender: .init(id: "author-\(index % 2)", name: "Example", email: "example@example.com", presence: .online)))
      value.id = "fixture-\(index)"
      value.createdAt = Date(timeIntervalSince1970: 1_700_000_000 + Double(index)*60)
      if kind == "unfurls" { value.unfurls = [.init(url: "https://example.com/article/\(index)", title: "Fixture preview", description: "Delayed local image", imageUrl: "https://scroll-fixture.invalid/\(mix)-\(count)-\(index).png")] }
      if kind == "reactions" { value.reactions = [.init(emoji: "👍", count: 1, reactedByCurrentUser: false, reactors: [.init(id: "other", name: "Other")])] }
      return value
    }
  }
  func scrollViews(_ view: NSView) -> [NSScrollView] { (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews) }
  func pause(_ ms: Int) async { try? await Task.sleep(for: .milliseconds(ms)) }
  func run() async {
    let activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Synthetic scrolling measurement")
    defer { ProcessInfo.processInfo.endActivity(activity) }
    URLProtocol.registerClass(ScrollMediaProtocol.self)
    URLProtocol.registerClass(M6ReactionProtocol.self)
    defer { URLProtocol.unregisterClass(ScrollMediaProtocol.self); URLProtocol.unregisterClass(M6ReactionProtocol.self) }
    let env = ProcessInfo.processInfo.environment
    await pause(Int(env["M6_START_DELAY"] ?? "1000")!)
    let counts = (env["M6_COUNTS"] ?? "50,500,2000").split(separator: ",").map { Int($0)! }
    let mixes = (env["M6_MIXES"] ?? "plain,markdown,code,images,unfurls,reactions,mixed").split(separator: ",").map(String.init)
    for count in counts { for mix in mixes {
      let thread = env["M6_VIEW"] == "thread"
      var fixture = messages(count, mix: mix)
      if thread { for index in 1..<count { fixture[index].parentMessageId = fixture[0].id } }
      M6Probe.reset()
      if env["M6_ONLY"] == "prepare" { await prepareSamples(fixture, count: count, mix: mix); continue }
      let state = WorkspaceState(clientProvider: { _ in Client.connecting(to: URL(string: "https://scroll-fixture.invalid")!) })
      state.timeline.reset(roomId: "fixture")
      state.timeline.failInitialLoad(message: "", generation: state.timeline.generation)
      state.timeline.messages = thread ? [fixture[0]] : fixture
      if thread {
        state.thread.open(fixture[0])
        state.thread.timeline.failInitialLoad(message: "", generation: state.thread.timeline.generation)
        state.thread.timeline.messages = Array(fixture.dropFirst())
      }
      if env["M6_ONLY"] == "lookup" {
        let message = fixture[count/2]
        for mode in ["existing", "reject-ordinary-first"] {
          M6MentionRetryProbe.sourceCollections = 0
          var batches: [Double] = []
          var allowed = 0
          for _ in 0..<21 {
            let start = ProcessInfo.processInfo.systemUptime
            for _ in 0..<100 {
              if mode == "existing" {
                if state.canRetryMention(message) { allowed += 1 }
              } else if case .failed(_, _?) = CoworkerMentionShell(message: message) {
                if state.canRetryMention(message) { allowed += 1 }
              }
            }
            batches.append((ProcessInfo.processInfo.systemUptime-start)*1000/100)
          }
          precondition(allowed == 0)
          M6Probe.emit(["phase":"lookup", "mode": mode, "count":count, "mix":mix, "per_call_ms":M6Probe.summary(batches), "allowed":allowed])
        }
        continue
      }
      let auth = AuthState()
      let host = NSHostingView(rootView: Group {
        if thread { ReplyThreadView() } else { RoomTimelineView(roomId: "fixture") }
      }.environmentObject(state).environmentObject(auth))
      let window = NSWindow(contentRect: NSRect(x: 50, y: 50, width: 900, height: 700), styleMask: [.titled, .closable], backing: .buffered, defer: false)
      window.isReleasedWhenClosed = false
      window.contentView = host
      window.makeKeyAndOrderFront(nil)
      NSApplication.shared.activate(ignoringOtherApps: true)
      var scroll: NSScrollView?
      for _ in 0..<1000 {
        host.layoutSubtreeIfNeeded()
        scroll = scrollViews(host).max(by: { $0.frame.height < $1.frame.height })
        if let scroll, scroll.contentInsets.bottom > 0, (scroll.documentView?.frame.height ?? 0) > 1000 { break }
        await pause(20)
      }
      guard let scroll, (scroll.documentView?.frame.height ?? 0) > 1000 else { fatalError("Transcript not ready") }
      await pause(1500)
      if env["M6_ONLY"] == "updates" {
        await validateUpdates(state, auth: auth, host: host, fixture: fixture, thread: thread)
        window.close()
        continue
      }
      let initialBodies = Set(M6Probe.bodies.keys)
      M6Probe.emit(["phase": "load", "count": count, "mix": mix, "ids": M6Probe.bodies, "media_completions": ScrollMediaProtocol.completedRequests, "bodies": M6Probe.totalBodies, "unique": M6Probe.bodies.count, "room_bodies": M6Probe.roomBodies, "prepare": M6Preparation.take(), "document_height": scroll.documentView!.frame.height])
      await measure(scroll, host: host, count: count, mix: mix, phase: "early", ticks: env["M6_ONLY"] == "projection" ? 30 : 120, amount: 60, retired: [])
      if env["M6_ONLY"] == "projection" { window.close(); continue }
      // Walk toward the top with actual wheel events; no jump-to-id substitution.
      await measure(scroll, host: host, count: count, mix: mix, phase: "traverse", ticks: count * 3, amount: 400, retired: initialBodies)
      await measure(scroll, host: host, count: count, mix: mix, phase: "late", ticks: 120, amount: -60, retired: initialBodies)
      await measure(scroll, host: host, count: count, mix: mix, phase: "idle", ticks: 60, amount: 0, retired: initialBodies)
      // Exercise the same pending-reaction publication through the coordinator, with a delayed local response.
      M6Probe.reset()
      var confirmed = fixture[count/2]
      confirmed.reactions.append(.init(emoji: "🎉", count: 1, reactedByCurrentUser: true, reactors: []))
      let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .custom { date, encoder in var container = encoder.singleValueContainer(); try container.encode(date.ISO8601Format(.init(includingFractionalSeconds: true))) }
      let object = try! JSONSerialization.jsonObject(with: encoder.encode(confirmed))
      let payload = try! JSONSerialization.data(withJSONObject: ["data": object, "meta": ["timestamp": "2026-09-21T12:00:00.000Z", "requestId": "m6"]])
      M6ReactionProtocol.response.withLock { $0 = payload }
      let started = ProcessInfo.processInfo.systemUptime
      do { _ = try await state.toggleReaction(fixture[count/2], emoji: "🎉", auth: auth) } catch { fatalError("Reaction fixture failed: \(error)") }
      await pause(500)
      M6Probe.emit(["phase": "reaction", "count": count, "mix": mix, "wall_ms": (ProcessInfo.processInfo.systemUptime-started)*1000, "prepare": M6Preparation.take(), "bodies": M6Probe.totalBodies, "room_bodies": M6Probe.roomBodies])
      window.orderOut(nil); window.contentView = nil; window.close()
      await pause(300)
    } }
  }
  func validateUpdates(_ state: WorkspaceState, auth: AuthState, host: NSView,
                       fixture: [Components.Schemas.ChatRoomMessage], thread: Bool) async {
    let timeline = thread ? state.thread.timeline : state.timeline
    let target = fixture.last!.id
    var passed: [String] = []
    func check(_ label: String, _ condition: () -> Bool) async {
      for _ in 0..<500 {
        host.layoutSubtreeIfNeeded()
        if condition() { passed.append(label); return }
        await pause(20)
      }
      fatalError("M6 live update failed: \(label)")
    }
    await check("initial row") { M6Probe.observedRows[target] != nil }
    timeline.messages[timeline.messages.count-1].content = "Edited **projection marker**"
    await check("edit and prepared markdown") {
      M6Probe.observedRows[target]?.content == "Edited **projection marker**"
        && M6Probe.observedDocuments[target]?.contains("Edited projection marker") == true
    }

    var confirmed = timeline.messages.last!
    confirmed.reactions = [.init(emoji: "🎉", count: 1, reactedByCurrentUser: true, reactors: [])]
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
      var container = encoder.singleValueContainer()
      try container.encode(date.ISO8601Format(.init(includingFractionalSeconds: true)))
    }
    let object = try! JSONSerialization.jsonObject(with: encoder.encode(confirmed))
    M6ReactionProtocol.response.withLock { $0 = try! JSONSerialization.data(withJSONObject:
      ["data":object,"meta":["timestamp":"2026-09-21T12:00:00.000Z","requestId":"m6-updates"]]) }
    func reacted() -> Bool {
      M6Probe.observedRows[target]?.reactions.contains { $0.emoji == "🎉" && $0.reactedByCurrentUser } == true
    }
    var reactionFinished = false
    let reaction = Task {
      do { _ = try await state.toggleReaction(confirmed, emoji: "🎉", auth: auth) }
      catch { fatalError("M6 reaction failed: \(error)") }
      reactionFinished = true
    }
    await check("optimistic reaction before response") { reacted() }
    precondition(!reactionFinished, "Reaction was not rendered optimistically")
    await reaction.value
    await check("confirmed reaction") { reacted() }
    M6ReactionProtocol.status.withLock { $0 = 500 }
    var rollbackFinished = false
    let rollback = Task {
      do { _ = try await state.toggleReaction(confirmed, emoji: "🎉", auth: auth); fatalError("Expected reaction failure") }
      catch { rollbackFinished = true }
    }
    await check("optimistic reaction removal") { !reacted() }
    precondition(!rollbackFinished, "Removal was not rendered before response")
    await rollback.value
    await check("reaction rollback") { reacted() }
    M6ReactionProtocol.status.withLock { $0 = 200 }

    var arriving = fixture.last!
    arriving.id = "arriving"
    arriving.content = "Arrival projection marker"
    arriving.createdAt = arriving.createdAt.addingTimeInterval(60)
    timeline.messages.append(arriving)
    await check("arrival") { M6Probe.observedRows["arriving"]?.content == arriving.content }
    timeline.messages.removeAll { $0.id == "arriving" }
    await check("removal") { !M6Probe.projectedRows.contains { $0.id == "arriving" } }

    let outbox = thread ? state.thread.outbox : state.outbox
    let shell = OutboundShell(clientTurnId: "projection-outbox", roomId: "fixture",
      parentMessageId: thread ? fixture.first!.id : nil, content: "Pending projection marker",
      sender: .init(id: "me", name: "Me", email: "me@example.com", presence: .online))
    var releaseSend: CheckedContinuation<Components.Schemas.ChatRoomMessage, Error>?
    outbox.enqueue(shell, send: {
      try await withCheckedThrowingContinuation { releaseSend = $0 }
    }, confirmed: { _ in fatalError("Expected send failure") }, failed: { _ in })
    await check("pending send") { M6Probe.observedRows[shell.id]?.content == shell.content && releaseSend != nil }
    releaseSend!.resume(throwing: CancellationError())
    await check("failed send") { outbox.shells.first?.status == .failed }
    outbox.remove(shell.clientTurnId)
    await check("outbox removal") { !M6Probe.projectedRows.contains { $0.id == shell.id } }

    M6Probe.projectedHistory = []
    var replacement = fixture.first!
    replacement.id = "replacement"
    replacement.content = "Replacement projection marker"
    replacement.parentMessageId = nil
    if thread {
      state.thread.open(replacement)
      timeline.failInitialLoad(message: "", generation: timeline.generation)
      var reply = arriving
      reply.id = "replacement-reply"
      reply.parentMessageId = replacement.id
      timeline.messages = [reply]
    } else {
      timeline.reset(roomId: "fixture")
      timeline.failInitialLoad(message: "", generation: timeline.generation)
      timeline.messages = [replacement]
    }
    await check("scope replacement") { M6Probe.observedRows["replacement"]?.content == replacement.content }
    precondition(M6Probe.projectedHistory.flatMap { $0 }.allSatisfy { $0.hasPrefix("replacement") }, "Old scope rows escaped into the new scope")
    M6Probe.emit(["phase":"updates", "count":fixture.count, "mix":"plain", "passed":passed])
  }

  func prepareSamples(_ fixture: [Components.Schemas.ChatRoomMessage], count: Int, mix: String) async {
  var warm: PreparedTranscript?
  for mode in ["cold", "reuse", "reaction"] {
    var times: [Double] = []
    for iteration in 0..<7 {
      var inputMessages = fixture
      if mode == "reaction" { inputMessages[count/2].reactions = [.init(emoji: "🎉", count: iteration+1, reactedByCurrentUser: true, reactors: [])] }
      let input = PreparedTranscript.Input(scope: ["benchmark"], messages: inputMessages, mentions: nil, channels: [], baseURL: URL(string: "https://example.com")!)
      let start = ProcessInfo.processInfo.systemUptime
      warm = try! await PreparedTranscript.prepare(input, reusing: mode == "cold" ? nil : warm)
      times.append((ProcessInfo.processInfo.systemUptime-start)*1000)
    }
    M6Probe.emit(["phase": "prepare-\(mode)", "count": count, "mix": mix, "wall_ms": M6Probe.summary(times), "worker": M6Preparation.take()])
  }
  }
  func measure(_ scroll: NSScrollView, host: NSView, count: Int, mix: String, phase: String, ticks: Int, amount: Int32, retired: Set<String>) async {
    M6Probe.reset()
    M6Probe.logger.notice("BEGIN \(count) \(mix, privacy: .public) \(phase, privacy: .public)")
    let frames = M6Frames()
    let display = host.displayLink(target: frames, selector: #selector(M6Frames.tick(_:)))
    display.add(to: .main, forMode: .common)
    defer { display.invalidate() }
    var layout: [Double] = [], steps: [Double] = [], evaluations: [Double] = []
    let startY = scroll.contentView.bounds.minY
    var executed = 0
    for index in 0..<ticks {
      let before = M6Probe.totalBodies
      let start = ProcessInfo.processInfo.systemUptime
      if amount != 0 {
        let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: phase == "late" ? (index / 30).isMultiple(of: 2) ? -60 : 60 : amount, wheel2: 0, wheel3: 0)!
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: index == 0 ? 1 : 2)
        scroll.scrollWheel(with: NSEvent(cgEvent: event)!)
      }
      host.layoutSubtreeIfNeeded()
      layout.append((ProcessInfo.processInfo.systemUptime-start)*1000)
      await pause(16)
      steps.append((ProcessInfo.processInfo.systemUptime-start)*1000)
      evaluations.append(Double(M6Probe.totalBodies-before))
      executed += 1
      if (phase == "traverse" || phase == "early"), scroll.contentView.bounds.minY <= 1 { break }
    }
    let retiredCount = M6Probe.bodies.filter { retired.contains($0.key) }.values.reduce(0,+)
    M6Probe.emit(["phase": phase, "count": count, "mix": mix, "ticks": executed, "layout_ms": M6Probe.summary(layout), "step_ms": M6Probe.summary(steps), "bodies_per_tick": M6Probe.summary(evaluations), "bodies_per_display_callback": M6Probe.summary(frames.counts), "display_interval_ms": M6Probe.summary(frames.intervals), "unique": M6Probe.bodies.count, "ids": M6Probe.bodies, "retired_bodies": retiredCount, "room_bodies": M6Probe.roomBodies, "scans_ms": M6Probe.scans.mapValues(M6Probe.summary), "geometry_transform_ms": M6Probe.summary(M6Probe.geometryTransform), "geometry_action_ms": M6Probe.summary(M6Probe.geometryAction), "prepare": M6Preparation.take(), "start_y": startY, "end_y": scroll.contentView.bounds.minY, "document_height": scroll.documentView!.frame.height])
    M6Probe.logger.notice("END \(count) \(mix, privacy: .public) \(phase, privacy: .public)")
    display.invalidate()
    if amount != 0 {
      let end = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 0, wheel2: 0, wheel3: 0)!
      end.setIntegerValueField(.scrollWheelEventScrollPhase, value: 4)
      scroll.scrollWheel(with: NSEvent(cgEvent: end)!)
      await pause(500)
    }
  }
}

final nonisolated class M6ReactionProtocol: URLProtocol, @unchecked Sendable {
  static let response = Mutex(Data())
  static let status = Mutex(200)
  override static func canInit(with request: URLRequest) -> Bool { request.url?.host == "scroll-fixture.invalid" && request.url!.path.contains("/reactions/") }
  override static func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Task { @Sendable [self] in
      try? await Task.sleep(for: .milliseconds(ProcessInfo.processInfo.environment["M6_ONLY"] == "updates" ? 1000 : 250))
      let reply = HTTPURLResponse(url: request.url!, statusCode: Self.status.withLock { $0 }, httpVersion: nil, headerFields: ["Content-Type":"application/json"])!
      client?.urlProtocol(self, didReceive: reply, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Self.response.withLock { $0 })
      client?.urlProtocolDidFinishLoading(self)
    }
  }
  override func stopLoading() {}
}

@MainActor final class M6Frames: NSObject {
  var previousBodies = 0
  var previousTime: CFTimeInterval?
  var counts: [Double] = []
  var intervals: [Double] = []
  @objc func tick(_ link: CADisplayLink) {
    counts.append(Double(M6Probe.totalBodies - previousBodies))
    previousBodies = M6Probe.totalBodies
    if let previousTime { intervals.append((link.timestamp-previousTime)*1000) }
    previousTime = link.timestamp
  }
}
```

### Geometry.swift

<!-- file: Geometry.swift -->
```swift
import AppKit
import SwiftUI

@MainActor enum Samples {
  static var transforms = 0
  static var actions = 0
  static var actionMS: [Double] = []
}
struct GeometryView: View {
  let mode: String
  @State private var position = ScrollPosition(idType: Int.self)
  @State private var inset: CGFloat
  init(mode: String) { self.mode = mode; _inset = State(initialValue: mode == "dynamic" ? 0 : 202) }
  var body: some View {
    ScrollView {
      Color.gray.frame(height: 100000)
    }
    .scrollPosition($position)
    .defaultScrollAnchor(.bottom, for: .sizeChanges)
    .safeAreaInset(edge: .bottom) { Color.clear.frame(height: inset) }
    .modifier(ObserveGeometry(enabled: mode != "none"))
    .task { if mode == "dynamic" { inset = 202 } }
  }
}
struct ObserveGeometry: ViewModifier {
  let enabled: Bool
  @ViewBuilder func body(content: Content) -> some View {
    if enabled {
      content.onScrollGeometryChange(for: ScrollGeometry.self) { value in
        Samples.transforms += 1
        return value
      } action: { _, _ in
        let start = ProcessInfo.processInfo.systemUptime
        Samples.actions += 1
        Samples.actionMS.append((ProcessInfo.processInfo.systemUptime-start)*1000)
      }
    } else { content }
  }
}
@main enum GeometryMain {
  @MainActor static func main() {
    let app = NSApplication.shared; let delegate = GeometryDelegate()
    app.delegate = delegate; app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
  }
}
@MainActor final class GeometryDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) { Task { await run(); NSApplication.shared.terminate(nil) } }
  func scrolls(_ view: NSView) -> [NSScrollView] { (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrolls) }
  func stats(_ v: [Double]) -> [String: Double] { let s=v.sorted();return ["p50":s[(s.count-1)/2],"p95":s[(s.count-1)*95/100],"max":s.last!,"total":s.reduce(0,+)] }
  func run() async {
    let activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Synthetic scrolling measurement")
    defer { ProcessInfo.processInfo.endActivity(activity) }
    for round in 0..<3 { for mode in (round == 1 ? ["dynamic","observed","none"] : ["none","observed","dynamic"]) {
      let host = NSHostingView(rootView: GeometryView(mode: mode))
      let window = NSWindow(contentRect: NSRect(x: 50,y: 50,width: 900,height: 700),styleMask: [.titled],backing: .buffered,defer: false)
      window.isReleasedWhenClosed=false;window.contentView=host;window.makeKeyAndOrderFront(nil)
      try? await Task.sleep(for: .milliseconds(500))
      let scroll = scrolls(host).first!
      Samples.transforms=0;Samples.actions=0;Samples.actionMS=[]
      var eventMS: [Double]=[],stepMS: [Double]=[]
      for i in 0..<240 {
        let start=ProcessInfo.processInfo.systemUptime
        let event=CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:1,wheel1:-60,wheel2:0,wheel3:0)!
        event.setIntegerValueField(.scrollWheelEventScrollPhase,value:i==0 ? 1:2)
        scroll.scrollWheel(with:NSEvent(cgEvent:event)!)
        host.layoutSubtreeIfNeeded()
        eventMS.append((ProcessInfo.processInfo.systemUptime-start)*1000)
        try? await Task.sleep(for:.milliseconds(16))
        stepMS.append((ProcessInfo.processInfo.systemUptime-start)*1000)
      }
      let result: [String:Any]=["mode":mode,"round":round,"ticks":240,"event_ms":stats(eventMS),"step_ms":stats(stepMS),"transforms":Samples.transforms,"actions":Samples.actions,"action_total_ms":Samples.actionMS.reduce(0,+),"end_y":scroll.contentView.bounds.minY]
      print(String(decoding:try! JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]),as:UTF8.self));fflush(stdout)
      window.orderOut(nil);window.contentView=nil;window.close()
    } }
  }
}
```

### summarize.py

<!-- file: summarize.py -->
```python
import json,sys
rows=[json.loads(line) for line in open(sys.argv[1]) if line.startswith('{')]
for d in rows:
 if d['phase'] in ('early','late'):
  bodies=d['bodies_per_display_callback']
  scans=d.get('scans_ms',{})
  print(d.get('view','room'),d['count'],d['mix'],d['phase'],'bodies/display-callback',round(bodies['total']/max(1,bodies['n']),2),bodies['p95'],'event_p95',round(d['layout_ms']['p95'],3),'step_p95',round(d['step_ms']['p95'],3),'display_p95',round(d['display_interval_ms']['p95'],3),'scans_total',round(sum(x['total'] for x in scans.values()),3),'room',d['room_bodies'],'retired',d['retired_bodies'],'projection_calls',d.get('projection_ms',scans.get('preparedMessages',{})).get('n',0),'projection_ms',round(d.get('projection_ms',scans.get('preparedMessages',{})).get('total',0),3),'view_bodies',d.get('view_bodies',d['room_bodies']))
 if d['phase']=='reaction': print(d['count'],d['mix'],'tap prepare',d['prepare'])
if '--check' in sys.argv:
 cases={(d['count'],d['mix']) for d in rows}
 assert len(cases)==21, len(cases)
 assert len(rows)==189,len(rows)
 for count,mix in cases:
  by_phase={d['phase']:d for d in rows if d['count']==count and d['mix']==mix}
  assert by_phase['early']['start_y']-by_phase['early']['end_y']>400,(count,mix,'did not scroll')
  assert by_phase['traverse']['end_y']<=1,(count,mix,'did not reach top')
  for phase in ('early','traverse','late','idle'): assert not by_phase[phase]['prepare'],(count,mix,phase,'unexpected preparation')
  assert by_phase['late']['bodies_per_display_callback']['total']>0,(count,mix,'late phase did not exercise rows')
  for phase in ('load','reaction'):
   samples=by_phase[phase]['prepare']
   expected=2 if phase=='load' and by_phase[phase].get('view')=='room' and '--stable-projection' not in sys.argv else 1
   assert len(samples)==expected,(count,mix,phase,'unexpected preparation count')
   assert samples[0]['visited']==count and samples[0]['parsed']==(count if phase=='load' else 0),(count,mix,phase,'unexpected visit/parse count')
   assert all(sample['visited']==count and sample['parsed']==0 for sample in samples[1:]),(count,mix,phase,'unexpected startup reparsing')
  for index in range(count-2,count):
   sentinel=f'fixture-{index}'
   assert by_phase['load']['ids'].get(sentinel,0)>0,(count,mix,sentinel,'not initially realized')
   assert by_phase['late']['ids'].get(sentinel,0)==0,(count,mix,sentinel,'evaluated during top sweep')
  for phase in ('cold','reuse','reaction'):
   samples=by_phase['prepare-'+phase]['worker']
   assert len(samples)==7,(count,mix,phase,'sample count')
   assert all(x['visited']==count and x['parsed']==(count if phase=='cold' else 0) for x in samples),(count,mix,phase,'unexpected visit/parse count')
 print('PASS: 21 cases, real scrolling, top reached, no scroll preparation, expected load/reaction preparation, distant rows inactive, 7 cold/reuse/reaction samples each')

if '--retry-guard' in sys.argv:
 cases=[r for r in rows if r['phase']=='lookup' and r['mode']=='existing']
 assert {r['count'] for r in cases}=={50,500,2000}
 for row in cases:
  assert row['allowed']==0
  assert row['retry_source_collections']==0,(row['count'],row['retry_source_collections'],'ordinary retry checks constructed source arrays')
 print('PASS: ordinary retry checks construct zero source arrays at 50/500/2000 messages')

if '--projection' in sys.argv:
 cases={(d['view'],d['count'],d['mix']) for d in rows}
 assert cases=={(view,count,mix) for view in ('room','thread') for count in (50,500,2000) for mix in ('plain','mixed')},cases
 assert len(rows)==72,len(rows)
 for view,count,mix in sorted(cases):
  phases={d['phase']:d for d in rows if (d['view'],d['count'],d['mix'])==(view,count,mix)}
  assert phases['early']['start_y']-phases['early']['end_y']>400,(view,count,mix,'did not scroll')
  assert phases['traverse']['end_y']<=1,(view,count,mix,'did not reach top')
  for phase in ('early','traverse','late','idle'):
   row=phases[phase]
   assert not row['prepare'],(view,count,mix,phase,'unexpected preparation')
   assert row['projection_ms']['n']==row['view_bodies'],(view,count,mix,phase,row['projection_ms']['n'],row['view_bodies'],'repeated projection')
  assert phases['late']['view_bodies']>0,(view,count,mix,'view not exercised')
  for phase in ('load','reaction'):
   samples=phases[phase]['prepare']
   expected=2 if phase=='load' and view=='room' else 1
   assert len(samples)==expected and samples[0]['visited']==count and samples[0]['parsed']==(count if phase=='load' else 0),(view,count,mix,phase,samples)
   assert all(sample['visited']==count and sample['parsed']==0 for sample in samples[1:]),(view,count,mix,phase,'unexpected startup reparsing')
  for index in range(count-(2 if view=='room' else 1),count):
   sentinel=f'fixture-{index}'
   assert phases['load']['ids'].get(sentinel,0)>0,(view,count,mix,sentinel,'not initially realized')
   assert phases['late']['ids'].get(sentinel,0)==0,(view,count,mix,sentinel,'evaluated during top sweep')
  assert all(row['retry_source_collections']==0 for row in phases.values())
 print('PASS: 12 room/thread cases; one projection per view evaluation during scroll/idle; scrolling, preparation, distant-row and retry-copy checks pass')

if "--stable-matrix" in sys.argv:
 expected={(view,count,mix,phase) for view in ('room','thread') for count in (50,500,2000) for mix in ('plain','mixed') for phase in ('load','early')}
 actual=[(row.get('view'),row.get('count'),row.get('mix'),row.get('phase')) for row in rows]
 assert len(actual)==len(expected) and set(actual)==expected, 'Incomplete or duplicated short matrix: expected 12 room/thread cases, each with load and early records'
 assert all(row['ticks']==30 for row in rows if row['phase']=='early'), 'Expected 30 wheel events per short case'
 print('PASS: complete short matrix, 12 cases with 30 wheel events each')

if "--stable-projection" in sys.argv:
 scroll = [row for row in rows if row['phase'] in ('early', 'traverse', 'late', 'idle')]
 assert scroll, 'No measured scroll phases'
 failures = []
 for row in scroll:
     print(f"{row['view']} {row['count']} {row['mix']} {row['phase']}: bodies={row['view_bodies']}, overlay_builds={row['overlay_builds']}, preparations={len(row['prepare'])}")
     assert not row['prepare'], 'Unexpected preparation during stable scroll'
     if row['phase'] == 'early':
         assert row['view_bodies'] > 0, 'No view updates exercised'
         assert row['start_y'] - row['end_y'] > 100, 'No real scrolling exercised'
     if row['overlay_builds'] != 0:
         failures.append((row['view'], row['count'], row['mix'], row['phase'], row['overlay_builds']))
 assert not failures, f'Stable scrolling rebuilt transcript projections: {failures}'
 print('PASS: stable scrolling rebuilds zero transcript projections')

if "--updates" in sys.argv:
 cases=[row for row in rows if row['phase']=='updates']
 assert len(cases)==2 and {row['view'] for row in cases}=={'room','thread'}
 expected={'initial row','edit and prepared markdown','optimistic reaction before response','confirmed reaction','optimistic reaction removal','reaction rollback','arrival','removal','pending send','failed send','outbox removal','scope replacement'}
 for row in cases: assert set(row['passed'])==expected,(row['view'],row['passed'])
 print('PASS: 12 live-update checks each in real room/thread views')
```

### trace_stacks.py

<!-- file: trace_stacks.py -->
```python
import collections,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'scripts'))
from instruments_parser import xctrace,xml_utils
trace=Path(sys.argv[2]); cache=trace.with_suffix('.time-profile.xml')
if not cache.exists():cache.write_bytes(xctrace.export_schema(trace,'time-profile'))
window=None if len(sys.argv)<5 else (int(float(sys.argv[3])*1e6),int(float(sys.argv[4])*1e6))
stream=xml_utils.RowStream(cache.read_bytes())
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
  if any(key in name for key in ('RoomTimelineView','MessageRowView','PreparedTranscript','M6Probe','M6Delegate','MessageMarkdown','ExpandableMessageBody','TranscriptScrollEdges','ChatRoomMessage','ForEach')):app[name]+=w

def top(counter):return [{'symbol':k,'ms':round(v/1e6,3),'percent_main_weight':round(100*v/total,2)} for k,v in counter.most_common(40)]
print(json.dumps({'main_samples':sample_count,'main_weight_ms':round(total/1e6,3),'window_ns':window,'leaf':top(leaf),'inclusive':top(inclusive),'app_inclusive':top(app)},indent=2))
```
