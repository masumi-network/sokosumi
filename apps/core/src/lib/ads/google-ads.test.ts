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

function gaqlResult(customerId: string, query: string): unknown {
  if (query.includes("FROM customer LIMIT 1")) {
    if (customerId === "111") {
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
    }
    if (customerId === "222") {
      // snake_case, JSON string, manager account
      return {
        data: JSON.stringify([
          {
            results: [
              {
                customer: {
                  id: 222,
                  descriptive_name: "Agency",
                  currency_code: "USD",
                  manager: true,
                },
              },
            ],
          },
        ]),
      };
    }
    throw new ComposioToolError({ message: "no access" });
  }
  return {
    data: [
      {
        results: [
          {
            customerClient: {
              id: "333",
              descriptiveName: "",
              currencyCode: "USD",
              timeZone: "America/New_York",
            },
          },
          {
            customerClient: {
              id: "111",
              descriptiveName: "Direct Shop",
              currencyCode: "EUR",
            },
          },
        ],
      },
    ],
  };
}

describe("listGoogleAdAccounts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    executeToolMock.mockImplementation(
      async (call: {
        toolSlug: string;
        arguments: { customer_id?: string; query?: string };
      }) => {
        if (call.toolSlug === "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS") {
          return {
            resource_names: ["customers/111", "customers/222", "customers/999"],
          };
        }
        return gaqlResult(
          call.arguments.customer_id ?? "",
          call.arguments.query ?? "",
        );
      },
    );
  });

  it("lists direct accounts and manager clients, skipping unreachable customers", async () => {
    const accounts = await listGoogleAdAccounts(input);
    expect(accounts).toEqual([
      {
        externalAccountId: "111",
        name: "Direct Shop",
        currency: "EUR",
        timeZone: "Europe/Berlin",
        loginCustomerId: null,
      },
      {
        externalAccountId: "333",
        name: "Account 333",
        currency: "USD",
        timeZone: "America/New_York",
        loginCustomerId: "222",
      },
    ]);
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
