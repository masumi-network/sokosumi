# SwiftUI prepend reproduction

Standalone diagnostic app. This is not part of the Sokosumi app or its Xcode workspace.
It uses one `ScrollView`, one `LazyVStack`, and stable integer row IDs. No network,
Markdown, media, authentication, position persistence, or custom anchoring.

The subsequent [production transcript isolation](transcript-isolation.md) adds
the real components in a disposable Apple workspace. The full message row brings
back 60+ ms delays. Native ID anchoring failed older-page position retention;
no production fix is included here.

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
signal on the measured 60 Hz Mac, not a failed app build.

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

Each fresh process starts with 100 rows, waits three seconds, then publishes five
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
25 ms red budget detects a missed approximately 16.7 ms callback on this 60 Hz Mac;
it is not a universal threshold for other displays. The nonpublication maximum
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
