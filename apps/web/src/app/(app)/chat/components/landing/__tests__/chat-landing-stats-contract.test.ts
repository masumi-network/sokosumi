import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The activity/stats row must stay on the landing composition so the first
 * viewport still answers "what happened while I was gone". Clamping the
 * selected-coworker block must not delete that row — and the row must be
 * pinned (`shrink-0` + test id) at the bottom of the viewport-tall column.
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
      expect(source).toContain("hasReportableActivity");
      expect(source).toContain("stats.map");
      expect(source).toContain('data-testid="landing-activity-stats"');
      expect(source).toContain("shrink-0");
      expect(source).toContain("min-w-0");
    },
  );
});
