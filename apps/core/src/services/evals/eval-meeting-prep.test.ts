import {
  evaluateScenario,
  SOKO_BOT_SYSTEM_SCHEDULES,
} from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";
import { startLabScenarioTurn } from "@/services/soko-bot-lab-scenario.service";
import { selectEvalCases } from "./eval-cases";

const { startTurn } = vi.hoisted(() => ({
  startTurn: vi.fn().mockResolvedValue({ turnId: "meeting" }),
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { startTurn },
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

function meetingCase() {
  const [entry] = selectEvalCases({
    suites: ["soko-bot"],
    caseIds: ["meeting-prep-invite-grounding"],
  });
  if (entry?.kind !== "scenario") throw new Error("Missing meeting prep eval");
  return entry;
}

describe("scheduled meeting prep evaluation", () => {
  it("starts in a mailbox-free lane with the production meeting prompt and closed tool grant", async () => {
    const definition = meetingCase();
    expect(definition.requires).toBeUndefined();
    await startLabScenarioTurn(
      definition.scenario,
      {
        bot: { id: "lane-bot", userId: "lane-owner" },
        workspaceId: "lane-workspace",
      },
      "lab:eval:meeting",
    );
    const [turn] = startTurn.mock.calls[0];
    expect(turn).toMatchObject({
      source: "SCHEDULE",
      sokoBotId: "lane-bot",
      presetRoute: { systemKey: "meeting-prep", capabilities: [] },
    });
    const schedule = SOKO_BOT_SYSTEM_SCHEDULES.find(
      (beat) => beat.key === "meeting-prep",
    );
    expect(turn.message).toBe(
      `${schedule?.prompt}\n\n${definition.scenario.prompt}`,
    );
  });

  it("accepts the grounded invite and rejects missing links, named guesses and unsupported follow-up claims", () => {
    const { scenario } = meetingCase();
    const link =
      "[Mira Quill](/contacts?contact=01960001-0001-7001-8001-000000000108&workspace=01960001-0001-7001-8001-000000000109)";
    const answer = `### Prism review at 15:00\n- Review the color proof with ${link} and teo@visitor.example.`;
    const score = (finalAnswer: string) =>
      evaluateScenario(scenario, {
        status: "COMPLETED",
        route: "DIRECT_RESPONSE",
        userMessage: scenario.prompt,
        finalAnswer,
        toolCalls: [],
        events: [],
        delegations: [],
        decisions: [],
      });
    const passing = score(answer);
    expect(passing.passed).toBe(passing.total);
    for (const incorrect of [
      answer.replace(link, "Mira Quill"),
      answer.replace("teo@visitor.example", "Teo"),
      answer.replace("teo@visitor.example", "Teo (teo@visitor.example)"),
      answer.replace("&workspace=01960001-0001-7001-8001-000000000109", ""),
      answer.replace("15:00", "16:00"),
      answer + " Rowan Vale is attending.",
      answer + " No open Tasks were found.",
      answer + " No matching emails were found.",
    ]) {
      const failing = score(incorrect);
      expect(failing.passed, incorrect).toBeLessThan(failing.total);
    }
  });
});
