import {
  createEmptySokoBotMemory,
  parseSokoBotMemory,
  renderSokoBotMemory,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeToolMock } = vi.hoisted(() => ({ executeToolMock: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: { executeTool: executeToolMock },
  SokoBotRuntimeConflictError: class extends Error {},
  SokoBotRuntimeValidationError: class extends Error {},
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (operation: (tx: unknown) => unknown) =>
    operation(currentTx),
}));

import {
  TOOL_RESULT_MAX_CHARS,
  TOOL_RESULT_SHORTENED_EVENT,
} from "@/lib/soko-bot/tool-result-fit";
import { type RuntimeEventLog, runTurnTool } from "@/lib/soko-bot/turn-loop";
import { hashMemory, updateMemory } from "./memory";

const TURN_ID = "01960001-0001-7001-8001-000000000003";
const BOT_ID = "01960001-0001-7001-8001-000000000001";
const LAST_ENTRY = "Never publish before the owner approves.";

let currentTx: unknown;

/** A memory near the byte limit, full of what JSON has to escape. */
function longMemory(): string {
  const memory = createEmptySokoBotMemory();
  const sections = [
    "activeGoals",
    "decisions",
    "preferences",
    "followUps",
    "blockers",
  ] as const;
  const entry = (section: string, index: number) =>
    `${section} ${index}: Jürgen ✓ ${'say "yes" at C:\\share\\path, '.repeat(16)}`;
  for (const section of sections)
    for (let index = 0; index < 12; index++)
      memory[section].push(entry(section, index));
  memory.blockers[11] = LAST_ENTRY;
  // Shorten entries until the document fits the store's limit.
  for (;;) {
    // Rendering refuses a document over SOKO_BOT_MEMORY_LIMITS.maxBytes.
    try {
      return renderSokoBotMemory(memory);
    } catch {
      for (const section of sections)
        memory[section] = memory[section].map((text) =>
          text === LAST_ENTRY ? text : text.slice(0, -4),
        );
    }
  }
}

function fakeLog(events: { type: string; data: unknown }[]): RuntimeEventLog {
  return {
    turnId: TURN_ID,
    sessionId: "session_1",
    append: async (event: { type: string; data: unknown }) => {
      events.push(event);
    },
  } as unknown as RuntimeEventLog;
}

/**
 * The transaction update_memory runs in, over the turn's recorded reads. Like
 * Prisma's interactive transaction client, it refuses a query while another
 * is still running (AGENTS.md: never Promise.all inside a transaction).
 */
function txFor(input: {
  reads: { toolCallId: string }[];
  events: { type: string; data: unknown }[];
}) {
  let running = false;
  const one =
    <A extends unknown[], R>(query: (...args: A) => R) =>
    async (...args: A): Promise<Awaited<R>> => {
      if (running) throw new Error("Two queries at once on one transaction");
      running = true;
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await query(...args);
      } finally {
        running = false;
      }
    };
  return {
    sokoBotContextSnapshot: {
      findUnique: one(() => ({ omissions: { memory: 9_000 } })),
    },
    sokoBotToolCall: {
      findMany: one(
        ({
          where,
        }: {
          where: { NOT?: { toolCallId: { startsWith: string } } };
        }) =>
          input.reads.filter(
            (read) =>
              !where.NOT ||
              !read.toolCallId.startsWith(where.NOT.toolCallId.startsWith),
          ),
      ),
      update: one(() => ({})),
    },
    sokoBotRuntimeEvent: {
      findMany: one(({ where }: { where: { type: string } }) =>
        input.events
          .filter((event) => event.type === where.type)
          .map((event) => ({ data: event.data })),
      ),
    },
    sokoBot: {
      findUniqueOrThrow: async () => ({ memoryVersion: 3 }),
      update: async () => ({}),
    },
    sokoBotMemoryRevision: {
      create: async ({ data }: { data: { markdown: string } }) => ({
        id: "rev-4",
        version: 4,
        hash: "hash-4",
        markdown: data.markdown,
      }),
    },
  };
}

const authorized = {
  turn: { id: TURN_ID, sokoBotId: BOT_ID },
  grant: { memoryVersion: 3 },
} as never;
const runtime = { requireMutationAuthority: async () => undefined } as never;

describe("reading memory whole before rewriting it", () => {
  const stored = longMemory();

  beforeEach(() => {
    executeToolMock.mockReset();
    executeToolMock.mockResolvedValue({
      id: "rev-3",
      version: 3,
      hash: hashMemory(stored),
      markdown: stored,
    });
  });

  it("gives the model the whole document near the limit, and the rewrite keeps the last entry", async () => {
    expect(Buffer.byteLength(stored, "utf8")).toBeGreaterThan(15_000);
    expect(stored).toContain(LAST_ENTRY);
    const events: { type: string; data: unknown }[] = [];

    const seen = (await runTurnTool({
      log: fakeLog(events),
      capability: "read_memory",
      toolCallId: "call_read",
      toolInput: {},
    })) as { result: { markdown: string } };

    // Escaped for the model it is longer than the generic cap, and still whole.
    expect(JSON.stringify(seen).length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
    expect(seen.result.markdown).toBe(stored);
    expect(events.map((event) => event.type)).not.toContain(
      TOOL_RESULT_SHORTENED_EVENT,
    );

    const memory = parseSokoBotMemory(seen.result.markdown);
    memory.activeGoals[0] = "Ship the launch on Friday.";
    currentTx = txFor({ reads: [{ toolCallId: "call_read" }], events });
    const saved = await updateMemory(
      runtime,
      authorized,
      { markdown: renderSokoBotMemory(memory) },
      "call_write",
    );
    expect(saved.markdown).toContain(LAST_ENTRY);
    expect(saved.markdown).toContain("Ship the launch on Friday.");
  });

  it("does not count a read the model got shortened", async () => {
    currentTx = txFor({
      reads: [{ toolCallId: "call_read" }],
      events: [
        {
          type: TOOL_RESULT_SHORTENED_EVENT,
          data: { name: "read_memory", callId: "call_read" },
        },
      ],
    });
    await expect(
      updateMemory(runtime, authorized, { markdown: stored }, "call_write"),
    ).rejects.toThrow("Call read_memory");
  });

  it("does not count a read only a script saw", async () => {
    currentTx = txFor({
      reads: [{ toolCallId: "script:0b1c" }],
      events: [],
    });
    await expect(
      updateMemory(runtime, authorized, { markdown: stored }, "call_write"),
    ).rejects.toThrow("Call read_memory");
  });
});
