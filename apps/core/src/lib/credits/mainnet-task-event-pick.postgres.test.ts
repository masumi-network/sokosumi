/**
 * Mainnet's ledger never picks up a Task event tagged Preprod (ticket 29,
 * slice 2): the lateral pick of a transaction's oldest Task event reads only
 * events that name no Network or Mainnet, and a Task's credit total and its
 * public milestones never count a Preprod event's Mainnet amount. Core's HTTP
 * routes on a real PostgreSQL, on both layouts; the equal-id cases of the two
 * Networks run on the split layout only. Every row is this file's own.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/lib/credits/mainnet-task-event-pick.postgres.test.ts
 */
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { onSplitLayout } from "@/test/split-layout";

// Before any import reads the environment: Preprod is on on the split layout.
await vi.hoisted(async () => {
  const { isSplitLayout } = await import("@/test/split-layout-pending");
  vi.stubEnv(
    "NETWORK_PREPROD_ENABLED",
    isSplitLayout(process.env) ? "true" : "false",
  );
});
vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  return {
    ...actual,
    stripeClient: {
      ...actual.stripeClient,
      createUserCustomer: vi.fn().mockResolvedValue({}),
    },
  };
});
vi.mock("@/services/webhook.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook.service")>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      callAccountCreated: vi.fn().mockResolvedValue(undefined),
      callUserWebhook: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const onPostgres =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

/** Module loads and sign-ins, past Vitest's 10 s hook limit on CI's runner. */
const SETUP_TIMEOUT = 120_000;
const CASE_TIMEOUT = 60_000;
const CREDIT = 10n ** 10n;
const HEADER = "X-Sokosumi-Network";

type Tag = "mainnet" | "preprod" | null;

interface Entry {
  id: string;
  kind: string;
  taskId: string | null;
  description: string | null;
  projectId: string | null;
  credits: number;
}

describe.runIf(onPostgres)("Mainnet's Task event pick (PostgreSQL)", () => {
  let network: typeof import("@/lib/db/network-scope");
  let prisma: typeof import("@/lib/db/prisma").default;
  let fixture: typeof import("@/test-fixtures/core-session");
  let createPersonalWorkspace: typeof import("@/helpers/personal-workspace").createPersonalWorkspace;
  let app: ReturnType<
    typeof import("@/test-fixtures/core-session").createCoreApp
  >;
  const userIds: string[] = [];
  const taskIds: string[] = [];
  const projectIds: string[] = [];

  beforeAll(async () => {
    network = await import("@/lib/db/network-scope");
    ({ default: prisma } = await import("@/lib/db/prisma"));
    fixture = await import("@/test-fixtures/core-session");
    ({ createPersonalWorkspace } = await import(
      "@/helpers/personal-workspace"
    ));
    app = fixture.createCoreApp();
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await prisma.taskEvent.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.publicShare.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    for (const name of onSplitLayout
      ? (["mainnet", "preprod"] as const)
      : (["mainnet"] as const)) {
      await network.createNetworkScope(name).networkDb.transaction.deleteMany({
        where: { userId: { in: userIds } },
      });
    }
    await prisma.workspace.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    vi.unstubAllEnvs();
  }, SETUP_TIMEOUT);

  /** A signed-in owner with a personal workspace, a Project and a Task in it per name. */
  async function owner(names: string[]) {
    const user = await fixture.createPasswordUser("Task event pick", "admin");
    userIds.push(user.id);
    const workspace = await createPersonalWorkspace(user.id);
    const cookie = await fixture.signIn(app, user.email);
    const tasks: Record<string, { taskId: string; projectId: string }> = {};
    for (const name of names) {
      const { id: projectId } = await prisma.project.create({
        data: { name: `Project ${name}`, workspaceId: workspace.id },
        select: { id: true },
      });
      projectIds.push(projectId);
      const { id: taskId } = await prisma.task.create({
        data: {
          ownerId: user.id,
          creatorUserId: user.id,
          workspaceId: workspace.id,
          projectId,
          name: `Task ${name}`,
          status: "RUNNING",
        },
        select: { id: true },
      });
      taskIds.push(taskId);
      tasks[name] = { taskId, projectId };
    }
    return { userId: user.id, cookie, tasks };
  }

  function request(cookie: string, path: string, onPreprod = false) {
    return app.request(`${fixture.ORIGIN}/v1${path}`, {
      headers: {
        cookie,
        origin: fixture.ORIGIN,
        ...(onPreprod && { [HEADER]: "preprod" }),
      },
    });
  }

  async function data(cookie: string, path: string, onPreprod = false) {
    const response = await request(cookie, path, onPreprod);
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: unknown }).data;
  }

  async function entries(cookie: string, query: string, onPreprod = false) {
    const items = (await data(
      cookie,
      `/transactions?limit=100&${query}`,
      onPreprod,
    )) as Array<Entry & Record<string, unknown>>;
    return items.map(
      ({ id, kind, taskId, description, projectId, credits }) => ({
        id,
        kind,
        taskId: taskId ?? null,
        description,
        projectId,
        credits,
      }),
    );
  }

  /** Every reader of the ledger for one filter, as the client receives it. */
  async function readers(cookie: string, query: string, onPreprod = false) {
    const answers: Record<string, string> = {};
    for (const path of [
      `/transactions?limit=100&${query}`,
      `/transactions?limit=3&${query}`,
      `/transactions/total?${query}`,
      `/transactions/daily?${query}`,
      `/transactions/export?${query}`,
    ]) {
      const response = await request(cookie, path, onPreprod);
      const text = await response.text();
      // Only the answer's own timestamp differs between two reads.
      answers[path] = `${response.status} ${
        path.startsWith("/transactions/export")
          ? text
          : JSON.stringify({
              ...JSON.parse(text),
              meta: { ...JSON.parse(text).meta, timestamp: null },
            })
      }`;
    }
    return answers;
  }

  async function totals(cookie: string, query: string, onPreprod = false) {
    const total = (await data(
      cookie,
      `/transactions/total?${query}`,
      onPreprod,
    )) as { credits: number; count: number };
    const days = (await data(
      cookie,
      `/transactions/daily?${query}`,
      onPreprod,
    )) as { credits: number }[];
    const response = await request(
      cookie,
      `/transactions/export?${query}`,
      onPreprod,
    );
    expect(response.status).toBe(200);
    const csv = (await response.text()).trimEnd().split("\r\n");
    return {
      credits: total.credits,
      count: total.count,
      daily: days.reduce((sum, day) => sum + day.credits, 0),
      csvSpent: Number(
        csv
          .find((line) => line.startsWith(",total,Spent,"))
          ?.split(",")
          .at(-1),
      ),
      csvRows: csv.filter((line) => !line.startsWith(",total,")).length - 1,
    };
  }

  describe("one Network's transactions, events tagged each way", () => {
    let cookie: string;
    let a: { taskId: string; projectId: string };
    let b: { taskId: string; projectId: string };
    /** Transaction ids by case name, newest last. */
    const tx: Record<string, string> = {};
    const preprodEvents: Array<{
      taskId: string;
      transactionId: string;
      comment: string;
      createdAt: Date;
    }> = [];
    const tag = randomUUID().slice(0, 8);
    const c = (name: string) => `${name}-${tag}`;

    beforeAll(async () => {
      let tasks: Record<string, { taskId: string; projectId: string }>;
      let userId: string;
      ({ cookie, tasks, userId } = await owner(["A", "B"]));
      ({ A: a, B: b } = tasks as Record<
        "A" | "B",
        { taskId: string; projectId: string }
      >);
      const start = Date.now() - 3_600_000;
      const minute = 60_000;
      // [case, credits, minute, events: [tag, task, comment, offset ms]]
      const cases: Array<
        [string, bigint, number, Array<[Tag, "A" | "B", string, number]>]
      > = [
        ["untagged", 1n, 1, [[null, "A", c("c1"), 0]]],
        ["mainnet", 2n, 2, [["mainnet", "A", c("c2"), 0]]],
        ["none", 4n, 3, []],
        ["onlyPreprod", 8n, 4, [["preprod", "B", c("p4"), 0]]],
        [
          "preprodOlderThanMainnet",
          16n,
          5,
          [
            ["preprod", "B", c("p5"), 0],
            ["mainnet", "A", c("m5"), 1000],
          ],
        ],
        // The same instant as the case before: a page boundary splits the tie.
        [
          "mainnetOlderThanPreprod",
          32n,
          5,
          [
            ["mainnet", "A", c("m6"), 0],
            ["preprod", "B", c("p6"), 1000],
          ],
        ],
        [
          "untaggedOlderThanMainnet",
          64n,
          6,
          [
            [null, "A", c("u7"), 0],
            ["mainnet", "A", c("m7"), 1000],
          ],
        ],
        [
          "mainnetOlderThanUntagged",
          128n,
          7,
          [
            ["mainnet", "A", c("m8"), 0],
            [null, "A", c("u8"), 1000],
          ],
        ],
        [
          "untaggedOlderThanPreprod",
          256n,
          8,
          [
            [null, "A", c("u9"), 0],
            ["preprod", "B", c("p9"), 1000],
          ],
        ],
        [
          "preprodOlderThanUntagged",
          512n,
          9,
          [
            ["preprod", "B", c("p10"), 0],
            [null, "A", c("u10"), 1000],
          ],
        ],
      ];
      const db = network.createNetworkScope("mainnet").networkDb;
      for (const [name, credits, at, events] of cases) {
        const createdAt = new Date(start + at * minute);
        const { id } = await db.transaction.create({
          data: { amount: -credits * CREDIT, userId, createdAt },
          select: { id: true },
        });
        tx[name] = id;
        for (const [eventTag, task, comment, offset] of events) {
          const event = {
            taskId: tasks[task]?.taskId ?? "",
            transactionId: id,
            comment,
            createdAt: new Date(createdAt.getTime() + offset),
          };
          if (eventTag === "preprod") preprodEvents.push(event);
          await prisma.taskEvent.create({
            data: { ...event, network: eventTag },
          });
        }
      }
      // A top up, and an event that charged nothing.
      await db.transaction.create({
        data: {
          amount: 1000n * CREDIT,
          userId,
          createdAt: new Date(start + 10 * minute),
        },
      });
      await prisma.taskEvent.create({
        data: { taskId: a.taskId, comment: c("free"), network: "mainnet" },
      });
    }, SETUP_TIMEOUT);

    const taskRow = (
      name: string,
      credits: number,
      comment: string,
      task: { taskId: string; projectId: string },
    ) => ({
      id: tx[name],
      kind: "task",
      taskId: task.taskId,
      description: c(comment),
      projectId: task.projectId,
      credits,
    });

    it(
      "takes each transaction's oldest event that names no Network or Mainnet, in both orders",
      async () => {
        const rows = await entries(cookie, "types=task,unattributed");
        const byId = new Map(rows.map((row) => [row.id, row]));
        expect(
          Object.fromEntries(
            Object.entries(tx).map(([name, id]) => [name, byId.get(id)]),
          ),
        ).toEqual({
          untagged: taskRow("untagged", 1, "c1", a),
          mainnet: taskRow("mainnet", 2, "c2", a),
          none: expect.objectContaining({
            id: tx.none,
            kind: "unattributed",
            taskId: null,
            projectId: null,
            credits: 4,
          }),
          // Its only event is Preprod's: no Task, no comment, no Project.
          onlyPreprod: expect.objectContaining({
            id: tx.onlyPreprod,
            kind: "unattributed",
            taskId: null,
            description: null,
            projectId: null,
            credits: 8,
          }),
          preprodOlderThanMainnet: taskRow(
            "preprodOlderThanMainnet",
            16,
            "m5",
            a,
          ),
          mainnetOlderThanPreprod: taskRow(
            "mainnetOlderThanPreprod",
            32,
            "m6",
            a,
          ),
          untaggedOlderThanMainnet: taskRow(
            "untaggedOlderThanMainnet",
            64,
            "u7",
            a,
          ),
          mainnetOlderThanUntagged: taskRow(
            "mainnetOlderThanUntagged",
            128,
            "m8",
            a,
          ),
          untaggedOlderThanPreprod: taskRow(
            "untaggedOlderThanPreprod",
            256,
            "u9",
            a,
          ),
          preprodOlderThanUntagged: taskRow(
            "preprodOlderThanUntagged",
            512,
            "u10",
            a,
          ),
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "applies the same pick to the Task, Project, kind and comment filters, the total, the daily spend and the CSV",
      async () => {
        const taskA = 1 + 2 + 16 + 32 + 64 + 128 + 256 + 512;
        const none = {
          credits: 0,
          count: 0,
          daily: 0,
          csvSpent: 0,
          csvRows: 0,
        };
        const expected: Array<[string, string[], ReturnType<typeof Object>]> = [
          [`taskId=${b.taskId}`, [], none],
          [`projectId=${b.projectId}`, [], none],
          [`q=${c("p4")}`, [], none],
          [`q=${c("p5")}`, [], none],
          [`q=${c("p10")}`, [], none],
          [
            `q=${c("m5")}`,
            [tx.preprodOlderThanMainnet ?? ""],
            { credits: 16, count: 1, daily: 16, csvSpent: -16, csvRows: 1 },
          ],
          [
            `q=${c("u10")}`,
            [tx.preprodOlderThanUntagged ?? ""],
            { credits: 512, count: 1, daily: 512, csvSpent: -512, csvRows: 1 },
          ],
          [
            "types=unattributed",
            [tx.onlyPreprod ?? "", tx.none ?? ""],
            { credits: 12, count: 2, daily: 12, csvSpent: -12, csvRows: 2 },
          ],
        ];
        const taskIds = [
          "preprodOlderThanUntagged",
          "untaggedOlderThanPreprod",
          "mainnetOlderThanUntagged",
          "untaggedOlderThanMainnet",
        ].map((name) => tx[name] ?? "");
        // The tie: the larger id first, as the list orders it.
        const tie = [
          tx.preprodOlderThanMainnet ?? "",
          tx.mainnetOlderThanPreprod ?? "",
        ]
          .sort()
          .reverse();
        const taskAll = [
          ...taskIds,
          ...tie,
          tx.mainnet ?? "",
          tx.untagged ?? "",
        ];
        const taskTotals = {
          credits: taskA,
          count: 8,
          daily: taskA,
          csvSpent: -taskA,
          csvRows: 8,
        };
        expected.push(
          [`taskId=${a.taskId}`, taskAll, taskTotals],
          [`projectId=${a.projectId}`, taskAll, taskTotals],
          ["types=task", taskAll, taskTotals],
        );
        for (const [query, ids, sums] of expected) {
          expect({
            query,
            ids: (await entries(cookie, query)).map((row) => row.id),
          }).toEqual({ query, ids });
          expect({ query, ...(await totals(cookie, query)) }).toEqual({
            query,
            ...sums,
          });
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "walks the pages with a cursor that splits the tie of one instant",
      async () => {
        const all = (await entries(cookie, "types=task")).map((row) => row.id);
        const walked: string[] = [];
        let cursor: string | null = null;
        do {
          const response = await request(
            cookie,
            `/transactions?types=task&limit=5${cursor ? `&cursor=${cursor}` : ""}`,
          );
          const body = (await response.json()) as {
            data: Entry[];
            meta: {
              pagination?: { nextCursor?: string | null };
              nextCursor?: string | null;
            };
          };
          walked.push(...body.data.map((row) => row.id));
          cursor =
            body.data.length === 5 ? (body.data.at(-1)?.id ?? null) : null;
        } while (cursor);
        expect(walked).toEqual(all);
        // The fifth and sixth rows are the two of one instant.
        expect(new Set(all.slice(4, 6))).toEqual(
          new Set([tx.preprodOlderThanMainnet, tx.mainnetOlderThanPreprod]),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "answers every reader the same with and without the events tagged Preprod",
      async () => {
        const queries = [
          "",
          `taskId=${a.taskId}`,
          `taskId=${b.taskId}`,
          `projectId=${a.projectId}`,
          `projectId=${b.projectId}`,
          "types=task",
          "types=unattributed",
          `q=${c("p5")}`,
          `q=${c("m5")}`,
        ];
        const read = async () => {
          const answers: Record<string, Record<string, string>> = {};
          for (const query of queries)
            answers[query] = await readers(cookie, query);
          return answers;
        };
        const withPreprod = await read();
        const ids = await prisma.taskEvent.findMany({
          where: { taskId: { in: [a.taskId, b.taskId] }, network: "preprod" },
          select: { id: true },
        });
        expect(ids).toHaveLength(preprodEvents.length);
        await prisma.taskEvent.deleteMany({
          where: { id: { in: ids.map(({ id }) => id) } },
        });
        try {
          expect(await read()).toEqual(withPreprod);
        } finally {
          for (const event of preprodEvents) {
            await prisma.taskEvent.create({
              data: { ...event, network: "preprod" },
            });
          }
        }
      },
      CASE_TIMEOUT,
    );
  });

  // Today's layout only: on the split layout the event's `transaction`
  // relation still reads through the default client (slice 29-3).
  describe.runIf(!onSplitLayout)(
    "a Task's credit total and its public milestones",
    () => {
      it(
        "count no Preprod event's Mainnet amount",
        async () => {
          const { userId, cookie, tasks } = await owner(["C"]);
          const taskId = tasks.C?.taskId ?? "";
          const db = network.createNetworkScope("mainnet").networkDb;
          const at = Date.now() - 600_000;
          for (const [eventTag, credits, comment] of [
            ["mainnet", 2n, "Mainnet charge"],
            [null, 3n, "Untagged charge"],
            ["preprod", 5n, "Preprod charge"],
          ] as const) {
            const { id } = await db.transaction.create({
              data: { amount: -credits * CREDIT, userId },
              select: { id: true },
            });
            // No `cents`: the milestone falls back to the transaction's amount.
            await prisma.taskEvent.create({
              data: {
                taskId,
                transactionId: id,
                network: eventTag,
                comment,
                status: "RUNNING",
                createdAt: new Date(at + Number(credits) * 1000),
              },
            });
          }
          const task = (await data(cookie, `/tasks/${taskId}`)) as {
            credits: number;
          };
          expect(task.credits).toBe(5);

          const token = randomUUID();
          await prisma.publicShare.create({ data: { taskId, token } });
          const response = await app.request(
            `${fixture.ORIGIN}/v1/share/${token}`,
          );
          expect(response.status).toBe(200);
          const body = (await response.json()) as {
            data: {
              task: { events: { comment: string; credits: number | null }[] };
            };
          };
          expect(
            Object.fromEntries(
              body.data.task.events.map((event) => [
                event.comment,
                event.credits,
              ]),
            ),
          ).toEqual({
            "Mainnet charge": 2,
            "Untagged charge": 3,
            "Preprod charge": null,
          });
        },
        CASE_TIMEOUT,
      );
    },
  );

  describe.runIf(onSplitLayout)(
    "one id on both Networks (split layout)",
    () => {
      let cookie: string;
      let shared: { taskId: string; projectId: string };
      const ids = {
        both: randomUUID(),
        untagged: randomUUID(),
        onlyPreprod: randomUUID(),
      };
      const tag = randomUUID().slice(0, 8);
      const c = (name: string) => `${name}-${tag}`;
      const preprodEvents: Array<{
        taskId: string;
        transactionId: string;
        comment: string;
        createdAt: Date;
      }> = [];

      beforeAll(async () => {
        let userId: string;
        let tasks: Record<string, { taskId: string; projectId: string }>;
        ({ cookie, tasks, userId } = await owner(["S"]));
        shared = tasks.S ?? { taskId: "", projectId: "" };
        const start = Date.now() - 1_800_000;
        const rows: Array<
          [keyof typeof ids, bigint, bigint, Array<[Tag, string, number]>]
        > = [
          // The Preprod event first: Mainnet's oldest event would be Preprod's.
          [
            "both",
            12n,
            42n,
            [
              ["preprod", c("P42"), 0],
              ["mainnet", c("M12"), 1000],
            ],
          ],
          ["untagged", 11n, 41n, [[null, c("U11"), 0]]],
          ["onlyPreprod", 13n, 43n, [["preprod", c("P43"), 0]]],
        ];
        for (const [
          index,
          [name, mainnetCredits, preprodCredits, events],
        ] of rows.entries()) {
          const createdAt = new Date(start + index * 60_000);
          const id = ids[name];
          await network
            .createNetworkScope("mainnet")
            .networkDb.transaction.create({
              data: { id, amount: -mainnetCredits * CREDIT, userId, createdAt },
            });
          await network
            .createNetworkScope("preprod")
            .networkDb.transaction.create({
              data: { id, amount: -preprodCredits * CREDIT, userId, createdAt },
            });
          for (const [eventTag, comment, offset] of events) {
            const event = {
              taskId: shared.taskId,
              transactionId: id,
              comment,
              createdAt: new Date(createdAt.getTime() + offset),
            };
            if (eventTag === "preprod") preprodEvents.push(event);
            await prisma.taskEvent.create({
              data: { ...event, network: eventTag },
            });
          }
        }
      }, SETUP_TIMEOUT);

      const row = (
        id: string,
        kind: string,
        credits: number,
        comment: string | null,
      ) => ({
        id,
        kind,
        taskId: kind === "task" ? shared.taskId : null,
        description: comment && c(comment),
        projectId: kind === "task" ? shared.projectId : null,
        credits,
      });

      const none = { credits: 0, count: 0, daily: 0, csvSpent: 0, csvRows: 0 };
      it.each([
        {
          name: "Mainnet's",
          onPreprod: false,
          rows: () => [
            row(ids.onlyPreprod, "unattributed", 13, null),
            row(ids.untagged, "task", 11, "U11"),
            row(ids.both, "task", 12, "M12"),
          ],
          sums: () =>
            [
              [
                `taskId=${shared.taskId}`,
                { credits: 23, count: 2, daily: 23, csvSpent: -23, csvRows: 2 },
              ],
              [
                `projectId=${shared.projectId}`,
                { credits: 23, count: 2, daily: 23, csvSpent: -23, csvRows: 2 },
              ],
              [
                `q=${c("M12")}`,
                { credits: 12, count: 1, daily: 12, csvSpent: -12, csvRows: 1 },
              ],
              [`q=${c("P42")}`, none],
              [`q=${c("P43")}`, none],
            ] as const,
        },
        {
          // As on origin/main: the Preprod branch is not changed.
          name: "Preprod's",
          onPreprod: true,
          rows: () => [
            row(ids.onlyPreprod, "task", 43, "P43"),
            row(ids.untagged, "unattributed", 41, null),
            row(ids.both, "task", 42, "P42"),
          ],
          sums: () =>
            [
              [
                `taskId=${shared.taskId}`,
                { credits: 85, count: 2, daily: 85, csvSpent: -85, csvRows: 2 },
              ],
              [
                `projectId=${shared.projectId}`,
                { credits: 85, count: 2, daily: 85, csvSpent: -85, csvRows: 2 },
              ],
              [
                `q=${c("P42")}`,
                { credits: 42, count: 1, daily: 42, csvSpent: -42, csvRows: 1 },
              ],
              [`q=${c("U11")}`, none],
              [`q=${c("M12")}`, none],
            ] as const,
        },
      ])(
        "gives $name entry only its own events",
        async ({ onPreprod, rows, sums }) => {
          expect(
            await entries(cookie, "types=task,unattributed", onPreprod),
          ).toEqual(rows());
          for (const [query, expected] of sums()) {
            expect({
              query,
              ...(await totals(cookie, query, onPreprod)),
            }).toEqual({ query, ...expected });
          }
        },
        CASE_TIMEOUT,
      );

      it(
        "answers Mainnet's readers the same with and without the Preprod rows",
        async () => {
          const queries = [
            "",
            `taskId=${shared.taskId}`,
            `projectId=${shared.projectId}`,
            "types=task",
            "types=unattributed",
            `q=${c("P42")}`,
            `q=${c("M12")}`,
          ];
          const read = async () => {
            const answers: Record<string, Record<string, string>> = {};
            for (const query of queries)
              answers[query] = await readers(cookie, query);
            return answers;
          };
          const withPreprod = await read();
          const preprodDb = network.createNetworkScope("preprod").networkDb;
          const preprodRows = await preprodDb.transaction.findMany({
            where: { id: { in: Object.values(ids) } },
          });
          await prisma.taskEvent.deleteMany({
            where: { taskId: shared.taskId, network: "preprod" },
          });
          await preprodDb.transaction.deleteMany({
            where: { id: { in: Object.values(ids) } },
          });
          try {
            expect(await read()).toEqual(withPreprod);
          } finally {
            await preprodDb.transaction.createMany({ data: preprodRows });
            for (const event of preprodEvents) {
              await prisma.taskEvent.create({
                data: { ...event, network: "preprod" },
              });
            }
          }
        },
        CASE_TIMEOUT,
      );
    },
  );
});
