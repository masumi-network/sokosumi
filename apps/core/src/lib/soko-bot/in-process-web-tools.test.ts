import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordAction, recordResult, fetchPage } = vi.hoisted(() => ({
  recordAction: vi.fn(),
  recordResult: vi.fn(),
  fetchPage: vi.fn(),
}));

vi.mock("@/services/soko-bot-sandbox-turn.service", () => ({
  recordSandboxAction: recordAction,
  recordSandboxActionResult: recordResult,
}));
vi.mock("@/soko-bot-runner/local-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/soko-bot-runner/local-tools")>()),
  fetchWebPage: fetchPage,
}));

import { runInProcessWebTool } from "./in-process-web-tools";

const base = {
  sessionId: "sess-1",
  turnId: "turn-1",
  toolCallId: "call-1",
  model: "openai/gpt-5.4",
};

describe("runInProcessWebTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAction.mockResolvedValue(undefined);
    recordResult.mockResolvedValue(undefined);
  });

  it("records a fetch like the sandbox does, with the page as a source", async () => {
    fetchPage.mockResolvedValue({
      url: "https://acme.io/",
      status: 200,
      contentType: "text/html",
      text: "Acme sells rockets.",
    });
    const output = await runInProcessWebTool({
      ...base,
      capability: "web_fetch",
      toolInput: { url: "https://acme.io" },
    });
    expect(output).toMatchObject({ text: "Acme sells rockets." });
    // The same audit row and web taint as a sandbox read.
    expect(recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: "turn-1", sessionId: "sess-1" }),
      expect.objectContaining({ name: "web_fetch", toolCallId: "call-1" }),
    );
    expect(recordResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "completed",
        sources: ["https://acme.io/"],
      }),
    );
  });

  it("reports a failed fetch and rethrows it to the model", async () => {
    fetchPage.mockRejectedValue(new Error("timeout"));
    await expect(
      runInProcessWebTool({
        ...base,
        capability: "web_fetch",
        toolInput: { url: "https://acme.io" },
      }),
    ).rejects.toThrow("timeout");
    expect(recordResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });
});
