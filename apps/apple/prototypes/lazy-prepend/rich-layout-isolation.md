# Shared rich-row reveal/layout isolation

The full `MessageRowView` shell is a measurable contributor. Removing it while
retaining the same production rich content lowers reveal costs, but does not
remove the stalls. Singleton Markdown stack/`ForEach` wrappers, text selection,
and alert modifiers do not individually explain the delays. No production fix
is justified by these controls.

This follows the [no-insertion control](no-insertion-isolation.md). All changes
stay in the standalone fixture and disposable copied sources. Production chat,
its interaction behavior, fetching, anchoring, and signing settings are untouched.

## Final comparison

Measured 2026-10-10 on Homer: Apple Silicon, macOS 27.0.1 (26A434), Xcode 27.0
(27A266a), Release, Developer ID team **GVWN7HXYJB**. Each mode/variant has three
fresh processes and 15 operation windows. Directions and variants rotate their
launch positions each cycle; the 27 runs are sequential. No task build or profiler
runs during these timings. Diagnostics are off.

| Row renderer | Visible prepend median / worst | Visible append median / worst | No insertion median / worst |
| --- | ---: | ---: | ---: |
| Full production row | 55.9 / 74.6 ms | 52.2 / 66.7 ms | 52.3 / 73.1 ms |
| Flatten singleton Markdown collections | 52.8 / 68.8 ms | 50.0 / 70.5 ms | 50.0 / 70.5 ms |
| Content-only row | 50.1 / 57.7 ms | 38.3 / 50.0 ms | 42.6 / 64.1 ms |

**All 135 windows exceed 25 ms.** These are actual main-thread callback scheduling
gaps overlapping the operation through +700 ms, not presented-frame hitch
durations or FPS. The fixed 25 ms threshold is diagnostic, not a universal display
deadline. Nonpublication gaps are retained separately in the raw records and are
not a gesture-scrolling benchmark.

Every run has the same corpus SHA-256, 600 final messages, and identical visible
IDs: five, five, eight, eight, and seven rows at the five targets. No-insertion
records always contain `rows: 600`, `inserted_rows: 0`; the array is never mutated.
Separate diagnostic runs check matching row heights within 0.5 pt. Controls do not
replace rich content with plain text or change viewport density.

The content-only renderer uses the actual production avatar/profile buttons,
sender/time header, Markdown, quote/thumbnail, and reactions, with the same
14/6/10 pt stack spacing and 4/12/8 pt padding. It removes the outer row's state,
environment reads, unused domain branches, hover/menu/accessibility/alert chrome.
This is a broad row-shell control, not a safe production replacement: removing
those features is not the proposed fix. The static fixture has none of the
missing deleted/editing/thought/outbound/skill/unfurl/result/thread variants.

The full shell's cost is clearest in append and no-insertion. Content-only lowers
the median in every cycle for those modes, but still exceeds budget in every
window. Prepend retains additional work; its third-cycle median is effectively
unchanged (50.0 versus 50.1 ms). Flattening singleton Markdown collections gives
small pooled differences and no consistent per-cycle benefit in no-insertion.
The rich-content cost remains after the shell is removed.

## Component screens and evaluation counts

Before the final comparison, fresh same-build screens tested these predictions:

1. If selection dominates, disabling both body and nested code/quote selection
   should clear the stalls.
2. If outer row interaction chrome dominates, removing that group should clear
   the stalls; then removing only its three alerts should reproduce that gain.
3. If dynamic singleton Markdown collections dominate, flattening them should
   clear the stalls without changing visible content.

None clears the stalls. The exact runs, including failed controls, are retained in
[rich-layout-measurements.json](rich-layout-measurements.json).

| Screen | Same-build full-row median / worst | Control median / worst | Result |
| --- | ---: | ---: | --- |
| All selection off, diagnostics on | 52.7 / 66.6 ms | 49.5 / 62.3 ms | All windows still over budget |
| Outer row interactions off, diagnostics on | 52.7 / 66.6 ms | 44.3 / 62.1 ms | Residual stalls; 14/15 over budget |
| Single text wrapper flattened, diagnostics on | 52.7 / 66.6 ms | 54.4 / 73.4 ms | No gain |
| Three row alerts off, diagnostics off | 54.6 / 66.7 ms | 50.1 / 69.8 ms | One cycle worse; not a reliable cause |
| Outer row interactions off, diagnostics off | 54.6 / 66.7 ms | 49.7 / 58.4 ms | Residual stalls; 14/15 over budget |
| Content-only, diagnostics off | 63.8 / 69.1 ms | 42.4 / 66.7 ms | Broad shell contribution; stalls remain |

Each screen has three processes and 15 windows per variant. **Do not compare
absolute timings across screens.** Extracted helpers, conditional view structure,
and diagnostic observers changed between builds. Every screen and the final
comparison has its own same-build `none` baseline.

Diagnostic counters reset at the operation marker and snapshot approximately
one second later, separately from the 700 ms timing window. Full-row controls
show only 5–11 unique `MessageRowView.body` evaluations per reveal, not 600.
Outer fixture render-helper evaluations can include more estimated/offscreen
rows; they are not full message bodies. Content-only intentionally does not
execute `MessageRowView.body`, so its empty body counter is not evidence that no
rows were created. Height observers and counters are **off by default** and are
not used for the final performance comparison.

## Native CPU profiles

Two separate app-scoped **Time Profiler + Points of Interest** captures compare
full and content-only rows without insertion, using the same Build 3 binary.
Unlike the earlier SwiftUI-template captures, these do not enable SwiftUI layout
tracing. They corroborate the broad row-shell cost without that tracing path's
extra work. They are one capture per variant, not repeated benchmark proof.

Each capture is scoped to five exact `Reveal page` signposts through +180 ms.
Native sample weights give the following CPU totals across those five windows:

| Sampled CPU region | Full row | Content-only |
| --- | ---: | ---: |
| All main-thread samples | 343 ms | 223 ms |
| SwiftUI graph update, inclusive | 242 ms | 148 ms |
| Layout sizing, inclusive | 131 ms | 90 ms |
| Selection/TextKit, inclusive | 46 ms | 35 ms |
| Root scroll sizing, inclusive | 4 ms | 6 ms |
| Syntax captures, background | 271 ms | 257 ms |
| PNG/image decoding, background | 187 ms | 178 ms |

Inclusive regions overlap; **do not sum them**. CPU totals include samples without
backtraces (these captures had none missing). The longest full-row callback gaps
have 75–93% sampled main-thread running coverage. This is CPU-heavy graph/layout
work, rather than evidence of a synchronous image decode or syntax parse on the
main thread. Background work can still compete for CPU.

Generic `AG::Graph`, `ForEach`, layout-engine, and AppKit hosting-layout stacks
cannot attribute the remaining cost to one child view. Time Profiler supplies
CPU stacks, not a SwiftUI view/cause graph; earlier SwiftUI-template captures
returned no such view/cause data. See [profile evidence](rich-layout-profile-summary.json)
for exact scopes, samples, gap coverage, and attribution limits. Raw captures
remain local at `/tmp/swiftui-rich-layout-profile-20261010/{none,content-only}`.

## Reproduce

Use the existing team certificate; no ad-hoc fallback or password prompt:

```bash
bash apps/apple/prototypes/lazy-prepend/build.sh /tmp/swiftui-rich-layout --rich
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-rich-layout/ScrollReproduction.app /tmp/layout-full \
  --rich --reveal-rows --no-insertion-control --pairs 3 --check-budget
```

Use fresh output folders with `--omit content-only` or `--omit flat-markdown`
for the corresponding three-way comparisons. Allow about 135 seconds per
variant. For component screening, use `--direction no-insertion --pairs 1`.
Repeat and interleave variants; the reported final experiment runs one direction
and one variant at a time, rotating both lists once per cycle:

```text
cycle 1: prepend / append / no-insertion × none / flat-markdown / content-only
cycle 2: append / no-insertion / prepend × flat-markdown / content-only / none
cycle 3: no-insertion / prepend / append × content-only / none / flat-markdown
```

The left list is the outer loop. Each invocation uses `--direction <mode>
--omit <variant> --pairs 1`; every fresh folder retains raw JSON. The fixed budget
command exits 1 for reproduced stalls; that is expected, not a build failure.
Direct launch equivalents are `REPRO_OMIT=<variant>` and `REPRO_DIAGNOSTICS=1`.
Use `--diagnostics` only for separate height/evaluation checks, not release timings.

To recapture CPU evidence, launch one signed variant per fresh trace directory:

```bash
xcrun xctrace record --template 'Time Profiler' --instrument 'Points of Interest' \
  --device Homer --output /tmp/layout-full.trace --time-limit 25s \
  --env REPRO_DIRECTION=no-insertion --env REPRO_REVEAL_ROWS=1 \
  --env REPRO_OUTPUT=/tmp/layout-full-profile.json --env REPRO_OMIT=none \
  --env REPRO_DIAGNOSTICS=0 --env REPRO_FIXED_ROW_HEIGHT=0 \
  --env REPRO_PAGE_SIZE=100 --env REPRO_INSPECT=0 \
  --launch -- /tmp/swiftui-rich-layout/ScrollReproduction.app/Contents/MacOS/ScrollReproduction
```

Replace `Homer` with the host Mac. Export the `time-profile` table with `xctrace`,
resolve referenced thread/stack records, and scope actual sample weights using
the five `Reveal page` signposts. Check for a stopped task-launched process after
recording ends and terminate it before launching the next variant.

## Verification and next boundary

Verified Release/team signing, 27 final runs / 135 windows, matching fingerprints
and visible IDs, zero array changes without insertion, separate equal-height
checks, component counters, and native CPU captures. SwiftFormat, strict
SwiftLint, Python/shell syntax, and doc-script-reference checks cover the fixture.

The remaining boundary is cold rich-row graph construction/layout, including a
measurable full-row shell contribution. This does not establish one defective
child component or a safe production optimization. Keep the reproduction as a
draft investigation. A production experiment must preserve row actions and state
identity and verify normal scrolling, older-page anchoring, streaming, and saved
position restoration. These static at-rest controls do not verify those flows;
flattened singleton-to-multiple transitions could recreate child state/tasks.
