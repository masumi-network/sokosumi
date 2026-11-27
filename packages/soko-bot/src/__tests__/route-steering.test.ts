import { describe, expect, it } from "vitest";
import {
  applyRouteSteeringPrompt,
  composeSystemPrompt,
  getSokoBotVersion,
  ROUTE_STEERING_ACT_OR_ASK_SECTION,
  type SokoBotVersion,
} from "../index.js";

describe("routeSteering prompt replacement (E1)", () => {
  it("replaces # Routes with # Act or ask and removes contradictory route-table hints", () => {
    const base = getSokoBotVersion("v37");
    const steered: SokoBotVersion = { ...base, routeSteering: true };

    const legacyPrompt = composeSystemPrompt(base);
    const steeredPrompt = composeSystemPrompt(steered);

    expect(legacyPrompt).toContain("# Routes");
    expect(legacyPrompt).toContain(
      "`DIRECT_RESPONSE`: answer from context; no work tools are present.",
    );

    expect(steeredPrompt).not.toContain("# Routes");
    expect(steeredPrompt).toContain("# Act or ask");
    expect(steeredPrompt).toContain(ROUTE_STEERING_ACT_OR_ASK_SECTION);
    for (const forbidden of [
      "DIRECT_RESPONSE",
      "DELEGATE_TASK",
      "HIRE_AGENT",
      "MANAGE_WORK",
      "trigger.route",
      "trigger.unsureRoute",
      "no work tools are present",
    ]) {
      expect(steeredPrompt).not.toContain(forbidden);
    }
    // Keeps surrounding sections intact.
    expect(steeredPrompt).toContain("# How you work");
    expect(steeredPrompt).toContain("# Truth");
    expect(steeredPrompt).toContain("# Turns nobody asked for");
    // Explicitly asks for missing time and account/audience target on publish/schedule/spend.
    expect(steeredPrompt).toContain("when (date, time, or time zone)");
    expect(steeredPrompt).toContain(
      "which account, recipient, or audience (target)",
    );
    expect(steeredPrompt).toContain(
      "publishes, schedules, sends externally, or spends credits",
    );
  });

  it("applies cleanly to Cuso versions and keeps speaker authority explicit", () => {
    const base = getSokoBotVersion("cmo-v24");
    const steered: SokoBotVersion = { ...base, routeSteering: true };

    const promptA = composeSystemPrompt(
      steered,
      { name: "Cuso", shared: true },
      {
        clientTurnId: null,
        occasions: ["chat"],
      },
    );
    const promptB = composeSystemPrompt(
      steered,
      { name: "Nova" },
      {
        clientTurnId: "cmo:strategy:1",
        occasions: ["strategy"],
      },
    );

    // Prompt cache invariant for skillsOnDemand versions holds across turns.
    expect(promptA).toBe(promptB);
    expect(promptA).not.toContain("# Routes");
    expect(promptA).toContain("# Act or ask");
    expect(promptA).toContain("# You are Cuso");
    expect(promptA).toContain("Authority follows the speaker and grant");
    expect(promptA).toContain("TEAMMATE");
    expect(promptA).not.toContain("no work tools are present");
  });

  it("appends # Act or ask when a prompt has no # Routes heading", () => {
    const result = applyRouteSteeringPrompt("# Identity\n\nHelper.");
    expect(result).toBe(
      `# Identity\n\nHelper.\n\n${ROUTE_STEERING_ACT_OR_ASK_SECTION}`,
    );
  });
});
