import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The activity/stats row must stay on the landing composition so the first
 * viewport still answers "what happened while I was gone". Clamping the
 * selected-coworker block must not delete that row — and the row must be
 * pinned (`shrink-0` + test id) at the bottom of the viewport-tall column,
 * always mounted (including zero chips), never gated on non-zero activity.
 *
 * The middle column must be top-aligned (`justify-start`) so description
 * length cannot vertically re-center Start chat.
 */
describe("chat landing stats row contract", () => {
  it.each(["chat-landing.tsx", "chat-landing.mobile.tsx"])(
    "%s still pins the activity stats row",
    (filename) => {
      const source = readFileSync(
        join(import.meta.dirname, "..", filename),
        "utf8",
      );

      expect(source).toContain("buildActivityStats");
      expect(source).not.toContain("hasReportableActivity");
      expect(source).toContain("stats.map");
      expect(source).toContain('data-testid="landing-activity-stats"');
      expect(source).toContain("shrink-0");
      expect(source).toContain("min-w-0");
      // Always mounted — no activity / summary gate before the test id.
      expect(source).not.toMatch(/hasAnyActivity[\s\S]*landing-activity-stats/);
      expect(source).not.toMatch(/summary\s*&&[\s\S]*landing-activity-stats/);
    },
  );

  it.each(["chat-landing.tsx", "chat-landing.mobile.tsx"])(
    "%s top-aligns the middle column so CTA cannot re-center",
    (filename) => {
      const source = readFileSync(
        join(import.meta.dirname, "..", filename),
        "utf8",
      );

      expect(source).toContain("justify-start");
      // Vertically centering the pitch+picker re-positions Start chat when
      // description height changes across coworkers — forbid that pattern.
      expect(source).not.toMatch(
        /flex-1[\s\S]*justify-center[\s\S]*LandingCoworkerPicker/,
      );
    },
  );
});
