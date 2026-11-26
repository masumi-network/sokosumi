import type { Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/soko-bot-schedule.service", () => ({
  SokoBotScheduleNotFoundError: class extends Error {},
  SokoBotScheduleValidationError: class extends Error {},
}));

import { briefAsksToEnd } from "@/lib/soko-bot/schedule-brief";
import { requireScheduledRunMayEnd } from "./schedule-scope";

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
    "Delete this weekly schedule after the launch.",
    // The verb split around the noun (Codex round 15).
    "Turn this schedule off once the invoice is paid.",
    "Schalte den Zeitplan ab, wenn alles erledigt ist.",
    // A negation elsewhere does not cancel a real ask.
    "Don't ping Hannah on weekends. Delete this schedule once the launch ships.",
  ])("reads an ask to end: %s", (brief) => {
    expect(briefAsksToEnd(brief)).toBe(true);
  });

  it.each([
    "Every Friday: summarize the week's Tasks and post the report.",
    "Check the board and tell me what is stuck.",
    "Stop me if I overspend on ads.",
    // Negated: these forbid ending the schedule (Neon round 6).
    "Never delete this schedule, even when the board is quiet.",
    "Do not turn off this schedule.",
    "Don't remove the reminder until I say so.",
    "Lösche diesen Zeitplan nicht.",
    "Never turn this schedule off.",
    // "End" here is about Tasks, and the reminders are only listed.
    "Report the Tasks that end today and list upcoming reminders.",
    "Stop by the board, then check the follow-ups.",
    "Diesen Zeitplan niemals beenden; entferne keine Erinnerung.",
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
