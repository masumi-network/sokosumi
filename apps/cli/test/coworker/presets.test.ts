import assert from "node:assert/strict";
import test from "node:test";

import {
  describeRegisterNextStep,
  presetForKey,
} from "../../src/coworker/presets.js";

test("maps keys to Coworker framework presets", () => {
  const pi = presetForKey("1");
  const eve = presetForKey("2");
  const hermes = presetForKey("3");
  const openclaw = presetForKey("4");
  assert.ok(pi);
  assert.ok(eve);
  assert.ok(hermes);
  assert.ok(openclaw);
  assert.equal(pi.id, "pi-sokosumi");
  assert.equal(eve.id, "eve");
  assert.equal(hermes.id, "hermes");
  assert.equal(openclaw.id, "openclaw");
  assert.equal(presetForKey("9"), null);
});

test("register next-step copy names a Coworker, not a Hire listing", () => {
  const preset = presetForKey("1");
  assert.ok(preset);
  const copy = describeRegisterNextStep(preset);
  assert.match(copy, /Coworker runtime/);
  assert.match(copy, /chat \+ Tasks/);
  assert.match(copy, /not a Hire Agent/);
});
