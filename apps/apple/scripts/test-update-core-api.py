"""Regression for extending an existing path without dropping its operations."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class UpdateCoreAPITests(unittest.TestCase):
    def test_adding_delete_preserves_patch_and_its_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "scripts/update-core-api.py"
            script.parent.mkdir()
            shutil.copyfile(Path(__file__).with_name("update-core-api.py"), script)
            target = root / "Packages/CoreAPI/Sources/CoreAPI/openapi.json"
            target.parent.mkdir(parents=True)
            patch = {"requestBody": {"$ref": "#/components/schemas/Edit"}}
            previous = {
                "paths": {"/messages/{id}": {"patch": patch}},
                "components": {"schemas": {"Edit": {"type": "string"}}},
            }
            target.write_text(json.dumps(previous))
            source = root / "source.json"
            specification = json.loads(json.dumps(previous))
            specification["paths"]["/messages/{id}"]["delete"] = {"responses": {}}
            source.write_text(json.dumps(specification))
            subprocess.run(
                [sys.executable, str(script), str(source), "/messages/{id}#delete"],
                check=True,
            )
            result = json.loads(target.read_text())
            self.assertEqual(set(result["paths"]["/messages/{id}"]), {"patch", "delete"})
            self.assertEqual(result["components"], previous["components"])


if __name__ == "__main__":
    unittest.main()
