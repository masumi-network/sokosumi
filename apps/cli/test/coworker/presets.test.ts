import assert from "node:assert/strict";
import test from "node:test";

import {
  COWORKER_FRAMEWORK_PRESETS,
  describeRegisterNextStep,
} from "../../src/coworker/presets.js";

test("register next-step copy names a Coworker, not a Hire listing", () => {
  const preset = COWORKER_FRAMEWORK_PRESETS.find(
    (candidate) => candidate.id === "pi-sokosumi",
  );
  assert.ok(preset);
  const copy = describeRegisterNextStep(preset);
  assert.match(copy, /Coworker runtime/);
  assert.match(copy, /chat \+ Tasks/);
  assert.match(copy, /not a Hire Agent/);
});
