#!/usr/bin/env python3
"""Build the account-free scrolling harness and check its complete short matrix."""

import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import tempfile


REPOSITORY = Path(__file__).resolve().parents[3]
APPLE = REPOSITORY / "apps/apple"
HARNESS = APPLE / "docs/scrolling-performance-harness.md"
SOURCES = {"setup.py", "Probe.swift", "summarize.py", "Geometry.swift", "trace_stacks.py"}


def extract_sources(document, output):
    files = re.findall(r"<!-- file: ([\w.]+) -->\n```\w+\n(.*?)\n```", document, re.S)
    if len(files) != len(SOURCES) or {name for name, _ in files} != SOURCES:
        raise ValueError("Harness must contain each of its five named source files exactly once")
    for name, code in files:
        (output / name).write_text(code + "\n")


def run(command, output, *, env=None, timeout=1800):
    """Keep complete logs; terminate only this command's process group on interruption."""
    errors = output.with_suffix(".stderr.log")
    with output.open("w") as stdout, errors.open("w") as stderr:
        process = subprocess.Popen(command, stdout=stdout, stderr=stderr, env=env,
                                   start_new_session=True)
        try:
            status = process.wait(timeout=timeout)
        except (KeyboardInterrupt, subprocess.TimeoutExpired):
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
    if status:
        raise RuntimeError(f"{Path(command[0]).name} exited {status}; see {output} and {errors}")


def fixture_environment(view, mode):
    # Shell smoke-test filters must not silently reduce the audited matrix.
    env = {key: value for key, value in os.environ.items() if not key.startswith("M6_")}
    env.update(M6_VIEW=view, M6_ONLY=mode,
               M6_COUNTS="50,500,2000" if mode == "projection" else "50",
               M6_MIXES="plain,mixed" if mode == "projection" else "plain")
    return env


def read_records(path):
    return [json.loads(line) for line in path.read_text().splitlines()
            if line.lstrip().startswith("{")]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def measure(output, binary, mode):
    for view in ("room", "thread"):
        print(f"  {mode}: {view}", flush=True)
        run([str(binary)], output / f"{mode}-{view}.jsonl",
            env=fixture_environment(view, mode), timeout=600)
    combined = output / f"{mode}.jsonl"
    combined.write_text("".join((output / f"{mode}-{view}.jsonl").read_text()
                                for view in ("room", "thread")))
    return combined


def audit(output, derived_data):
    python = [sys.executable, "-I"]  # Keep assertions active even with PYTHONOPTIMIZE set.
    print("[1/5] Extracting probes and copying Apple sources", flush=True)
    extract_sources(HARNESS.read_text(), output)
    run(python + [str(output / "setup.py"), str(REPOSITORY)], output / "setup.log")
    workspace = output / "apple/Sokosumi.xcworkspace"
    build_options = ["-scheme", "Sokosumi", "-configuration", "Release", "-destination",
                     f"platform=macOS,arch={platform.machine()}", "-skipPackagePluginValidation"]
    if derived_data is None:
        # Ask the original workspace for its normal cache instead of creating one per run.
        run(["xcodebuild", "-workspace", str(APPLE / "Sokosumi.xcworkspace"),
             *build_options, "-showBuildSettings", "-json"], output / "settings.json")
        settings = json.loads((output / "settings.json").read_text())
        settings = next(item["buildSettings"] for item in settings if item["target"] == "Sokosumi")
        products = Path(settings["BUILD_ROOT"])
        if products.parts[-2:] != ("Build", "Products"):
            raise ValueError("Custom Xcode build location; pass --derived-data explicitly")
        derived_data = products.parent.parent
    derived_data = derived_data.expanduser().resolve()
    if derived_data == APPLE or APPLE in derived_data.parents:
        raise ValueError("DerivedData must be outside apps/apple")
    run(["xcodebuild", "-workspace", str(workspace), *build_options,
         "-derivedDataPath", str(derived_data), "-list", "-json"], output / "schemes.json")
    schemes = json.loads((output / "schemes.json").read_text())["workspace"]["schemes"]
    if "Sokosumi" not in schemes:
        raise RuntimeError("Copied workspace has no Sokosumi scheme")

    print(f"[2/5] Building Release harness (DerivedData: {derived_data})", flush=True)
    run(["xcodebuild", "-workspace", str(workspace), *build_options,
         "-derivedDataPath", str(derived_data), "ENABLE_CODE_COVERAGE=NO",
         "CLANG_ENABLE_CODE_COVERAGE=NO", "DEVELOPMENT_TEAM=", "CODE_SIGN_IDENTITY=-",
         "ONLY_ACTIVE_ARCH=YES", "PRODUCT_BUNDLE_IDENTIFIER=com.sokosumi.m6probe",
         "ENABLE_APP_SANDBOX=NO", "CODE_SIGN_ENTITLEMENTS=", "build"], output / "build.log")
    run(["ditto", str(derived_data / "Build/Products/Release/Sokosumi.app"),
         str(output / "Sokosumi.app")], output / "snapshot.log")
    binary = output / "Sokosumi.app/Contents/MacOS/Sokosumi"

    print("[3/5] Measuring all 12 scrolling cases", flush=True)
    matrix = measure(output, binary, "projection")
    run(python + [str(output / "summarize.py"), str(matrix),
                  "--stable-projection", "--stable-matrix"], output / "projection-check.log")
    print("[4/5] Checking live updates in both panes", flush=True)
    updates = measure(output, binary, "updates")
    run(python + [str(output / "summarize.py"), str(updates), "--updates"],
        output / "updates-check.log")

    print("[5/5] Recording results", flush=True)
    cases = [{key: row[key] for key in ("view", "count", "mix", "view_bodies", "overlay_builds")}
             for row in read_records(matrix) if row["phase"] == "early"]
    return {
        "cpu_work_check": "passed", "smoothness": "unmeasured",
        "scrolling_cases": cases,
        "live_update_checks": sum(len(row["passed"]) for row in read_records(updates)),
        "derived_data": str(derived_data),
        "harness_sha256": {name: sha256(output / name) for name in sorted(SOURCES)},
        "binary_sha256": sha256(binary),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="new artifact directory (default: a temporary directory)")
    parser.add_argument("--derived-data", type=Path,
                        help="reuse this Xcode cache (default: resolve the original workspace's cache)")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("The real-view harness requires macOS with Xcode 27 and a visible desktop")
    if args.derived_data:
        args.derived_data = args.derived_data.expanduser().resolve()
        if args.derived_data == APPLE or APPLE in args.derived_data.parents:
            parser.error("--derived-data must be outside apps/apple")
    if args.output:
        output = args.output.expanduser().resolve()
        if output == APPLE or APPLE in output.parents:
            parser.error("--output must be outside apps/apple so the source copy cannot include itself")
        if output.exists():
            parser.error("--output must be a new directory; existing artifacts are never overwritten")
    else:
        output = None

    # Serialize runner invocations even when they use different artifact/cache paths.
    lock_dir = Path.home() / "Library/Caches/com.sokosumi.scrolling-performance"
    lock_dir.mkdir(parents=True, exist_ok=True)
    with (lock_dir / "runner.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("Another scrolling-performance runner is active")
        if output is None:
            output = Path(tempfile.mkdtemp(prefix="sokosumi-scrolling-"))
        else:
            output.mkdir(parents=True)
        print(f"Artifacts: {output}", flush=True)
        summary = {"status": "failed", "smoothness": "unmeasured",
                   "started_at": datetime.now(timezone.utc).isoformat(),
                   "artifacts": str(output), "architecture": platform.machine(),
                   "macos": platform.mac_ver()[0], "runner_sha256": sha256(Path(__file__))}
        status = 1
        try:
            summary["revision"] = subprocess.check_output(
                ["git", "-C", str(REPOSITORY), "rev-parse", "HEAD"], text=True).strip()
            summary["apple_worktree_changes"] = subprocess.check_output(
                ["git", "-C", str(REPOSITORY), "status", "--short", "--", "apps/apple"],
                text=True).splitlines()
            summary.update(audit(output, args.derived_data))
            summary["status"] = "passed"
            status = 0
            print("PASS: 12 scrolling cases, zero projection rebuilds; 24 live-update checks. "
                  "Scrolling smoothness remains unmeasured.")
        except KeyboardInterrupt:
            summary["error"] = "Interrupted; active command terminated"
            status = 130
        except (OSError, ValueError, KeyError, StopIteration, RuntimeError, subprocess.SubprocessError) as error:
            summary["error"] = str(error)
        finally:
            summary["finished_at"] = datetime.now(timezone.utc).isoformat()
            (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        if status:
            print(f"FAIL: {summary['error']}", file=sys.stderr)
        print(f"Report: {output / 'summary.json'}")
        return status


if __name__ == "__main__":
    sys.exit(main())
