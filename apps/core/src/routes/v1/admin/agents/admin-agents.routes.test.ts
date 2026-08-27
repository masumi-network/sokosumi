import { AgentStatus } from "@sokosumi/database";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountGetAdminAgent from "./[id]/get";
import mountDeleteAdminAgentMetadataOverride from "./[id]/metadata-override/delete";
import mountPatchAdminAgentMetadataOverride from "./[id]/metadata-override/patch";
import mountGetAdminAgents from "./get";

const {
  agentCountMock,
  agentFindManyMock,
  agentFindUniqueMock,
  agentMetadataOverrideDeleteManyMock,
  agentMetadataOverrideFindUniqueMock,
  agentMetadataOverrideUpsertMock,
  agentMetadataOverrideUpdateMock,
  agentMetadataOverrideDeleteMock,
  exampleOutputCreateManyMock,
  exampleOutputDeleteManyMock,
  tagUpsertMock,
  transactionMock,
  queryRawMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  agentCountMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  agentFindUniqueMock: vi.fn(),
  agentMetadataOverrideDeleteManyMock: vi.fn(),
  agentMetadataOverrideFindUniqueMock: vi.fn(),
  agentMetadataOverrideUpsertMock: vi.fn(),
  agentMetadataOverrideUpdateMock: vi.fn(),
  agentMetadataOverrideDeleteMock: vi.fn(),
  exampleOutputCreateManyMock: vi.fn(),
  exampleOutputDeleteManyMock: vi.fn(),
  tagUpsertMock: vi.fn(),
  transactionMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: {
      count: agentCountMock,
      findMany: agentFindManyMock,
      findUnique: agentFindUniqueMock,
    },
    agentMetadataOverride: {
      deleteMany: agentMetadataOverrideDeleteManyMock,
      upsert: agentMetadataOverrideUpsertMock,
      update: agentMetadataOverrideUpdateMock,
      findUnique: agentMetadataOverrideFindUniqueMock,
      delete: agentMetadataOverrideDeleteMock,
    },
    exampleOutput: {
      createMany: exampleOutputCreateManyMock,
      deleteMany: exampleOutputDeleteManyMock,
    },
    tag: {
      upsert: tagUpsertMock,
    },
    $transaction: transactionMock,
    $queryRawUnsafe: queryRawMock,
  },
}));

const now = new Date("2026-01-01T00:00:00.000Z");

function createRegistryAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent_1",
    createdAt: now,
    updatedAt: now,
    blockchainIdentifier: "chain_1",
    name: "Registry Name",
    description: "Registry description",
    apiBaseUrl: "https://registry.example.com",
    type: "STANDARD",
    openApiSpecUrl: null,
    x402ResourcesUrl: null,
    paymentType: "WEB3_CARDANO_V1",
    metadataVersion: 1,
    supersededByAgentIdentifier: null,
    capabilityName: "cap",
    capabilityVersion: "1.0.0",
    authorName: "Author",
    authorImage: null,
    authorContactEmail: null,
    authorContactOther: null,
    authorOrganization: null,
    legalPrivacyPolicy: null,
    legalDpa: null,
    legalTerms: null,
    legalOther: null,
    image: null,
    icon: null,
    status: "ONLINE",
    isShown: true,
    metadataOverride: null,
    tags: [],
    exampleOutput: [],
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  mountGetAdminAgents(app);
  mountGetAdminAgent(app);
  mountPatchAdminAgentMetadataOverride(app);
  mountDeleteAdminAgentMetadataOverride(app);

  return app;
}

describe("admin agents routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRawMock.mockResolvedValue([]);
    transactionMock.mockImplementation(async (arg) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg({
        agentMetadataOverride: {
          upsert: agentMetadataOverrideUpsertMock,
          update: agentMetadataOverrideUpdateMock,
          findUnique: agentMetadataOverrideFindUniqueMock,
          delete: agentMetadataOverrideDeleteMock,
        },
        exampleOutput: {
          createMany: exampleOutputCreateManyMock,
          deleteMany: exampleOutputDeleteManyMock,
        },
        tag: {
          upsert: tagUpsertMock,
        },
      });
    });
    agentFindManyMock.mockResolvedValue([createRegistryAgent()]);
    agentCountMock.mockResolvedValue(1);
    agentFindUniqueMock.mockResolvedValue(createRegistryAgent());
    agentMetadataOverrideUpsertMock.mockResolvedValue({
      id: "override_1",
      tags: [],
      exampleOutputs: [],
    });
    agentMetadataOverrideFindUniqueMock.mockResolvedValue({
      id: "override_1",
      name: "Display Name",
      description: null,
      apiBaseUrl: null,
      capabilityName: null,
      capabilityVersion: null,
      authorName: null,
      authorImage: null,
      authorContactEmail: null,
      authorContactOther: null,
      authorOrganization: null,
      legalPrivacyPolicy: null,
      legalDpa: null,
      legalTerms: null,
      legalOther: null,
      image: null,
      tags: [],
      exampleOutputs: [],
    });
    agentMetadataOverrideUpdateMock.mockResolvedValue({ id: "override_1" });
    agentMetadataOverrideDeleteMock.mockResolvedValue({ id: "override_1" });
    tagUpsertMock.mockResolvedValue({ id: "tag_1", name: "research" });
    exampleOutputDeleteManyMock.mockResolvedValue({ count: 0 });
    exampleOutputCreateManyMock.mockResolvedValue({ count: 1 });
    agentMetadataOverrideDeleteManyMock.mockResolvedValue({ count: 1 });
  });

  it("lists agents with resolved display fields", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({
      id: "agent_1",
      registryName: "Registry Name",
      hasOverride: false,
      displayName: "Registry Name",
    });
  });

  it("filters agents by status query param", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?status=ONLINE");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: AgentStatus.ONLINE },
      }),
    );
    expect(agentCountMock).toHaveBeenCalledWith({
      where: { status: AgentStatus.ONLINE },
    });
  });

  it("combines search and status filters in list where", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?q=research&status=OFFLINE",
    );

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { name: { contains: "research", mode: "insensitive" } },
                {
                  blockchainIdentifier: {
                    contains: "research",
                    mode: "insensitive",
                  },
                },
                {
                  metadataOverride: {
                    is: {
                      name: { contains: "research", mode: "insensitive" },
                    },
                  },
                },
              ],
            },
            { status: AgentStatus.OFFLINE },
          ],
        },
      }),
    );
    expect(agentCountMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: "research", mode: "insensitive" } },
              {
                blockchainIdentifier: {
                  contains: "research",
                  mode: "insensitive",
                },
              },
              {
                metadataOverride: {
                  is: {
                    name: { contains: "research", mode: "insensitive" },
                  },
                },
              },
            ],
          },
          { status: AgentStatus.OFFLINE },
        ],
      },
    });
  });

  it("rejects invalid status query param", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?status=UNKNOWN");

    expect(response.status).toBe(422);
    expect(agentFindManyMock).not.toHaveBeenCalled();
    expect(agentCountMock).not.toHaveBeenCalled();
  });

  it("defaults list sort to createdAt desc with stable id tie-breaker", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("applies alternate sortBy and sortOrder query params", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?sortBy=registryName&sortOrder=asc",
    );

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("sorts displayName via coalesce SQL then hydrates agents in that order", async () => {
    queryRawMock.mockResolvedValue([{ id: "agent_2" }, { id: "agent_1" }]);
    agentFindManyMock.mockResolvedValue([
      createRegistryAgent({ id: "agent_1", name: "Zebra" }),
      createRegistryAgent({
        id: "agent_2",
        name: "Registry",
        metadataOverride: { name: "Alpha", image: null },
      }),
    ]);
    agentCountMock.mockResolvedValue(2);

    const app = createApp();
    const response = await app.request(
      "http://localhost/?sortBy=displayName&sortOrder=asc",
    );

    expect(response.status).toBe(200);
    expect(queryRawMock).toHaveBeenCalled();
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["agent_2", "agent_1"] } },
      }),
    );
    const body = await response.json();
    expect(body.data.map((agent: { id: string }) => agent.id)).toEqual([
      "agent_2",
      "agent_1",
    ]);
    expect(body.data[0].displayName).toBe("Alpha");
    expect(body.data[1].displayName).toBe("Zebra");
  });

  it("returns 422 for invalid sortBy", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/?sortBy=invalidColumn",
    );

    expect(response.status).toBe(422);
    expect(agentFindManyMock).not.toHaveBeenCalled();
  });

  it("returns agent detail with registry and resolved preview", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/agent_1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.registry.name).toBe("Registry Name");
    expect(body.data.override).toBeNull();
    expect(body.data.resolved.name).toBe("Registry Name");
  });

  it("patches metadata override scalars", async () => {
    agentFindUniqueMock
      .mockResolvedValueOnce(createRegistryAgent())
      .mockResolvedValueOnce(
        createRegistryAgent({
          metadataOverride: {
            id: "override_1",
            createdAt: now,
            updatedAt: now,
            agentId: "agent_1",
            name: "Display Name",
            description: null,
            apiBaseUrl: null,
            capabilityName: null,
            capabilityVersion: null,
            authorName: null,
            authorImage: null,
            authorContactEmail: null,
            authorContactOther: null,
            authorOrganization: null,
            legalPrivacyPolicy: null,
            legalDpa: null,
            legalTerms: null,
            legalOther: null,
            image: null,
            tags: [],
            exampleOutputs: [],
          },
        }),
      );

    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_1/metadata-override",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Display Name" }),
      },
    );

    expect(response.status).toBe(200);
    expect(agentMetadataOverrideUpsertMock).toHaveBeenCalled();
    const body = await response.json();
    expect(body.data.resolved.name).toBe("Display Name");
  });

  it("rejects invalid apiBaseUrl overrides", async () => {
    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_1/metadata-override",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiBaseUrl: "https://agent.example.com/path?token=1",
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(agentMetadataOverrideUpsertMock).not.toHaveBeenCalled();
  });

  it("replaces tags and example outputs on patch", async () => {
    agentFindUniqueMock
      .mockResolvedValueOnce(createRegistryAgent())
      .mockResolvedValueOnce(
        createRegistryAgent({
          metadataOverride: {
            id: "override_1",
            createdAt: now,
            updatedAt: now,
            agentId: "agent_1",
            name: null,
            description: null,
            apiBaseUrl: null,
            capabilityName: null,
            capabilityVersion: null,
            authorName: null,
            authorImage: null,
            authorContactEmail: null,
            authorContactOther: null,
            authorOrganization: null,
            legalPrivacyPolicy: null,
            legalDpa: null,
            legalTerms: null,
            legalOther: null,
            image: null,
            tags: [{ id: "tag_1", name: "research" }],
            exampleOutputs: [
              {
                id: "ex_1",
                name: "Sample",
                mimeType: "image/png",
                url: "https://example.com/out.png",
              },
            ],
          },
          tags: [],
          exampleOutput: [],
        }),
      );

    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_1/metadata-override",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tags: ["research"],
          exampleOutputs: [
            {
              name: "Sample",
              mimeType: "image/png",
              url: "https://example.com/out.png",
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(tagUpsertMock).toHaveBeenCalledWith({
      where: { name: "research" },
      create: { name: "research" },
      update: {},
    });
    expect(agentMetadataOverrideUpdateMock).toHaveBeenCalledWith({
      where: { id: "override_1" },
      data: {
        tags: {
          set: [{ id: "tag_1" }],
        },
      },
    });
    expect(exampleOutputDeleteManyMock).toHaveBeenCalledWith({
      where: { metadataOverrideId: "override_1" },
    });
    expect(exampleOutputCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          metadataOverrideId: "override_1",
          name: "Sample",
          mimeType: "image/png",
          url: "https://example.com/out.png",
        },
      ],
    });
    const body = await response.json();
    expect(body.data.resolved.tags).toEqual(["research"]);
    expect(body.data.resolved.exampleOutputs).toEqual([
      {
        name: "Sample",
        mimeType: "image/png",
        url: "https://example.com/out.png",
      },
    ]);
  });

  it("prunes an empty override after clearing collections", async () => {
    agentMetadataOverrideFindUniqueMock.mockResolvedValue({
      id: "override_1",
      name: null,
      description: null,
      apiBaseUrl: null,
      capabilityName: null,
      capabilityVersion: null,
      authorName: null,
      authorImage: null,
      authorContactEmail: null,
      authorContactOther: null,
      authorOrganization: null,
      legalPrivacyPolicy: null,
      legalDpa: null,
      legalTerms: null,
      legalOther: null,
      image: null,
      tags: [],
      exampleOutputs: [],
    });
    agentFindUniqueMock
      .mockResolvedValueOnce(createRegistryAgent())
      .mockResolvedValueOnce(createRegistryAgent());

    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_1/metadata-override",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags: [], exampleOutputs: [] }),
      },
    );

    expect(response.status).toBe(200);
    expect(agentMetadataOverrideDeleteMock).toHaveBeenCalledWith({
      where: { id: "override_1" },
    });
    const body = await response.json();
    expect(body.data.override).toBeNull();
  });

  it("deletes metadata override idempotently", async () => {
    agentFindUniqueMock
      .mockResolvedValueOnce(createRegistryAgent())
      .mockResolvedValueOnce(createRegistryAgent());
    const app = createApp();
    const response = await app.request(
      "http://localhost/agent_1/metadata-override",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(200);
    expect(agentMetadataOverrideDeleteManyMock).toHaveBeenCalledWith({
      where: { agentId: "agent_1" },
    });
    const body = await response.json();
    expect(body.data.override).toBeNull();
    expect(body.data.resolved.name).toBe("Registry Name");
    expect(body.data.resolved.tags).toEqual([]);
  });

  it("returns 404 when agent is missing", async () => {
    agentFindUniqueMock.mockResolvedValueOnce(null);
    const app = createApp();
    const response = await app.request(
      "http://localhost/missing/metadata-override",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(404);
  });
});
