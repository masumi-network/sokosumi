import assert from "node:assert/strict";
import test from "node:test";

import { moveSelectionIndex } from "../../src/tui/select-input.js";

test("selector moves down and wraps at the end", () => {
  assert.equal(moveSelectionIndex(0, 1, 2), 1);
  assert.equal(moveSelectionIndex(1, 1, 2), 0);
});

test("selector moves up and wraps at the beginning", () => {
  assert.equal(moveSelectionIndex(1, -1, 2), 0);
  assert.equal(moveSelectionIndex(0, -1, 2), 1);
});

test("selector stays at zero when it has no items", () => {
  assert.equal(moveSelectionIndex(4, 1, 0), 0);
});
