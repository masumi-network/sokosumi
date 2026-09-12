import assert from "node:assert/strict";
import test from "node:test";

import { runAuthLogout } from "../../src/cli/auth-logout.js";

test("auth logout clears credentials and does not print tokens", async () => {
  const output: string[] = [];
  let cleared = false;
  const result = await runAuthLogout({
    authManager: {
      logout() {
        cleared = true;
      },
    },
    stdout: { write: (value) => output.push(value) },
    json: true,
  });

  assert.equal(cleared, true);
  assert.deepEqual(result, { authenticated: false });
  assert.deepEqual(JSON.parse(output.join("")), result);
});
