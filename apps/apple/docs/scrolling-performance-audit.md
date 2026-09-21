# Chat scrolling performance

## Projection reuse follow-up — 2026-09-21

`RoomTimelineView` and `ReplyThreadView` now compute `preparedMessages` once per view evaluation and pass that array to the rows, jump-readiness check and last-message observer. This removes repeated calls to the existing `PreparedTranscript.overlaying` helper: **four to one in the room, three to one in the thread** during scrolling. The thread's pending-jump path also uses the same array. The projection is still live on every update; no persistent cache, new state lifetime, renderer, domain rule or scroll container is introduced.

The comparison starts at merged retry guard `26f8e9e0fb19e90dfbe6d08c33a8fd773cac99e2`. Both sides use identical probes from the [inlined harness](scrolling-performance-harness.md), arm64 Release builds, the same 900 × 700 pt window and the same host/configuration as below. Each side runs 12 cases: room/thread × 50/500/2,000 total messages × plain/mixed content. Mixed content cycles through plain text, markdown, code, images, unfurls and reactions; a thread contains one parent and N−1 replies. Each pane starts in a fresh process. There is one run per cell, with no concurrent build or other benchmark. Both binaries were copied out of the shared DerivedData directory before the next build. Each copied app logged one `sandbox_extension_issue_file_to_process` launch warning; the retained evidence records it, and both sides completed every case and trace.

For the 120-tick repeat-scroll phase in the plain cases:

| View | Messages | View evaluations, before / after | Projection calls, before / after | Total projection time (ms), before / after |
| --- | ---: | ---: | ---: | ---: |
| room | 50 | 103 / 101 | 412 / 101 | 12.349 / 5.121 |
| room | 500 | 101 / 101 | 404 / 101 | 94.812 / 30.855 |
| room | 2,000 | 101 / 101 | 404 / 101 | 383.784 / 132.235 |
| thread | 50 | 94 / 93 | 282 / 93 | 11.627 / 7.209 |
| thread | 500 | 94 / 94 | 282 / 94 | 79.186 / 32.227 |
| thread | 2,000 | 81 / 93 | 243 / 93 | 259.829 / 114.165 |

Body evaluation counts can vary even with identical wheel ticks, so the table retains that denominator. Every updated scroll/idle phase in all 12 plain/mixed cases has exactly one projection per view evaluation. This is a **75% reduction in calls per room evaluation and 67% per thread evaluation**, not a promise of the same percentage reduction in scrolling latency. At 2,000 messages the room's aggregate projection time falls from 383.784 to 132.235 ms for the same 101 evaluations. One O(N) projection still runs per update; reuse across unchanged updates would need a separate state/invalidation design.

The deterministic `--projection` check fails on the baseline (`136` calls for `34` room evaluations in the 50-message mixed early phase), and passes after the change. It uses no timing threshold. Both matrices scroll more than 400 points and reach the top; neither prepares during scrolling/idle or constructs ordinary retry-source arrays. The current conditional room/thread host records **two room startup preparations on both sides** (first parses N, second reparses zero), one thread startup preparation, and one reaction preparation that reparses zero. Fresh-process 50-message mixed-room checks reproduce the extra startup pass before and after. This differs from the older direct-room harness and is retained rather than attributed to this fix. The final two room IDs stay inactive during the top sweep; threads use the final ID because the preceding row is not consistently realized at startup on either side.

A separate paired Time Profiler capture uses the expert skill's recorder and parser, scoped to the complete first 120-wheel-event phase via process-scoped unified logs. The previous SwiftUI-template finalization failure still limits this workflow to Time Profiler plus explicit body counters. `RoomTimelineView.preparedMessages` drops from **396 ms (10.34%) to 125 ms (3.21%)** of inclusive main-thread sample weight. Direct counters record **428 / 107 projection calls for 107 / 107 room evaluations**, and **1,520 / 1,522 row-body evaluations**. Inclusive frames overlap; their shares must not be added.

**An overall scrolling speedup is not established.** Total sampled main-thread work is **3,830 / 3,900 ms** and phase duration is **5,034.420 / 4,987.216 ms** in this single pair. The result establishes less projection work, not improved presented-frame FPS or a cure for the live-room report. [Retained evidence](scrolling-projection-results.json) includes both complete phase summaries, getter distributions, isolated startup checks, source hashes, trace bounds and parsed stacks. Binary traces stay local; the harness recreates the capture and checks.

Verification: the full workspace suite passes **867 tests, zero failures/skips**, before and after the product change. This includes the 16 existing content-growth/reading-position cases, four room/thread media-scrolling cases, and the expanded four light/dark room/thread jump cases that request navigation before preparation finishes. Release harness builds and the shared Workspace build targeting iOS 17 pass. Strict uncached SwiftLint and pinned SwiftFormat pass. The inlined sources recreate the measured app/probes byte for byte, with the Xcode project and package-product linkage unchanged. An app-only rerun passes 100 tests after making the snapshot fixture background explicit. All four light/dark room/thread captures were inspected: the requested message is centered and highlighted, with the composer and Jump to latest control visible. The existing large room view composition has a scoped length/complexity lint annotation after becoming a parameterized function; its branches and view tree were not expanded.

Verification commands, from `apps/apple` (reuse the shared DerivedData directory via `-derivedDataPath` when needed):

```sh
xcodebuild test -workspace Sokosumi.xcworkspace -scheme Sokosumi -configuration Debug \
  -destination 'platform=macOS,arch=arm64' -skipPackagePluginValidation \
  -parallel-testing-enabled NO -enableCodeCoverage NO \
  ENABLE_CODE_COVERAGE=NO CLANG_ENABLE_CODE_COVERAGE=NO DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=-
xcodebuild -workspace Sokosumi.xcworkspace -scheme SokosumiWorkspace -configuration Debug \
  -destination 'generic/platform=iOS' -sdk iphoneos -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO IPHONEOS_DEPLOYMENT_TARGET=17.0 \
  ENABLE_CODE_COVERAGE=NO CLANG_ENABLE_CODE_COVERAGE=NO build
mint run swiftformat --lint .
mint run swiftlint lint --strict --no-cache
```

The final app-only run adds `-only-testing:SokosumiTests` to the test command. Release harness builds and the red/green projection check use the commands in the [harness](scrolling-performance-harness.md).

**M6 remains Partial.** `ScrollView`, `LazyVStack`, stable row IDs, scroll anchors, callbacks and detached preparation are retained. Live authenticated room/thread responsiveness, older-page insertion, historic pagination, gap loading, follow-latest arrivals and position while images grow still need interactive acceptance. This change does not justify a `List` conversion or close the separate geometry warning.

## Retry guard follow-up — 2026-09-21

`WorkspaceState.canRetryMention` now rejects rows that are not failed mention shells with a source ID **before** constructing `mentionRetrySources`. Room and thread views share this method. Valid failed shells still use the existing loaded-source and ownership check. `ScrollView`, `LazyVStack`, row rendering, geometry callbacks and the prepared-message projection are unchanged.

A fresh before/after comparison starts at `e7ec006938a2f0a9f419da39e236b2eb24282468`, on the same host and Release configuration as the baseline below. The retained harness now counts calls to the actual source-array getter in its disposable copy. Each lookup cell contains 21 batches of 100 ordinary-message checks:

| Messages | Before: median ms/check | After: median ms/check | Source collections, before / after |
| --- | ---: | ---: | ---: |
| 50 | 0.004205 | 0.000265 | 2,100 / 0 |
| 500 | 0.029067 | 0.000266 | 2,100 / 0 |
| 2,000 | 0.117340 | 0.000271 | 2,100 / 0 |

At 2,000 messages the real method is about **430× faster for this negative check**, with a flat cost across message counts. The harness-only predicate used in the earlier baseline was cheaper still because it skipped the coordinator call and room check; this table measures the implemented method. The deterministic `--retry-guard` check failed before the change (2,100 source collections) and passes afterward (zero), without a timing threshold. Package tests separately cover ordinary/thinking/orphan rows, missing sources, ownership and room changes, plus valid sources present only in the open thread parent or replies.

In the native 2,000-message plain transcript, the first 120 wheel events built **4,022 source collections before and zero afterward**. Row-body evaluations were **1,527 / 1,526**. One paired Time Profiler capture, scoped to the complete early-scroll phase using unified-log timestamps, recorded **4,329 / 4,107 ms** of main-thread sample weight (about 5.1% less). Phase duration was **5,227 / 5,215 ms**, effectively unchanged. This single pair is descriptive evidence, not a stable overall speedup or presented-frame FPS claim. The remaining prepared-message projection still consumed **377 / 389 ms** of inclusive main-thread sample weight.

Six unprofiled cases (plain and mixed transcripts at 50 / 500 / 2,000 messages) all scrolled more than 400 points and reached the top. Every phase constructed zero retry-source arrays. Each case still prepared once at load and once after the mock reaction, with no preparation during scrolling/idle and no reaction reparsing. Previously realized bottom sentinels stayed inactive during the top sweep. The mixed transcript covers markdown, code, images, unfurls and reactions as well as plain text; the original seven-mix matrix below is retained rather than replaced.

[Follow-up results](scrolling-retry-guard-results.json) retain lookup batch summaries, parsed trace stacks/windows and phase summaries, including bottom-sentinel counts. The [harness](scrolling-performance-harness.md) contains the new counter and exact rerun/check commands. Binary traces remain local. The original failed SwiftUI-template capture led to using the expert skill's Time Profiler workflow for both follow-up captures.

Verification: the workspace test run passes **858 tests, zero failures/skips** (99 app, 1 CoreAPI, 35 Auth, 553 Chat, 48 Realtime, 122 Workspace). The Release measurement app builds; the shared Workspace scheme builds with `IPHONEOS_DEPLOYMENT_TARGET=17.0`. Pinned SwiftFormat and strict uncached SwiftLint pass. The inlined harness extracts and recreates the built probes; Xcode project/package-product linkage is unchanged. All task-owned app hosts exited.

This removes a measured source of main-thread work. **M6 remains open:** live-room responsiveness, the other projection cost and the regression gates below still require acceptance. The first guard does not establish that a `List` conversion is necessary or that all sluggishness is fixed.

## Baseline measurement — 2026-09-21

**Neither the growing row-body workload in candidate (a) nor `PreparedTranscript.prepare` in candidate (b) explains the measured steady-scroll work.** The geometry callback in (c) is also small in the tested path. There is other whole-transcript work on the main actor: `preparedMessages` repeatedly builds its live-message dictionary/projection, and retry eligibility eagerly constructs `mentionRetrySources` for ordinary rows. The native CPU trace attributes 9.66% of main-thread sample weight to `mentionRetryAction(for:)` and 7.97% to `preparedMessages` during scrolling. These are measured contributors, not a claim that removing one will cure every reported hitch.

**Baseline recommendation:** reject messages that are not failed mention shells with a source ID in `WorkspaceState.canRetryMention`, before evaluating `mentionRetrySources`. The isolated negative-case check at 2,000 messages falls from **0.127 ms to 0.000083 ms per call** with that guard in the measurement harness. That baseline session made no product fix or end-to-end comparison. Keep the existing eligibility check for valid failed shells; a future patch needs its positive/negative permission tests.

The original “lazy rows never disappear, therefore live rendered work grows without limit” statement was an unmeasured hypothesis. The counts below reject its **cumulative row-body evaluation** prediction. They do not measure retained heap/state or prove that every offscreen descendant is inactive. At the baseline, M6 remained Todo because no scrolling fix or regression-gate acceptance had happened.

## Method and reproducibility

Baseline: `85524b023fc44ee13ce92d848e25c5cc23b08487`, Apple M4 Pro, 24 GiB RAM, macOS 27.0 (26A428), Xcode 27.0 (27A266a), arm64 Release (`-O`). Both `ENABLE_CODE_COVERAGE=NO` and `CLANG_ENABLE_CODE_COVERAGE=NO` are necessary here. The app/package compile commands were checked for coverage instrumentation. A cached generator-tool link still mentioned its profile runtime; it is not the measured app.

The [inlined harness](scrolling-performance-harness.md) adapts `SokosumiTests/Chat/Timeline/TranscriptScrollingTests.swift`: real `RoomTimelineView`, `MessageRowView`, rendering/composer code, and `WorkspaceState`, hosted in a 900 × 700 pt `NSWindow`. It copies Apple sources to a disposable directory and adds counters there. The checkout's product code, Xcode project, package products, dependencies, and `apps/web` were not changed. In particular, **no package products were added to `SokosumiTests`**; the hosted-test/Xcode Cloud coverage link remains unchanged.

Fixtures use fixed IDs/times, alternating authors, and 50 / 500 / 2,000 messages. Separate homogeneous cases cover plain text, markdown, Swift code blocks, images, unfurls, and reactions; the mixed case cycles equally through those six types. Markdown has three rich paragraphs, code has eight lines, and plain text repeats a short paragraph four times. Images/unfurls use the existing `ScrollMediaProtocol`: a local 2400 × 1600 PNG with a 50 ms delay and distinct URLs. No account, live server, roster, or channel suggestions are used.

One UI run per count/mix cell waits for the real transcript and settles for 1.5 seconds, scrolls upward at 60 pixels per wheel tick for up to 120 ticks, traverses to the top at 400 pixels per tick, repeats a 120-tick up/down sweep near the top, idles for 60 ticks, then calls the coordinator action behind one reaction tap. Every gesture ends explicitly and settles for 500 ms outside its measured interval. All 21 cases scrolled more than 400 points and reached the top. The seven preparation samples per mode run separately in a fresh process without hosted views; the lookup benchmark also runs in its own process.

Counters record `MessageRowView.body` by message ID and group counts between `NSView.displayLink` callbacks. These are **display callbacks, not proof of presented frames**. Direct timers measure the actual detached preparation worker, synchronous getters, and geometry transform/action. Full records and checks are retained in [results](scrolling-performance-results.jsonl) and [supporting evidence](scrolling-performance-evidence.json).

The retained harness also holds a scoped process activity token and publishes phase names in its diagnostic logs. The original UI-count matrix predates those two harness refinements; neither changes product view logic or the counters. The token did not eliminate all empty-control scheduling delays. Some driver intervals were 80–116 ms even without an observer, so **driver sleep/callback intervals are not used as product FPS or as causal timing evidence**. This avoids mistaking foreground, scheduler, or host effects for transcript work. The raw intervals remain available for inspection.

## (a) Row bodies stay bounded while scrolling

After traversing history, repeat-scroll body evaluations per display callback were:

| Content | 50 messages: mean / p95 | 500: mean / p95 | 2,000: mean / p95 |
| --- | ---: | ---: | ---: |
| plain | 11.81 / 15 | 12.28 / 16 | 12.12 / 16 |
| markdown | 3.04 / 9 | 3.08 / 9 | 3.17 / 9 |
| code | 1.35 / 5 | 1.48 / 5 | 1.48 / 7 |
| images | 0.68 / 4 | 0.69 / 4 | 0.66 / 5 |
| unfurls | 0.90 / 5 | 0.95 / 5 | 0.33 / 4 |
| reactions | 6.26 / 12 | 6.79 / 13 | 6.41 / 12 |
| mixed | 1.90 / 7 | 1.96 / 7 | 1.76 / 7 |

For plain text, the early-scroll means were **12.75 / 12.65 / 12.65** at 50 / 500 / 2,000 messages; the repeat-scroll means were **11.81 / 12.28 / 12.12**. A 40× increase in loaded messages did not produce a 40× body workload. Content height changes how many nearby rows are crossed per tick, which explains why the content mixes should not be compared as equal-size rows.

The **last two bottom message IDs had zero body evaluations during the later top sweep in all 21 cases**. All were realized at the initial bottom position. The full per-ID records show where evaluation happened; initial realization also includes a few top rows while the bottom anchor is established, so the raw `retired_bodies` aggregate is not itself an offscreen count. Distant bottom sentinels, not that aggregate, establish that previously visited rows are not continuously reevaluated. Nearby prefetch rows and independently updating descendants are outside that narrower conclusion.

Idle phases caused zero preparation calls. Row-body counts can include isolated local state changes; they are not an allocation or retained-view count. Moving to `List` is not supported by a claim that every previously visited row body runs on every scroll frame.

## (b) Preparation: cold parsing scales; reactions re-walk without reparsing

Across all 21 UI cases there was **one preparation at load, zero during early/traverse/repeat/idle phases, and one after the synthetic successful reaction action**. The reaction visits exactly N messages and reparses **zero** documents. The worker also builds the previous N-entry source dictionary before its N-message loop. This confirms the reaction re-walk; it does not make it a steady-scroll explanation. The mock returns the same confirmed reaction state as the optimistic overlay; different server normalization or concurrent realtime updates can cause additional production preparations.

The fresh-process direct API benchmark produced these worker wall-time medians (seven samples per cell):

| Messages | Content | Cold median (ms) | Reuse median (ms) | Reaction-only median (ms) |
| --- | --- | ---: | ---: | ---: |
| 50 | plain | 7.539 | 0.013 | 0.011 |
| 50 | markdown | 12.010 | 0.011 | 0.010 |
| 50 | code | 3.074 | 0.011 | 0.010 |
| 50 | images | 1.876 | 0.011 | 0.010 |
| 50 | unfurls | 5.279 | 0.010 | 0.008 |
| 50 | reactions | 5.377 | 0.009 | 0.022 |
| 50 | mixed | 5.714 | 0.011 | 0.009 |
| 500 | plain | 52.837 | 0.081 | 0.077 |
| 500 | markdown | 118.503 | 0.079 | 0.078 |
| 500 | code | 31.860 | 0.079 | 0.078 |
| 500 | images | 19.073 | 0.078 | 0.079 |
| 500 | unfurls | 53.382 | 0.081 | 0.079 |
| 500 | reactions | 52.423 | 0.077 | 0.077 |
| 500 | mixed | 55.771 | 0.078 | 0.078 |
| 2,000 | plain | 209.620 | 0.313 | 0.308 |
| 2,000 | markdown | 489.534 | 0.311 | 0.304 |
| 2,000 | code | 127.191 | 0.315 | 0.315 |
| 2,000 | images | 82.235 | 0.419 | 0.329 |
| 2,000 | unfurls | 214.038 | 0.323 | 0.323 |
| 2,000 | reactions | 217.942 | 0.316 | 0.311 |
| 2,000 | mixed | 224.217 | 0.329 | 0.309 |

`Cold` always passes `reusing: nil`. `Reuse` keeps the previous snapshot unchanged. `Reaction-only` changes one message's reactions while preserving all content. Every cold sample parsed N documents; every reuse/reaction sample visited N and parsed zero. Caller wall times, which also include detached-task scheduling, are retained in the raw data. Do not confuse the direct worker timing with network or tap-to-paint latency.

An earlier same-process benchmark immediately after media-heavy UI phases produced substantially larger parsing times (for example, 1,127 ms for 2,000 mixed messages). Those values are excluded from this table: they mixed parsing with remaining UI/media and host scheduling effects. The separate no-view process is the reproducible preparation measurement.

## Other measured main-thread work and the cheapest fix

The valid native Time Profiler capture covers a 2,000-message plain transcript. The analysed **4,000–9,000 ms** window lies entirely inside early scrolling: capture began at 12:25:49.659 +02:00, and unified-log BEGIN/END timestamps were 12:25:52.730096 and 12:25:58.791708. The trace's own log table was empty, so the process-scoped unified log establishes that boundary.

There were **4,256 main-thread samples / 4,256 ms of sample weight in 5,000 ms: 85.12% running coverage**, consistent with a CPU-bound interval. Selected inclusive shares of main-thread sample weight were:

| Stack | Share |
| --- | ---: |
| `NSHostingView.layout()` | 81.04% |
| `RoomTimelineView.mentionRetryAction(for:)` | 9.66% |
| `RoomTimelineView.preparedMessages.getter` | 7.97% |
| `MessageRowView.body.getter` | 5.83% |

Inclusive stacks overlap; do not add these percentages. The supplemental stack analysis uses at most 128 frames per sample. The expert skill's Time Profiler analysis reports zero detected hangs in this short window; hitches and SwiftUI lanes are **unavailable**, not zero.

The source explains the avoidable retry work: `WorkspaceState.canRetryMention` passes `mentionRetrySources` as an eagerly evaluated argument. That property concatenates the transcript, thread parent and replies **before** `CoworkerMentionShell.canRetry` rejects an ordinary message. The negative-case benchmark calls the real method 2,100 times per count, in 21 batches of 100. Its comparison checks for a failed shell with a source ID before calling that same method. Both paths deny every ordinary-message case:

| Loaded messages | Existing check, median ms/call | Reject ordinary message first, ms/call |
| --- | ---: | ---: |
| 50 | 0.004012 | 0.000083 |
| 500 | 0.032160 | 0.000087 |
| 2,000 | 0.126915 | 0.000082 |

Use the existing `CoworkerMentionShell` predicate in the shared `WorkspaceState.canRetryMention` seam. Do not add another renderer or implement a new permission path. This is the smallest measured waste to remove, with the benefit limited to that work until a future UI benchmark proves more.

`preparedMessages` is a second measured contributor. During the plain-text top sweep it ran **404 / 404 / 388 times**, spending **11.46 / 103.51 / 366.61 ms** at 50 / 500 / 2,000 messages. That is four calls for each of **101 / 101 / 97** room-body evaluations. Unlike detached `prepare`, this dictionary/map work happens while scrolling on the main actor. Reusing that projection when message/reaction inputs have not changed is a later candidate; this session does not prescribe or ship its state-lifetime design.

## (c) Geometry has a small independent cost

The actual `TranscriptScrollEdges` observer was timed without changing its behavior. Across the early/traverse/repeat phases and all content mixes, the largest per-case p95 at each count was:

| Messages | Transform p95 (ms) | Action p95 (ms) |
| --- | ---: | ---: |
| 50 | 0.000750 | 0.012625 |
| 500 | 0.000792 | 0.013750 |
| 2,000 | 0.001125 | 0.026417 |

These are nonzero costs, but they do not explain the observed main-thread CPU work. Microsecond timings include timer overhead. The fixed-width run does not exercise width-change restoration.

A separate one-rectangle app removes all chat models and rows. Its growing inset changes during initial layout, before the measured scroll loop. It preserves scroll position, the bottom size-change anchor and the composer inset, comparing no observer, a full-geometry observer with an empty action, and that observer with an inset growing from 0 to 202 points. Each variant receives 240 identical 60-pixel wheel events; order is reversed in round 2:

| Round | No observer: event/layout p95 (ms) | Empty observer (ms) | Observer + growing inset (ms) |
| --- | ---: | ---: | ---: |
| 1 | 0.227 | 0.236 | 0.253 |
| 2 | 0.277 | 0.269 | 0.277 |
| 3 | 0.359 | 0.306 | 0.320 |

The stable observer's paired p95 differences were **+0.009 / −0.009 / −0.052 ms**. It received 239–240 action callbacks per run. There is no repeatable positive event/layout penalty above the run-to-run variation in this control. Long scheduled-step delays also appeared in the no-observer variant, including with the activity token; they cannot be attributed to the observer. This does not close the separate [scroll geometry warning](scroll-geometry-warning.md), which concerns layout transitions and still has its original reproduction and failed substitutions.

## Trace capture and limits

The app-scoped `swiftui-expert-skill` scripts were used for capture and analysis on the host Mac. A 25-second native `SwiftUI` capture grew to about 1.4 GiB but did not finalize after more than five minutes. It was interrupted/terminated; export still failed with **`Document Missing Template Error`**. It supplies no evidence. A valid **Time Profiler** capture (`native-time.trace`, 16.093 s recorded) supplies the CPU evidence above, and explicit body counters provide the requested fallback. An earlier geometry-only SwiftUI capture succeeded but reported an empty SwiftUI lane; its zero-body table is not used as evidence.

Binary traces are not committed. The inlined harness recreates them; the parsed metrics, phase timestamps and raw counters are retained. No claim is made about live authenticated rooms, actual presented-frame FPS, retained heap, every descendant's body, or an end-to-end improvement from the proposed guard.

## Preserve M6's regression gates

**Do not start with a `List` conversion on this evidence.** It would replace the current `ScrollPosition`, `.defaultScrollAnchor(.bottom, for: .sizeChanges)`, and geometry-edge machinery without addressing the measured eager copies directly. Its cost is a rewrite and re-verification of reading position on older-page insertion, historic jumps, gap rows, follow-latest, and position while images grow. None of those gates is waived or marked passed here.

Room and reply-thread scrolling remain required; this measurement exercised the room view. Keep shared code iOS 17 compatible, preserve the API contract, and retain `ExpandableMessageBody` line-boundary coverage. Keep the accepted complete-line expansion, rounded edges, hover actions, pagination, and follow behavior. Publish UI state on the main actor; prepare in detached work with Sendable snapshots, cancellation and stale-result checks; bound document reuse to the previous snapshot. Reuse `TranscriptScrollingTests`, `ImageThumbnail`, `RoomTimeline`, `ThreadSession`, `TimelineScrollIntent`, and coordinator lifecycles in any subsequent fix. #4571's parsing improvement remains distinct from a scrolling fix.
