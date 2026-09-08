import assert from "node:assert/strict";
import test from "node:test";

import { resolveHostedTargetConfig } from "../../src/tui/status-app.js";

test("TestV32 mainnet TUI selection overrides a preprod API URL", () => {
  const config = resolveHostedTargetConfig(
    { SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com" },
    "mainnet",
  );

  assert.equal(config.target, "mainnet");
  assert.equal(config.apiUrl, "https://api.sokosumi.com");
  assert.equal(config.authBaseUrl, "https://api.sokosumi.com/auth");
});
