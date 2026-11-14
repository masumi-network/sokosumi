import { beforeEach, describe, expect, it, vi } from "vitest";

const { revisionFind, authorize, getContext } = vi.hoisted(() => ({
  revisionFind: vi.fn(),
  authorize: vi.fn(),
  getContext: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotMemoryRevision: { findFirst: revisionFind } },
}));
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: { authorize, getContext },
}));

import { prepareTurn } from "./turn-loop";

const INSTRUCTION = "Write Hannah's Task briefs in German.";
const CAPTURE = {
  instruction: INSTRUCTION,
  memoryRevisionId: "11111111-1111-4111-8111-111111111111",
  memoryVersion: 2,
  memoryHash: "capture-hash",
};
const GUIDANCE_PREFIX = "Core verified a saved preference for this turn.";

function context(trigger: unknown) {
  return {
    packet: { trigger, recentTurns: [] },
    version: {
      id: "v40",
      name: "Fixture",
      systemPrompt: "Owner instructions.",
    },
  };
}

function trigger(overrides: Record<string, unknown> = {}) {
  return {
    source: "CHAT",
    askedBy: { kind: "OWNER" },
    savedPreference: CAPTURE,
    ...overrides,
  };
}

async function preparedSystem() {
  return (await prepareTurn("session", "turn", { sandbox: false })).system;
}

beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue({
    askedByKind: "OWNER",
    turn: {
      source: "CHAT",
      sokoBotId: "bot-1",
      versionId: "v40",
      chainDepth: 0,
    },
    grant: { capabilities: ["update_memory"] },
  });
  getContext.mockResolvedValue(context(trigger()));
  revisionFind.mockResolvedValue({
    markdown: `# Soko Bot memory\n\n## Preferences\n- ${INSTRUCTION}\n`,
  });
});

describe("prepareTurn saved-preference guidance", () => {
  it("uses persisted capture proof before instructing the model to leave the confirmation to Core", async () => {
    const system = await preparedSystem();
    expect(revisionFind).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: CAPTURE.memoryRevisionId,
        sokoBotId: "bot-1",
        source: "preference_capture",
        version: CAPTURE.memoryVersion,
        hash: CAPTURE.memoryHash,
      },
      select: { markdown: true },
    });
    const lines = system.split("\n");
    const guidanceIndex = lines.findIndex((line) =>
      line.startsWith(GUIDANCE_PREFIX),
    );
    expect(guidanceIndex).toBeGreaterThan(
      lines.findIndex((line) => line.startsWith('{"trigger"')),
    );
    expect(guidanceIndex).toBe(lines.length - 2);
    expect(lines[guidanceIndex]).toContain("Do not repeat or translate");
    expect(lines[guidanceIndex]).toContain("only request");
    expect(lines[guidanceIndex]).toContain("other work or answers");
    expect(lines[guidanceIndex]).toContain("stated deliverables");
    expect(lines[guidanceIndex]).not.toContain(INSTRUCTION);
    expect(lines.at(-1)).toMatch(
      /^Reply in the language of the owner's latest message/,
    );
  });

  it("does not acknowledge an uncommitted or mismatched capture", async () => {
    revisionFind.mockResolvedValue(null);
    expect(await preparedSystem()).not.toContain(GUIDANCE_PREFIX);
  });

  it("does not acknowledge proof whose persisted revision lacks the claimed preference", async () => {
    revisionFind.mockResolvedValue({
      markdown: "# Soko Bot memory\n\n## Preferences\n- Use short replies.\n",
    });
    expect(await preparedSystem()).not.toContain(GUIDANCE_PREFIX);
  });

  it.each([
    {},
    trigger({ savedPreference: undefined }),
    trigger({ savedPreference: { ...CAPTURE, memoryRevisionId: "forged-id" } }),
    trigger({ askedBy: { kind: "TEAMMATE" } }),
    trigger({ source: "SCHEDULE" }),
  ])(
    "does not query preference revisions for an ordinary or invalid trigger: %j",
    async (packetTrigger) => {
      getContext.mockResolvedValue(context(packetTrigger));
      expect(await preparedSystem()).not.toContain(GUIDANCE_PREFIX);
      expect(revisionFind).not.toHaveBeenCalled();
    },
  );

  it("does not trust a valid-looking packet on a non-chat turn", async () => {
    const authorization = await authorize();
    authorize.mockResolvedValue({
      ...authorization,
      turn: { ...authorization.turn, source: "SCHEDULE" },
    });
    expect(await preparedSystem()).not.toContain(GUIDANCE_PREFIX);
    expect(revisionFind).not.toHaveBeenCalled();
  });
});
