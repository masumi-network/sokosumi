import { fileURLToPath } from "node:url";
import { Client, type Pool } from "pg";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import {
  baseFile,
  holdCommit,
  inFlow,
  nextMillisecond,
  observing,
  plain,
  sendOrder,
  sentBeforeAnswered,
  statements,
} from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";

const state = vi.hoisted(() => ({
  pools: [] as Pool[],
  invoice: null as Stripe.Invoice | null,
  receipts: [] as unknown[],
  failAfterWake: false,
}));
vi.unmock("@/lib/db/prisma");
vi.mock("@vercel/functions", async (original) => {
  const actual = await original<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    attachDatabasePool(pool: Pool) {
      state.pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    getInvoice: async () => state.invoice,
    getAccountId: async () => "acct_fixture",
    payInvoiceOutOfBand: async () => ({ ...state.invoice, status: "paid" }),
    getBaseCreditTopUpPrice: async () => ({
      id: "price_fixture",
      currency: "usd",
    }),
    createAdminInvoice: async () => state.invoice,
  },
}));
vi.mock("@/services/stripe-customer-billing.service", () => ({
  stripeCustomerBillingService: {
    getUserBillingDetails: async () => ({ address: { country: "DE" } }),
  },
}));
vi.mock("@/helpers/billing-notifications", () => ({
  notifyInvoicePaid: async (...args: unknown[]) => {
    state.receipts.push(args);
  },
}));
vi.mock("@/services/subscription-catalog.service", () => ({
  getSubscriptionCatalog: async () =>
    Object.fromEntries(
      ["free", "starter", "standard", "pro"].map((plan, i) => [
        plan,
        {
          productId: `prod_${plan}_test`,
          credits: 100 * (i + 1),
          monthlyAmount: 1000,
        },
      ]),
    ),
}));
vi.mock("@/services/task-topup.service", async (original) => {
  const actual =
    await original<typeof import("@/services/task-topup.service")>();
  return {
    markOutOfCreditsTasksAsToppedUp: async (
      ...args: Parameters<typeof actual.markOutOfCreditsTasksAsToppedUp>
    ) => {
      await actual.markOutOfCreditsTasksAsToppedUp(...args);
      if (state.failAfterWake) throw new Error("Failed after the Task wake");
    },
  };
});

const base = baseFile(
  fileURLToPath(new URL("./grant-stripe.base.json", import.meta.url)),
  process.env.RECORD_GRANT_STRIPE_BASE === "true",
  { debitMoved: false },
);
async function loadCore() {
  const { default: db } = await import("@/lib/db/prisma");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const { handleInvoicePaidEvent: deliver } = await import(
    "@/services/stripe-invoice-credit.service"
  );
  const { invoiceAdminService: admin } = await import(
    "@/services/invoice-admin.service"
  );
  return {
    db,
    ledger: createNetworkScope("mainnet").networkDb,
    deliver,
    admin,
  };
}
let core: Awaited<ReturnType<typeof loadCore>>;
let copy: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

type Scenario =
  | "recurring"
  | "one-time"
  | "project-tagged"
  | "mixed"
  | "nothing";
async function fixture(name: string, org: boolean, emptyId = false) {
  const customer = `cus_${name}`;
  const userId = emptyId && !org ? "" : `user-${name}`;
  const orgId = emptyId && org ? "" : `org-${name}`;
  await core.db.user.create({
    data: {
      id: userId,
      name,
      email: `${name}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      stripeCustomerId: org ? null : customer,
    },
  });
  if (org)
    await core.db.organization.create({
      data: {
        id: orgId,
        name,
        slug: name,
        stripeCustomerId: customer,
        members: { create: { userId, role: "owner" } },
      },
    });
  const owner = org ? { organizationId: orgId } : { userId };
  const workspace = await core.db.workspace.create({
    data: owner,
    select: { id: true },
  });
  const project = await core.db.project.create({
    data: { workspaceId: workspace.id, name },
    select: { id: true },
  });
  const task = await core.db.task.create({
    data: {
      name,
      workspaceId: workspace.id,
      projectId: project.id,
      ownerId: org ? null : userId,
      organizationId: org ? orgId : null,
      creatorUserId: userId,
      status: "OUT_OF_CREDITS",
    },
    select: { id: true },
  });
  await core.db.notification.create({
    data: {
      userId,
      kind: "TASK",
      referenceId: task.id,
      eventId: name,
      messageKey: "Notifications.Task.outOfCredits",
      messageParams: "{}",
    },
  });
  return {
    customer,
    taskId: task.id,
    projectId: project.id,
    userId,
    orgId,
    name,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function invoice(f: Fixture, kind: Scenario) {
  const line = (product: string, quantity: number, end = 1_800_000_000) => ({
    amount: 1000,
    quantity,
    pricing: { price_details: { product } },
    period: { end },
  });
  const credit = line("prod_credit_test", 7);
  const plan = line("prod_starter_test", 3);
  const lines = {
    recurring: [plan],
    "one-time": [credit],
    "project-tagged": [credit],
    mixed: [
      plan,
      credit,
      line("unrelated", 99),
      line("prod_pro_test", 2, 1_801_000_000),
      line("prod_credit_test", 5),
    ],
    nothing: [line("unrelated", 99)],
  }[kind];
  const data = {
    id: `in_${f.name}`,
    customer: f.customer,
    created: 1_735_689_600,
    amount_paid: 1000,
    amount_due: 1000,
    total: 1000,
    currency: "usd",
    status: "paid",
    livemode: false,
    billing_reason:
      kind === "mixed" || kind === "recurring"
        ? "subscription_cycle"
        : "manual",
    metadata: {
      grant_source: "admin_one_time_credit",
      ttl_days: "3",
      ...(kind === "project-tagged" ? { projectId: f.projectId } : {}),
    },
    lines: { data: lines },
  };
  return data as unknown as Stripe.Invoice;
}
async function rows(f: Fixture) {
  const [transactions, buckets, task, events, notification] = await Promise.all(
    [
      core.ledger.transaction.findMany({ orderBy: { id: "asc" } }),
      core.ledger.creditBucket.findMany({ orderBy: { referenceId: "asc" } }),
      core.db.task.findUniqueOrThrow({
        where: { id: f.taskId },
        select: { id: true, status: true, updatedAt: true },
      }),
      core.db.taskEvent.findMany({
        where: { taskId: f.taskId },
        orderBy: { id: "asc" },
      }),
      core.db.notification.findFirstOrThrow({
        where: { referenceId: f.taskId },
        select: { isRead: true, readAt: true },
      }),
    ],
  );
  return { transactions, buckets, task, events, notification };
}
function lastLine(error: unknown) {
  return error instanceof Error
    ? error.message.trim().split("\n").at(-1)?.trim()
    : String(error);
}
async function settle(run: () => Promise<unknown>) {
  try {
    return (await run()) ?? null;
  } catch (error) {
    return { error: lastLine(error) };
  }
}
async function race(run: () => Promise<unknown>) {
  const gate = holdCommit("first");
  const first = inFlow("first", () => settle(run));
  const held = await Promise.race([
    gate.reached.then(() => true),
    first.then(() => false),
  ]);
  gate.cancel();
  const second = inFlow("second", () => settle(run));
  let waiting = false;
  try {
    if (held) {
      const client = new Client({ connectionString: copy.url });
      await client.connect();
      try {
        const until = Date.now() + 15000;
        while (Date.now() < until) {
          const result = await client.query(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') AS waiting",
          );
          if (result.rows[0].waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        await client.end();
      }
    }
  } finally {
    gate.release();
  }
  const answers = await Promise.all([first, second]);
  expect(waiting).toBe(!onSplitLayout);
  return { held, waiting, answers };
}

async function record(
  f: Fixture,
  key: string,
  run: () => Promise<unknown>,
  sql = true,
) {
  const before = await rows(f);
  state.receipts = [];
  const start = await nextMillisecond();
  const { log, outcome } = await observing(() => settle(run));
  const end = Date.now();
  expect(log.length > 0).toBe(sql);
  const after = await rows(f);
  const buckets = after.buckets.filter(
    (row) => !before.buckets.some((old) => old.id === row.id),
  );
  const transactions = after.transactions.filter(
    (row) => !before.transactions.some((old) => old.id === row.id),
  );
  // Compare existing rows with their raw values before replacing generated IDs and clock times.
  expect(after.buckets.filter((row) => !buckets.includes(row))).toEqual(
    before.buckets,
  );
  expect(
    after.transactions.filter((row) => !transactions.includes(row)),
  ).toEqual(before.transactions);
  // Align the transactions with their bucket; UUIDs created in one millisecond need not sort in issuance order.
  transactions.sort(
    (a, b) =>
      buckets.findIndex((row) => row.sourceTransactionId === a.id) -
      buckets.findIndex((row) => row.sourceTransactionId === b.id),
  );
  const fresh = [...transactions, ...buckets];
  const labels = new Map([
    [f.projectId, "<fixture Project>"],
    [f.taskId, "<fixture Task>"],
  ]);
  // Fixed provider-supplied times must also match when the attempted insert rolls back.
  for (const time of [
    1_735_689_600 + 3 * 86400,
    1_800_000_000,
    1_801_000_000,
  ]) {
    const iso = new Date(time * 1000).toISOString();
    labels.set(iso, `<provider unix ${time}>`);
    labels.set(
      iso.replace("T", " ").replace("Z", " UTC"),
      `<provider unix ${time} UTC>`,
    );
  }
  const flows = [...new Set(log.map((row) => row.flow))].map((flow) => {
    const entries = log.filter((row) => row.flow === flow);
    return {
      flow,
      order: sendOrder(entries),
      overlap: sentBeforeAnswered(entries),
    };
  });
  const observed = {
    statements: statements(log, { asSent: true }),
    outcome,
    receipts: state.receipts,
    flows,
    order: sendOrder(log),
    raw: {
      expires: buckets.map((b) => b.expiresAt?.toISOString() ?? null),
      clock: fresh.map((row) => [
        row.id[14],
        row.createdAt.getTime() >= start && row.updatedAt.getTime() <= end,
        row.createdAt.getTime() === row.updatedAt.getTime(),
      ]),
      idOrder: fresh.every((a) =>
        fresh.every((b) => a.createdAt >= b.createdAt || a.id < b.id),
      ),
      taskTimeChanged:
        after.task.updatedAt.getTime() !== before.task.updatedAt.getTime(),
      noticeTimeChanged:
        after.notification.readAt?.getTime() !==
        before.notification.readAt?.getTime(),
    },
    transactions,
    buckets,
    task: after.task,
    events: after.events,
    notification: after.notification,
  };
  base.expectAsOnBase(
    `${onSplitLayout ? "split" : "public"} ${key}`,
    plain(observed, labels),
  );
}

describe.runIf(enabled)(
  "Stripe invoice grants as recorded on origin/main",
  () => {
    beforeAll(async () => {
      const url =
        process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
      if (!url) throw new Error("Missing PostgreSQL test template");
      copy = await copyPostgresTestDatabase(url, "credit_grant_test");
      vi.stubEnv("DATABASE_URL", copy.url);
      vi.stubEnv("DATABASE_URL_UNPOOLED", copy.url);
      core = await loadCore();
    }, 120000);
    afterAll(async () => {
      await Promise.all(state.pools.map((pool) => pool.end()));
      vi.unstubAllEnvs();
      await copy?.drop();
    }, 120000);
    for (const kind of ["recurring", "one-time", "project-tagged"] as const) {
      it(`${kind}, including replay and simultaneous delivery`, async () => {
        for (const concurrent of [false, true]) {
          const f = await fixture(
            `${kind}-${concurrent ? "race" : "single"}`,
            kind !== "one-time",
          );
          const data = invoice(f, kind);
          const deliver = () => core.deliver(data);
          if (concurrent) await record(f, f.name, () => race(deliver));
          else {
            await record(f, f.name, deliver);
            await record(f, `${f.name} replay`, deliver);
          }
        }
      }, 90000);
    }
    for (const kind of ["mixed", "nothing"] as const) {
      it(kind, async () => {
        const f = await fixture(kind, false);
        await record(f, kind, () => core.deliver(invoice(f, kind)));
      });
    }
    it("rolls the grant and Task wake back together", async () => {
      const f = await fixture("rollback", false);
      state.failAfterWake = true;
      try {
        await record(f, f.name, () => core.deliver(invoice(f, "one-time")));
      } finally {
        state.failAfterWake = false;
      }
    });
    for (const org of [false, true]) {
      it(`admin mark-paid, new and already granted, org=${org}`, async () => {
        const f = await fixture(`admin-pay-${org}`, org);
        state.invoice = invoice(f, "one-time");
        state.invoice.status = "open";
        const pay = () => core.admin.markInvoicePaid(`in_${f.name}`);
        await record(f, f.name, pay);
        state.invoice.status = "paid";
        await record(f, `${f.name} replay`, pay);
      });
      it(`empty owner, org=${org}`, async () => {
        const f = await fixture(`empty-owner-${org}`, org, true);
        await record(f, f.name, () => core.deliver(invoice(f, "one-time")));
      });
    }
    for (const projectId of ["", null]) {
      it(`invoice metadata Project id ${JSON.stringify(projectId)}`, async () => {
        const f = await fixture(
          `project-${projectId === null ? "null" : "empty"}`,
          true,
        );
        const data = invoice(f, "one-time");
        data.metadata = { ...data.metadata, projectId } as Stripe.Metadata;
        await record(f, f.name, () => core.deliver(data));
      });
    }
    it("an invoice without a customer has no owner", async () => {
      const f = await fixture("null-owner", false);
      const data = invoice(f, "one-time");
      data.customer = null;
      await record(f, f.name, () => core.deliver(data), false);
    });
    it("admin refuses to report a grant when the paid invoice gave nothing", async () => {
      const f = await fixture("admin-missing-grant", false);
      state.invoice = invoice(f, "nothing");
      await record(f, f.name, () => core.admin.markInvoicePaid(`in_${f.name}`));
    });
    it("admin-issued paid invoice", async () => {
      const f = await fixture("admin-issue", false);
      state.invoice = invoice(f, "one-time");
      await record(f, f.name, () =>
        core.admin.createInvoice({
          target: { targetType: "user", targetId: f.userId },
          credits: 7,
          ttlDays: 3,
          priceId: null,
        }),
      );
    });
  },
);
