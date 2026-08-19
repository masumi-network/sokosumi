import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AUTH_BACKGROUND_IMAGES,
  AUTH_BACKGROUND_SIZES,
  pickAuthBackgroundImage,
} from "@/auth/components/auth-background";

const here = dirname(fileURLToPath(import.meta.url));
const authDir = join(here, "../..");

function readAuth(rel: string): string {
  return readFileSync(join(authDir, rel), "utf8");
}

/** Drop comments so docs do not false-positive scans. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("auth background LCP contract (SOK-782)", () => {
  it("maps RNG bounds to catalog indices", () => {
    expect(AUTH_BACKGROUND_IMAGES.length).toBeGreaterThan(0);
    expect(pickAuthBackgroundImage(() => 0)).toBe(AUTH_BACKGROUND_IMAGES[0]);
    expect(pickAuthBackgroundImage(() => 0.99)).toBe(
      AUTH_BACKGROUND_IMAGES[AUTH_BACKGROUND_IMAGES.length - 1],
    );
  });

  it("auth-background is a server module with preloaded LCP image", () => {
    const code = stripComments(readAuth("components/auth-background.tsx"));

    // Chosen server-side for first paint — not a post-hydrate surprise.
    expect(code).not.toMatch(/["']use client["']/);
    expect(code).not.toMatch(/\buseState\b/);
    expect(code).not.toMatch(/\buseMountEffect\b/);
    expect(code).not.toMatch(/\buseEffect\b/);

    // Half-viewport hero must preload (Next deprecates priority → preload).
    expect(code).toMatch(/\bpreload\b/);
    expect(code).not.toMatch(/\bpriority\b/);
    expect(code).toMatch(/from\s+["']next\/image["']/);
    expect(code).toMatch(/\bpickAuthBackgroundImage\s*\(/);
    // Below Tailwind lg the panel is hidden — sizes must not claim 50vw there.
    expect(AUTH_BACKGROUND_SIZES).toBe("(max-width: 1023px) 0px, 50vw");
    expect(code).toMatch(/\bsizes=\{AUTH_BACKGROUND_SIZES\}/);
    expect(code).toMatch(/<AuthAside\s*\/>/);
    expect(code).not.toMatch(/export default async function AuthBackground/);
  });

  it("auth layout keeps Instant opt-out and still mounts AuthBackground", () => {
    const layout = stripComments(readAuth("layout.tsx"));
    expect(layout).toMatch(/export\s+const\s+instant\s*=\s*false/);
    expect(layout).toMatch(/<AuthBackground\s*\/>/);
    expect(layout).toMatch(/min-h-6/);
  });
});
