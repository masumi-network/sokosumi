import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioToolError } from "@/clients/social-post-providers/tools";

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

import { listGoogleAdAccounts } from "./google-ads";

const input = {
  connectedAccountId: "ca_google",
  executorUserId: "sokosumi:project-executor:project_1",
};

function customerResult(customerId: string): Record<string, unknown> {
  switch (customerId) {
    case "111":
      return {
        data: [
          {
            results: [
              {
                customer: {
                  id: "111",
                  descriptiveName: "Direct Shop",
                  currencyCode: "EUR",
                  timeZone: "Europe/Berlin",
                },
              },
            ],
          },
        ],
      };
    case "222":
      // Manager account: its clients are out of reach without login-customer-id.
      return {
        results: [
          {
            customer: {
              id: "222",
              descriptiveName: "Agency",
              currencyCode: "USD",
              manager: true,
            },
          },
        ],
      };
    case "333":
      // snake_case, numeric id, no name
      return {
        results: [
          { customer: { id: 333, currency_code: "USD", time_zone: "UTC" } },
        ],
      };
    default:
      throw new ComposioToolError({ message: "no access" });
  }
}

describe("listGoogleAdAccounts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    executeToolMock.mockImplementation(
      async (call: {
        toolSlug: string;
        arguments: { customer_id?: string };
      }) =>
        call.toolSlug === "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS"
          ? {
              resource_names: [
                "customers/111",
                "customers/222",
                "customers/333",
                "customers/999",
              ],
            }
          : customerResult(call.arguments.customer_id ?? ""),
    );
  });

  it("lists direct customer accounts only", async () => {
    expect(await listGoogleAdAccounts(input)).toEqual([
      {
        externalAccountId: "111",
        name: "Direct Shop",
        currency: "EUR",
        timeZone: "Europe/Berlin",
      },
      {
        externalAccountId: "333",
        name: "Account 333",
        currency: "USD",
        timeZone: "UTC",
      },
    ]);
  });

  it("never queries manager client accounts", async () => {
    await listGoogleAdAccounts(input);
    const queries = executeToolMock.mock.calls.map(
      ([call]) => call.arguments.query ?? "",
    );
    expect(queries.some((query: string) => /customer_client/.test(query))).toBe(
      false,
    );
  });

  it("pins the session to the connected account and the account tools, then deletes it", async () => {
    await listGoogleAdAccounts(input);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "googleads",
        connectedAccountId: "ca_google",
        executorUserId: input.executorUserId,
        toolSlugs: [
          "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS",
          "GOOGLEADS_SEARCH_STREAM_GAQL",
        ],
      }),
    );
    expect(deleteSessionMock).toHaveBeenCalledWith(
      "sess_1",
      expect.any(String),
    );
  });

  it("raises a response that does not match the expected shape", async () => {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
      call.toolSlug === "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS"
        ? { resource_names: ["customers/111"] }
        : { results: [{ customer: { id: "111" } }] },
    );
    await expect(listGoogleAdAccounts(input)).rejects.toThrow(
      /invalid response/,
    );
    expect(deleteSessionMock).toHaveBeenCalled();
  });
});
