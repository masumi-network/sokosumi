import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRegistryClient } from "./masumi-registry.client.js";

const postRegistryDiffMock = vi.fn();
const postRegistryEntryMock = vi.fn();

vi.mock("./openapi/generated/registry/index.js", () => ({
  postRegistryDiff: (...args: unknown[]) => postRegistryDiffMock(...args),
  postRegistryEntry: (...args: unknown[]) => postRegistryEntryMock(...args),
}));

describe("createRegistryClient.getAgentsDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postRegistryDiffMock.mockResolvedValue({
      data: {
        data: {
          entries: [],
        },
      },
      error: undefined,
      response: {
        status: 200,
      },
    });
  });

  it("forwards abort signal to registry diff request", async () => {
    const registry = createRegistryClient(
      "Preprod",
      "https://registry.example.com",
      "api-key",
    );
    const abortSignal = AbortSignal.timeout(1000);

    const result = await registry.getAgentsDiff(
      new Date("2026-02-25T00:00:00.000Z"),
      null,
      20,
      {
        signal: abortSignal,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(postRegistryDiffMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: abortSignal,
        body: expect.objectContaining({
          cursorId: undefined,
          limit: 20,
          network: "Preprod",
        }),
      }),
    );
  });

  it("remains backward compatible when no options are provided", async () => {
    const registry = createRegistryClient(
      "Mainnet",
      "https://registry.example.com",
      "api-key",
    );

    const result = await registry.getAgentsDiff(
      new Date("2026-02-25T00:00:00.000Z"),
      "cursor-1",
      10,
    );

    expect(result.isOk()).toBe(true);
    expect(postRegistryDiffMock).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: undefined,
        body: expect.objectContaining({
          cursorId: "cursor-1",
          limit: 10,
          network: "Mainnet",
        }),
      }),
    );
  });
});
