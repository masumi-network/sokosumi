# Eval run: cmo-picture-layout

Local work, written by hand: a picture-prompt experiment run with a script against a local Core (`apps/core/.picfix/exp2.mts`, not committed). It has no eval run id, and its data lives in the local database `soko_picfix` and the agent's scratchpad.

- Date: 2026-11-21
- Run: none (local experiment, completed)
- Environment: local
- Commit: `9daccf9ae4` feat(core): make styled pictures look like the print they borrow from (#7815), plus cmo-v9 (#7817)
- Bots: none; the pieces come from a local cmo-v9 NMKR month (scenes and headlines unchanged across arms)
- Judge: Core's style check (`anthropic/claude-sonnet-5.5`) and a read by eye
- Repeats: 2 Muse Image tries per piece and arm; 1 GPT Image 2.6 try for the two best arms
- Cost: $6.78 (fal pictures, style checks, eight layout descriptions)

## Results

| Arm      | What the model gets                                                           | Passed | $ per passed |
| -------- | ----------------------------------------------------------------------------- | ------ | ------------ |
| A        | Today's prompt: copy the print's technique, era and lettering                 | 15/16  | 0.021        |
| B        | Reference as layout reference, composition in words, NMKR's look              | 7/16   | 0.047        |
| B2       | B with text slots limited to the headline and nmkr.io                         | 11/16  | 0.029        |
| C        | B, reference named a wireframe only                                           | 6/16   | 0.054        |
| D        | B, reference turned into a three-grey block map                               | 7/16   | 0.046        |
| D2       | D with text slots limited                                                     | 12/16  | 0.026        |
| E        | No reference image, composition in words only                                 | 3/16   | 0.109        |
| G        | NMKR's look only, no reference (control)                                      | 15/16  | 0.021        |
| F2       | C plus one big subject, green largest, logo in the header, text slots limited | 12/16  | 0.026        |
| H        | Keep layout and kind of picture, redrawn modern in NMKR's colours and type    | 9/16   | 0.035        |
| D2 · GPT | D2 on GPT Image 2.6                                                           | 8/8    | 0.219        |
| H · GPT  | H on GPT Image 2.6                                                            | 6/8    | 0.293        |

## Before and after

Baseline: arm A, today's prompt after #7815, on the same eight pieces. D2 keeps the reference's composition without its look at $0.026 per passed picture against A's $0.021.

## Failed cases

Most failures in B, C, D and E were invented words: the model filled the layout's small text lines with taglines, numbers and captions. These were 9, 6, 5 and 10 of the failed tries. A misdrawn or repeated logo caused 1 to 3 failures per arm. H also copied the reference's own figures twice.

## Why the failures happened

- The layout description names a type hierarchy (a big title, smaller lines), and the model fills every line it hears about. Naming the slots ("the largest slot takes the headline, one small slot takes nmkr.io, nothing else") raised passes from 7 to 11 (B) and from 7 to 12 (D).
- Words alone don't carry a layout (E): the reference image or its block map has to be sent.
- The style check was written for borrowing a print's style, so A and G pass most easily; the layout arms are judged on words, logo and colours, which still apply.

## Verdict

Don't ship yet; this is an experiment for Patrick to choose from. The proposal:

- The reference lends its layout as a block map.
- The text slots are named.
- The brand's look comes from a picture-style sentence Core writes from DESIGN.md.
- The kind of picture varies across the month, so pictures don't all become one flat style.
- References are chosen by a stored composition line.
- Muse stays first, with GPT Image as the remake.

## Links

- Results page with the full grid: https://claude.ai/artifact/T6PHRgXbkrMWX24T1qbypg
- Earlier runs: [2026-11-21-cmo-v9.md](2026-11-21-cmo-v9.md)
