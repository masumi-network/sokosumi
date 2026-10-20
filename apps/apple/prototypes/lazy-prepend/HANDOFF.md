# Scroll performance handoff after the first release

Performance investigation is paused. Release the current production `LazyVStack`
implementation. This PR preserves development-only reproductions and evidence;
it includes no production optimization or app/project/dependency changes.

## Findings to carry forward

| Experiment | Result | Conclusion |
| --- | --- | --- |
| Plain versus rich rows; visible prepend, visible append, and preloaded reveal | Rich-row stalls also occur without insertion | Insertion direction alone does not explain the stalls. |
| Cold versus repeat reveal of 1/2/4/8 identical rich rows | Eight cold rows reach 79.4 ms; repeat median 20.6 ms; row State is retained | First realization is costly. State retention does not establish reuse of AppKit controls. |
| Hidden native measuring Text in the unchanged rich-row shell | Eight-row cold median 65.4 to 47.1 ms (28%); worst remains 69.1 ms | A contributor in the fixed reveal fixture, not a demonstrated production paging fix. |
| Live shared native height in production room/thread panes | Paging median 57 to 55 ms; mean 58.7 to 59.5 ms; worst 90 to 100 ms | No reliable paging improvement; keep the trial unapplied. |

All timings above are diagnostic main-thread callback gaps, not presented-frame
times or FPS. The reveal fixture uses a 25 ms comparison budget; the production
paging trial uses 33.4 ms. Keep the workloads and thresholds separate.

## Preserved material

- [Reproduction and earlier controls](README.md): portable plain/rich app, prepend
  and append, visible-row and no-insertion controls, row/layout isolation, and
  original raw artifacts. The app runs without live Core/Web or an account.
- [Cold/repeat findings](cold-repeat-reveal.md) and
  [clamp isolation](clamp-isolation.md): experiment methods, native-action checks,
  scoped CPU summaries, provenance, limits, and links to their raw measurements.
- [Shared-height trial](shared-height-trial/README.md): latest production findings,
  six raw paging runs, the exact unapplied source/test patch, and replay commands.

The shared-height attempt reduces observed per-row height callbacks from 77 to
zero, using two shared probes. Its native tests pass: 53 targeted cases and 2,227
broader app/package cases, with team signing. Eliminating those measurements did
not establish a paging speedup. Do not promote the fixed-corpus 28% result into a
production performance claim.

## Resume after release

1. Capture a stalled **production older-page publication** using Instruments
   SwiftUI and Time Profiler, in a team-signed Release build. Reproduce the current
   shipping app first; the recorded paging workload is a historical control.
   Scope the capture to publication and the ensuing layout/reading-position
   correction. Completion: a trace with the stalled interval and dominant
   main-thread stacks, separating row construction, text layout, and correction.
2. Change only the dominant component. Keep `LazyVStack`, Markdown, native
   selection, row actions, quote clamps, and font changes. Completion: a small
   implementation diff whose removed work appears in the scoped trace.
3. Repeat paired unprofiled paging runs, then the native correctness checks in
   the trial replay guide. Verify normal room/thread scrolling, automatic older
   loading, deferred insertion, streaming, and reading-position restoration.
   Completion: repeatable improvement beyond baseline variation, with all relevant
   tests passing, before proposing a production PR.

No new experiment is needed to complete this handoff. Measurements and patches
are versioned here; future work does not depend on old local worktrees, `/tmp`
profiles, or this conversation.
