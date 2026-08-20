import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertHttps443,
  PORTLESS_CORE_NAME,
  PORTLESS_WEB_NAME,
  portlessNameFor,
} from "../portless-dev.mjs";

describe("portless names", () => {
  it("uses stable service names (worktree prefix still comes from portless get)", () => {
    assert.equal(PORTLESS_WEB_NAME, "web.sokosumi");
    assert.equal(PORTLESS_CORE_NAME, "core.sokosumi");
    assert.equal(portlessNameFor("web"), "web.sokosumi");
    assert.equal(portlessNameFor("core"), "core.sokosumi");
  });
});

describe("assertHttps443", () => {
  it("accepts https URLs on implicit 443", () => {
    assert.doesNotThrow(() => assertHttps443("https://web.sokosumi.localhost"));
    assert.doesNotThrow(() =>
      assertHttps443("https://main.core.sokosumi.localhost"),
    );
  });

  it("rejects http and non-443 ports", () => {
    assert.throws(
      () => assertHttps443("http://web.sokosumi.localhost:1355"),
      /expected https on port 443/,
    );
    assert.throws(
      () => assertHttps443("https://web.sokosumi.localhost:1355"),
      /not 443/,
    );
  });
});
