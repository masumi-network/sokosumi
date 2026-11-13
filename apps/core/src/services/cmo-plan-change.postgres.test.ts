/**
 * Real-Postgres proof that two plan changes for one Cuso never both count
 * their upgrade from the same old tier (ADR 0068).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-plan-change.postgres.test.ts
 *
 * A change claims the subscription row with one conditional write before it
 * reads the tier, and releases it once Polar answered and the new tier is
 * written. A second change while the first is at Polar is refused; one after
 * it reads the first one's tier. Polar and the caller's role are replaced;
 * fixtures are committed and deleted after.
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { ok } from "neverthrow";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { changeCmoPlan } from "./cmo-plan-change.service";

const m = vi.hoisted(() => ({
  changePolarSubscriptionPlan: vi.fn(),
  listPolarProducts: vi.fn(),
}));

vi.mock("@/clients/polar.client", () => ({
  changePolarSubscriptionPlan: m.changePolarSubscriptionPlan,
  clearPolarPendingPlanChange: vi.fn(),
  createPolarCustomerPortalUrl: vi.fn(),
  listPolarProducts: m.listPolarProducts,
  revokePolarSubscription: vi.fn(),
}));
vi.mock("@/services/marketing-strategy.service", () => ({
  mayApproveMarketingStrategy: async () => true,
}));
// The caller is a member of the Cuso's organization.
vi.mock("@/lib/image-studio/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-studio/access")>()),
  requireProjectAccessForUser: async () => ({
    workspaceId: WORKSPACE,
    organizationId: ORGANIZATION,
  }),
}));

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

const { ORGANIZATION, WORKSPACE } = vi.hoisted(() => ({
  ORGANIZATION: `org-${crypto.randomUUID()}`,
  WORKSPACE: crypto.randomUUID(),
}));
const PROJECT = randomUUID();
const SUBSCRIPTION = `sub-${randomUUID()}`;
const DAY_MS = 86_400_000;
const PERIOD_START = new Date(Date.now() - 5 * DAY_MS);
const PERIOD_END = new Date(PERIOD_START.getTime() + 30 * DAY_MS);

function plan(tier: string, credits: number) {
  return {
    id: `prod_${tier}_month`,
    name: tier,
    is_archived: false,
    is_recurring: true,
    recurring_interval: "month",
    recurring_interval_count: 1,
    metadata: { kind: "plan", tier, credits: String(credits) },
    prices: [
      {
        amount_type: "fixed",
        price_amount: credits * 2,
        price_currency: "usd",
        is_archived: false,
      },
    ],
  };
}
const PRODUCTS = [
  plan("starter", 10_000),
  plan("growth", 25_000),
  plan("scale", 50_000),
];

/** Polar's answer: the subscription moved to `tier`, at `modifiedAt`. */
function moved(tier: string) {
  const product = PRODUCTS.find((p) => p.metadata.tier === tier);
  return ok({
    id: SUBSCRIPTION,
    modified_at: new Date().toISOString(),
    created_at: PERIOD_START.toISOString(),
    status: "active",
    product_id: product?.id,
    product,
    recurring_interval: "month",
    current_period_start: PERIOD_START.toISOString(),
    current_period_end: PERIOD_END.toISOString(),
    cancel_at_period_end: false,
    ended_at: null,
    metadata: {},
    customer: { id: "cus_1", external_id: ORGANIZATION },
    pending_update: null,
  });
}

function database() {
  if (!db) throw new Error("Missing integration database");
  return db;
}

function change(tier: string) {
  return changeCmoPlan({
    userId: "user-1",
    projectId: PROJECT,
    tier,
  });
}

describe.skipIf(!db)("two plan changes for one Cuso", () => {
  beforeAll(async () => {
    if (!db) return;
    m.listPolarProducts.mockResolvedValue(PRODUCTS);
    await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Polar Org', ${ORGANIZATION}, NOW())`;
    await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
    await db.$executeRaw`INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${PROJECT}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
    await db.sokoBot.create({
      data: {
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        userId: null,
        versionId: CMO_SOKO_BOT_VERSION_IDS[0],
        name: "Cuso",
      },
    });
  });

  beforeEach(async () => {
    if (!db) return;
    m.changePolarSubscriptionPlan.mockReset();
    await db.cmoSubscription.deleteMany({ where: { projectId: PROJECT } });
    await db.cmoSubscription.create({
      data: {
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        polarSubscriptionId: SUBSCRIPTION,
        polarProductId: "prod_starter_month",
        tier: "starter",
        interval: "month",
        status: "active",
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
        polarEventAt: PERIOD_START,
      },
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.cmoSubscription.deleteMany({ where: { projectId: PROJECT } });
    await db.sokoBot.deleteMany({ where: { workspaceId: WORKSPACE } });
    await db.$executeRaw`DELETE FROM "project" WHERE "id" = ${PROJECT}::uuid`;
    await db.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM "organization" WHERE "id" = ${ORGANIZATION}`;
    await db.$disconnect();
  });

  it("refuses the second while the first is at Polar", async () => {
    let answer = (_value: unknown) => {};
    m.changePolarSubscriptionPlan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const first = change("growth");
    await vi.waitFor(() =>
      expect(m.changePolarSubscriptionPlan).toHaveBeenCalledTimes(1),
    );

    await expect(change("scale")).rejects.toMatchObject({
      kind: "subscription_change_not_allowed",
    });
    answer(moved("growth"));

    await expect(first).resolves.toEqual({ change: "upgrade" });
    expect(m.changePolarSubscriptionPlan).toHaveBeenCalledTimes(1);
    const row = await database().cmoSubscription.findUniqueOrThrow({
      where: { polarSubscriptionId: SUBSCRIPTION },
      select: { tier: true, planChangeClaimedAt: true },
    });
    expect(row).toEqual({ tier: "growth", planChangeClaimedAt: null });
  });

  it("counts the second upgrade from the tier the first left", async () => {
    m.changePolarSubscriptionPlan
      .mockResolvedValueOnce(moved("growth"))
      .mockResolvedValueOnce(moved("scale"));

    await change("growth");
    await change("scale");

    expect(m.changePolarSubscriptionPlan.mock.calls).toEqual([
      [
        {
          polarSubscriptionId: SUBSCRIPTION,
          productId: "prod_growth_month",
          upgradeFromCredits: 10_000,
        },
      ],
      [
        {
          polarSubscriptionId: SUBSCRIPTION,
          productId: "prod_scale_month",
          upgradeFromCredits: 25_000,
        },
      ],
    ]);
  });
});
