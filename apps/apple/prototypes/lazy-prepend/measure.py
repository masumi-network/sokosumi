#!/usr/bin/env python3
"""Sequential comparisons. Raw JSON remains beside the summary; no build runs during measurement."""
import argparse
import json
import os
from pathlib import Path
import statistics
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("app", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--pairs", type=int, default=3, help="Comparison cycles (three runs per cycle with the no-insertion control)")
parser.add_argument("--single-line", action="store_true")
parser.add_argument("--fixed-row-height", action="store_true", help="Clip rich content to diagnostic 160-point row bounds")
parser.add_argument("--reveal-rows", action="store_true", help="Reveal the same target rows in each compared mode")
parser.add_argument("--no-insertion-control", action="store_true", help="Also reveal the same rows in a preloaded 600-message transcript")
parser.add_argument("--direction", choices=["prepend", "append", "no-insertion"], help="Run only this mode for component screening")
parser.add_argument("--diagnostics", action="store_true", help="Record visible heights and one-second row evaluation counts (separate from release timings)")
parser.add_argument("--omit", choices=["none", "body-selection", "clamp", "code-highlighting", "all-selection", "row-interactions", "row-alerts", "flat-text", "flat-markdown", "content-only", "row-content", "hover-events", "hover-writes", "row-state", "row-metrics", "row-accessibility", "menu-sizing", "alert-host", "original-row", "row-overlays"], default="none", help="Omit one component in the copied rich build")
parser.add_argument("--rich", action="store_true", help="Require a build made with --rich")
parser.add_argument("--cold-repeat", action="store_true", help="Compare cold/repeat reveal of 1, 2, 4, and 8 identical rich rows without insertion")
parser.add_argument("--page-size", type=int, default=100)
parser.add_argument("--check-budget", action="store_true", help="Exit 1 if a measurement window exceeds the fixed 25 ms diagnostic budget")
args = parser.parse_args()
if args.cold_repeat:
    assert args.rich and not args.single_line and not args.fixed_row_height
    assert args.omit in ["none", "original-row"] and args.direction in [None, "no-insertion"]
    assert not args.no_insertion_control
    args.direction, args.reveal_rows, args.omit = "no-insertion", True, "original-row"
assert args.pairs > 0
assert args.rich or args.omit == "none", "Component controls need the rich build"
assert not args.no_insertion_control or (args.rich and args.reveal_rows), "No-insertion control needs visible rich rows"
assert not (args.direction and args.no_insertion_control), "Choose a single mode or the three-way comparison"
assert args.direction != "no-insertion" or (args.rich and args.reveal_rows), "No-insertion control needs visible rich rows"
assert not (args.rich and args.single_line), "Single-line mode is a bare-text control"
args.output.mkdir(parents=True, exist_ok=True)
assert not any(args.output.glob("*-*.json")), "Use a fresh output folder"
binary = args.app.resolve() / "Contents/MacOS/ScrollReproduction"
runs = []
directions = [args.direction] if args.direction else (["prepend", "append", "no-insertion"] if args.no_insertion_control else ["prepend", "append"])
conditions = [(direction, count) for count in ([1, 2, 4, 8] if args.cold_repeat else [None]) for direction in directions]
for pair in range(1, args.pairs + 1):
    # Rotate triples, or alternate pairs, to balance each mode's launch position.
    offset = (pair - 1) % len(conditions)
    order = conditions[offset:] + conditions[:offset]
    visible_ids = None
    visible_heights = None
    for direction, count in order:
        path = args.output.resolve() / f"{direction}-{'rows' + str(count) + '-' if count else ''}{pair}.json"
        env = dict(os.environ, REPRO_DIRECTION=direction, REPRO_OUTPUT=str(path),
                   REPRO_SINGLE_LINE=str(int(args.single_line)), REPRO_PAGE_SIZE=str(args.page_size), REPRO_INSPECT="0", REPRO_REVEAL_ROWS=str(int(args.reveal_rows)), REPRO_OMIT=args.omit, REPRO_FIXED_ROW_HEIGHT=str(int(args.fixed_row_height)), REPRO_DIAGNOSTICS=str(int(args.diagnostics)))
        env.pop("REPRO_REPEAT_ROW_COUNT", None)
        if count:
            env["REPRO_REPEAT_ROW_COUNT"] = str(count)
        completed = subprocess.run([str(binary)], env=env, capture_output=True, text=True, timeout=50 if count else 40, check=True)
        path.with_suffix(".stderr.log").write_text(completed.stderr)
        result = json.loads(path.read_text())
        assert result["direction"] == direction and result["page_size"] == args.page_size
        assert result["single_line"] == args.single_line
        assert result.get("fixed_row_height", False) == args.fixed_row_height
        assert result.get("omitted_component", "none") == args.omit
        assert result.get("reveal_rows", False) == args.reveal_rows
        assert result["diagnostics"] == args.diagnostics
        if count:
            assert result["repeat_row_count"] == count and result["final_rows"] == 48
            assert len(result["insertions"]) == 10 and result["callback_count"] > 100
            for index, row in enumerate(result["insertions"]):
                target = (index // 2 + 1) * count
                assert row["page"] == index + 1 and row["rows"] == 48 and row["inserted_rows"] == 0
                assert row["phase"] == ("cold" if index % 2 == 0 else "repeat")
                assert row["revealed_row"] == target and row["visible_row_ids"] == list(range(target, target + count))
                if args.diagnostics:
                    assert len(row["visible_row_heights"]) == count and all(height > 0 for height in row["visible_row_heights"])
                    assert sum(row["visible_row_heights"]) <= result["viewport_height"] + 0.5, "Rows do not fully fit"
                    ids = [f"repeat-{value}" for value in row["visible_row_ids"]]
                    assert sorted(row["state_tokens"]) == sorted(ids)
                    if index % 2 == 0:
                        assert row["previously_evaluated_ids"] == [], "Cold rows were evaluated before reveal"
                    else:
                        assert sorted(row["previously_evaluated_ids"]) == sorted(ids)
                        cold = result["insertions"][index - 1]
                        assert all(abs(a - b) <= 0.5 for a, b in zip(row["visible_row_heights"], cold["visible_row_heights"]))
                        # Retained State is observed, not assumed from stable ForEach IDs.
                        reused = [value for value in ids if row["state_tokens"][value] == cold["state_tokens"][value]]
                        events = result["lifecycle_events"]
                        for value in ids:
                            assert any(event["id"] == value and event["event"] == "disappear" and cold["uptime"] < event["uptime"] < row["uptime"] for event in events), "Row did not disappear between reveals"
                            assert any(event["id"] == value and event["event"] == "appear" and row["uptime"] <= event["uptime"] <= row["uptime"] + 1 for event in events), "Repeat did not reappear"
                        print(f"rows={count} group={index // 2}: retained {len(reused)}/{count} State tokens", flush=True)
            result["cycle"] = pair
        elif args.reveal_rows:
            if args.rich:
                assert [row["revealed_row"] for row in result["insertions"]] == [100 + page * args.page_size for page in range(5)]
                assert all(row["revealed_row"] in row["visible_row_ids"] for row in result["insertions"])
                current_ids = [row["visible_row_ids"] for row in result["insertions"]]
                assert visible_ids is None or current_ids == visible_ids, "Compared viewports show different rows"
                visible_ids = current_ids
                if args.diagnostics:
                    assert all(len(row["visible_row_heights"]) == len(row["visible_row_ids"]) and all(height > 0 for height in row["visible_row_heights"]) for row in result["insertions"])
                    current_heights = [row["visible_row_heights"] for row in result["insertions"]]
                    assert visible_heights is None or all(abs(a - b) <= 0.5 for actual, expected in zip(current_heights, visible_heights) for a, b in zip(actual, expected)), "Compared rows have different heights"
                    visible_heights = current_heights
            else:
                assert all("revealed_row" in row for row in result["insertions"])
        assert result.get("row_kind", "plain") == ("production-rich" if args.rich else "plain")
        if args.rich:
            assert len(result["input_fingerprint_sha256"]) == 64
            assert not runs or result["input_fingerprint_sha256"] == runs[0]["input_fingerprint_sha256"], "Fixture content differs between runs"
        if not count:
            expected_rows = 600 if direction == "no-insertion" else 100 + 5 * args.page_size
            assert result["final_rows"] == expected_rows
            assert [row["rows"] for row in result["insertions"]] == ([600] * 5 if direction == "no-insertion" else [100 + page * args.page_size for page in range(1, 6)])
            assert all(row["inserted_rows"] == (0 if direction == "no-insertion" else args.page_size) for row in result["insertions"])
            assert len(result["insertions"]) == 5 and result["callback_count"] > 100
        runs.append(result)
        values = [round(row["max_callback_gap_ms"], 1) for row in result["insertions"]]
        print(f"{direction} {pair}{' rows=' + str(count) if count else ''}: {values}", flush=True)
summary = {}
for direction, count in conditions:
    for phase in (["cold", "repeat"] if count else [None]):
        selected = [run for run in runs if run["direction"] == direction and run.get("repeat_row_count") == count]
        gaps = [row["max_callback_gap_ms"] for run in selected for row in run["insertions"] if row.get("phase") == phase]
        key = f"rows-{count}-{phase}" if count else direction
        summary[key] = {"measurement_windows": len(gaps), "publications": 0 if direction == "no-insertion" else len(gaps), "median_max_callback_gap_ms": statistics.median(gaps),
                              "worst_callback_gap_ms": max(gaps),
                              "windows_over_25_ms": sum(gap > 25 for gap in gaps),
                              "publications_over_25_ms": 0 if direction == "no-insertion" else sum(gap > 25 for gap in gaps),
                              "nonpublication_worst_callback_gap_ms": max(run["nonpublication_max_callback_gap_ms"] for run in selected)}
        if count and phase == "repeat" and args.diagnostics:
            pairs = [(run["insertions"][index - 1], run["insertions"][index]) for run in selected for index in range(1, 10, 2)]
            summary[key]["retained_state_rows"] = sum(cold["state_tokens"][value] == repeat["state_tokens"][value] for cold, repeat in pairs for value in cold["state_tokens"])
            summary[key]["observed_state_rows"] = len(pairs) * count
(args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))

if args.check_budget and any(value["windows_over_25_ms"] for value in summary.values()):
    raise SystemExit("STALL: measurement window exceeded the 25 ms callback budget")
