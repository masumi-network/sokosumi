import { createClient } from "@sokosumi/core-client/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCoreClient } from "./core.shared";

const sdk = vi.hoisted(() => ({
  getMySokoBotTurnResults: vi.fn(),
  getSokoBotTurnResults: vi.fn(),
}));

vi.mock("@sokosumi/core-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/core-client")>()),
  ...sdk,
}));

const client = createClient({ baseUrl: "https://core.example/v1" });
const core = createCoreClient(async () => client);
const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

beforeEach(() => {
  vi.clearAllMocks();
  for (const operation of Object.values(sdk)) {
    operation.mockResolvedValue({
      data: { data: [] },
      response: new Response("{}", { status: 200 }),
    });
  }
});

describe("getMySokoBotTurnResults", () => {
  it("reads a shared bot's turn by id", async () => {
    await core.getMySokoBotTurnResults("t1", BOT_ID);
    expect(sdk.getSokoBotTurnResults).toHaveBeenCalledWith({
      client,
      path: { sokoBotId: BOT_ID, turnId: "t1" },
      cache: "no-store",
    });
    expect(sdk.getMySokoBotTurnResults).not.toHaveBeenCalled();
  });

  it("reads the caller's own turn without an id", async () => {
    await core.getMySokoBotTurnResults("t1");
    expect(sdk.getMySokoBotTurnResults).toHaveBeenCalledWith({
      client,
      path: { turnId: "t1" },
      cache: "no-store",
    });
    expect(sdk.getSokoBotTurnResults).not.toHaveBeenCalled();
  });
});
