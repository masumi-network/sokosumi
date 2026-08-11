import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const paDir = join(here, "..");

function readPa(rel: string): string {
  return readFileSync(join(paDir, rel), "utf8");
}

/** Drop comments so doc strings do not false-positive scans. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("personal-assistant first-paint contract (SOK-780)", () => {
  it("keeps Instant soft-nav opt-out", () => {
    const layout = stripComments(readPa("layout.tsx"));
    expect(layout).toMatch(/export\s+const\s+instant\s*=\s*false/);
  });

  it("page streams Suspense shell before billing work", () => {
    const page = stripComments(readPa("page.tsx"));
    // Outer page must wrap experience in Suspense with LoadingState fallback.
    expect(page).toMatch(/<Suspense[\s\S]*fallback=\{<\s*LoadingState/);
    // Billing probes must live in the deferred child, not the default page body.
    expect(page).toMatch(/hasPaidPlanCoverage/);
    expect(page).toMatch(/getSubscriptionCatalog/);
    // Default export should return Suspense without awaiting coverage first:
    // coverage call must appear after the default function's return of Suspense,
    // i.e. only inside a separate async component in the same file.
    const defaultMatch = page.match(
      /export\s+default\s+async\s+function\s+\w+[\s\S]*?^}/m,
    );
    expect(defaultMatch).toBeTruthy();
    const defaultBody = defaultMatch?.[0] ?? "";
    expect(defaultBody).toMatch(/return\s*\(\s*<Suspense/);
    expect(defaultBody).not.toMatch(/hasPaidPlanCoverage\s*\(/);
    expect(defaultBody).not.toMatch(/getSubscriptionCatalog\s*\(/);
  });

  it("loading shell uses static orb (no animated LCP candidate)", () => {
    const loading = stripComments(readPa("components/loading-state.tsx"));
    // Must not enable animate={true}; default/static is required for LCP.
    expect(loading).not.toMatch(/animate\s*=\s*\{?\s*true/);
    // Explicit static is preferred when AuroraOrb is present.
    if (loading.includes("AuroraOrb")) {
      expect(loading).toMatch(/animate\s*=\s*\{?\s*false/);
    }
  });

  it("defers RunningState (settings/skills) off the experience entry", () => {
    const experience = stripComments(
      readPa("components/hermes-experience.tsx"),
    );
    // No static import of running-state module.
    expect(experience).not.toMatch(
      /import\s+RunningState\s+from\s+["'][^"']*running-state["']/,
    );
    // Dynamic import keeps heavy client surface off first paint chunk.
    expect(experience).toMatch(
      /dynamic\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*["'][^"']*running-state["']/,
    );
  });
});
