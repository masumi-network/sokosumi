import type { SokoBotToolCall } from "@sokosumi/database";
import { SOKO_BOT_SEO_WRITE_CAPABILITIES } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWebAppBaseUrl } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { ACTION_CAPABILITIES } from "./action-receipts";
import { ACTION_LABELS, buildActionResponse } from "./action-response";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn() },
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  job: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

const projectId = "01a0f400-0000-7000-8000-000000000001";
const SEO = new Set<string>(SOKO_BOT_SEO_WRITE_CAPABILITIES);

/** A stored result rich enough that every receipt which can link does. */
function receipt(capability: string, index: number): SokoBotToolCall {
  const targetId = `01a0f400-0000-7000-8000-${String(index).padStart(12, "0")}`;
  const at = new Date(Date.UTC(2026, 10, 17, 12, 0, index));
  return {
    id: `receipt-${index}`,
    turnId: "turn-current",
    toolCallId: `call-${index}`,
    capability,
    actorBotId: "bot-one",
    inputHash: `hash-${index}`,
    input: {},
    result: {
      projectId,
      id: targetId,
      taskId: targetId,
      name: "Launch",
      filename: "hero.png",
      studioUrl: `/studio?projectId=${projectId}`,
      link: SEO.has(capability)
        ? `/seo?projectId=${projectId}&view=project`
        : "/ads/campaigns/campaign-one",
    },
    operationKey: `operation-${index}`,
    status: "COMPLETED",
    disposition: "APPLIED",
    verification: "LOCAL_TRANSACTION",
    targetId,
    effectEventId: `event-${index}`,
    observedVersion: null,
    committedAt: at,
    createdAt: at,
    updatedAt: at,
    errorKind: null,
    errorDetail: null,
    replayedReceiptId: null,
  };
}

const receipts = [...ACTION_CAPABILITIES].map(receipt);

/** What a reply in CMO.xyz must never hold: Sokosumi's routes, address, names. */
function sokosumiIn(text: string): string[] {
  return [
    /\]\(\/[^)]*\)/g,
    new RegExp(new URL(getWebAppBaseUrl()).host.replaceAll(".", "\\."), "g"),
    /sokosumi\.com\/\w+/g,
    /Sokosumi|Content Studio|Soko Bot/gi,
  ].flatMap((pattern) => text.match(pattern) ?? []);
}

async function replyOn(versionId: string, message: string) {
  db.sokoBotTurn.findUnique.mockResolvedValue({
    source: "CHAT",
    versionId,
    workspaceId: "workspace-one",
  });
  db.sokoBotToolCall.count.mockResolvedValue(0);
  db.sokoBotToolCall.findMany.mockResolvedValue(receipts);
  db.task.findMany.mockResolvedValue(
    receipts.map(({ targetId }) => ({
      id: targetId,
      projectId,
      name: "Launch",
      assignee: { name: "Elena" },
      assigneeUser: null,
      assigneeSokoBot: null,
    })),
  );
  db.job.findMany.mockResolvedValue(
    receipts.map(({ targetId }) => ({ id: targetId, agentId: "agent-one" })),
  );
  const response = await buildActionResponse(prisma, "turn-current", "", true, {
    kind: "REPORT",
    message,
    question: null,
    observationToolCallIds: [],
  });
  return response.answerText;
}

describe("Cuso's replies stay inside CMO.xyz", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const message = `The picture is ready ([Open in Content Studio](/studio?projectId=${projectId})) and the post is [scheduled](${getWebAppBaseUrl()}/social?projectId=${projectId}). The file is [hero.png](https://sokosumi.com/drive/files/file-one). It goes live on [x.com](https://x.com/acme).`;

  it("carries no Sokosumi link or name, whatever Cuso did", async () => {
    const reply = await replyOn("cmo-v1", message);
    expect(sokosumiIn(reply)).toEqual([]);
    expect(reply).toContain("Started image.");
    expect(reply).toContain("Created task Launch → Elena");
    expect(reply).toContain(
      "The picture is ready and the post is scheduled. The file is hero.png. It goes live on [x.com](https://x.com/acme).",
    );
  });

  it("checks receipts that do link for a Soko Bot", async () => {
    const reply = await replyOn("v19", message);
    for (const route of [
      "/studio?",
      "/social?",
      "/tasks/",
      "/drive/files/",
      "/drive/tables/",
      "/projects/",
      "/newsletter/issues/",
      "/ads/campaigns/",
      "/agents/agent-one/jobs/",
      "/seo?",
    ])
      expect(reply).toContain(`](${route}`);
  });

  it("names no Sokosumi product in a receipt's label", () => {
    expect(sokosumiIn(Object.values(ACTION_LABELS).join("\n"))).toEqual([]);
  });
});
