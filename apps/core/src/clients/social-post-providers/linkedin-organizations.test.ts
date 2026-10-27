import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listLinkedInAdministeredOrganizations,
  listLinkedInAdministeredOrganizationUrns,
} from "@/clients/social-post-providers/linkedin-organizations";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => null }));

const connection = {
  connectedAccountId: "ca_li",
  executorUserId: "sokosumi:project-executor:project_123",
};

interface ExecuteCall {
  tool_slug: string;
  arguments: Record<string, unknown>;
}
interface ProxyCall {
  endpoint: string;
  method: string;
}

function stub(handlers: {
  execute: (call: ExecuteCall) => Response;
  proxy?: (call: ProxyCall) => unknown;
}) {
  const fetchMock = vi.fn(
    async (url: URL, init?: RequestInit): Promise<Response> => {
      if (url.pathname === "/api/v3.1/tool_router/session") {
        return Response.json({ session_id: "sess_li" });
      }
      if (url.pathname.endsWith("/execute")) {
        return handlers.execute(JSON.parse(String(init?.body)));
      }
      if (url.pathname.endsWith("/proxy")) {
        return Response.json(
          handlers.proxy?.(JSON.parse(String(init?.body))) ?? { status: 404 },
        );
      }
      if (init?.method === "DELETE") return Response.json({});
      throw new Error(`Unexpected path ${url.pathname}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function acls(ids: number[], total?: number): Response {
  return Response.json({
    data: {
      data: {
        elements: ids.map((id) => ({
          organization: `urn:li:organization:${id}`,
          role: "ADMINISTRATOR",
          state: "APPROVED",
        })),
        paging: { total },
      },
    },
    error: null,
    successful: true,
  });
}

function executeCalls(fetchMock: ReturnType<typeof stub>): ExecuteCall[] {
  return fetchMock.mock.calls
    .filter(([url]) => url.pathname.endsWith("/execute"))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

describe("LinkedIn administered organizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ COMPOSIO_API_KEY: "test-key" });
  });

  it("pages through approved administrator roles", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => index + 1);
    const fetchMock = stub({
      execute: (call) =>
        call.arguments.start === 0 ? acls(firstPage, 102) : acls([101, 102]),
    });

    const urns = await listLinkedInAdministeredOrganizationUrns(connection);

    expect(urns).toHaveLength(100);
    expect(urns?.[0]).toBe("urn:li:organization:1");
    expect(executeCalls(fetchMock).map((call) => call.arguments)).toEqual([
      { role: "ADMINISTRATOR", state: "APPROVED", start: 0, count: 100 },
    ]);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("requests the next page while LinkedIn returns full pages", async () => {
    const fetchMock = stub({
      execute: (call) =>
        call.arguments.role !== "ADMINISTRATOR"
          ? acls([])
          : call.arguments.start === 0
            ? acls(Array.from({ length: 100 }, () => 5))
            : acls([6, 7]),
    });

    await expect(
      listLinkedInAdministeredOrganizationUrns(connection),
    ).resolves.toEqual([
      "urn:li:organization:5",
      "urn:li:organization:6",
      "urn:li:organization:7",
    ]);
    expect(executeCalls(fetchMock).map((call) => call.arguments.start)).toEqual(
      [0, 100, 0],
    );
  });

  it("includes pages the member manages as content administrator", async () => {
    const fetchMock = stub({
      execute: (call) =>
        call.arguments.role === "ADMINISTRATOR" ? acls([1, 2]) : acls([2, 3]),
    });

    await expect(
      listLinkedInAdministeredOrganizationUrns(connection),
    ).resolves.toEqual([
      "urn:li:organization:1",
      "urn:li:organization:2",
      "urn:li:organization:3",
    ]);
    expect(executeCalls(fetchMock).map((call) => call.arguments)).toEqual([
      { role: "ADMINISTRATOR", state: "APPROVED", start: 0, count: 100 },
      {
        role: "CONTENT_ADMINISTRATOR",
        state: "APPROVED",
        start: 0,
        count: 100,
      },
    ]);
  });

  it("reports a missing page permission instead of failing", async () => {
    stub({
      execute: () =>
        Response.json({
          data: null,
          error: {
            message: "Not enough permissions to access: ACCESS_DENIED",
            status: 403,
          },
          successful: false,
        }),
    });

    await expect(
      listLinkedInAdministeredOrganizations(connection),
    ).resolves.toEqual({ status: "permission_missing", organizations: [] });
  });

  it("reads each page's name, vanity name and logo", async () => {
    const fetchMock = stub({
      execute: () => acls([777]),
      proxy: (call) =>
        call.endpoint.includes("/organizations/")
          ? {
              status: 200,
              data: {
                localizedName: "Example Company",
                vanityName: "example-company",
                logoV2: { original: "urn:li:digitalmediaAsset:C4E" },
              },
            }
          : {
              status: 200,
              data: { downloadUrl: "https://media.licdn.com/logo.png" },
            },
    });

    await expect(
      listLinkedInAdministeredOrganizations(connection),
    ).resolves.toEqual({
      status: "ok",
      organizations: [
        {
          urn: "urn:li:organization:777",
          name: "Example Company",
          vanityName: "example-company",
          logoUrl: "https://media.licdn.com/logo.png",
        },
      ],
    });
    const proxied = fetchMock.mock.calls
      .filter(([url]) => url.pathname.endsWith("/proxy"))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(proxied.map((call) => call.endpoint)).toEqual([
      "https://api.linkedin.com/rest/organizations/777",
      "https://api.linkedin.com/rest/images/urn%3Ali%3Aimage%3AC4E",
    ]);
    expect(proxied[0].connected_account_id).toBe("ca_li");
  });

  it("still lists a page whose details cannot be read", async () => {
    stub({ execute: () => acls([778]), proxy: () => ({ status: 403 }) });

    await expect(
      listLinkedInAdministeredOrganizations(connection),
    ).resolves.toEqual({
      status: "ok",
      organizations: [
        {
          urn: "urn:li:organization:778",
          name: null,
          vanityName: null,
          logoUrl: null,
        },
      ],
    });
  });
});
