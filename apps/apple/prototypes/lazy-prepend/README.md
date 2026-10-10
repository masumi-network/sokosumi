# SwiftUI prepend reproduction

Diagnostic app with two builds, sharing one `ScrollView`, one `LazyVStack`, stable
integer row IDs, and the same measurement loop. The bare build is dependency-free
text. The rich build reuses production message rendering in a disposable workspace.
Neither changes the production app or its Xcode project.

The subsequent [production transcript isolation](transcript-isolation.md) adds
the real components in a disposable Apple workspace. The full message row brings
back 60+ ms delays. Native ID anchoring failed older-page position retention;
no production fix is included here.

## Portable rich rows

From any checkout of this PR, using a fresh output directory:

```bash
bash apps/apple/prototypes/lazy-prepend/build.sh /tmp/swiftui-rich-rows --rich
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-rich-rows/ScrollReproduction.app \
  /tmp/swiftui-rich-results --rich --pairs 3 --check-budget
```

The build copies `apps/apple` into the output folder, substitutes the fixture entry
point, and compiles the actual `MessageRowView` and its children in Release. It
reuses the checkout's normal Derived Data; `REPRO_DERIVED_DATA` can select an existing
cache explicitly. The fixture flag is scoped to the copied app target. Production
sources, generated code, dependencies, and signing settings remain untouched.

Building needs this repository, Xcode 27, Python 3, and the same team certificate
as the bare build. A fresh cache may need SwiftPM package downloads. After building,
the app bundle can be copied elsewhere and run without the checkout, live Core/Web
services, credentials, or the earlier `/tmp` experiment directories. It is a local
team-signed profiling build, without distribution notarization.

The corpus contains 600 deterministic real message models: paragraphs, links,
code, images, quote thumbnails, and reactions. Every row uses a full sender header.
Callback-backed actions are unavailable; built-in participant and copy-link
interactions remain. Body Markdown is prepared before measurement; quote parsing
and media realization use the unchanged production components. PNG responses are
generated locally and intercepted by URLProtocol with
a fixed 50 ms delay.

Both directions start with the **same rows 0–99**, then insert the **same page
contents and IDs** (100–199, 200–299, and so on). Only the insertion end differs.
The runner checks a SHA-256 fingerprint of the complete message corpus across all
runs. There is no reader, target layout, position binding, or correction.

Both viewports start at the top. Prepended rows become visible; appended rows are
offscreen. The comparison therefore includes the cost of realizing rich rows;
it does not isolate an insertion-algorithm defect. This is an at-rest diagnostic,
not verification of production scrolling, streaming, or position restoration.

Allow about 90 seconds for three sequential pairs after the build. To inspect the
initial rows without timed insertion or automatic exit:

```bash
REPRO_INSPECT=1 /tmp/swiftui-rich-rows/ScrollReproduction.app/Contents/MacOS/ScrollReproduction
```

## Rich-row results

Measured 2026-10-10 on macOS 27.0.1 (26A434), Xcode 27.0 (27A266a), arm64,
Release, team GVWN7HXYJB. The app was copied to a different directory before running;
its source workspace was not needed at runtime. Three alternating pairs completed
30 publications, all with 600 final rows and the same corpus fingerprint.
Raw results and launch order are in [rich-measurements.json](rich-measurements.json).

| Direction | Median window maximum | Worst callback gap | Windows over 25 ms |
| --- | ---: | ---: | ---: |
| Prepend | 47.5 ms | 71.7 ms | 15 / 15 |
| Append | 16.5 ms | 16.7 ms | 0 / 15 |

Per-run prepend maxima were 51.7, 54.8, and 71.7 ms. Nonpublication maxima were
21.3 ms for both directions. The rich fixture **reproduces the production stall's
60–83 ms range**, without production fetching, anchoring, or position correction.
This narrows the investigation to rich-row realization/layout under a prepend;
it does not identify one faulty component or prove a SwiftUI defect. Identical
incoming content does not eliminate the visible-versus-offscreen difference.

A separate fresh plain-row control pair completed ten publications below 25 ms:
prepend median 21.0 ms / worst 24.4 ms; append median 8.5 ms / worst 21.0 ms.
This is a control screen, not a repeat of the original three-pair baseline below.
Callback cadence varied in this session; the fixed 25 ms budget is a diagnostic
threshold, not a display-independent frame deadline.

Verified the relocated signed app, rendered local image/code/quote/reaction rows,
six rich runs and two plain control runs, final counts/fingerprints, strict
SwiftLint, SwiftFormat, Python/shell syntax, and the doc-script-reference test.
No production behavior changed; streaming and position restoration are outside
this at-rest reproduction.

## Visible-row append control

The follow-up [visible-row isolation](visible-row-isolation.md) reveals the first
inserted row in both directions using the same nonanimated native scroll command:

```bash
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-rich-rows/ScrollReproduction.app \
  /tmp/swiftui-visible-results --rich --reveal-rows --pairs 3 --check-budget
```

The historical paired viewports show identical rich-row IDs: prepend median 58.4 ms /
worst 76.4 ms; visible append median 55.5 ms / worst 69.0 ms. All 30 windows exceed
25 ms. This includes reveal and realization work. Offscreen appends were cheaper
because they avoided that work.

The copied sources include optional `--omit body-selection`, `--omit clamp`, and
`--omit code-highlighting` controls. `--fixed-row-height` clips rows to diagnostic
160-point bounds. The default retains production behavior. None of these controls
reliably removed the stall; an apparent highlighting gain failed interleaving.
Native profiles localize graph/layout and extra prepend root/scroll sizing, but
provide no SwiftUI view/cause data. No single faulty child component is established.
See the linked report for raw data, confounds, and profiling commands.

## No-insertion control

Add `--no-insertion-control` to compare visible prepend, visible append, and
revealing preloaded rows. The third mode loads all 600 messages before measurement
and never changes the row array. All three modes reveal targets 100, 200, 300,
400, and 500 through the same nonanimated `ScrollViewReader.scrollTo` callback.
The runner rejects different corpus fingerprints or visible row IDs within each
comparison cycle.

```bash
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-rich-rows/ScrollReproduction.app \
  /tmp/swiftui-no-insertion-results --rich --reveal-rows \
  --no-insertion-control --pairs 3 --check-budget
```

Three cycles rotate the launch order: prepend/append/no-insertion,
append/no-insertion/prepend, then no-insertion/prepend/append. Allow about 135
seconds for nine sequential runs. The no-insertion control requires the rich
build and `--reveal-rows`. Direct launch uses `REPRO_DIRECTION=no-insertion` and
`REPRO_REVEAL_ROWS=1`.

The legacy raw JSON key `insertions` also holds the no-insertion measurement
windows. Those records explicitly contain `inserted_rows: 0` and `rows: 600`.
Summary `measurement_windows` and `windows_over_25_ms` cover all modes;
`publications` and `publications_over_25_ms` are zero for no-insertion.
Preloading data does not pre-render every lazy row. This control includes native
scroll/reveal, realization, layout, and subsequent asynchronous row updates.
It separates the need for insertion; it cannot isolate rendering from scrolling
or identify a particular child component by itself.

The [no-insertion follow-up](no-insertion-isolation.md) remeasures all three modes
with the common reveal callback. Median window maxima are 41.2 ms for prepend,
45.4 ms for append, and 41.4 ms without insertion. All 45 windows exceed 25 ms,
with matching visible IDs. Native profiles show comparable total main-thread CPU
and shared graph/layout work; prepend retains extra root/scroll sizing. See
[raw timings](no-insertion-measurements.json) and
[profile evidence](no-insertion-profile-summary.json) for the method and limits.

## Shared row-layout controls

The [shared rich-row isolation](rich-layout-isolation.md) compares the full row,
`--omit content-only`, and `--omit flat-markdown` with identical rich content,
visible IDs, and separately checked heights. The full row shell contributes
measurable graph/layout work, but content-only still stalls. Singleton Markdown
wrapper removal gives little consistent benefit; no production fix is included.

Additional screens use `--omit all-selection`, `--omit row-interactions`,
`--omit row-alerts`, and `--omit flat-text`. Controls change only copied source.
Use `--direction no-insertion --pairs 1` for one fresh component screen and
`--diagnostics` for separate height/evaluation checks. Diagnostics are off by
default. Repeat and interleave against a fresh same-build `--omit none` baseline.
See the report for the 27-run three-way comparison, CPU profiles, and limits.

## Row-shell component controls

The [row-shell follow-up](row-shell-isolation.md) tests state, font metrics, hover,
accessibility, menu sizing, alerts, content branches, and decorative overlays.
An original row-shell control checks diagnostic scaffolding. The final 36-run
comparison reproduces stalls with the original shell; combining the overlays
preserves native actions but worsens repeated gaps. Eight CPU captures locate
shared graph/layout work without a reliable single-component attribution.

All controls use identical rich rows. Separate checks verify matching heights;
86 existing native action tests pass. These are diagnostic variants, not a
production change. Raw timings and CPU evidence are linked in the report.

## Run

Requires an Apple Silicon Mac on macOS 26+ and Xcode 27. The build script uses the
existing **utxo AG team GVWN7HXYJB** Developer ID certificate. It never falls back
to ad-hoc signing. The local profiling entitlement permits Instruments attachment;
this app is not a distribution build.

From the repository root:

```bash
bash apps/apple/prototypes/lazy-prepend/build.sh /tmp/swiftui-prepend-reproduction
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-prepend-reproduction/ScrollReproduction.app \
  /tmp/swiftui-prepend-wrapped --pairs 3 --check-budget
```

Allow about 90 seconds for three sequential pairs. A visible native window opens
and closes for every run. Use a fresh output folder. `--check-budget` exits 1 when
any insertion exceeds a 25 ms main-thread callback gap; that is the expected red
signal when a stall reproduces, not a failed app build.

Single-line control:

```bash
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-prepend-reproduction/ScrollReproduction.app \
  /tmp/swiftui-prepend-single-line --pairs 3 --single-line
```

For one run, launch the signed executable directly with `REPRO_DIRECTION=prepend`
or `REPRO_DIRECTION=append`. It defaults to prepend. `REPRO_SINGLE_LINE=1` selects
short text; `REPRO_PAGE_SIZE=30` reduces each page from 100 to 30 rows.

## Method

In the default offscreen comparison, each fresh process starts with 100 rows,
waits three seconds, then publishes five
100-row pages, ending at 600 rows. The same text generator and layout serve both
directions. Both directions start with the viewport at the top. Each page waits one second,
inserts, then waits one second. SwiftUI handles the resulting layout without a
scroll reader, explicit row `.id` modifier, scroll binding, geometry observer,
animation, or position correction. Incoming page allocation occurs before the publication
marker; array mutation remains inside the measured window. This measures at-rest insertions, not scrolling gestures.

Pair order alternates prepend/append and append/prepend. Processes run sequentially;
no build or other measurement runs during publication windows. Keep the Mac awake
and avoid interacting with the floating measurement window.

An `NSView` display link records actual main-thread callback times. Each result
reports the longest interval overlapping publication through +700 ms. These are
**callback scheduling gaps, not presented-frame hitch durations or FPS**. The
25 ms red budget is a fixed diagnostic threshold; callback cadence can vary,
and it is not a universal threshold for other displays. The nonpublication maximum
covers the intervals outside publication windows; no gesture benchmark runs here.

## Results

Measured 2026-10-10 with macOS 27.0.1 (26A434), Xcode 27.0 (27A266a), arm64,
optimized Swift 6 compilation, and team signing. Raw per-publication results and
summaries are in `measurements.json`. Profiler runs are separate from these pairs.

The final bare view's wrapped-text pairs produced the following publication-window
maxima (three fresh runs per direction per mode, five publications each):

| Text mode | Direction | Median window maximum | Worst gap | Windows over 25 ms |
| --- | --- | ---: | ---: | ---: |
| Wrapped | Prepend | 16.9 ms | 32.4 ms | 3 / 15 |
| Wrapped | Append | 16.7 ms | 32.3 ms | 2 / 15 |
| Single line | Prepend | 33.3 ms | 33.3 ms | 12 / 15 |
| Single line | Append | 16.7 ms | 33.3 ms | 1 / 15 |

All three wrapped prepend outliers occurred on the first publication. Single-line
prepends were more consistently delayed, despite simpler text; that mode fits more
rows in the viewport. Both directions occasionally missed a callback. **This does not reproduce the production app's
60–83 ms older-page stalls or establish a SwiftUI defect.** It supplies a small,
runnable control for further isolation, rather than a production performance fix.

During minimization, a scroll-reader/reset variant produced a stronger difference
(wrapped prepend median 20.5 ms, worst 47.2 ms, 5/15 over budget; append median
16.7 ms, worst 17.0 ms, 0/15). Removing the reader removed that larger outlier;
the smallest app is the final artifact. A single pair with native animated
bottom/top scrolling before the first insertion stayed under 25 ms in both
directions (prepend worst 24.1 ms; append 16.8 ms). This was a screen, not repeated
proof about normal scrolling. Those controls remain in the local measurement
artifacts; they are not alternate implementations in this app.

Verified the signed optimized build, 12 native runs / 60 publications, final row
counts, strict SwiftLint, SwiftFormat, Python syntax, and shell syntax. No Sokosumi
production code or Xcode project settings changed.

Separate native Instruments SwiftUI-template captures of the final single-line
app recorded zero presentation hitches in both directions at rest. The profiler
callback windows peaked at 33.8 ms for prepend and 16.8 ms for append. The append
trace reported one late 369.6 ms microhang at 14.715 seconds; that is recorded
separately from the publication callback comparison. Both traces reported no
SwiftUI data, so neither supplies a cause graph or view-update diagnosis. Zero
reported hitches in a stationary view does not prove animated scrolling is smooth.
Raw traces are local at `/tmp/swiftui-prepend-bare-20261010/{prepend,append}.trace`.
No Apple Feedback report was submitted.
