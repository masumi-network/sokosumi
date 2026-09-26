import { existsSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApplePwaHead } from "./apple-pwa-head";

describe("ApplePwaHead", () => {
  it("serves the home-screen icon from public, the same way splash images are", () => {
    render(<ApplePwaHead />);
    const href = document
      .querySelector('link[rel="apple-touch-icon"]')
      ?.getAttribute("href");

    expect(href?.startsWith("/images/")).toBe(true);

    const file = join(process.cwd(), "public", href?.slice(1) ?? "");
    expect(existsSync(file)).toBe(true);
  });

  it("names the home screen after the manifest, not the page title", () => {
    render(<ApplePwaHead />);
    const title = document
      .querySelector('meta[name="apple-mobile-web-app-title"]')
      ?.getAttribute("content");

    expect(title).toBe("Sokosumi");
  });
});
