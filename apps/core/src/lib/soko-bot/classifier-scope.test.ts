import { capabilitiesForClassification } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ generateText, Output: { object: vi.fn() } }));
vi.mock("./model-policy", () => ({
  SOKO_BOT_SELECTOR_MODEL: "fixture-model",
  sokoBotModelRequest: vi.fn().mockReturnValue({ model: "fixture-model" }),
  assertSokoBotInferenceRegion: vi.fn(),
  sokoBotInferenceEvidence: vi.fn().mockReturnValue({ region: "eu" }),
}));

import { ExternalTurnClassifier } from "./classifier";

const context = {
  projectIds: [],
  coworkerIds: [],
  agentIds: [],
  taskIds: [],
  jobIds: [],
};
describe("selector write scope", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["MEMORY", "SCHEDULE", "CHAT", "FILE", "INTEGRATION", null])(
    "retains the independent %s ceiling after model selection",
    async (writeScope) => {
      generateText.mockResolvedValue({
        output: {
          schemaVersion: 1,
          route: "MANAGE_WORK",
          writeScope,
          confidence: 1,
          rationaleSummary: "Requested change",
          requestedOutcome: "Adjust the requested surface",
          candidateTaskIds: [],
          candidateProjectIds: [],
          candidateCoworkerIds: [],
          candidateAgentIds: [],
          requiresClarification: false,
          requiresApproval: false,
          proposedTaskBrief: null,
        },
        usage: {},
        providerMetadata: {},
      });
      const result = await new ExternalTurnClassifier(true).classify(
        "A small adjustment, please",
        context,
      );
      expect(generateText).toHaveBeenCalledOnce();
      expect(result.failed).toBe(false);
      expect(result.classification.writeScope).toBe(writeScope ?? undefined);
      const capabilities = capabilitiesForClassification(result.classification);
      for (const forbidden of [
        "create_task",
        "update_task",
        "archive_task",
        "assign_task",
        "hire_agent",
      ])
        expect(capabilities).not.toContain(forbidden);
      if (writeScope === null) {
        for (const write of [
          "update_memory",
          "create_schedule",
          "post_chat",
          "upload_file",
          "run_integration_tool",
        ])
          expect(capabilities).not.toContain(write);
      }
    },
  );
});
