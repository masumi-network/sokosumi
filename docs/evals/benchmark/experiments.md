# Harness experiments

One row per harness experiment. Each one runs behind its own version flag on a test version, never a live one, and changes one thing at a time. It is measured on one pin against the same-pin control:

1. control: v39 + cmo-v26
2. plan loop only: v40 + cmo-v27
3. plan loop plus one experiment

Experiments get combined only after each has won alone.

**Kept** means it beat the control on both sets, with no newly failing journey and input tokens per turn no more than 10% worse. Anything else is **discarded**: the PR is closed and the reason is noted here. Each measurement gets its own dated file in this folder, linked from the Result column. Held-out results are totals only.

| Id        | Idea                                                                                                                                                      | Flag                      | PR                                                     | Result           | Kept?   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------ | ---------------- | ------- |
| Plan loop | Send an answer back once while its plan has open steps (done check)                                                                                       | `planLoop` (v40, cmo-v27) | #8340 (merged), #8411 (cmo-v27), #8413 (receipt check) | Not measured yet | Pending |
| E1        | Route steering: filter routes to what the workspace can do before asking Jev; on abstain, act and ask only about the one open detail                      | own flag on v40 / cmo-v27 | #8416                                                  | Not measured yet | Pending |
| E2        | Step focus selector: before each agent step, Jev picks inspect / act / verify / answer from a menu, each mapped to a tool bundle                          | own flag                  | not opened                                             | Not measured yet | Pending |
| E3        | Jev completion decider: when the agent wants to stop, Jev chooses finish / continue (names the open step) / ask the owner from Core receipts and the plan | own flag                  | not opened                                             | Not measured yet | Pending |
| E4        | Decision receipts + replay: record every Jev decision; replay stored scenarios under a changed policy (Jev only)                                          | own flag                  | not opened                                             | Not measured yet | Pending |
| E5        | Typed tool errors with one recovery hint per error class                                                                                                  | own flag                  | not opened                                             | Not measured yet | Pending |
| E6        | Ask only at the start: first measure where questions fall in stored turns; gate late questions only if they hurt                                          | own flag                  | not opened                                             | Not measured yet | Pending |
| B1        | Judge each rubric item in its own call, 3 votes (benchmark change, not bot): re-judge the stored turns of the baseline runs first                         | judge setting             | not opened                                             | Not measured yet | Pending |

Baseline for every row: [2026-11-26 real-Jev baseline](2026-11-26-real-jev-baseline.md).
