import type { MarketingStrategy } from "@sokosumi/database";
import { vi } from "vitest";

/**
 * The mocked Prisma client, env and collaborators every CMO service test
 * shares. Each test file mocks the modules with `cmoServiceMocks`, e.g.
 * `vi.mock("@/lib/db/prisma", async () => (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma)`,
 * and runs `resetCmoServiceMocks` before each test.
 */

export const memberFindMany = vi.fn();
export const sokoBotFindUnique = vi.fn();
export const cusoFindMany = vi.fn();
export const memberFindUnique = vi.fn();
export const chatRoomDelete = vi.fn();
export const integrationFindMany = vi.fn();
export const connectSokoBotIntegration = vi.fn();
export const finalizeSokoBotIntegration = vi.fn();
export const cusoFind = vi.fn();
export const subscriptionFindFirst = vi.fn();
export const subscriptionCreate = vi.fn();
export const subscriptionUpdate = vi.fn();
export const projectFindUnique = vi.fn();
export const projectUpdate = vi.fn();
export const turnFindFirst = vi.fn();
export const connectionFindMany = vi.fn();
export const workspaceFindUnique = vi.fn();
export const postFindFirst = vi.fn();
export const postFindMany = vi.fn();
export const postUpdate = vi.fn();
export const postCreateMany = vi.fn();
export const postUpdateMany = vi.fn();
export const cancelSocialPost = vi.fn();
export const eventFindFirst = vi.fn();
export const expireTurn = vi.fn();
export const startTurn = vi.fn();
export const createBot = vi.fn();
export const projectCreate = vi.fn();
export const fileLinkFindMany = vi.fn();
export const projectDelete = vi.fn();
export const createOrganizationWorkspace = vi.fn();
export const organizationFindFirst = vi.fn();
export const getUserWorkspace = vi.fn();
export const messageUpsert = vi.fn();
export const messageFindFirst = vi.fn();
export const messageFindMany = vi.fn();
export const messageUpdate = vi.fn();
export const chatRoomUpdate = vi.fn();
export const projectUpdateMany = vi.fn();
export const brainFindUnique = vi.fn();
export const brainUpsert = vi.fn();
export const brainUpdate = vi.fn();

type CusoFixture = {
  sokoBotId?: string;
  projectId?: string;
  createdAt?: Date;
  workspaceId?: string;
  websiteUrl?: string;
  brandBrain?: unknown;
  brandBrainUpdatedAt?: Date | null;
  brandBrainConfirmedAt?: Date | null;
};

/**
 * Cuso as Core reads him, his bot with its Project: a flat fixture (what
 * `cusoFind` resolves) gives the bot's id, the Project's id, workspace,
 * website and Brand Brain.
 */
export function asCusoBot(cuso: unknown) {
  if (!cuso || typeof cuso !== "object") return cuso;
  const fixture = cuso as CusoFixture;
  return {
    id: fixture.sokoBotId ?? "bot-1",
    createdAt: fixture.createdAt ?? new Date("2026-10-01T09:00:00Z"),
    project: {
      id: fixture.projectId ?? "project-1",
      workspaceId: fixture.workspaceId ?? "ws-1",
      websiteUrl: fixture.websiteUrl ?? "https://acme.io",
      workspace: { organizationId: "org-1" },
      brandBrain: fixture.brandBrain
        ? {
            body: fixture.brandBrain,
            updatedAt: fixture.brandBrainUpdatedAt ?? null,
            confirmedAt: fixture.brandBrainConfirmedAt ?? null,
          }
        : null,
    },
  };
}

/**
 * The Project's Marketing strategy versions, as rows in memory: tests seed
 * them with `seedStrategy` and read what the services wrote back.
 */
export const strategyRows: MarketingStrategy[] = [];
let strategyClock = 0;

type StrategyWhere = Record<string, unknown>;

function matchesStrategy(row: MarketingStrategy, where: StrategyWhere = {}) {
  return Object.entries(where).every(([key, value]) => {
    const actual = row[key as keyof MarketingStrategy];
    if (value && typeof value === "object" && "not" in value) {
      return actual !== (value as { not: unknown }).not;
    }
    return actual === value;
  });
}

function newestStrategiesFirst(rows: MarketingStrategy[]) {
  return [...rows].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
}

export function seedStrategy(
  plan: unknown,
  fields: Partial<MarketingStrategy> = {},
): MarketingStrategy {
  strategyClock += 1;
  const at = new Date(Date.UTC(2026, 9, 1, 9, strategyClock));
  const row: MarketingStrategy = {
    id: `strategy-${strategyClock}`,
    projectId: "project-1",
    createdAt: at,
    updatedAt: at,
    plan: plan as MarketingStrategy["plan"],
    authorSokoBotId: "bot-1",
    authorUserId: null,
    authorTurnId: null,
    approvedAt: null,
    approvedByUserId: null,
    ...fields,
  };
  strategyRows.push(row);
  return row;
}

const marketingStrategy = {
  findFirst: vi.fn(
    async (args: { where?: StrategyWhere } = {}) =>
      newestStrategiesFirst(strategyRows).find((row) =>
        matchesStrategy(row, args.where),
      ) ?? null,
  ),
  findMany: vi.fn(async (args: { where?: StrategyWhere } = {}) =>
    newestStrategiesFirst(strategyRows).filter((row) =>
      matchesStrategy(row, args.where),
    ),
  ),
  create: vi.fn(
    async (args: { data: Partial<MarketingStrategy> & { plan: unknown } }) =>
      seedStrategy(args.data.plan, args.data),
  ),
  update: vi.fn(
    async (args: {
      where: { id: string };
      data: Partial<MarketingStrategy>;
    }) => {
      const row = strategyRows.find((item) => item.id === args.where.id);
      if (!row) throw new Error(`No strategy ${args.where.id}`);
      Object.assign(row, args.data, { updatedAt: new Date() });
      return row;
    },
  ),
  updateMany: vi.fn(
    async (args: {
      where?: StrategyWhere;
      data: Partial<MarketingStrategy>;
    }) => {
      const rows = strategyRows.filter((row) =>
        matchesStrategy(row, args.where),
      );
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    },
  ),
  deleteMany: vi.fn(async (args: { where?: StrategyWhere } = {}) => {
    const rows = strategyRows.filter((row) => matchesStrategy(row, args.where));
    for (const row of rows) strategyRows.splice(strategyRows.indexOf(row), 1);
    return { count: rows.length };
  }),
};

const client = {
  // Runs the callback against this same mock, as one transaction would.
  $transaction: (callback: (tx: unknown) => unknown) => callback(client),
  $executeRaw: vi.fn(async () => 1),
  brandBrain: {
    findUnique: brainFindUnique,
    upsert: brainUpsert,
    update: brainUpdate,
  },
  user: {
    findUnique: async () => ({ preferredOrganizationId: "org-1" }),
  },
  member: {
    findUnique: memberFindUnique,
    // An organization role read by workspace answers like one by organization.
    findFirst: memberFindUnique,
    findMany: memberFindMany,
  },
  sokoBot: {
    findUnique: sokoBotFindUnique,
    // Finding Cuso by his bot or by a member: the Cuso `cusoFind` stands for.
    findFirst: async (args: unknown) => asCusoBot(await cusoFind(args)),
    findMany: cusoFindMany,
  },
  chatRoom: { delete: chatRoomDelete, update: chatRoomUpdate },
  chatRoomMessage: {
    upsert: messageUpsert,
    findFirst: messageFindFirst,
    findMany: messageFindMany,
    update: messageUpdate,
  },
  project: {
    create: projectCreate,
    delete: projectDelete,
    findUnique: projectFindUnique,
    update: projectUpdate,
    updateMany: projectUpdateMany,
    // Cuso's Project lives in the business's organization (ADR 0060).
    findFirst: async () => ({
      workspace: { id: "ws-1", userId: null, organizationId: "org-1" },
    }),
  },
  marketingStrategy,
  fileProjectLink: { findMany: fileLinkFindMany },
  organization: { findFirst: organizationFindFirst },
  subscription: {
    findFirst: subscriptionFindFirst,
    create: subscriptionCreate,
    update: subscriptionUpdate,
  },
  workspace: { findUnique: workspaceFindUnique },
  sokoBotTurn: { findFirst: turnFindFirst },
  projectSocialConnection: { findMany: connectionFindMany },
  socialPost: {
    findFirst: postFindFirst,
    findMany: postFindMany,
    update: postUpdate,
    createMany: postCreateMany,
    updateMany: postUpdateMany,
  },
  // Calendar times read in UTC unless a test gives Cuso's rhythms a zone.
  sokoBotSchedule: { findFirst: async () => null },
  sokoBotRuntimeEvent: { findFirst: eventFindFirst },
  sokoBotIntegration: { findMany: integrationFindMany },
};

export const mockBilling = { on: false, production: false };

export const funding = {
  spendable: 100,
  requireFunding: vi.fn(),
  BillingError: class extends Error {},
};

/** The module mocks, keyed by what they stand for. */
export const cmoServiceMocks = {
  prisma: { default: client },
  env: (actual: typeof import("@/config/env")) => ({
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      CMO_MOCK_BILLING: mockBilling.on,
      ...(mockBilling.production ? { VERCEL_ENV: "production" as const } : {}),
    }),
  }),
  socialPosts: { cancelSocialPost },
  sharedCreate: { createSharedSokoBot: createBot },
  controlPlane: { sokoBotControlPlane: { expireTurn, startTurn } },
  organizationWorkspace: { createOrganizationWorkspace },
  userWorkspaces: { getUserWorkspace },
  subscription: {
    buildCreditsPayload: async () => ({
      spendable: funding.spendable,
      subscription: null,
    }),
  },
  billing: {
    requireSokoBotTurnFunding: funding.requireFunding,
    SokoBotBillingAccessError: funding.BillingError,
  },
  vercelFunctions: { waitUntil: vi.fn() },
  integrationConnection: {
    connectSokoBotIntegration,
    finalizeSokoBotIntegration,
  },
};

export const strategy = {
  month: "2026-10",
  summary: "Founder-led LinkedIn posts that show the product working.",
  goals: ["More demo requests"],
  pillars: ["Product stories"],
  channels: [{ channel: "linkedin", cadence: "3 a week" }],
  calendar: [
    {
      id: "a",
      date: "2026-10-20",
      channel: "linkedin",
      title: "Customer story",
      format: "post",
      status: "draft" as const,
    },
    {
      id: "b",
      date: "2026-10-02",
      channel: "linkedin",
      title: "Old post",
      format: "post",
      status: "draft" as const,
    },
    {
      id: "c",
      date: "2026-10-08",
      channel: "linkedin",
      title: "Published",
      format: "post",
      status: "published" as const,
    },
  ],
  previews: [],
  changes: [],
};
export const revised = { ...strategy, summary: "Twice the LinkedIn posts." };

export function resetCmoServiceMocks(): void {
  vi.clearAllMocks();
  strategyRows.length = 0;
  mockBilling.on = false;
  mockBilling.production = false;
  expireTurn.mockResolvedValue(true);
  // A report message comes back as it was written.
  messageUpsert.mockImplementation(async (args) => ({
    id: args.create.id,
    createdAt: args.create.createdAt,
    metadata: args.create.metadata,
  }));
  projectUpdateMany.mockResolvedValue({ count: 1 });
  messageFindMany.mockResolvedValue([]);
  // Every hire lives in the business's organization (ADR 0060), and the
  // member asking owns it unless a test says otherwise.
  workspaceFindUnique.mockResolvedValue({ organizationId: "org-1" });
  memberFindUnique.mockResolvedValue({ role: "owner" });
  // A Project with no logo, DESIGN.md, site platform or Brand research files.
  projectFindUnique.mockResolvedValue({
    logo: null,
    designMdUrl: null,
    sitePlatform: null,
  });
  fileLinkFindMany.mockResolvedValue([]);
  // No Social posts or connections unless a test seeds them.
  postFindMany.mockResolvedValue([]);
  connectionFindMany.mockResolvedValue([]);
  // The Cuso a member works with is the one `cusoFind` stands for here, in
  // the business's organization.
  cusoFindMany.mockImplementation(async (args: unknown) => {
    const cuso = await cusoFind(args);
    return cuso ? [asCusoBot(cuso)] : [];
  });
}
