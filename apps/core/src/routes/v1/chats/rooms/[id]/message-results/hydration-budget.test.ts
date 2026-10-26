import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { chatResultSnapshotSchema } from "@/schemas/chat-result-preview.schema";
import mount from "./get";

interface WorkspaceRow {
  id: string;
  userId: string | null;
  organizationId: string | null;
}

interface ProjectRow {
  id: string;
  workspaceId: string;
}

interface MemberRow {
  userId: string;
  organizationId: string;
}

interface PostRow {
  id: string;
  projectId: string;
  workspaceId: string;
  text: string;
  provider: string;
  status: string;
  media: unknown;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  timezone: string | null;
  socialConnection: {
    externalHandle: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    provider: string;
    status: string;
  } | null;
  project: { workspace: { organization: { slug: string | null } } };
  creatorUser: { id: string; name: string } | null;
  creatorCoworker: null;
  creatorSokoBot: null;
  firstComment: null;
  scheduledByUserId: null;
  scheduledByCoworkerId: null;
  canceledAt: null;
  publishedExternalId: null;
  publishedUrl: null;
  statistics: null;
  lastError: null;
  attemptCount: number;
  nextAttemptAt: null;
  lastAttemptAt: null;
  attempts: [];
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

interface JobRow {
  id: string;
  projectId: string;
  status: "COMPLETED";
  kind: "TEXT_TO_IMAGE";
  model: string;
  prompt: string;
  settings: Record<string, never>;
  referenceAssetIds: string[];
  error: string | null;
  failureReason: null;
  parentAssetId: null;
  createdAt: Date;
  submittedAt: null;
  settledAt: null;
  cancelRequestedAt: null;
  chargedCents: null;
  transactionId: null;
  asset: null;
}

interface MessageRow {
  id: string;
  metadata: { result_preview_snapshots: unknown[] };
}

const harness = vi.hoisted(() => {
  const counts = {
    workspace: 0,
    project: 0,
    member: 0,
    socialPost: 0,
    fileResource: 0,
    imageJob: 0,
    imageAsset: 0,
  };
  const rows: {
    workspaces: WorkspaceRow[];
    projects: ProjectRow[];
    members: MemberRow[];
    posts: PostRow[];
    jobs: JobRow[];
    messages: MessageRow[];
  } = {
    workspaces: [],
    projects: [],
    members: [],
    posts: [],
    jobs: [],
    messages: [],
  };

  function resetCounts() {
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      counts[key] = 0;
    }
  }

  function viewerId(where: { OR?: unknown }) {
    const clauses = Array.isArray(where.OR) ? where.OR : [];
    const first = clauses[0] as { userId?: string } | undefined;
    const second = clauses[1] as
      | {
          organization?: { members?: { some?: { userId?: string } } };
        }
      | undefined;
    return first?.userId ?? second?.organization?.members?.some?.userId;
  }

  function workspaceVisible(row: WorkspaceRow, userId: string | undefined) {
    if (!userId) return false;
    if (row.userId === userId) return true;
    return rows.members.some(
      (member) =>
        member.userId === userId &&
        member.organizationId === row.organizationId,
    );
  }

  function idList(value: unknown): string[] | null {
    if (typeof value === "string") return [value];
    if (
      value &&
      typeof value === "object" &&
      "in" in value &&
      Array.isArray((value as { in: unknown }).in)
    ) {
      return (value as { in: string[] }).in;
    }
    return null;
  }

  const prisma = {
    workspace: {
      async findFirst(args: { where: { id: string; OR?: unknown[] } }) {
        counts.workspace += 1;
        const userId = viewerId(args.where);
        return (
          rows.workspaces.find(
            (row) => row.id === args.where.id && workspaceVisible(row, userId),
          ) ?? null
        );
      },
      async findMany(args: {
        where: { id?: { in?: string[] } | string; OR?: unknown[] };
      }) {
        counts.workspace += 1;
        const ids = idList(args.where.id);
        const userId = viewerId(args.where);
        return rows.workspaces.filter(
          (row) =>
            (ids === null || ids.includes(row.id)) &&
            workspaceVisible(row, userId),
        );
      },
      async findUnique() {
        counts.workspace += 1;
        return null;
      },
    },
    project: {
      async findFirst(args: {
        where: { id: string; workspaceId: string };
        select?: { workspace?: unknown };
      }) {
        counts.project += 1;
        const project = rows.projects.find(
          (row) =>
            row.id === args.where.id &&
            row.workspaceId === args.where.workspaceId,
        );
        if (!project) return null;
        const workspace = rows.workspaces.find(
          (row) => row.id === project.workspaceId,
        );
        return { ...project, workspace };
      },
      async findMany(args: {
        where: {
          OR?: Array<{ workspaceId: string; id: { in: string[] } }>;
          workspaceId?: string;
          id?: { in: string[] };
        };
      }) {
        counts.project += 1;
        const clauses =
          args.where.OR ??
          (args.where.workspaceId && args.where.id
            ? [{ workspaceId: args.where.workspaceId, id: args.where.id }]
            : []);
        return rows.projects.filter((project) =>
          clauses.some(
            (clause) =>
              clause.workspaceId === project.workspaceId &&
              clause.id.in.includes(project.id),
          ),
        );
      },
    },
    member: {
      async findFirst(args: {
        where: { userId: string; organizationId: string };
      }) {
        counts.member += 1;
        return (
          rows.members.find(
            (member) =>
              member.userId === args.where.userId &&
              member.organizationId === args.where.organizationId,
          ) ?? null
        );
      },
      async findMany(args: {
        where: { userId: string; organizationId: { in: string[] } };
      }) {
        counts.member += 1;
        return rows.members.filter(
          (member) =>
            member.userId === args.where.userId &&
            args.where.organizationId.in.includes(member.organizationId),
        );
      },
    },
    socialPost: {
      async findFirst(args: {
        where: { id: string; projectId: string; workspaceId: string };
      }) {
        counts.socialPost += 1;
        return (
          rows.posts.find(
            (post) =>
              post.id === args.where.id &&
              post.projectId === args.where.projectId &&
              post.workspaceId === args.where.workspaceId,
          ) ?? null
        );
      },
      async findMany(args: {
        where: {
          OR: Array<{ id: string; projectId: string; workspaceId: string }>;
        };
      }) {
        counts.socialPost += 1;
        return rows.posts.filter((post) =>
          args.where.OR.some(
            (clause) =>
              clause.id === post.id &&
              clause.projectId === post.projectId &&
              clause.workspaceId === post.workspaceId,
          ),
        );
      },
    },
    fileResource: {
      async findMany(args: {
        where: {
          OR?: Array<{
            workspaceId: string;
            sourceId: { in: string[] };
          }>;
          workspaceId?: string;
          sourceId?: { in: string[] };
        };
      }) {
        counts.fileResource += 1;
        return [];
      },
    },
    projectImageJob: {
      async findFirst(args: { where: { id: string; projectId: string } }) {
        counts.imageJob += 1;
        return (
          rows.jobs.find(
            (job) =>
              job.id === args.where.id &&
              job.projectId === args.where.projectId,
          ) ?? null
        );
      },
      async findMany(args: {
        where: { OR: Array<{ id: string; projectId: string }> };
      }) {
        counts.imageJob += 1;
        return rows.jobs.filter((job) =>
          args.where.OR.some(
            (clause) =>
              clause.id === job.id && clause.projectId === job.projectId,
          ),
        );
      },
    },
    projectImageAsset: {
      async findFirst() {
        counts.imageAsset += 1;
        return null;
      },
      async findMany() {
        counts.imageAsset += 1;
        return [];
      },
    },
    chatRoomMessage: {
      async findMany(args: { where: { id: { in: string[] } } }) {
        return rows.messages.filter((message) =>
          args.where.id.in.includes(message.id),
        );
      },
    },
  };

  return { counts, rows, prisma, resetCounts };
});

vi.mock("@/middleware/auth", async (original) => {
  const actual = await original<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("../../helpers", () => ({
  requireChatRoomUserMembership: vi.fn(),
}));
vi.mock("@/helpers/chat-message-read-budget", () => ({
  assertChatMessageReadBudget: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: harness.prisma }));

const roomId = "00000000-0000-4000-8000-0000000000a1";
const viewer = "owner";
const capturedAt = "2026-10-06T10:00:00.000Z";

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function snapshot(input: {
  workspaceId: string;
  kind: "social_post" | "studio_job";
  id: string;
  projectId: string;
  title: string;
}) {
  return chatResultSnapshotSchema.parse({
    workspaceId: input.workspaceId,
    reference: {
      kind: input.kind,
      id: input.id,
      projectId: input.projectId,
    },
    data: {
      id: uuid(input.title.length + input.id.length + input.projectId.length),
      state: "available",
      capturedAt,
      kind: input.kind,
      title: input.title,
      status: "SCHEDULED",
      sourceHref: input.kind === "social_post" ? "/social" : "/studio",
    },
  });
}

function postRow(input: {
  id: string;
  projectId: string;
  workspaceId: string;
  text: string;
}): PostRow {
  const now = new Date(capturedAt);
  return {
    id: input.id,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    text: input.text,
    provider: "linkedin",
    status: "SCHEDULED",
    media: [],
    scheduledAt: now,
    publishedAt: null,
    timezone: "UTC",
    socialConnection: null,
    project: { workspace: { organization: { slug: null } } },
    creatorUser: { id: viewer, name: "Owner" },
    creatorCoworker: null,
    creatorSokoBot: null,
    firstComment: null,
    scheduledByUserId: null,
    scheduledByCoworkerId: null,
    canceledAt: null,
    publishedExternalId: null,
    publishedUrl: null,
    statistics: null,
    lastError: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    attempts: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function app() {
  const api = new OpenAPIHonoWithAuth();
  api.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: viewer,
      organizationId: null,
      role: "user",
    });
    c.set("requestId", "hydration-budget");
    await next();
  });
  api.onError(errorHandler);
  mount(api);
  return api;
}

async function readResults(messageIds: string[]) {
  harness.resetCounts();
  const response = await app().request(
    `/${roomId}/message-results?messageIds=${messageIds.join(",")}`,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: Array<{
      messageId: string;
      results: Array<{
        state: string;
        summary?: string | null;
        title?: string;
      }>;
    }>;
  };
  return { counts: { ...harness.counts }, data: body.data };
}

describe("message result hydration query budget", () => {
  beforeEach(() => {
    harness.rows.workspaces = [
      { id: "ws-own", userId: viewer, organizationId: null },
      { id: "ws-org", userId: null, organizationId: "org-1" },
      { id: "ws-foreign", userId: "someone-else", organizationId: "org-1" },
      { id: "ws-closed", userId: "someone-else", organizationId: null },
    ];
    harness.rows.members = [{ userId: viewer, organizationId: "org-1" }];
    harness.rows.projects = [
      { id: "proj-own", workspaceId: "ws-own" },
      { id: "proj-org", workspaceId: "ws-org" },
      { id: "proj-foreign", workspaceId: "ws-foreign" },
    ];
    harness.rows.posts = [];
    harness.rows.jobs = [];
    harness.rows.messages = [];
    harness.resetCounts();
  });

  async function seedSocial(count: number) {
    const messages: MessageRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = `post-${index}`;
      const text = `Launch note ${index}`;
      harness.rows.posts.push(
        postRow({
          id,
          projectId: "proj-own",
          workspaceId: "ws-own",
          text,
        }),
      );
      const messageId = uuid(100 + index);
      messages.push({
        id: messageId,
        metadata: {
          result_preview_snapshots: [
            snapshot({
              workspaceId: "ws-own",
              kind: "social_post",
              id,
              projectId: "proj-own",
              title: text,
            }),
          ],
        },
      });
    }
    harness.rows.messages = messages;
    return messages.map((message) => message.id);
  }

  it("keeps workspace, project, post, and file reads constant as social cards grow", async () => {
    const four = await readResults(await seedSocial(4));
    const eight = await readResults(await seedSocial(8));
    expect(eight.data).toHaveLength(8);
    expect(
      eight.data.every(
        (row) =>
          row.results[0]?.state === "available" &&
          row.results[0]?.title?.startsWith("Launch note"),
      ),
    ).toBe(true);
    expect(four.counts).toEqual(eight.counts);
    expect(eight.counts.workspace).toBeLessThanOrEqual(1);
    expect(eight.counts.project).toBeLessThanOrEqual(1);
    expect(eight.counts.socialPost).toBeLessThanOrEqual(1);
    expect(eight.counts.fileResource).toBe(0);
    expect(eight.counts.member).toBe(0);
  });

  it("hides social cards the viewer cannot access and still shows the ones they can", async () => {
    const visible = postRow({
      id: "visible",
      projectId: "proj-own",
      workspaceId: "ws-own",
      text: "Visible launch",
    });
    const org = postRow({
      id: "org-post",
      projectId: "proj-org",
      workspaceId: "ws-org",
      text: "Org launch",
    });
    const foreign = postRow({
      id: "foreign-post",
      projectId: "proj-foreign",
      workspaceId: "ws-foreign",
      text: "Foreign launch",
    });
    const closed = postRow({
      id: "closed-post",
      projectId: "missing-project",
      workspaceId: "ws-closed",
      text: "Closed launch",
    });
    const missingProject = postRow({
      id: "missing-post",
      projectId: "missing-project",
      workspaceId: "ws-own",
      text: "Missing project",
    });
    harness.rows.posts.push(visible, org, foreign, closed, missingProject);
    const specs = [
      ["visible", "ws-own", "proj-own", "Visible launch"],
      ["org-post", "ws-org", "proj-org", "Org launch"],
      ["foreign-post", "ws-foreign", "proj-foreign", "Foreign launch"],
      ["closed-post", "ws-closed", "missing-project", "Closed launch"],
      ["missing-post", "ws-own", "missing-project", "Missing project"],
    ] as const;
    harness.rows.messages = specs.map(
      ([id, workspaceId, projectId, title], index) => ({
        id: uuid(200 + index),
        metadata: {
          result_preview_snapshots: [
            snapshot({
              workspaceId,
              kind: "social_post",
              id,
              projectId,
              title,
            }),
          ],
        },
      }),
    );
    const { data } = await readResults(
      harness.rows.messages.map((message) => message.id),
    );
    const titles = data.flatMap((row) =>
      row.results.map((result) =>
        result.state === "available" ? result.title : "hidden",
      ),
    );
    expect(titles).toEqual([
      "Visible launch",
      "Org launch",
      "hidden",
      "hidden",
      "hidden",
    ]);
  });

  it("reads studio jobs for one workspace in a bounded project query", async () => {
    const messages: MessageRow[] = [];
    for (let index = 0; index < 8; index += 1) {
      const id = `job-${index}`;
      harness.rows.jobs.push({
        id,
        projectId: "proj-own",
        status: "COMPLETED",
        kind: "TEXT_TO_IMAGE",
        model: "model",
        prompt: `Banner ${index}`,
        settings: {},
        referenceAssetIds: [],
        error: null,
        failureReason: null,
        parentAssetId: null,
        createdAt: new Date(capturedAt),
        submittedAt: null,
        settledAt: null,
        cancelRequestedAt: null,
        chargedCents: null,
        transactionId: null,
        asset: null,
      });
      messages.push({
        id: uuid(300 + index),
        metadata: {
          result_preview_snapshots: [
            snapshot({
              workspaceId: "ws-own",
              kind: "studio_job",
              id,
              projectId: "proj-own",
              title: `Banner ${index}`,
            }),
          ],
        },
      });
    }
    harness.rows.messages = messages;
    const { counts, data } = await readResults(
      messages.map((message) => message.id),
    );
    expect(
      data.every(
        (row) =>
          row.results[0]?.state === "available" &&
          row.results[0]?.title?.startsWith("Banner"),
      ),
    ).toBe(true);
    expect(counts.workspace).toBeLessThanOrEqual(1);
    expect(counts.project).toBeLessThanOrEqual(1);
    expect(counts.imageJob).toBeLessThanOrEqual(1);
    expect(counts.imageAsset).toBe(0);
  });
});
