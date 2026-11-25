/**
 * `GET /v1/credit-costs` on a real PostgreSQL, on both layouts: the response a
 * Mainnet admin gets, read from Mainnet's schema. On the split layout Preprod
 * holds a row with the same id, which must not show.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/credit-costs/get.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

import mountGetCreditCosts from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

const id = randomUUID();
const unit = `n58_${id}`;
const at = new Date("2026-01-02T03:04:05.678Z");

function createApp(role: "admin" | "user") {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: randomUUID(),
      organizationId: null,
      role,
      authenticationMethod: "session",
    });
    await next();
  });
  mountGetCreditCosts(app);
  return app;
}

type Client = ReturnType<typeof createPrismaClient>;

async function seed(
  client: Client,
  cost: { unit: string; centsPerUnit: bigint },
) {
  await client.$transaction(async (tx) => {
    // shortcut: the unit trigger calls `public.canonical_credit_cost_unit`,
    // which the split layout moved to `shared`; drop this line with ticket 19.
    if (onSplitLayout) {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    }
    await tx.creditCost.create({
      data: { id, createdAt: at, updatedAt: at, ...cost },
    });
  });
}

describe.skipIf(!enabled)("GET /credit-costs", () => {
  // Past Core's clients: each names its schema itself.
  let mainnet: Client;
  let preprod: Client;

  beforeAll(async () => {
    const schemas = testSchemaNames();
    mainnet = createPrismaClient(url ?? "", {
      schema: schemas.DATABASE_SCHEMA_MAINNET,
    });
    preprod = createPrismaClient(url ?? "", {
      schema: schemas.DATABASE_SCHEMA_PREPROD,
    });
    await seed(mainnet, { unit, centsPerUnit: 25_000_000_000n });
    if (onSplitLayout) {
      await seed(preprod, { unit: `${unit}_preprod`, centsPerUnit: 1n });
    }
  });

  afterAll(async () => {
    await mainnet.creditCost.deleteMany({ where: { id } });
    if (onSplitLayout) await preprod.creditCost.deleteMany({ where: { id } });
    await mainnet.$disconnect();
    await preprod.$disconnect();
  });

  it("lists Mainnet's credit costs for an admin", async () => {
    const response = await createApp("admin").request("http://localhost/");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string }[] };
    expect(Object.keys(body)).toEqual(["data", "meta"]);
    expect(body.data.filter((cost) => cost.id === id)).toEqual([
      {
        id,
        createdAt: "2026-01-02T03:04:05.678Z",
        updatedAt: "2026-01-02T03:04:05.678Z",
        unit,
        creditsPerUnit: 2.5,
      },
    ]);
  });

  it("refuses a user who is not an admin", async () => {
    const response = await createApp("user").request("http://localhost/");

    expect(response.status).toBe(403);
  });
});
