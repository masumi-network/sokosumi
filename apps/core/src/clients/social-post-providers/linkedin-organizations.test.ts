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
  connected_account_id: string;
  endpoint: string;
  method: string;
  parameters: { name: string; value: string; type: "header" | "query" }[];
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
        const call: ProxyCall = JSON.parse(String(init?.body));
        return Response.json(
          handlers.proxy?.(call) ??
            (call.endpoint.endsWith("/organizationAcls")
              ? { status: 200, data: aclData([]) }
              : { status: 404 }),
        );
      }
      if (init?.method === "DELETE") return Response.json({});
      throw new Error(`Unexpected path ${url.pathname}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function aclData(ids: number[], total?: number) {
  return {
    elements: ids.map((id) => ({
      organization: `urn:li:organization:${id}`,
      role: "ADMINISTRATOR",
      state: "APPROVED",
    })),
    paging: { total },
  };
}

function acls(ids: number[], total?: number): Response {
  return Response.json({
    data: {
      data: aclData(ids, total),
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

function proxyCalls(fetchMock: ReturnType<typeof stub>): ProxyCall[] {
  return fetchMock.mock.calls
    .filter(([url]) => url.pathname.endsWith("/proxy"))
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
      [0, 100],
    );
  });

  it("includes pages the member manages as content administrator", async () => {
    const fetchMock = stub({
      execute: (call) =>
        call.arguments.role === "ADMINISTRATOR"
          ? acls([1, 2])
          : Response.json({
              successful: false,
              error: {
                message:
                  "role must be ADMINISTRATOR or DIRECT_SPONSORED_CONTENT_POSTER",
                status: 400,
              },
            }),
      proxy: () => ({ status: 200, data: aclData([2, 3]) }),
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
    ]);
    expect(proxyCalls(fetchMock)).toEqual([
      {
        connected_account_id: "ca_li",
        endpoint: "https://api.linkedin.com/rest/organizationAcls",
        method: "GET",
        parameters: [
          { name: "LinkedIn-Version", value: "202606", type: "header" },
          { name: "X-Restli-Protocol-Version", value: "2.0.0", type: "header" },
          { name: "q", value: "roleAssignee", type: "query" },
          { name: "role", value: "CONTENT_ADMINISTRATOR", type: "query" },
          { name: "state", value: "APPROVED", type: "query" },
          { name: "start", value: "0", type: "query" },
          { name: "count", value: "100", type: "query" },
        ],
      },
    ]);
  });

  it("pages through content administrator ACLs via proxy", async () => {
    const fetchMock = stub({
      execute: () => acls([]),
      proxy: (call) => ({
        status: 200,
        data: aclData(
          call.parameters.find((parameter) => parameter.name === "start")
            ?.value === "0"
            ? Array.from({ length: 100 }, () => 5)
            : [6, 7],
        ),
      }),
    });

    await expect(
      listLinkedInAdministeredOrganizationUrns(connection),
    ).resolves.toEqual([
      "urn:li:organization:5",
      "urn:li:organization:6",
      "urn:li:organization:7",
    ]);
    expect(
      proxyCalls(fetchMock).map(
        (call) =>
          call.parameters.find((parameter) => parameter.name === "start")
            ?.value,
      ),
    ).toEqual(["0", "100"]);
  });

  it("reads administrator ACLs via proxy when the tool returns company details", async () => {
    const fetchMock = stub({
      execute: () =>
        Response.json({
          successful: true,
          data: { id: 1, localizedName: "Example Company" },
        }),
      proxy: (call) => ({
        status: 200,
        data: aclData(
          call.parameters.find((parameter) => parameter.name === "role")
            ?.value === "ADMINISTRATOR"
            ? [1, 2]
            : [],
        ),
      }),
    });

    await expect(
      listLinkedInAdministeredOrganizationUrns(connection),
    ).resolves.toEqual(["urn:li:organization:1", "urn:li:organization:2"]);
    expect(executeCalls(fetchMock).map((call) => call.arguments.role)).toEqual([
      "ADMINISTRATOR",
    ]);
    expect(
      proxyCalls(fetchMock).map(
        (call) =>
          call.parameters.find((parameter) => parameter.name === "role")?.value,
      ),
    ).toEqual(["ADMINISTRATOR", "CONTENT_ADMINISTRATOR"]);
  });

  it("lists content-only pages when the administrator tool reports no matching organizations", async () => {
    const fetchMock = stub({
      execute: () =>
        Response.json({
          successful: false,
          error: { message: "No matching organizations found", status: 400 },
        }),
      proxy: (call) => ({
        status: 200,
        data: aclData(
          call.parameters.find((parameter) => parameter.name === "role")
            ?.value === "CONTENT_ADMINISTRATOR"
            ? [3]
            : [],
        ),
      }),
    });

    await expect(
      listLinkedInAdministeredOrganizationUrns(connection),
    ).resolves.toEqual(["urn:li:organization:3"]);
    expect(executeCalls(fetchMock).map((call) => call.arguments.role)).toEqual([
      "ADMINISTRATOR",
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

  it.each([401, 403])(
    "reports permission missing for a content ACL proxy %s response",
    async (status) => {
      const fetchMock = stub({
        execute: () => acls([]),
        proxy: () => ({ status, data: { message: "ACCESS_DENIED" } }),
      });

      await expect(
        listLinkedInAdministeredOrganizations(connection),
      ).resolves.toEqual({ status: "permission_missing", organizations: [] });
      expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    },
  );

  it("recognizes missing scopes in the ACL proxy's provider message", async () => {
    stub({
      execute: () => acls([]),
      proxy: () => ({
        status: 400,
        data: { message: "The access token lacks the required scope" },
      }),
    });

    await expect(
      listLinkedInAdministeredOrganizations(connection),
    ).resolves.toEqual({ status: "permission_missing", organizations: [] });
  });

  it.each([429, 500])("propagates an ACL proxy %s response", async (status) => {
    const fetchMock = stub({
      execute: () => acls([]),
      proxy: () => ({
        status,
        data: { message: "Page permission checks are temporarily unavailable" },
      }),
    });

    await expect(
      listLinkedInAdministeredOrganizationUrns(connection),
    ).rejects.toMatchObject({
      name: "ComposioToolError",
      providerStatus: status,
    });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it.each([429, 500])(
    "propagates an administrator tool %s response without proxy fallback",
    async (status) => {
      const fetchMock = stub({
        execute: () =>
          Response.json({
            successful: false,
            error: { message: "No organizations found", status },
          }),
      });

      await expect(
        listLinkedInAdministeredOrganizationUrns(connection),
      ).rejects.toMatchObject({
        name: "ComposioToolError",
        providerStatus: status,
      });
      expect(proxyCalls(fetchMock)).toEqual([]);
    },
  );

  it("reads each page's name, vanity name and logo", async () => {
    const fetchMock = stub({
      execute: () => acls([777]),
      proxy: (call) =>
        call.endpoint.endsWith("/organizationAcls")
          ? { status: 200, data: aclData([]) }
          : call.endpoint.includes("/organizations/")
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
    const proxied = proxyCalls(fetchMock);
    expect(proxied.map((call) => call.endpoint)).toEqual([
      "https://api.linkedin.com/rest/organizationAcls",
      "https://api.linkedin.com/rest/organizations/777",
      "https://api.linkedin.com/rest/images/urn%3Ali%3Aimage%3AC4E",
    ]);
    expect(proxied[0].connected_account_id).toBe("ca_li");
  });

  it("still lists a page whose details cannot be read", async () => {
    stub({
      execute: () => acls([778]),
      proxy: (call) =>
        call.endpoint.endsWith("/organizationAcls")
          ? { status: 200, data: aclData([]) }
          : { status: 403 },
    });

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
