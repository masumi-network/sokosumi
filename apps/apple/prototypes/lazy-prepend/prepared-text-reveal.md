# Prepared styled Text versus the Markdown pipeline

The direct styled-Text control keeps the original production row shell, selection,
link routing, participant popovers, reactions, and actions. It bypasses the rich
content hierarchy for the identical single-paragraph corpus. This is a diagnostic
control in the portable reproduction, not a production fast path.

## Method

Measured on 2026-10-12, Homer, arm64, macOS 27.0.1 (26A434), Xcode 27.0
(27A266a), Release, Developer ID team **GVWN7HXYJB**. Both renderers use one
signed binary. Production inputs are from commit
`30786b76d9f2675f2cc492dc32931035bce5e987`; the artifact records the measured
binary SHA-256. The PR subsequently received main merge `7ecb758c0` while delivery
was in progress. Its Apple differences are comments and unrelated file-local
visibility restrictions, not changes to this paragraph pipeline. All copied
renderer/shell/lifecycle/test transformation seams pass on the updated sources.
The timing and native results remain evidence from the measured build, not a
claim that the post-merge binary was remeasured. Prepared attributed text is extracted before measurement from the
same prepared document and uses the production styling function. Assertions
check the single paragraph, exact attachment-split text, and bold, italic, inline
code, and link attributes. Both conditions perform this preparation before
warm-up; parsing is outside the measured window.

The original shell is copied from production with only its type renamed. The
outer MessageMarkdownView still owns selection, URL routing, and participant
presentation. The direct branch replaces the ExpandableMessageBody, document
segments, block/attachment collections, and image-gallery subtree with one native
Text. It retains MessageMarkdownContent's task and state. It also moves attachment
splitting and the shared inline styling call out of the measured render path. This broad boundary
control cannot attribute a gain to one of the removed layers or to styling alone.

The fixed 48-row, seven-spacer protocol is the same as
[cold-repeat-reveal.md](cold-repeat-reveal.md): five untouched groups after an
explicit warm-up, cold/blank/repeat/blank, zero insertion. Cold means first
observed row-body realization after shared framework warm-up, not cold process
or font caches. All rows share the identical compact paragraph, sender, timestamp,
and reaction; only their identities differ. Exactly N IDs must be visible per
window. The viewport is 1,100 × 800 pt. The corpus fingerprint remains
`e19e8c20fb544aa27e8d6f3348b6e5e248e1f1f0a09f41d3a811f47fdc50716e`.

Eight rows were screened first in three fresh-process pairs, alternating
Markdown/Text, Text/Markdown, Markdown/Text. Smaller counts follow separately;
compare renderers within each count, not absolute values between count batches.
Diagnostics, build, tests, and profiler are absent during the unprofiled timing
runs. Main-thread callback gaps overlap each reveal mark through +700 ms; these
are not presented-frame durations or FPS.

## Callback comparison

Twenty-four unprofiled processes, **240 windows**, with 15 cold and 15 repeat
windows per renderer/count. Both renderers exceed the budget: 44/60 Markdown
cold windows versus 35/60 Text, and 7/60 Markdown repeat versus 12/60 Text.

| Rows | Markdown cold median / worst | Prepared Text cold median / worst | Markdown / Text repeat medians | Cold windows >25 ms, Markdown / Text |
| --- | ---: | ---: | ---: | ---: |
| 1 | 21.2 / 30.7 ms | 18.7 / 33.2 ms | 16.9 / 17.0 ms | 4/15 / 2/15 |
| 2 | 28.2 / 38.3 ms | 22.9 / 33.9 ms | 16.8 / 17.5 ms | 11/15 / 7/15 |
| 4 | 39.5 / 56.6 ms | 32.8 / 50.0 ms | 17.1 / 16.9 ms | 14/15 / 11/15 |
| 8 | 60.3 / 70.1 ms | 49.9 / 61.6 ms | 19.3 / 20.4 ms | 15/15 / 15/15 |

The eight-row pooled cold median falls **17.2%** (60.3 to 49.9 ms). All three
paired cold medians improve: 54.6→38.5, 64.9→56.7, 55.6→50.1 ms. The delta
shrinks across cycles. Every eight-row cold window still exceeds 25 ms; the
worst direct-text cold gap is **61.6 ms**. Repeat median is slightly higher
(19.3→20.4 ms), so this is not a general smoothness improvement.

Smaller-count pooled cold medians also fall, but per-cycle results are mixed:
Text wins 2/3 pairs for one and two rows, and only 1/3 for four. The four-row
cycle medians are 40.3→23.9, 32.7→32.8, and 39.5→41.7 ms. The pooled table
must not be used to claim a reliable gain at every count.


## State and geometry

Separate diagnostic processes verify identical IDs and heights, previously
unevaluated cold IDs, disappearance/reappearance, and stored UUID State tokens
inside the lifecycle clone. At eight rows, both renderers retained **80/80**
revisited tokens in total, every height was **84 pt**, and all ten measured cold
groups had zero previously evaluated target IDs. Timing uses the original shell without extra state
or lifecycle probes. UUID retention does not establish reuse of every native
control/layout node.

## Scoped CPU

Two separate native Time Profiler + Points of Interest captures use the same
Release binary, diagnostics off, eight rows. Ten exact Repeat reveal signposts
scope +180 ms windows, five per phase, excluding startup/blank jumps/exit.
Actual sample weights include stackless samples in totals; attributed regions
require backtraces. This is one capture per renderer, corroboration rather than
an independently repeated CPU benchmark. No SwiftUI cause graph was captured.

| Renderer / phase | Main CPU across five windows | Graph update | Layout sizing | Selectable text / TextKit |
| --- | ---: | ---: | ---: | ---: |
| Markdown / cold | 284 ms | 217 ms | 148 ms | 49 ms |
| Prepared Text / cold | 232 ms | 172 ms | 110 ms | 22 ms |
| Markdown / repeat | 67 ms | 42 ms | 1 ms | 2 ms |
| Prepared Text / repeat | 80 ms | 43 ms | 3 ms | 0 ms |

Regions are inclusive and overlap; **do not sum them**. The cold total falls
18.3% in these two captures. Generic graph/layout symbols do not isolate a
specific child. TextKit contributes but is not the sole cost.

## Native actions and limits

**18 existing native tests passed per renderer**, zero failures/skips: 12
context-menu and 6 hover-delay tests, on one team-signed Debug build. The copied
tests use OriginalMessageRowView and prepare/cache their paragraphs before
mounting them, so Text actually takes the direct branch. The menu fixture has
bold, italic, inline code, and a link while retaining the known selection
substring. Multi-block quote/code fixtures retain the Markdown fallback.
Coverage includes body/quote/code/control-click menus, selection copy, action
callbacks, editing menus, hover-pill ownership, deletion confirmation, and
hover delay/scroll suppression. It is not exhaustive reaction-picker, focus,
VoiceOver, or alert-lifecycle coverage.

A new link-activation probe was rejected because it did not work reliably in
the Markdown baseline: the text range frame was empty, pressing the rotor node
raised an unsupported-selector exception, and synthetic left-click probes did
not dispatch the URL reliably. That probe is removed from the portable harness.
**Actual link activation is unverified.** The exact URL/inline attributes and
outer routing implementation are preserved; this is not evidence of a product
link regression. Failed probe runs are excluded from timing and from the final
18-per-renderer verification summaries.

Release/Debug builds, strict signing, SwiftFormat, strict SwiftLint, Python/shell
syntax, and documentation-script references passed. Native traces and test hosts
launched by this task are closed after checks. Normal commit hooks run Biome and
Typecheck before commit.

Production files and behavior are unchanged. This static reveal test does not
verify production scrolling gestures, older-page anchoring, streaming, saved
position restoration, or long-body expansion. The direct control is restricted
to this single-paragraph experiment; multi-block native tests retain the normal
Markdown fallback. Do not ship it as a general renderer replacement.

## Reproduce

```bash
bash apps/apple/prototypes/lazy-prepend/build.sh /tmp/swiftui-prepared-text --rich
python3 apps/apple/prototypes/lazy-prepend/measure.py \
  /tmp/swiftui-prepared-text/ScrollReproduction.app /tmp/swiftui-prepared-text-timing \
  --rich --cold-repeat --content-comparison --row-count 8 --pairs 3 --check-budget
```

Allow about four minutes for the six sequential processes after the build.
The 25 ms diagnostic budget remains red if any measured gap exceeds it.
Use a fresh output directory with `--diagnostics --pairs 1` to verify geometry
and State separately. Omit `--row-count` to compare all four counts; allow about
14 minutes for three cycles. `--content-renderer prepared-text` selects a single
renderer for profiling; the default remains Markdown.

Raw evidence: [prepared-text-measurements.json](prepared-text-measurements.json).
Local native traces: `/tmp/swiftui-content-control-profiles-20261012`.

## Decision

The comparison supports investigating rich-content realization, particularly
eight rows. It does **not** justify a production renderer replacement: stalls
remain, smaller-count pairs are mixed, repeat cost does not improve, native link
activation is unverified, and long-body semantics still need attention. The next
narrow control should retain document/block structure while isolating
ExpandableMessageBody's clamp/hidden-text measurement work. Reuse the copied
clamp-control seam with the original row shell; retain native actions and avoid
production prewarming or estimated heights.
