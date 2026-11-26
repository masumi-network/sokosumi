import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Patrick's request end to end, with the model and the image provider
 * stubbed: "Have CodePat review our code, then make 2-3 minimal images and
 * prepare a post on my Padierfind X account for me to approve." The owner's
 * chat hands CodePat a Task with the plan and its limits; CodePat's review
 * comes back; the turn Core starts for it makes the images within the limits
 * and saves the draft with them, never scheduled or published.
 */

interface Call {
  turnId: string;
  capability: string;
  toolCallId: string;
  input: { maxCredits: number };
}
interface Inbox {
  turnId: string;
  botId: string;
  entityId: string;
  eventId: string;
}

const store = vi.hoisted(() => ({
  delegations: [] as Record<string, unknown>[],
  calls: [] as Call[],
  inbox: [] as Inbox[],
  started: [] as Record<string, unknown>[],
  drafts: [] as Record<string, unknown>[],
  failedTurns: [] as string[],
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ SOKO_BOT_ENABLED: true }),
}));
vi.mock("@/lib/soko-bot/task-charges", () => ({
  taskCreditsCharged: async () => new Map<string, number>(),
  roundCredits: (credits: number) => credits,
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  proactiveGate: async () => ({ ok: true, usedToday: 0, limit: 20 }),
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: vi.fn(),
}));
// The saved draft, as the Social service stores it.
vi.mock("@/services/social-posts.service", async (original) => ({
  ...(await original<object>()),
  prepareSocialPostMutationMedia: async (input: {
    media: unknown;
    threadParts: unknown;
  }) => ({ media: input.media, threadParts: input.threadParts }),
  createSocialPost: async (input: Record<string, unknown>) => {
    const draft = {
      id: `post-${store.drafts.length + 1}`,
      revision: 1,
      status: input.scheduledAt ? "SCHEDULED" : "NEEDS_APPROVAL",
      ...input,
    };
    store.drafts.push(draft);
    return draft;
  },
}));
vi.mock("@/schemas/social-post.schema", async (original) => ({
  ...(await original<object>()),
  socialPostSchema: { parse: (post: unknown) => post },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: async (work: (tx: object) => Promise<unknown>) =>
    work({}),
}));
vi.mock("@/lib/soko-bot/action-receipts", async (original) => ({
  ...(await original<object>()),
  commitActionReceipt: async () => undefined,
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class SokoBotBusyError extends Error {},
  SokoBotNotFoundError: class SokoBotNotFoundError extends Error {},
  sokoBotControlPlane: {
    reconcileTurn: async () => undefined,
    // What Core records as it starts the wake: the change is seen and the
    // plan is claimed by this turn.
    startTurn: async (input: {
      eventBatch: {
        status: string;
        eventId: string;
        entityId: string;
        followUpDelegationIds?: string[];
      }[];
    }) => {
      store.started.push(input);
      for (const occurrence of input.eventBatch) {
        store.inbox.push({
          turnId: "event-turn",
          botId: "joseph",
          entityId: occurrence.entityId,
          eventId: occurrence.eventId,
        });
        for (const delegation of store.delegations)
          if (
            occurrence.followUpDelegationIds?.includes(delegation.id as string)
          )
            Object.assign(delegation, {
              lastSeenStatus: occurrence.status,
              lastSeenEventId: occurrence.eventId,
              followUpTurnId: "event-turn",
            });
      }
      return { turnId: "event-turn", status: "RUNNING" };
    },
  },
}));

type Where = {
  turnId?: string | { in: string[] };
  capability?: string | { in: string[] };
  botId?: string;
  entityId?: { in: string[] };
  turn?: { status: string };
  toolCallId?: string;
  NOT?: { turnId?: string; toolCallId?: string };
};
/** The call this check is for, which never counts against itself. */
const excluded = (call: { turnId: string; toolCallId: string }, where: Where) =>
  !!where.NOT &&
  (where.NOT.turnId === undefined || where.NOT.turnId === call.turnId) &&
  where.NOT.toolCallId === call.toolCallId;
const onTurn = (turnId: string, where: Where) =>
  typeof where.turnId === "string"
    ? turnId === where.turnId
    : !where.turnId || where.turnId.in.includes(turnId);
const ofCapability = (capability: string, where: Where) =>
  typeof where.capability === "string"
    ? capability === where.capability
    : !where.capability || where.capability.in.includes(capability);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    syncMetadata: {
      upsert: async () => ({
        key: "soko-events-v2",
        createdAt: new Date(0),
        cursorId: null,
      }),
      update: async () => ({}),
    },
    sokoBotEventInbox: {
      findMany: async ({ where }: { where: Where }) =>
        store.inbox.filter(
          (entry) =>
            onTurn(entry.turnId, where) &&
            (!where.botId || entry.botId === where.botId) &&
            (!where.entityId || where.entityId.in.includes(entry.entityId)) &&
            (!where.turn || store.failedTurns.includes(entry.turnId)),
        ),
    },
    taskEvent: { findMany: async () => [] },
    sokoBotTurn: {
      findMany: async () => [],
      findUnique: async () => ({ clientTurnId: "event:codepat-review" }),
    },
    sokoBotDelegation: {
      findMany: async ({ where }: { where: { followUpTurnId?: string } }) =>
        where.followUpTurnId
          ? store.delegations.filter(
              (delegation) =>
                delegation.followUpTurnId === where.followUpTurnId,
            )
          : store.delegations,
      update: async () => ({}),
    },
    sokoBotToolCall: {
      findFirst: async () => null,
      count: async ({ where }: { where: Where }) =>
        store.calls.filter(
          (call) =>
            onTurn(call.turnId, where) &&
            ofCapability(call.capability, where) &&
            !excluded(call, where),
        ).length,
      findMany: async ({ where }: { where: Where }) =>
        store.calls.filter(
          (call) =>
            onTurn(call.turnId, where) &&
            ofCapability(call.capability, where) &&
            !excluded(call, where),
        ),
    },
  },
}));

import { SokoBotEventsSyncService } from "./soko-bot-events-sync.service";
import { checkImageRequest } from "./soko-bot-runtime/media-checks";
import type { RuntimeOperations } from "./soko-bot-runtime/operations";
import { executeSocialTool } from "./soko-bot-runtime/social";

const PADIERFIND = "0193a000-0000-7000-8000-00000000aaaa";
const PADIERFIND_X = "0193a000-0000-7000-8000-00000000bbbb";
const PLAN =
  "Make 2-3 minimal images (white background, black text, few words) from CodePat's review and draft an X post with them on the Padierfind project's @padierfind account, for the owner's approval.";
const REVIEW =
  "Review: Soko Bot memory is five typed sections the bot edits entry by entry.";

/** Reaching the image provider means every owner and limit check passed. */
class ReachedImageProvider extends Error {}

const runtime = {
  mayActForOwner: async () => false,
  refuseCmoRunMedia: () => undefined,
  mediaPerTurn: async () => ({ images: 4, videos: 2 }),
  requireImageProject: () => {
    throw new ReachedImageProvider();
  },
  requireSocialAccess: async () => ({ organizationId: null }),
  requireMutationAuthority: async () => undefined,
  resolveSocialPostMedia: async (
    _authorized: unknown,
    input: { media?: { fileId: string }[] },
  ) => ({
    media: input.media?.map((item) => ({ fileId: item.fileId })),
    threadParts: undefined,
  }),
} as unknown as RuntimeOperations;

function turn(id: string) {
  return {
    turn: {
      id,
      source: "EVENT",
      workspaceId: "ws",
      sokoBotId: "joseph",
      versionId: "v36",
      actingUserId: "owner",
    },
  } as unknown as Parameters<typeof checkImageRequest>[1];
}

function image(
  maxCredits: number,
  turnId = "event-turn",
  toolCallId = `image-${store.calls.length + 1}`,
) {
  return checkImageRequest(
    runtime,
    turn(turnId),
    {
      projectId: PADIERFIND,
      prompt: "White background, black text: how Soko Bots keep memory",
      maxCredits,
    },
    toolCallId,
  );
}

/** One image the stub provider made; its file id goes into the draft. */
async function madeImage(
  maxCredits: number,
  turnId = "event-turn",
  toolCallId = `image-${store.calls.length + 1}`,
) {
  await expect(image(maxCredits, turnId, toolCallId)).rejects.toBeInstanceOf(
    ReachedImageProvider,
  );
  store.calls.push({
    turnId,
    capability: "generate_image",
    toolCallId,
    input: { maxCredits },
  });
  return `0193a000-0000-7000-8000-${String(store.calls.length).padStart(12, "0")}`;
}

function draft(input: Record<string, unknown>) {
  return executeSocialTool(
    runtime,
    {
      sessionId: "session",
      turnId: "event-turn",
      capability: "create_social_post",
      toolCallId: `post-${store.drafts.length + 1}`,
      input: {
        projectId: PADIERFIND,
        socialConnectionId: PADIERFIND_X,
        text: "How Soko Bots keep memory: five typed sections, edited entry by entry.",
        ...input,
      },
    } as never,
    turn("event-turn") as never,
  );
}

const sync = () =>
  new SokoBotEventsSyncService().syncDelegatedWork({
    abortSignal: new AbortController().signal,
    shouldContinue: () => true,
  });

describe("request → research → images → draft", () => {
  beforeEach(() => {
    store.calls = [];
    store.inbox = [];
    store.started = [];
    store.drafts = [];
    store.failedTurns = [];
    // The owner's chat created CodePat's Task with the plan and its limits.
    store.delegations = [
      {
        id: "codepat-task",
        turnId: "owner-chat",
        kind: "TASK",
        lastSeenStatus: "READY",
        lastSeenEventId: null,
        lastSeenEventAt: null,
        followUp: PLAN,
        followUpAllows: { images: 3, maxCredits: 30 },
        followUpTurnId: null,
        task: {
          id: "task-codepat",
          name: "Architecture review for a post",
          visibility: "PUBLIC",
          ownerId: "owner",
          workspaceId: "ws",
          archivedAt: null,
          status: "COMPLETED",
          assigneeSokoBotId: null,
          events: [
            {
              id: "review-done",
              comment: REVIEW,
              createdAt: new Date(),
              sokoBotId: null,
            },
          ],
        },
        job: null,
        turn: {
          sokoBotId: "joseph",
          requestedByUserId: "owner",
          sokoBot: { userId: "owner" },
          workspaceId: "ws",
          parentTurnId: null,
          parentTurn: null,
          status: "COMPLETED",
          source: "CHAT",
          chainDepth: 0,
          askedByUserId: null,
          capabilityNames: [
            "create_schedule",
            "create_task",
            "generate_image",
            "create_social_post",
            "publish_social_post",
            "schedule_social_post",
          ],
        },
      },
    ];
  });

  it("ends with a draft for approval that carries the images made from CodePat's review", async () => {
    // CodePat's review comes back with the plan, its limits and the tools.
    expect((await sync()).woken).toBe(1);
    const wake = store.started[0] as {
      message: string;
      presetRoute: { capabilities: string[] };
    };
    expect(wake.message).toContain(REVIEW);
    expect(wake.message).toContain(PLAN);
    expect(wake.message).toContain(
      "The owner allowed at most 3 images and 30 credits on media",
    );
    expect(wake.presetRoute.capabilities).toEqual(
      expect.arrayContaining(["generate_image", "create_social_post"]),
    );
    expect(wake.presetRoute.capabilities).not.toContain("publish_social_post");
    expect(wake.presetRoute.capabilities).not.toContain("schedule_social_post");

    // Three images, then the draft with them.
    const images = [
      await madeImage(10),
      await madeImage(10),
      await madeImage(10),
    ];
    await draft({ media: images.map((fileId) => ({ fileId })) });
    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0]).toMatchObject({
      status: "NEEDS_APPROVAL",
      socialConnectionId: PADIERFIND_X,
      media: images.map((fileId) => ({ fileId })),
      sokoBotId: "joseph",
    });
    expect(store.drafts[0]?.scheduledAt).toBeUndefined();
  });

  it("makes the images the owner asked for, and no more", async () => {
    await sync();
    await madeImage(10);
    await madeImage(10);
    await madeImage(10);
    await expect(image(10)).rejects.toThrow(
      "The owner asked for 3 images in this plan",
    );
  });

  it("keeps the images within the owner's credits", async () => {
    await sync();
    await madeImage(10);
    await expect(image(25)).rejects.toThrow(
      "The owner allowed 30 credits on media for this plan, and 10 are set aside already",
    );
    await madeImage(20);
  });

  describe("on a retry", () => {
    /** The first wake failed; the retry's occurrence may be a later event. */
    function retryAfterFailure(retriedEvent: string) {
      store.failedTurns.push("event-turn");
      store.inbox.push({
        turnId: "retry-turn",
        botId: "joseph",
        entityId: "task-codepat",
        eventId: `${retriedEvent}:follow-up-retry`,
      });
      Object.assign(store.delegations[0]!, { followUpTurnId: "retry-turn" });
    }

    it("does not start the owner's allowance again", async () => {
      await sync();
      await madeImage(10, "event-turn");
      await madeImage(10, "event-turn");
      retryAfterFailure("review-done");
      await madeImage(5, "retry-turn");
      await expect(image(5, "retry-turn")).rejects.toThrow(
        "The owner asked for 3 images in this plan",
      );
    });

    it("counts the failed turn's images when it wrote on the Task before failing", async () => {
      await sync();
      await madeImage(10, "event-turn");
      await madeImage(10, "event-turn");
      // The failed turn commented on CodePat's Task, a newer event.
      retryAfterFailure("reply-before-failing");
      await madeImage(5, "retry-turn");
      await expect(image(5, "retry-turn")).rejects.toThrow(
        "The owner asked for 3 images in this plan",
      );
    });

    it("counts a failed turn's call that has the same id as the retry's", async () => {
      await sync();
      await madeImage(10, "event-turn", "image-1");
      await madeImage(10, "event-turn", "image-2");
      retryAfterFailure("review-done");
      await madeImage(5, "retry-turn", "image-1");
      await expect(image(5, "retry-turn", "image-2")).rejects.toThrow(
        "The owner asked for 3 images in this plan",
      );
    });
  });

  it("keeps the media limits when the wake also carries a plan without limits", async () => {
    // A second plan on another Task: "give the findings to Alex as a Task".
    const media = store.delegations[0]!;
    Object.assign(media, { followUpAllows: { images: 2, maxCredits: 15 } });
    store.delegations.push({
      ...media,
      id: "alex-brief",
      followUp:
        "Give CodePat's findings to Alex as a Task for a one-page brief.",
      followUpAllows: null,
      task: {
        ...(media.task as Record<string, unknown>),
        id: "task-alex-research",
        events: [
          {
            id: "research-done",
            comment: "Research done.",
            createdAt: new Date(),
            sokoBotId: null,
          },
        ],
      },
    });
    await sync();
    expect(
      store.delegations.every(
        (delegation) => delegation.followUpTurnId === "event-turn",
      ),
    ).toBe(true);
    await madeImage(5);
    await madeImage(5);
    await expect(image(5)).rejects.toThrow(
      "The owner asked for 2 images in this plan",
    );
  });

  it("never schedules or publishes the post", async () => {
    await sync();
    await expect(
      draft({ scheduledAt: "2026-11-27T09:00:00.000Z" }),
    ).rejects.toThrow("stays a draft");
    expect(store.drafts).toHaveLength(0);
  });

  it("hands the plan over once, however often the review is seen again", async () => {
    expect((await sync()).woken).toBe(1);
    expect((await sync()).woken).toBe(0);
    expect(store.started).toHaveLength(1);
  });

  it("refuses images on a wake that carries no plan of the owner's", async () => {
    store.delegations = [];
    await expect(image(10)).rejects.toThrow(
      "Images are generated only when a person asks in chat",
    );
  });
});
