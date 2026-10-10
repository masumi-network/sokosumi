#!/usr/bin/env python3
"""Sequential paired runs. Raw JSON remains beside the summary; no build runs during measurement."""
import argparse
import json
import os
from pathlib import Path
import statistics
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("app", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--pairs", type=int, default=3)
parser.add_argument("--single-line", action="store_true")
parser.add_argument("--rich", action="store_true", help="Require a build made with --rich")
parser.add_argument("--page-size", type=int, default=100)
parser.add_argument("--check-budget", action="store_true", help="Exit 1 if a publication exceeds the fixed 25 ms diagnostic budget")
args = parser.parse_args()
assert args.pairs > 0
assert not (args.rich and args.single_line), "Single-line mode is a bare-text control"
args.output.mkdir(parents=True, exist_ok=True)
assert not any(args.output.glob("*-*.json")), "Use a fresh output folder"
binary = args.app.resolve() / "Contents/MacOS/ScrollReproduction"
runs = []
for pair in range(1, args.pairs + 1):
    # Alternate launch order to reduce warm-up / order bias.
    for direction in (["prepend", "append"] if pair % 2 else ["append", "prepend"]):
        path = args.output.resolve() / f"{direction}-{pair}.json"
        env = dict(os.environ, REPRO_DIRECTION=direction, REPRO_OUTPUT=str(path),
                   REPRO_SINGLE_LINE=str(int(args.single_line)), REPRO_PAGE_SIZE=str(args.page_size), REPRO_INSPECT="0")
        completed = subprocess.run([str(binary)], env=env, capture_output=True, text=True, timeout=40, check=True)
        path.with_suffix(".stderr.log").write_text(completed.stderr)
        result = json.loads(path.read_text())
        assert result["direction"] == direction and result["page_size"] == args.page_size
        assert result["single_line"] == args.single_line
        assert result.get("row_kind", "plain") == ("production-rich" if args.rich else "plain")
        if args.rich:
            assert len(result["input_fingerprint_sha256"]) == 64
            assert not runs or result["input_fingerprint_sha256"] == runs[0]["input_fingerprint_sha256"], "Fixture content differs between runs"
        assert result["final_rows"] == 100 + 5 * args.page_size
        assert len(result["insertions"]) == 5 and result["callback_count"] > 100
        runs.append(result)
        values = [round(row["max_callback_gap_ms"], 1) for row in result["insertions"]]
        print(f"{direction} {pair}: {values}", flush=True)
summary = {}
for direction in ("prepend", "append"):
    selected = [run for run in runs if run["direction"] == direction]
    gaps = [row["max_callback_gap_ms"] for run in selected for row in run["insertions"]]
    summary[direction] = {"publications": len(gaps), "median_max_callback_gap_ms": statistics.median(gaps),
                          "worst_callback_gap_ms": max(gaps),
                          "publications_over_25_ms": sum(gap > 25 for gap in gaps),
                          "nonpublication_worst_callback_gap_ms": max(run["nonpublication_max_callback_gap_ms"] for run in selected)}
(args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))

if args.check_budget and any(value["publications_over_25_ms"] for value in summary.values()):
    raise SystemExit("STALL: publication exceeded the 25 ms callback budget")
