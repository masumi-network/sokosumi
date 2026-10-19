# Clamp and hidden measuring Text isolation

Removing each row's native measuring Text lowers the eight-row cold-reveal
median **28.0%**, from **65.4 to 47.1 ms**, in three rotated fresh-process cycles.
Removing the remaining clamp path gives **46.9 ms** pooled, with mixed incremental
cycle results. Hidden measurement is a reproducible contributor in this fixed
corpus; these controls do not eliminate the stall or establish a production fix.

## Controls

One `--rich-clamp` Release binary compares three modes. Every mode uses the
original production row shell (only the type is renamed), original Markdown
structure, native enabled selection, URL routing, reaction/header content,
participant presentation, and row actions. The clamp-specific build discards the
earlier Markdown content transformations. Only the paragraph styling function's
visibility/static access changes so fixture assertions can reuse it; its logic
and the rendered Text remain the production implementation.

| Mode | Per-row measuring Text | Remaining clamp path | Clamp State declarations |
| --- | --- | --- | --- |
| `markdown` | Original 16-line native Text and geometry write | Original | Original |
| `no-hidden-text` | Removed; State seeded from one shared native measurement | Original geometry, preferences, clipping, frame, toggle/reset logic | Original |
| `no-clamp` | Removed | Bypassed with the same content and vertical fixed size | Still allocated |

All three modes first measure one identical native 16-line `.body` Text outside
the lazy stack, with enabled selection, before any rich row is realized and
before timing. Row realization is gated until its height is available. The seed
is **256 pt**, matching every observed production per-row measurement in the
separate baseline diagnostics. This is not a guessed font metric. The
`no-hidden-text` control removes the per-row native subtree **and its first
geometry/State write** together; it does not distinguish those two costs.

The seed is evidence only for this fixed 16-line `.body` corpus. It is not
interchangeable with four-line `.callout` quote clamps, and seeded State will not
track a later font/scale change. No production source is changed. The no-clamp
control deliberately bypasses clamp behavior; it does not measure the cost of
allocating ExpandableMessageBody's State boxes. The compact body does not
overflow, so all modes show the same row content and actions.

## Method and callback stalls

Measured 2026-10-12, Homer, arm64, macOS 27.0.1 (26A434), Xcode 27.0
(27A266a), Release, Developer ID team **GVWN7HXYJB**. Production inputs are from
commit `d8f72271689c7f6941e806241695b937d7cf643a`. The raw artifact records the
measured binary SHA-256.

The unchanged no-insertion cold/repeat protocol has 48 preloaded rows, seven
8,000-point blank spacers, one excluded warm-up group, and five untouched groups
of eight rows. Each group is revealed, hidden, revealed again, and hidden. All
rows share the same rich paragraph, sender, timestamp, and reaction; only IDs
differ. Parsing/preparation occurs before warm-up. The viewport is 1,100×800 pt.
Corpus SHA-256:
`e19e8c20fb544aa27e8d6f3348b6e5e248e1f1f0a09f41d3a811f47fdc50716e`.

Nine fresh processes give **90 windows**, 15 cold and 15 repeat per mode. Launch
order rotates Markdown/hidden/clamp, hidden/clamp/Markdown, clamp/Markdown/hidden.
Builds, diagnostics, profilers, and native tests are absent during primary timing.
Cold means first observed row-body realization after shared framework warm-up,
not cold process/font caches. Values below are maxima of **main-thread callback
scheduling gaps**, overlapping each reveal through +700 ms. They are not
presented-frame durations or FPS. The fixed 25 ms diagnostic budget remains red.

| Control | Cold median / worst | Repeat median / worst | Cold / repeat windows >25 ms |
| --- | ---: | ---: | ---: |
| Original clamp | 65.4 / 70.4 ms | 20.7 / 26.8 ms | 15/15 / 4/15 |
| No per-row measuring Text | 47.1 / 69.1 ms | 16.8 / 50.0 ms | 15/15 / 3/15 |
| No clamp layout path | 46.9 / 67.8 ms | 17.4 / 33.7 ms | 15/15 / 1/15 |

The per-cycle cold medians are:

| Cycle | Original clamp | No measuring Text | No clamp path |
| --- | ---: | ---: | ---: |
| 1 | 66.3 ms | 40.7 ms | 50.5 ms |
| 2 | 65.4 ms | 49.4 ms | 38.2 ms |
| 3 | 57.9 ms | 41.7 ms | 46.9 ms |

No measuring Text wins **3/3** comparisons against the baseline. Removing the
remaining clamp path is slower than that control in **2/3** cycles; its pooled
median is only 0.2 ms lower. There is no consistent additional callback-gap gain
from bypassing it. This does not prove that remaining clamp work is free.

All **45/45 cold windows** exceed 25 ms. The worst gaps remain **67.8–70.4 ms**;
removing hidden measurement reduces typical cold cost, not the worst-case stall
range. Repeat medians improve, but the no-hidden control also has a 50.0 ms
repeat outlier. Do not describe this as a general smoothness fix or assign an
exact millisecond cost to one component from callback scheduling alone.

## Geometry and row-state reuse

Three separate diagnostic processes verify exactly eight matching visible IDs,
**84 pt** per row, and no previously evaluated cold targets. All **120/120**
revisited State UUIDs inside the lifecycle row clone are retained across observed
disappearance/reappearance. This verifies SwiftUI row-state retention, not reuse
of particular AppKit views/controls or deallocation. Primary timings use the
original shell without the extra UUID or lifecycle callbacks.

The normal clamp observes only **256 pt** native measuring heights. Both removed
measurement controls observe none. All modes report the same 256 pt shared
calibration; only `no-hidden-text` uses it to seed clamp State.

## App-scoped CPU capture

One separate Time Profiler + Points of Interest capture per mode scopes the
app's main-thread CPU weights to five cold and five repeat reveal signposts,
each +0..180 ms. Startup and finish are excluded. Total CPU includes samples
without backtraces; attribution requires a stack. These are corroborating
captures, not repeated CPU benchmarks or a SwiftUI cause graph. Inclusive graph,
layout, and TextKit regions overlap; **do not add their columns**.

| Control | Cold main CPU | Graph update | Layout sizing | Selection/TextKit | Repeat main CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original clamp | 258 ms | 197 ms | 140 ms | 50 ms | 60 ms |
| No per-row measuring Text | 252 ms | 189 ms | 121 ms | 26 ms | 66 ms |
| No clamp layout path | 197 ms | 149 ms | 97 ms | 23 ms | 58 ms |

Without measuring Text, selection/TextKit weights fall **50→26 ms** and layout
weights **140→121 ms**, but total cold main CPU only falls **258→252 ms (2.3%)**.
This capture supports a TextKit/layout contribution, not a 28% total-CPU saving.
The repeated unprofiled callback comparison is the stronger evidence for the
observed scheduling improvement.

Bypassing the remaining clamp reduces this capture's total cold main CPU from
**252 to 197 ms (21.8%)**, with graph **189→149 ms** and layout **121→97 ms**.
That is real sampled work removed in this capture even though the callback-gap
comparison shows no consistent incremental gain. Do not conclude that the
remaining clamp is free, or that every removed modifier should be deleted.
Substantial graph/layout work remains. Generic framework symbols cannot assign
that residual to a particular rich-row child.

## Native actions and limits

One team-signed Debug build runs **18 existing native tests per mode**, all
**54 passed**, zero failures/skips: context-menu and hover-delay suites. The
copied tests mount OriginalMessageRowView with prepared documents, including
bold, italic, inline code, and a link. Coverage includes body/quote/code/control
click menus, selected-text copy, callbacks, editing menus, hover-pill ownership,
delete confirmation, and hover delay/scroll suppression. These action checks
are not quote-clamp parity, exhaustive reaction-picker/VoiceOver/focus coverage,
or verification of actual link activation.

Original selection, inline attributes, and URL routing remain; actual link
activation and long-body expansion are unverified. Static reveal controls also
do not verify production scroll gestures, older-page anchoring, streaming, or
saved position restoration. No production optimization ships in this PR.

Release/Debug builds, strict team-signature checks, SwiftFormat, strict SwiftLint,
Python/shell syntax, and the seven scrolling-harness tests pass. Normal commit
hooks run Biome and Typecheck. Task-launched profile and native test hosts are
closed after verification.

## Reproduce

```bash
bash apps/apple/prototypes/lazy-prepend/build.sh /tmp/swiftui-clamp --rich-clamp
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-clamp/ScrollReproduction.app /tmp/swiftui-clamp-results \
  --rich --cold-repeat --clamp-comparison --row-count 8 --pairs 3 --check-budget
```

Allow about five minutes for the nine sequential processes after building. Exit
1 with `STALL` is expected while the 25 ms budget is exceeded. Use a fresh output
folder with `--diagnostics --pairs 1` to check geometry/calibration/reuse separately.
`--content-renderer no-hidden-text` or `no-clamp` selects a single control; both
require the `--rich-clamp` build and cold/repeat mode. Default remains Markdown.
Earlier `--content-comparison` uses the ordinary `--rich` build.

Raw evidence: [clamp-measurements.json](clamp-measurements.json).
Local native traces: `/tmp/swiftui-clamp-isolation-profiles-20261012`.
