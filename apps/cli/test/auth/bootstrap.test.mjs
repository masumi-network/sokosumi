import assert from "node:assert/strict";
import test from "node:test";

import { selectBootRoute } from "../../src/auth/bootstrap.mjs";

test("selectBootRoute waits until auth resolves", () => {
  assert.equal(
    selectBootRoute({ authResolved: false, hasAuth: false }),
    "boot",
  );
  assert.equal(selectBootRoute({ authResolved: false, hasAuth: true }), "boot");
});

test("selectBootRoute shows auth or signed-in after resolve", () => {
  assert.equal(selectBootRoute({ authResolved: true, hasAuth: false }), "auth");
  assert.equal(
    selectBootRoute({ authResolved: true, hasAuth: true }),
    "signed-in",
  );
});
