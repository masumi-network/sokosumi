import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSessionMock, executeToolMock, deleteSessionMock } = vi.hoisted(
  () => ({
    createSessionMock: vi.fn(),
    executeToolMock: vi.fn(),
    deleteSessionMock: vi.fn(),
  }),
);

vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  deleteComposioToolSession: deleteSessionMock,
}));
vi.mock("@/clients/social-post-providers/tools", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/clients/social-post-providers/tools")
  >()),
  createComposioToolSession: createSessionMock,
  executeComposioTool: executeToolMock,
}));

import { listMetaAdAccounts } from "./meta-ads";

const input = {
  connectedAccountId: "ca_meta",
  executorUserId: "sokosumi:project-executor:project_1",
};

describe("listMetaAdAccounts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
  });

  it("maps ad accounts from the data list", async () => {
    executeToolMock.mockResolvedValue({
      data: [
        {
          id: "act_1",
          name: "Brand",
          currency: "EUR",
          timezone_name: "Europe/Berlin",
        },
        { id: "2", currency: "USD" },
      ],
    });
    expect(await listMetaAdAccounts(input)).toEqual([
      {
        externalAccountId: "act_1",
        name: "Brand",
        currency: "EUR",
        timeZone: "Europe/Berlin",
      },
      {
        externalAccountId: "act_2",
        name: "act_2",
        currency: "USD",
        timeZone: null,
      },
    ]);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "metaads",
        connectedAccountId: "ca_meta",
        toolSlugs: ["METAADS_GET_AD_ACCOUNTS"],
      }),
    );
    expect(deleteSessionMock).toHaveBeenCalledWith(
      "sess_1",
      expect.any(String),
    );
  });

  it("returns nothing when the user has no ad accounts", async () => {
    executeToolMock.mockResolvedValue({ data: [] });
    expect(await listMetaAdAccounts(input)).toEqual([]);
  });

  it("raises an account without a currency", async () => {
    executeToolMock.mockResolvedValue({ data: [{ id: "act_1" }] });
    await expect(listMetaAdAccounts(input)).rejects.toThrow(/invalid response/);
  });
});
