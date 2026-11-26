import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordAction, recordResult, fetchPage, searchExa, recordModelCall } =
  vi.hoisted(() => ({
    recordAction: vi.fn(),
    recordResult: vi.fn(),
    fetchPage: vi.fn(),
    searchExa: vi.fn(),
    recordModelCall: vi.fn(),
  }));

vi.mock("@/services/soko-bot-sandbox-turn.service", () => ({
  recordSandboxAction: recordAction,
  recordSandboxActionResult: recordResult,
}));
vi.mock("@/soko-bot-runner/local-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/soko-bot-runner/local-tools")>()),
  fetchWebPage: fetchPage,
}));
vi.mock("./exa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./exa")>()),
  searchExa,
}));
vi.mock("./model-calls", () => ({ recordModelCall }));
vi.mock("./turn-loop", () => ({
  RuntimeEventLog: class {
    append = vi.fn();
  },
  runtimeEvent: (type: string, data: unknown) => ({ type, data }),
}));

import { runCoreWebTool } from "./core-web-tools";
import { ExaUnavailableError } from "./exa";

const base = {
  sessionId: "sess-1",
  turnId: "turn-1",
  toolCallId: "call-1",
};

describe("runCoreWebTool", () => {
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
    const output = await runCoreWebTool({
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
      runCoreWebTool({
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

  it("searches straight against Exa, cites its pages and records the cost as search", async () => {
    searchExa.mockResolvedValue({
      results: [
        { title: "Acme", url: "https://acme.io/", passages: ["Rockets."] },
      ],
      costUsd: 0.005,
    });
    const output = await runCoreWebTool({
      ...base,
      capability: "web_search",
      toolInput: { query: "acme rockets" },
    });
    expect(searchExa).toHaveBeenCalledWith({
      query: "acme rockets",
      numResults: 5,
    });
    expect(output).toMatchObject({ query: "acme rockets" });
    expect(recordResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "completed",
        sources: ["https://acme.io/"],
      }),
    );
    expect(recordModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "turn-1",
        role: "search",
        label: "web_search",
        costUsd: 0.005,
      }),
    );
  });

  it("tells the model what to do when search is down", async () => {
    searchExa.mockRejectedValue(new ExaUnavailableError("no key"));
    await expect(
      runCoreWebTool({
        ...base,
        capability: "web_search",
        toolInput: { query: "acme" },
      }),
    ).rejects.toThrow("use web_fetch");
  });
});
