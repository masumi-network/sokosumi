import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  EXA_API_KEY: "exa-test" as string | undefined,
}));
vi.mock("@/config/env", () => ({ getEnv: () => env }));

import { runExaAgent } from "./exa-agent";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("runExaAgent", () => {
  beforeEach(() => {
    env.EXA_API_KEY = "exa-test";
  });

  it("starts a run, polls until it completes and reads the structured answer and cost", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, { id: "agent_run_1", status: "queued" }),
      )
      .mockResolvedValueOnce(
        response(200, { id: "agent_run_1", status: "running" }),
      )
      .mockResolvedValueOnce(
        response(200, {
          id: "agent_run_1",
          status: "completed",
          output: {
            structured: { investors: [{ name: "Ann" }] },
            grounding: [
              {
                field: "investors[0].name",
                citations: [{ url: "https://fund.com/team" }],
                confidence: "high",
              },
            ],
          },
          costDollars: { total: 0.5 },
        }),
      );

    const result = await runExaAgent(
      {
        query: "seed investors",
        effort: "high",
        outputSchema: { type: "object" },
      },
      { fetchImpl, pollMs: 1 },
    );

    expect(result).toEqual({
      runId: "agent_run_1",
      structured: { investors: [{ name: "Ann" }] },
      text: null,
      costUsd: 0.5,
      citations: [
        {
          field: "investors[0].name",
          urls: ["https://fund.com/team"],
          confidence: "high",
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.exa.ai/agent/runs");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: "seed investors",
      effort: "high",
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.exa.ai/agent/runs/agent_run_1",
    );
  });

  it("reports a failed run and a run that will not start", async () => {
    const failed = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response(200, {
        id: "agent_run_2",
        status: "failed",
        error: { message: "budget exhausted" },
      }),
    );
    await expect(
      runExaAgent(
        { query: "x", effort: "low", outputSchema: {} },
        { fetchImpl: failed, pollMs: 1 },
      ),
    ).rejects.toThrow("budget exhausted");

    const refused = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(402, { error: "out of credits" }));
    await expect(
      runExaAgent(
        { query: "x", effort: "low", outputSchema: {} },
        { fetchImpl: refused },
      ),
    ).rejects.toThrow("could not start (402)");
  });

  it("refuses without a key", async () => {
    env.EXA_API_KEY = undefined;
    await expect(
      runExaAgent({ query: "x", effort: "low", outputSchema: {} }),
    ).rejects.toThrow("not configured");
  });
});
