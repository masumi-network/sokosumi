import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertHttps443,
  envForDevApp,
  PORTLESS_CORE_NAME,
  PORTLESS_WEB_NAME,
  parseRunApps,
  portlessAppName,
  portlessInstancePrefix,
  portlessNameFor,
  portlessSpawnArgs,
  spawnPlan,
} from "./portless-dev.mjs";

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
      BETTER_AUTH_COOKIE_DOMAIN: "sokosumi.localhost",
    });
  });

  it("injects both named URLs into web", () => {
    assert.deepEqual(envForDevApp("web", urls), {
      CORE_APP_BASE_URL: urls.coreUrl,
      WEB_APP_BASE_URL: urls.webUrl,
      BETTER_AUTH_COOKIE_DOMAIN: "sokosumi.localhost",
    });
  });
});

describe("portlessInstancePrefix", () => {
  it("prefixes grok and local worktree checkouts by directory basename", () => {
    assert.equal(
      portlessInstancePrefix(
        "/Users/x/.grok/worktrees/masumi-network-sokosumi/3877",
      ),
      "3877",
    );
    assert.equal(
      portlessInstancePrefix("/Users/x/sokosumi/.worktrees/chore-portless"),
      "chore-portless",
    );
  });

  it("leaves the primary checkout unprefixed", () => {
    assert.equal(
      portlessInstancePrefix("/Users/x/Developer/masumi-network/sokosumi"),
      "",
    );
  });

  it("skips basename when git already sees a linked worktree", () => {
    assert.equal(
      portlessInstancePrefix("/Users/x/sokosumi/.worktrees/chore-foo", {
        linkedWorktree: true,
      }),
      "",
    );
  });
});

describe("portlessAppName", () => {
  it("uses grok basename so copies do not steal web.sokosumi", () => {
    const root = "/Users/x/.grok/worktrees/masumi-network-sokosumi/portless";
    assert.equal(portlessAppName("core", root), "portless.core.sokosumi");
    assert.equal(portlessAppName("web", root), "portless.web.sokosumi");
  });
});

describe("portlessSpawnArgs", () => {
  it("uses portless run --name --force so restarts take over a stale route", () => {
    assert.deepEqual(portlessSpawnArgs("core.sokosumi", "@sokosumi/core"), [
      "run",
      "--name",
      "core.sokosumi",
      "--force",
      "--",
      "pnpm",
      "--filter",
      "@sokosumi/core",
      "dev",
    ]);
  });
});

describe("spawnPlan", () => {
  const urls = {
    webUrl: "https://branch.web.sokosumi.localhost",
    coreUrl: "https://branch.core.sokosumi.localhost",
  };
  const primaryRoot = "/Users/x/Developer/masumi-network/sokosumi";

  it("plans both apps by default, still wiring both URLs", () => {
    const plan = spawnPlan(undefined, urls, primaryRoot);
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
    const [web] = spawnPlan("web", urls, primaryRoot);
    assert.equal(web.app, "web");
    assert.equal(web.env.CORE_APP_BASE_URL, urls.coreUrl);
    assert.equal(web.env.WEB_APP_BASE_URL, urls.webUrl);
  });

  it("plans grok copies with a basename prefix", () => {
    const grok = "/Users/x/.grok/worktrees/masumi-network-sokosumi/3877";
    const [web] = spawnPlan("web", urls, grok);
    assert.equal(web.name, "3877.web.sokosumi");
  });
});
