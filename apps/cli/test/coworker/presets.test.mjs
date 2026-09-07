import assert from "node:assert/strict";
import test from "node:test";

import {
  describeRegisterNextStep,
  presetForKey,
} from "../../src/coworker/presets.mjs";

test("maps keys to Coworker framework presets", () => {
  assert.equal(presetForKey("1").id, "pi-sokosumi");
  assert.equal(presetForKey("2").id, "eve");
  assert.equal(presetForKey("3").id, "hermes");
  assert.equal(presetForKey("4").id, "openclaw");
  assert.equal(presetForKey("9"), null);
});

test("register next-step copy names a Coworker, not a Hire listing", () => {
  const copy = describeRegisterNextStep(presetForKey("1"));
  assert.match(copy, /Coworker runtime/);
  assert.match(copy, /chat \+ Tasks/);
  assert.match(copy, /not a Hire Agent/);
});
