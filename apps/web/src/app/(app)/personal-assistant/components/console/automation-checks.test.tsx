import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AutomationChecks } from "./automation-checks";

const NOW = new Date("2026-11-09T08:00:00Z");
const relativeTime = vi.fn(() => "soon");

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ relativeTime }),
  useNow: () => NOW,
}));

describe("AutomationChecks", () => {
  it("measures every time against now, so next-intl never falls back", () => {
    render(
      <AutomationChecks
        checks={{
          lastSelfStartedAt: "2026-11-08T08:00:00Z",
          items: [
            {
              key: "standup",
              name: "Daily stand-up",
              lastRunAt: "2026-11-08T07:00:00Z",
              nextRunAt: "2026-11-10T07:00:00Z",
              late: false,
            },
          ],
        }}
      />,
    );
    expect(relativeTime).toHaveBeenCalledTimes(3);
    for (const call of relativeTime.mock.calls as unknown as unknown[][]) {
      expect(call[1]).toBe(NOW);
    }
  });
});
