import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_CHROMIUM_EXECUTABLE_URL } from "@/config/env.secrets";

const WEB_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const WEB_PKG = JSON.parse(
  readFileSync(path.join(WEB_ROOT, "package.json"), "utf8"),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const PUPPETEER_VERSION = "25.10.0";
const CHROMIUM_MIN_VERSION = "152.0.0";
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v152.0.0/chromium-v152.0.0-pack.x64.tar";

describe("PDF Chromium pack lockstep", () => {
  it("pins puppeteer, puppeteer-core, and chromium-min together", () => {
    expect(WEB_PKG.dependencies["puppeteer-core"]).toBe(PUPPETEER_VERSION);
    expect(WEB_PKG.devDependencies.puppeteer).toBe(PUPPETEER_VERSION);
    expect(WEB_PKG.dependencies["@sparticuz/chromium-min"]).toBe(
      CHROMIUM_MIN_VERSION,
    );
  });

  it("defaults CHROMIUM_EXECUTABLE_URL to the matching pack", () => {
    expect(DEFAULT_CHROMIUM_EXECUTABLE_URL).toBe(CHROMIUM_PACK_URL);
    expect(DEFAULT_CHROMIUM_EXECUTABLE_URL).toContain(
      `/v${CHROMIUM_MIN_VERSION}/chromium-v${CHROMIUM_MIN_VERSION}-pack.x64.tar`,
    );
  });
});
