import { beforeEach, describe, expect, it, vi } from "vitest";

const { getComposio, fetchMock } = vi.hoisted(() => ({
  getComposio: vi.fn(),
  fetchMock: vi.fn(),
}));
vi.mock("@/clients/composio.client", () => ({ getComposio }));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { getSokoBotIntegrationProvider } from "@sokosumi/soko-bot";
import { runInEvalWorld } from "@/lib/evals/eval-world-context";
import {
  executeIntegrationTool,
  listIntegrationTools,
  readIntegrationTool,
  runIntegrationTool,
} from "./composio-integration-tools.service";
import { evalIntegrationAccountId } from "./evals/eval-integration-world";

const gmail = getSokoBotIntegrationProvider("gmail")!;
const github = {
  id: "github",
  name: "GitHub",
  kinds: [],
  tools: {},
  logoUrl: "",
} as unknown as typeof gmail;
const evalGmail = {
  provider: gmail,
  composioAccountId: evalIntegrationAccountId("lane-1", "gmail"),
  entityId: "sokobot:bot-1",
};
const evalGithub = {
  provider: github,
  composioAccountId: evalIntegrationAccountId("lane-1", "github"),
  entityId: "sokobot:bot-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("Composio in the eval world", () => {
  it("answers an eval account from the eval world, even outside a lane's turn", async () => {
    await expect(
      executeIntegrationTool(evalGmail, "GMAIL_FETCH_EMAILS", {
        query: "invoice",
      }),
    ).resolves.toMatchObject({ messages: [{ messageId: "eval-mail-3" }] });
    await expect(
      runIntegrationTool(evalGithub, "GITHUB_CREATE_AN_ISSUE", { title: "x" }),
    ).resolves.toMatchObject({ number: 100 });
    await expect(
      readIntegrationTool(evalGithub, "GITHUB_LIST_PULL_REQUESTS", {}),
    ).resolves.toMatchObject({ pull_requests: expect.any(Array) });
    await expect(
      listIntegrationTools(evalGithub, { query: "issue", limit: 5 }),
    ).resolves.toEqual([
      expect.objectContaining({ slug: "GITHUB_CREATE_AN_ISSUE" }),
    ]);
    expect(getComposio).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a read of a tool marked as a write, and a tool the world lacks", async () => {
    await expect(
      readIntegrationTool(evalGithub, "GITHUB_CREATE_AN_ISSUE", {}),
    ).rejects.toThrow("not marked read-only");
    await expect(
      runIntegrationTool(evalGithub, "GITHUB_DELETE_A_REPOSITORY", {}),
    ).rejects.toThrow("not available on this connected account");
    expect(getComposio).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when a lane's turn reaches a real account", async () => {
    const real = { ...evalGmail, composioAccountId: "ca_live_123" };
    await expect(
      runInEvalWorld("ws-eval", () =>
        executeIntegrationTool(real, "GMAIL_SEND_DRAFT", { draft_id: "d" }),
      ),
    ).rejects.toThrow("An eval lane cannot use a real connected account");
    await expect(
      runInEvalWorld("ws-eval", () => listIntegrationTools(real, { limit: 5 })),
    ).rejects.toThrow("An eval lane cannot use a real connected account");
    expect(getComposio).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
