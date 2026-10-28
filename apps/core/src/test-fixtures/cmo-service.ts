import { vi } from "vitest";

/**
 * The mocked Prisma client, env and collaborators every CMO service test
 * shares. Each test file mocks the modules with `cmoServiceMocks`, e.g.
 * `vi.mock("@/lib/db/prisma", async () => (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma)`,
 * and runs `resetCmoServiceMocks` before each test.
 */

export const memberFindMany = vi.fn();
export const sokoBotFindUnique = vi.fn();
export const cmoFindMany = vi.fn();
export const memberFindUnique = vi.fn();
export const chatRoomDelete = vi.fn();
export const integrationFindMany = vi.fn();
export const connectSokoBotIntegration = vi.fn();
export const finalizeSokoBotIntegration = vi.fn();
export const cmoFindUnique = vi.fn();
export const cmoUpdate = vi.fn();
export const subscriptionFindFirst = vi.fn();
export const turnFindFirst = vi.fn();
export const connectionFindMany = vi.fn();
export const workspaceFindUnique = vi.fn();
export const postFindFirst = vi.fn();
export const postFindMany = vi.fn();
export const cancelSocialPost = vi.fn();
export const eventFindFirst = vi.fn();
export const expireTurn = vi.fn();
export const startTurn = vi.fn();
export const createBot = vi.fn();
export const projectCreate = vi.fn();
export const projectDelete = vi.fn();
export const cmoCreate = vi.fn();
export const createOrganizationWorkspace = vi.fn();
export const organizationFindFirst = vi.fn();
export const cmoDeleteMany = vi.fn();
export const getUserWorkspace = vi.fn();

// A hire read with its Project, as Core includes it: a fixture's own
// workspaceId and websiteUrl stand for the Project's.
export const withProject = (hire: unknown) =>
  hire && typeof hire === "object"
    ? {
        ...hire,
        project: {
          workspaceId: (hire as { workspaceId?: string }).workspaceId ?? "ws-1",
          websiteUrl:
            (hire as { websiteUrl?: string }).websiteUrl ?? "https://acme.io",
          workspace: { organizationId: "org-1" },
        },
      }
    : hire;

const client = {
  // Runs the callback against this same mock, as one transaction would.
  $transaction: (callback: (tx: unknown) => unknown) => callback(client),
  $executeRaw: vi.fn(async () => 1),
  cmoHire: {
    findUnique: async (args: { include?: unknown }) => {
      const hire = await cmoFindUnique(args);
      return args?.include ? withProject(hire) : hire;
    },
    findMany: cmoFindMany,
    update: cmoUpdate,
    create: async (args: { include?: unknown }) => {
      const hire = await cmoCreate(args);
      return args?.include ? withProject(hire) : hire;
    },
    deleteMany: cmoDeleteMany,
  },
  user: {
    findUnique: async () => ({ preferredOrganizationId: "org-1" }),
  },
  member: { findUnique: memberFindUnique, findMany: memberFindMany },
  sokoBot: { findUnique: sokoBotFindUnique },
  chatRoom: { delete: chatRoomDelete },
  project: { create: projectCreate, delete: projectDelete },
  organization: { findFirst: organizationFindFirst },
  subscription: { findFirst: subscriptionFindFirst },
  workspace: { findUnique: workspaceFindUnique },
  sokoBotTurn: { findFirst: turnFindFirst },
  projectSocialConnection: { findMany: connectionFindMany },
  socialPost: { findFirst: postFindFirst, findMany: postFindMany },
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
  mockBilling.on = false;
  mockBilling.production = false;
  cmoUpdate.mockImplementation(async (args) => ({ id: "cmo-1", ...args.data }));
  expireTurn.mockResolvedValue(true);
  // Every hire lives in the business's organization (ADR 0060), and the
  // member asking owns it unless a test says otherwise.
  workspaceFindUnique.mockResolvedValue({ organizationId: "org-1" });
  memberFindUnique.mockResolvedValue({ role: "owner" });
  // The hire a member works with is the one findUnique stands for here, in
  // the business's organization.
  cmoFindMany.mockImplementation(async (args: unknown) => {
    const hire = await cmoFindUnique(args);
    return hire ? [withProject(hire)] : [];
  });
}
