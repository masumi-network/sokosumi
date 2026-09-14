import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCoreClient } from "./core.shared";
import { createClient } from "./generated/core/client";

const sdk = vi.hoisted(() => ({
  listSokoBotAvatars: vi.fn(),
  topUpSokoBotAvatars: vi.fn(),
  claimMySokoBotAvatar: vi.fn(),
}));

vi.mock("@/lib/clients/generated/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./generated/core")>()),
  ...sdk,
}));

const client = createClient({
  baseUrl: "https://core.example/v1",
  headers: { authorization: "Bearer session-token" },
});
const getClient = vi.fn(async () => client);
const core = createCoreClient(getClient);
const response = {
  data: [{ id: "avatar-1", imageUrl: "https://example.com/avatar.png" }],
  meta: { timestamp: new Date("2026-09-14T12:00:00Z"), requestId: "req-1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const operation of Object.values(sdk)) {
    operation.mockResolvedValue({
      data: response,
      response: new Response("{}", { status: 200 }),
    });
  }
});

describe("Soko Bot avatar methods on the Core client", () => {
  it("reads the pool without caching and preserves the authenticated client", async () => {
    const query = { take: 6, exclude: "avatar-2,avatar-3" };

    await expect(core.listSokoBotAvatars(query)).resolves.toBe(response);

    expect(getClient).toHaveBeenCalledOnce();
    expect(sdk.listSokoBotAvatars).toHaveBeenCalledWith({
      client,
      query,
      cache: "no-store",
    });
  });

  it("forwards the top-up request and response", async () => {
    const body = { take: 6, excludeIds: ["avatar-2"] };

    await expect(core.topUpSokoBotAvatars(body)).resolves.toBe(response);

    expect(sdk.topUpSokoBotAvatars).toHaveBeenCalledWith({ client, body });
  });

  it("forwards the selected avatar and returns the updated bot", async () => {
    const botResponse = { ...response, data: { id: "bot-1" } };
    sdk.claimMySokoBotAvatar.mockResolvedValue({
      data: botResponse,
      response: new Response("{}", { status: 200 }),
    });
    const body = { avatarId: "avatar-1" };

    await expect(core.claimMySokoBotAvatar(body)).resolves.toBe(botResponse);

    expect(sdk.claimMySokoBotAvatar).toHaveBeenCalledWith({ client, body });
  });

  it.each([
    ["listSokoBotAvatars", () => core.listSokoBotAvatars()],
    ["topUpSokoBotAvatars", () => core.topUpSokoBotAvatars({ take: 6 })],
    [
      "claimMySokoBotAvatar",
      () => core.claimMySokoBotAvatar({ avatarId: "avatar-1" }),
    ],
  ] as const)(
    "preserves Core error details for %s",
    async (operation, invoke) => {
      sdk[operation].mockResolvedValue({
        error: { message: "Avatar unavailable", kind: "avatar_unavailable" },
        response: new Response("{}", {
          status: 409,
          headers: { "x-request-id": "req-conflict" },
        }),
      });

      await expect(invoke()).rejects.toMatchObject({
        name: "CoreApiRequestError",
        message: "Avatar unavailable",
        kind: "avatar_unavailable",
        status: 409,
        requestId: "req-conflict",
      });
    },
  );
});
