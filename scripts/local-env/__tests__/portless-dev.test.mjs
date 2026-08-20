import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertHttps443,
  envForDevApp,
  PORTLESS_CORE_NAME,
  PORTLESS_WEB_NAME,
  parseRunApps,
  portlessNameFor,
  spawnPlan,
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

describe("parseRunApps", () => {
  it("runs core then web when no selector is given", () => {
    assert.deepEqual(parseRunApps(), ["core", "web"]);
    assert.deepEqual(parseRunApps(undefined), ["core", "web"]);
  });

  it("runs a single named app", () => {
    assert.deepEqual(parseRunApps("web"), ["web"]);
    assert.deepEqual(parseRunApps("core"), ["core"]);
  });

  it("rejects unknown selectors", () => {
    assert.throws(() => parseRunApps("api"), /run \[web\|core\]/);
  });
});

describe("envForDevApp", () => {
  const urls = {
    webUrl: "https://web.sokosumi.localhost",
    coreUrl: "https://core.sokosumi.localhost",
  };

  it("injects both named URLs into core", () => {
    assert.deepEqual(envForDevApp("core", urls), {
      WEB_APP_BASE_URL: urls.webUrl,
      BETTER_AUTH_URL: urls.coreUrl,
    });
  });

  it("injects both named URLs into web", () => {
    assert.deepEqual(envForDevApp("web", urls), {
      CORE_APP_BASE_URL: urls.coreUrl,
      WEB_APP_BASE_URL: urls.webUrl,
    });
  });
});

describe("spawnPlan", () => {
  const urls = {
    webUrl: "https://branch.web.sokosumi.localhost",
    coreUrl: "https://branch.core.sokosumi.localhost",
  };

  it("plans both apps by default, still wiring both URLs", () => {
    const plan = spawnPlan(undefined, urls);
    assert.deepEqual(
      plan.map((item) => item.app),
      ["core", "web"],
    );
    assert.equal(plan[0].name, "core.sokosumi");
    assert.equal(plan[0].filter, "@sokosumi/core");
    assert.equal(plan[0].env.WEB_APP_BASE_URL, urls.webUrl);
    assert.equal(plan[1].name, "web.sokosumi");
    assert.equal(plan[1].filter, "web");
    assert.equal(plan[1].env.CORE_APP_BASE_URL, urls.coreUrl);
  });

  it("plans web only without dropping core URL injection", () => {
    const [web] = spawnPlan("web", urls);
    assert.equal(web.app, "web");
    assert.equal(web.env.CORE_APP_BASE_URL, urls.coreUrl);
    assert.equal(web.env.WEB_APP_BASE_URL, urls.webUrl);
  });
});
