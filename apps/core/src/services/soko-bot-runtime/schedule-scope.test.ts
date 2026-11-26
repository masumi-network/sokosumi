import type { Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/soko-bot-schedule.service", () => ({
  SokoBotScheduleNotFoundError: class extends Error {},
  SokoBotScheduleValidationError: class extends Error {},
}));

import { briefAsksToEnd, requireScheduledRunMayEnd } from "./schedule-scope";

const OWN = "01960001-0001-7001-8001-000000000001";
const OTHER = "01960001-0001-7001-8001-000000000002";

function tx(prompt: string | null) {
  return {
    sokoBotScheduleRun: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          prompt === null
            ? null
            : { schedule: { id: OWN, name: "Weekly report", prompt } },
        ),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("briefAsksToEnd", () => {
  it.each([
    "Check SOK-12 every morning. Delete this schedule once Mira is done.",
    "Remind me about the invoice; remove the reminder when it is paid.",
    "Stop the check-ins when the launch ships.",
    "Prüfe täglich den Stand und lösche den Zeitplan, sobald es fertig ist.",
  ])("reads an ask to end: %s", (brief) => {
    expect(briefAsksToEnd(brief)).toBe(true);
  });

  it.each([
    "Every Friday: summarize the week's Tasks and post the report.",
    "Check the board and tell me what is stuck.",
    "Stop me if I overspend on ads.",
  ])("reads no ask to end: %s", (brief) => {
    expect(briefAsksToEnd(brief)).toBe(false);
  });
});

describe("requireScheduledRunMayEnd", () => {
  const refused = /doesn't delete or switch off schedules/;

  it("refuses a run that deletes its own schedule when its brief never asked", async () => {
    await expect(
      requireScheduledRunMayEnd(
        tx("Every Friday: summarize the week's Tasks and post the report."),
        "turn-1",
        "delete_schedule",
        { scheduleId: OWN },
      ),
    ).rejects.toThrow(refused);
  });

  it("lets a run end its own schedule when its brief asks", async () => {
    await expect(
      requireScheduledRunMayEnd(
        tx("Check SOK-12. Delete this schedule once Mira is done."),
        "turn-1",
        "delete_schedule",
        { scheduleId: OWN },
      ),
    ).resolves.toBeUndefined();
  });

  it("never lets a run delete or switch off another schedule", async () => {
    const asks = tx("Check SOK-12. Delete this schedule once Mira is done.");
    await expect(
      requireScheduledRunMayEnd(asks, "turn-1", "delete_schedule", {
        scheduleId: OTHER,
      }),
    ).rejects.toThrow(refused);
    await expect(
      requireScheduledRunMayEnd(asks, "turn-1", "update_schedule", {
        scheduleId: OTHER,
        enabled: false,
      }),
    ).rejects.toThrow(refused);
  });

  it("leaves other changes and turns without a run to the existing rules", async () => {
    await expect(
      requireScheduledRunMayEnd(
        tx("Every Friday: post the report."),
        "turn-1",
        "update_schedule",
        { scheduleId: OWN, cronExpression: "0 9 * * 5" },
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireScheduledRunMayEnd(tx(null), "turn-1", "delete_schedule", {
        scheduleId: OWN,
      }),
    ).rejects.toThrow(refused);
  });
});
