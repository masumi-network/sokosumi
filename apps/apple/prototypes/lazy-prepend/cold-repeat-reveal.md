# Cold versus repeat rich-row reveal

New row realization carries more work than revisiting retained rows. Eight cold
rows reproduce a **79.4 ms** callback gap without inserting anything. This is a
reproduction finding, not a production optimization or a specific modifier fix.
Production LazyVStack and row actions remain unchanged.

## Controlled comparison

Measured on 2026-10-12, Homer, arm64, macOS 27.0.1 (26A434), Xcode 27.0
(27A266a), Release, Developer ID team **GVWN7HXYJB**. One signed binary serves
all counts. The original row shell is copied directly from production, with only
its type renamed. Existing rich-child control helpers remain in their normal
branches; this is not a wholly unmodified production app.

Every process preloads the same **48 rich row IDs 0–47**, plus seven 8,000 pt blank
spacers. All messages have identical content, sender, timestamp, and reactions;
only message/client identities differ. The compact corpus includes bold, italic,
inline code, a link, and one reaction. It does not include the previous mixed
corpus's images, code blocks, or quotes. All 600 prepared fixture messages have
fingerprint `e19e8c20fb544aa27e8d6f3348b6e5e248e1f1f0a09f41d3a811f47fdc50716e`.

Six groups contain 1, 2, 4, or 8 rows each; remaining rows sit beyond the final
blank spacer. Group zero is an explicit warm-up, outside callback collection.
SwiftUI initially evaluated it while estimating the stack, so labeling it cold
would have been wrong. Each of five measured groups is then revealed, moved out
of view into its preceding blank section, and revealed again. The array never
mutates. Exactly N rich IDs must be visible after each reveal; no rich IDs may
remain visible in the intervening blank viewport.

**Cold means first observed row-body realization after shared framework warm-up**,
not cold process/font/text caches. Group placement and warm-up size vary with N;
list count, content, spacer count, and the 1,100 × 800 pt viewport stay fixed.
Prepared Markdown exists before measurement. This isolates row realization from
parsing/networking/insertion, but does not separate construction from layout.

Three fresh-process cycles rotate order: 1/2/4/8, 2/4/8/1, 4/8/1/2. Processes run
sequentially, with diagnostics off and no task build, test, or profiler during
timing. Each window covers a mark through +700 ms. These are **main-thread
callback scheduling gaps, not presented-frame durations or FPS**.

## Callback gaps

Twelve unprofiled processes, **120 windows**: 15 cold and 15 repeat per count.
The fixed 25 ms diagnostic budget is exceeded in **41/60 cold** windows and
**13/60 repeat** windows. Repeat outliers remain; retention does not guarantee
smooth scrolling.

| Newly revealed rows | Cold median / worst | Repeat median / worst | Cold / repeat windows over 25 ms |
| --- | ---: | ---: | ---: |
| 1 | 22.4 / 32.0 ms | 16.8 / 36.3 ms | 4/15 / 3/15 |
| 2 | 23.6 / 40.0 ms | 17.1 / 33.4 ms | 7/15 / 3/15 |
| 4 | 33.8 / 50.3 ms | 17.7 / 33.3 ms | 15/15 / 4/15 |
| 8 | 59.5 / 79.4 ms | 20.6 / 46.4 ms | 15/15 / 3/15 |

Cold medians rise with newly realized row count despite a fixed total list size.
The strongest repeated delays occur during first realization of eight rows.
Absolute values must not be compared with earlier builds/corpora as an improvement.

## Observed state reuse

Four separate diagnostic processes add a UUID `@State` **inside**
`LifecycleMessageRowView`, generated from the same production shell. Body,
appear, and disappear records carry the actual stored token. Recording normal
Swift view initializer calls would not establish retained state.

- All 20 measured cold groups had **zero previously evaluated target IDs**.
- All **75/75** revisited rows kept the same UUID after disappearing/reappearing:
  5/5, 10/10, 20/20, and 40/40 for the four counts.
- Every row measured **84 pt**, with matching cold/repeat IDs and heights.
- Cold windows evaluated exactly N row bodies once: **75 evaluations** total.
  Repeat windows recorded **2 evaluations** total, both in one two-row group.

This proves observed state retention in the diagnostic clone. `onDisappear`
does not prove destruction/deallocation; UUID retention does not prove that every
native control or layout node survives. The uninstrumented timing renderer has
no added state or lifecycle callbacks, so reuse is not directly observed there.
Diagnostic timings and preliminary variable-total controls are excluded from
performance evidence.

## Scoped CPU evidence

Two separate native **Time Profiler + Points of Interest** captures use the same
Release binary with diagnostics off: one for 1 row, one for 8. Ten exact
`Repeat reveal` signposts per capture define +180 ms CPU scopes, five per phase.
Actual sample weights include samples without backtraces in totals. Attribution
is app-scoped, excluding startup, warm-up, blank jumps, and exit.

| Rows / phase | Main CPU across five windows | Graph update region | Layout sizing region | Selectable text / TextKit region |
| --- | ---: | ---: | ---: | ---: |
| 1 / cold | 78 ms | 61 ms | 35 ms | 8 ms |
| 1 / repeat | 34 ms | 17 ms | 1 ms | 0 ms |
| 8 / cold | 301 ms | 224 ms | 136 ms | 43 ms |
| 8 / repeat | 94 ms | 45 ms | 4 ms | 5 ms |

**Regions are inclusive and overlap; do not sum them.** These single captures
corroborate the repeated callback comparison, not a repeated CPU benchmark.
Graph updates and layout accompany the new-row cost. Named row-body functions
account for 1 ms in the one-row capture and 9 ms in the eight-row capture;
inlining/sampling prevent treating those as complete source-function costs.
No image decoding or code-block syntax capture appears in these reveal scopes.
Generic framework stacks do not isolate one modifier/child, and no SwiftUI
view/cause graph was captured. TextKit contributes but is not established as the
sole bottleneck. Profile callback gaps are excluded from the timing table.

## Row actions and verification

**18 existing native tests passed**, zero failures/skips, against
`OriginalMessageRowView`: 12 context-menu and 6 hover-delay tests. Only the two
copied test files substitute the original renderer; production tests are untouched.
Coverage includes body/quote/code/control-click menus, selection copy, callback
dispatch, editing menus, hover-pill row ownership, deletion confirmation in both
appearances, and hover delay/scroll suppression. This is not exhaustive coverage
of reaction-picker, focus, VoiceOver, or every alert lifecycle.

Release/Debug builds use the shared DerivedData and team signing. Strict signing,
SwiftFormat, strict SwiftLint, Python/shell syntax, and documentation references
passed. Normal commit hooks enforce Biome and Typecheck at commit. Static reveal tests do not
verify production gestures, streaming, older-page anchoring, or saved restoration;
those production paths are unchanged. The existing mixed-rich no-insertion runner
and the team-signed bare prepend runner also passed execution checks; their
timings are excluded from the table.

Raw runs, UUID/lifecycle records, CPU summaries, and native test summary are in
[cold-repeat-measurements.json](cold-repeat-measurements.json). Native traces
remain local at `/tmp/swiftui-cold-repeat-profiles-20261012`.

## Reproduce

```bash
bash apps/apple/prototypes/lazy-prepend/build.sh /tmp/swiftui-cold-repeat --rich
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-cold-repeat/ScrollReproduction.app /tmp/swiftui-cold-repeat-timing \
  --rich --cold-repeat --pairs 3 --check-budget
```

Allow about seven minutes for the 12 sequential timing processes, after the build.
`--check-budget` intentionally exits 1 if any reveal exceeds 25 ms. To verify
state retention/geometry separately, use a fresh output directory with
`--rich --cold-repeat --diagnostics --pairs 1` (about two minutes). The runner
rejects falsely cold rows, wrong visible counts, absent disappear/reappear events,
changed geometry, different fingerprints, or insertion. It reports retained and
recreated tokens without assuming reuse; changed tokens are a finding, not a
reason to silently drop a run.

The next useful control is to isolate rich-content construction/layout during
first realization with the same fixed-count protocol. Retain native actions and
avoid introducing production prewarming or estimated heights from this evidence.
