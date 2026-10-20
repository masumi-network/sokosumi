#!/usr/bin/env python3
"""Check the archived patch, raw results, and source preparation without building or profiling."""
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile

archive = Path(__file__).resolve().parent
repo = archive.parents[4]
data = json.loads((archive / "measurements.json").read_text())
runs = data["runs"]
assert [r["variant"] + "-" + str(r["cycle"]) for r in runs] == data["protocol"]["run_order"]
fingerprints = set()
for run in runs:
    result = run["result"]
    assert result["requests"] == 6 and result["messages_end"] == 600
    assert [p["messages"] for p in result["publication_windows"]] == [200, 300, 400, 500, 600]
    expected = (77, 0) if run["variant"] == "before" else (0, 2)
    assert (result["fallback_measurements"], result["shared_measurements"]) == expected
    fingerprints.add(result["input_fingerprint_sha256"])
assert len(fingerprints) == 1
for variant, expected in [("before", (57, 90)), ("after", (55, 100))]:
    gaps = [p["max_gap_ms"] for r in runs if r["variant"] == variant for p in r["result"]["publication_windows"]]
    assert (statistics.median(gaps), max(gaps)) == expected
    assert len(gaps) == 15 and all(g > data["budget_ms"] for g in gaps)
assert [v["passedCaseExecutions"] for v in data["verification"].values()] == [50, 53, 2227]
assert all(v["result"] == "Passed" and v["failedTests"] == 0 and v["skippedTests"] == 0
           for v in data["verification"].values())

with tempfile.TemporaryDirectory(prefix="shared-height-archive-") as temporary:
    work = Path(temporary)
    packed = work / "baseline.tar"
    with packed.open("wb") as output:
        subprocess.run(["git", "archive", data["baseline_commit"], "apps/apple"], cwd=repo, stdout=output, check=True)
    baseline = work / "baseline"
    baseline.mkdir()
    subprocess.run(["tar", "-xf", str(packed), "-C", str(baseline)], check=True)
    subprocess.run([sys.executable, str(archive / "build-paging.py"), str(baseline), str(work / "before"), "--prepare-only"], check=True)
    subprocess.run(["git", "apply", "--check", str(archive / "trial.patch")], cwd=baseline, check=True)
    subprocess.run(["git", "apply", str(archive / "trial.patch")], cwd=baseline, check=True)
    for path, expected in data["production_source_sha256"].items():
        assert hashlib.sha256((baseline / "apps/apple" / path).read_bytes()).hexdigest() == expected, path
    subprocess.run([sys.executable, str(archive / "build-paging.py"), str(baseline), str(work / "after"), "--prepare-only"], check=True)
    for variant in ["before", "after"]:
        source = work / variant / "AppleSource"
        for path, expected in data["paging_harness_source_sha256"][variant].items():
            assert hashlib.sha256((source / path).read_bytes()).hexdigest() == expected, (variant, path)
        entry = (source / "Sokosumi/App/SokosumiApp.swift").read_text()
        assert "link.timestamp" not in entry
        assert "HITCH_SCRIPTED_PAGES" in entry and "publication_windows" in entry
        assert "HitchProbe.publications.append" in (source / "Sokosumi/Chat/Timeline/RoomTimelineView.swift").read_text()
        if variant == "after":
            assert "HitchProbe.sharedMeasurements += 1" in (source / "Sokosumi/Chat/Rendering/SharedMessageClampMeasurements.swift").read_text()
print("Archive verified: patch applies, production hashes match, six raw runs agree, both replay sources prepare without Xcode.")
