"""Check the scrolling audit's CLI without building or launching the Mac app."""

import itertools
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


HARNESS = Path(__file__).resolve().parents[1] / "docs/scrolling-performance-harness.md"
spec = importlib.util.spec_from_file_location(
    "runner", Path(__file__).with_name("run-scrolling-performance.py")
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def matrix():
    rows = []
    for view, count, mix in itertools.product(
        ("room", "thread"), (50, 500, 2000), ("plain", "mixed")
    ):
        common = {"view": view, "count": count, "mix": mix}
        rows.append({**common, "phase": "load"})
        rows.append({
            **common, "phase": "early", "ticks": 30, "view_bodies": 2,
            "overlay_builds": 0, "prepare": [], "start_y": 3000, "end_y": 1200,
            "bodies_per_display_callback": {"total": 2, "n": 2, "p95": 1},
            "layout_ms": {"p95": 1}, "step_ms": {"p95": 17},
            "display_interval_ms": {"p95": 17}, "room_bodies": 2,
            "retired_bodies": 0,
        })
    return rows


class ScrollingPerformanceTests(unittest.TestCase):
    def check_matrix(self, rows):
        code = re.search(
            r"<!-- file: summarize.py -->\n```python\n(.*?)\n```",
            HARNESS.read_text(), re.S,
        ).group(1)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            (directory / "summarize.py").write_text(code)
            data = directory / "matrix.jsonl"
            data.write_text("".join(json.dumps(row) + "\n" for row in rows))
            return subprocess.run(
                [sys.executable, "-I", str(directory / "summarize.py"), str(data),
                 "--stable-projection", "--stable-matrix"],
                capture_output=True, text=True,
            )

    def test_matrix_requires_all_twelve_cases(self):
        complete = self.check_matrix(matrix())
        self.assertEqual(complete.returncode, 0, complete.stdout + complete.stderr)
        partial = self.check_matrix(matrix()[:2])
        self.assertNotEqual(partial.returncode, 0, "One case passed as a complete matrix")

    def test_duplicate_case_cannot_replace_a_missing_case(self):
        rows = matrix()
        rows[-2:] = rows[:2]
        self.assertNotEqual(self.check_matrix(rows).returncode, 0)

    def test_complete_matrix_still_requires_scrolling_without_rebuilds(self):
        for field, value in (("ticks", 0), ("overlay_builds", 1),
                             ("view_bodies", 0), ("end_y", 3000), ("prepare", [{}])):
            with self.subTest(field=field):
                rows = matrix()
                rows[1][field] = value
                self.assertNotEqual(self.check_matrix(rows).returncode, 0)

    def test_extraction_rejects_missing_or_duplicate_sources(self):
        document = HARNESS.read_text()
        for invalid in (document.replace("<!-- file: Probe.swift -->", ""),
                        document + "\n<!-- file: setup.py -->\n```python\npass\n```"):
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                with self.assertRaises(ValueError):
                    runner.extract_sources(invalid, output)
                self.assertEqual(list(output.iterdir()), [])

    def test_shell_filters_cannot_shrink_the_matrix(self):
        with patch.dict(os.environ, {"M6_COUNTS": "50", "M6_MIXES": "code",
                                     "M6_START_DELAY": "100000", "M6_ONLY": "lookup"}):
            env = runner.fixture_environment("thread", "projection")
        self.assertEqual(env["M6_COUNTS"], "50,500,2000")
        self.assertEqual(env["M6_MIXES"], "plain,mixed")
        self.assertEqual(env["M6_ONLY"], "projection")
        self.assertNotIn("M6_START_DELAY", env)

    def test_failed_command_preserves_logs_and_stops_the_run(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "command.log"
            with self.assertRaisesRegex(RuntimeError, "exited 7"):
                runner.run([sys.executable, "-c", "print('failure evidence'); raise SystemExit(7)"], output)
            self.assertIn("failure evidence", output.read_text())

    def test_timed_out_command_is_terminated(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "command.log"
            with self.assertRaises(subprocess.TimeoutExpired):
                runner.run([sys.executable, "-c",
                            "import os,time; print(os.getpid(), flush=True); time.sleep(30)"],
                           output, timeout=2)
            with self.assertRaises(ProcessLookupError):
                os.kill(int(output.read_text().strip()), 0)


if __name__ == "__main__":
    unittest.main()
