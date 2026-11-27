import {
  getSokoBotVersion,
  SOKO_BOT_TOOL_DESCRIPTIONS,
  type SokoBotCapability,
  sokoBotToolDescription,
} from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";
import { prepareTurn } from "./turn-loop";

const fixture = vi.hoisted(() => ({
  versionId: "v36",
  capabilities: [
    "create_schedule",
    "preview_result",
    "wait_for",
    "create_task",
  ] as SokoBotCapability[],
}));

vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: {
    authorize: async () => ({
      askedByKind: "OWNER",
      complexity: "SIMPLE",
      grant: { capabilities: fixture.capabilities },
      turn: {
        versionId: fixture.versionId,
        chainDepth: 0,
        sokoBotId: "bot",
        modelId: null,
      },
    }),
    getContext: async () => ({
      version: { id: fixture.versionId, name: "test", systemPrompt: "" },
      packet: {},
    }),
  },
}));
vi.mock("@/services/soko-bot-version.service", () => ({
  resolveRunnableSokoBotVersion: async (id: string) => getSokoBotVersion(id),
}));
vi.mock("./turn-model-context", () => ({
  modelContextBlock: async () => [],
  modelContextParts: async () => ({ fixed: [], perTurn: [] }),
}));

describe("prepareTurn toolDescriptions", () => {
  it.each(["v35", "v36", "v37"])(
    "passes messaging-aware tool descriptions to both runners on %s",
    async (versionId) => {
      fixture.versionId = versionId;
      fixture.capabilities = [
        "create_schedule",
        "preview_result",
        "wait_for",
        "create_task",
      ];
      const version = getSokoBotVersion(versionId);
      const prepared = await prepareTurn("session", "turn", { sandbox: false });

      for (const capability of [
        "create_schedule",
        "preview_result",
        "wait_for",
      ] as const) {
        const expected = sokoBotToolDescription(capability, version);
        const delivered =
          prepared.toolDescriptions[capability] ??
          SOKO_BOT_TOOL_DESCRIPTIONS[capability];
        expect(delivered).toBe(expected);
        expect(delivered).toContain("send_message");
        expect(delivered).not.toContain("post_chat");
        expect(delivered).not.toContain("ask_coworker");
      }

      // Unchanged descriptions stay omitted so prepared payloads stay small.
      expect(prepared.toolDescriptions.create_task).toBeUndefined();
    },
  );

  it("keeps legacy post_chat descriptions unchanged on v34", async () => {
    fixture.versionId = "v34";
    fixture.capabilities = ["create_schedule", "preview_result", "wait_for"];
    const prepared = await prepareTurn("session", "turn", { sandbox: false });
    expect(prepared.toolDescriptions).toEqual({});
    expect(SOKO_BOT_TOOL_DESCRIPTIONS.create_schedule).toContain("post_chat");
  });
});
