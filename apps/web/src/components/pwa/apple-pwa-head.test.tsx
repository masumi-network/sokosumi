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

  it("gives every device a splash for both themes and orientations", () => {
    render(<ApplePwaHead />);
    const splashes = [
      ...document.querySelectorAll('link[rel="apple-touch-startup-image"]'),
    ];

    expect(splashes).toHaveLength(92);
    for (const splash of splashes) {
      const href = splash.getAttribute("href") ?? "";
      const media = splash.getAttribute("media") ?? "";
      expect(existsSync(join(process.cwd(), "public", href.slice(1)))).toBe(
        true,
      );
      expect(media.includes("prefers-color-scheme: dark")).toBe(
        href.endsWith("-dark.jpg"),
      );
    }
  });

  it("colors the browser chrome like the page background", () => {
    render(<ApplePwaHead />);
    const colors = [
      ...document.querySelectorAll('meta[name="theme-color"]'),
    ].map((meta) => meta.getAttribute("content"));

    expect(colors).toEqual(["#ffffff", "#0c0c0c"]);
  });

  it("names the home screen after the manifest, not the page title", () => {
    render(<ApplePwaHead />);
    const title = document
      .querySelector('meta[name="apple-mobile-web-app-title"]')
      ?.getAttribute("content");

    expect(title).toBe("Sokosumi");
  });
});
