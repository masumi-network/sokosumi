import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";

import mountGetCategories from "./get";

const {
  creditCostFindManyMock,
  categoryFindManyMock,
  syncMetadataFindUniqueMock,
} = vi.hoisted(() => ({
  creditCostFindManyMock: vi.fn(),
  categoryFindManyMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    creditCost: {
      findMany: creditCostFindManyMock,
    },
    category: {
      findMany: categoryFindManyMock,
    },
    syncMetadata: {
      findUnique: syncMetadataFindUniqueMock,
    },
  },
}));

function createApp() {
  const app = new OpenAPIHono({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    return await next();
  });

  mountGetCategories(app);
  return app;
}

describe("GET /categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    creditCostFindManyMock.mockResolvedValue([{ unit: "default" }]);
    categoryFindManyMock.mockResolvedValue([]);
    syncMetadataFindUniqueMock.mockResolvedValue(null);
  });

  it("returns 200 and list of categories with expected shape", async () => {
    categoryFindManyMock.mockResolvedValue([
      {
        id: "cat_123",
        name: "Research",
        slug: "research",
        description: "Agents for research",
        image: null,
        icon: null,
        priority: 0,
        styles: JSON.stringify({
          light: {
            color: "text-default-foreground",
          },
        }),
      },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "cat_123",
      name: "Research",
      slug: "research",
      description: "Agents for research",
      image: null,
      icon: null,
      priority: 0,
      styles: {
        light: {
          color: "text-default-foreground",
        },
      },
    });
  });

  it("returns styles as null when stored JSON is invalid", async () => {
    categoryFindManyMock.mockResolvedValue([
      {
        id: "cat_123",
        name: "Research",
        slug: "research",
        description: "Agents for research",
        image: null,
        icon: null,
        priority: 0,
        styles: "{invalid json}",
      },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0]?.styles).toBeNull();
  });

  it("filters categories by available agents", async () => {
    categoryFindManyMock.mockResolvedValue([]);

    const app = createApp();
    await app.request("http://localhost/");

    expect(categoryFindManyMock).toHaveBeenCalledWith({
      where: {
        agents: { some: expect.any(Object) },
      },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
  });
});
