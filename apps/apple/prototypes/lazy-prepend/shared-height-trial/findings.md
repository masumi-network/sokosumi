# Shared native clamp-height production trial

Sharing the native height works, but this trial does **not** establish a production older-page performance improvement. Keep it separate from production delivery. Raw results are in [measurements.json](measurements.json).

## Change under test

Baseline: `591392e814f4e3ef6006a4252b0d641ba3affb2f` from `origin/main`. The exact source/test diff is archived in [trial.patch](trial.patch); it is unapplied.

Each room or reply-thread pane owns two hidden native `Text` probes: 16 body lines and four callout quote lines. `ExpandableMessageBody` reads their heights through the environment when the resolved font, line count, and line spacing match. An unmatched configuration retains the original per-row native measurement. Shared values remain live; they are not copied into row State. Probes update their font key along with their geometry, including a font change that keeps the same height.

The original Markdown tree, complete-line boundary calculation, block allowances, quote view, selection, context menu, hover actions, and scroll orchestration remain in place. This is a production trial, rather than the fixed-height diagnostic control in #5938.

## Paging measurements

Team-signed Release builds on Apple M4 Pro, macOS 27.0.1, Xcode 27.0 (27A266a). Signing identity: `Developer ID Application: utxo AG (GVWN7HXYJB)`; verified team `GVWN7HXYJB`.

The existing [production paging harness](../../../docs/scrolling-hover-harness.md) hosts the real `RoomTimelineView` in a 1100 × 800 pt native window. Both builds use exactly the same 600 mixed rich messages: paragraphs, links, code, fixture images, quotes, and reactions. Start with 100 messages; load five older pages of 100 through the Core transport fixture, with 150 ms response latency. Both use the same native scrollbar drag, wait 450 ms for rest, request the older page through `WorkspaceState`, and settle after publication. Automatic boundary loading is verified separately by native tests.

Three paired fresh-process cycles alternate order: before/after, after/before, before/after. No builds or tests run during timing. All six runs finish with six requests and 600 messages; every run records exactly five prepared-page publications, for counts 200 through 600. Their encoded fixture SHA-256 is identical: `ba07b410afdff1bba2c5a2e4a94c77ad30fa573bc9380a66c89dfd7bc67c98ef`.

The reported stall is the largest **actual main-actor display-link callback gap** from 50 ms before to 700 ms after a prepared older page publishes. Sampling uses `ProcessInfo.processInfo.systemUptime` at callback entry, rather than the display link's scheduled timestamp. These are diagnostic callback gaps, not measured presented-frame times. The 33.4 ms threshold is a comparison budget.

| Measure | Before | Shared native height |
| --- | ---: | ---: |
| Median of 15 page-window maxima | 57 ms | 55 ms |
| Mean of 15 page-window maxima | 58.7 ms | 59.5 ms |
| Worst page window | 90 ms | 100 ms |
| Page windows above 33.4 ms | 15/15 | 15/15 |
| Per-row native height callbacks per run | 77 | 0 |
| Shared height callbacks per run | 0 | 2 |

| Paired cycle | Before page-window maxima (ms) | Shared page-window maxima (ms) | Before/shared median (ms) |
| --- | --- | --- | --- |
| 1 | 47, 90, 44, 44, 62 | 85, 66, 55, 43, 67 | 47 / 66 |
| 2 | 66, 40, 38, 83, 83 | 53, 55, 55, 48, 44 | 66 / 53 |
| 3 | 68, 57, 70, 40, 49 | 49, 100, 54, 67, 51 | 57 / 54 |

The two shared callbacks and absence of fallback callbacks prove the production rows consumed the shared measurements in this fixture. Eliminating that repeated work does not remove the paging stalls. The 2 ms pooled median difference is smaller than run variation; the mean and worst window do not improve. Do not describe this as a proven paging speedup or use #5938's cold-reveal percentage as its production result.

## Native verification

The same ten focused suites pass in team-signed Debug builds through the Xcode workspace: baseline 43 test functions / 50 case executions; trial 45 test functions / 53 case executions. No failures or skips. The trial adds two tests (three cases) for shared-height consumption and font/spacing transitions.

- `TranscriptScrollingTests`, `RoomOlderPageTests`, `ThreadPaginationTests`, and `ThreadScrollNearTopTests`: native room/thread scrolling, initial bottom placement, automatic older-page requests, deferred insertion while a gesture remains active, reading-position restoration, and message-link placement. Accurate local OCR ran, including the older-page visible-message identity check.
- `TranscriptContentGrowthTests`: streaming/growth while pinned, reading history, and actively scrolling; thread growth; visible Markdown updates while an older page remains deferred.
- `MessageContextMenuTests` and `MessageHoverDelayTests`: native selection/copy, row actions, and hover suppression during scrolling. Shared measurement is enabled in the relevant row fixtures.
- `MessageBodyPresentationTests` and `ExpandableMessageBodyTests`: Show more/Show less, short natural height, image and code rendering, complete Markdown lines at narrow and wide widths, and four-line quotes. Shared/native comparisons cover body and callout fonts, a bold resolved-font context, a larger custom font, line spacing, and returning to the original configuration. A distinctive injected shared height proves live consumption; mismatched font, lines, or spacing prove native fallback.
- `TranscriptScrollEdgesTests`: edge and scroll-phase behavior. SwiftFormat and strict SwiftLint pass all eight changed Swift files.

The existing SwiftUI scroll-geometry warning also appears in both focused runs (14 occurrences before, 13 after); this trial does not resolve it. It is separate from the clamp measurement.

The broader workspace app/package gate, excluding the serialized native-window suite, also passes: 1,618 test functions / 2,227 case executions, no failures or skips. Result summaries are persisted in the raw artifact. Full xcresult bundles remain local and are not a prerequisite for replay.

Reading-position restoration here means keeping the reader's visible rows after an older page lands; it does not claim new persistence across room changes.
