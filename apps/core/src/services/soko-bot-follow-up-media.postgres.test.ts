import { randomUUID } from "node:crypto";
import {
  DEFAULT_SOKO_BOT_VERSION_ID,
  ownerAuthoritySchema,
  sokoBotFollowUpAllowsSchema,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * A follow-up the owner asked for ("when the review is back, make the images
 * and draft the post for my approval"), carried out by the turn Core starts
 * for it, against PostgreSQL and the real runtime: the owner's limits, the
 * studio job read by get_image and copied into the owner's Files, the Drive
 * media resolver and the Social service's own save. Only the image
 * provider, the studio's charge-and-submit step, Blob storage and the X
 * tier lookup are stubbed.
 */

const blobs = vi.hoisted(() => new Map<string, Uint8Array<ArrayBuffer>>());
const provider = vi.hoisted(() => ({
  fetchQueueStatus: vi.fn(),
  fetchQueueResult: vi.fn(),
  downloadMedia: vi.fn(),
  nextCreateImageJobError: null as Error | null,
  nextCreateImageJobStatus: null as string | null,
  createImageJobCalls: 0,
  onAfterCreateImageJob: null as (() => void) | null,
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      SOKO_BOT_ENABLED: true,
      FAL_KEY: "k",
      BLOB_READ_WRITE_TOKEN: "public-store-token",
      IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN: "studio-store-token",
    }),
    getBetterAuthPublicBaseUrl: () => null,
  };
});
vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  const url = (pathname: string) =>
    `https://store.public.blob.vercel-storage.com/${pathname}`;
  const meta = (pathname: string) => {
    const bytes = blobs.get(pathname);
    if (!bytes) throw new actual.BlobNotFoundError();
    return {
      pathname,
      url: url(pathname),
      downloadUrl: url(pathname),
      size: bytes.byteLength,
      contentType: "image/png",
      uploadedAt: new Date(),
      cacheControl: "public",
      contentDisposition: "inline",
      etag: "etag",
    };
  };
  return {
    ...actual,
    put: async (pathname: string, body: Buffer | Uint8Array) => {
      blobs.set(pathname, new Uint8Array(body));
      return { pathname, url: url(pathname), downloadUrl: url(pathname) };
    },
    head: async (pathname: string) => meta(pathname),
    get: async (pathname: string) => {
      const bytes = blobs.get(pathname);
      if (!bytes) return null;
      return {
        statusCode: 200,
        stream: new Blob([bytes]).stream(),
        blob: meta(pathname),
      };
    },
    del: async () => undefined,
  };
});
// Blob's public URLs, served from the same store.
vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ssrfSafeFetch: async (url: string) => {
    const bytes = blobs.get(new URL(url).pathname.slice(1));
    return bytes
      ? new Response(bytes, { headers: { "content-type": "image/png" } })
      : new Response(null, { status: 404 });
  },
}));
vi.mock("@/lib/image-studio/fal-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...provider,
}));
// The charge and the provider submission: a queued job the provider holds.
vi.mock("@/services/image-studio-jobs.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/image-studio-jobs.service")
    >();
  const { default: db } = await import("@/lib/db/prisma");
  return {
    ...actual,
    createImageJob: async (input: {
      projectId: string;
      workspaceId: string;
      userId: string;
      prompt: string;
      modelId: string;
      idempotencyKey: string;
    }) => {
      provider.createImageJobCalls += 1;
      if (provider.nextCreateImageJobError) {
        const error = provider.nextCreateImageJobError;
        provider.nextCreateImageJobError = null;
        throw error;
      }
      const status = provider.nextCreateImageJobStatus ?? "QUEUED";
      provider.nextCreateImageJobStatus = null;
      const job = await db.projectImageJob.create({
        data: {
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          requestedByUserId: input.userId,
          kind: "GENERATE",
          model: input.modelId,
          prompt: input.prompt,
          settings: {},
          referenceAssetIds: [],
          idempotencyKey: input.idempotencyKey,
          status: status as never,
          falRequestId: status === "FAILED" ? null : `fal-${randomUUID()}`,
          submitAttempts: 1,
          submittedAt: new Date(),
        },
      });
      const hook = provider.onAfterCreateImageJob;
      provider.onAfterCreateImageJob = null;
      hook?.();
      return job;
    },
  };
});
vi.mock("@/services/x-subscription-tier.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveXSubscriptionType: async (connection: {
    subscriptionType: string | null;
  }) => connection.subscriptionType,
}));

import prisma from "@/lib/db/prisma";
import { deriveDelegationAuthority } from "@/lib/soko-bot/owner-authority";
import { sokoBotRuntimeService } from "@/services/soko-bot-runtime.service";
import { pngBytes } from "@/test/image-bytes";
import { withFixtureSchemas } from "@/test/split-layout";

describe.skipIf(!enabled)("a follow-up's images and draft, end to end", () => {
  const ownerId = randomUUID();
  const workspaceId = randomUUID();
  const sokoBotId = randomUUID();
  const ownerChatId = randomUUID();
  let projectId: string;
  let requestedAccount: string;
  let otherAccount: string;
  let calls = 0;

  async function connection(handle: string) {
    const row = await prisma.projectSocialConnection.create({
      data: {
        projectId,
        provider: "x",
        externalAccountId: randomUUID(),
        externalHandle: handle,
        composioConnectedAccountId: randomUUID(),
        status: "active",
        connectorUserId: ownerId,
        connectedAt: new Date(),
      },
    });
    return row.id;
  }

  /** A turn Core started for the owner's plan; the plan's allowance on it. */
  async function wakeTurn(allows: { images?: number; maxCredits?: number }) {
    const id = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `create-task-${id}`,
        kind: "TASK",
        action: "create_task",
        followUp:
          "Make the images from the review and draft the post on the requested account, for the owner's approval.",
        followUpAllows: allows,
        followUpTurnId: id,
      },
    });
    return id;
  }

  async function eventTurn() {
    const id = randomUUID();
    await prisma.sokoBotTurn.create({
      data: {
        network: "mainnet",
        id,
        sokoBotId,
        workspaceId,
        requestedByUserId: ownerId,
        source: "EVENT",
        status: "RUNNING",
        versionId: DEFAULT_SOKO_BOT_VERSION_ID,
        capabilityNames: ["generate_image", "get_image", "create_social_post"],
        deadlineAt: new Date(Date.now() + 60 * 60 * 1000),
        leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        clientTurnId: `event:${id}`,
        userMessage: "The review is back.",
        contextSnapshot: {
          create: {
            generatedAt: new Date(),
            schemaVersion: 1,
            hash: id,
            // As the control plane writes a personal bot's wake.
            packet: { trigger: { askedBy: { kind: "OWNER" } } },
            byteSize: 2,
            tokenEstimate: 1,
            counts: {},
            omissions: {},
          },
        },
      },
    });
    return id;
  }

  function call(turnId: string, capability: string, input: unknown) {
    calls += 1;
    return sokoBotRuntimeService.executeTool({
      sessionId: `session-${turnId}`,
      turnId,
      capability,
      toolCallId: `call-${calls}`,
      input,
    } as never);
  }

  /** The studio jobs this fixture's workspace has submitted. */
  const studioJobs = () =>
    prisma.projectImageJob.count({ where: { workspaceId } });

  /** generate_image, the provider finishing it, then get_image. */
  async function madeImage(turnId: string, maxCredits: number) {
    const started = (await call(turnId, "generate_image", {
      projectId,
      // A different picture each time: the same input is one operation.
      prompt: `White background, black text: picture ${calls}`,
      maxCredits,
    })) as { jobId: string; credits: number };
    const read = (await call(turnId, "get_image", {
      projectId,
      jobId: started.jobId,
    })) as { status: string; file: { id: string } | null };
    expect(read.status).toBe("SUCCEEDED");
    expect(read.file?.id).toBeTruthy();
    return { fileId: read.file!.id, credits: started.credits };
  }

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        name: "Owner",
        email: `${ownerId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    projectId = await withFixtureSchemas(
      async (tx) =>
        (
          await tx.project.create({
            data: { workspaceId, name: "Follow-up media fixture" },
          })
        ).id,
    );
    await prisma.sokoBot.create({
      data: { id: sokoBotId, userId: ownerId, workspaceId },
    });
    // The owner's chat that handed the review out with the plan.
    await prisma.sokoBotTurn.create({
      data: {
        network: "mainnet",
        id: ownerChatId,
        sokoBotId,
        workspaceId,
        requestedByUserId: ownerId,
        source: "CHAT",
        status: "COMPLETED",
        versionId: DEFAULT_SOKO_BOT_VERSION_ID,
        capabilityNames: ["create_task"],
        deadlineAt: new Date(Date.now() + 60 * 60 * 1000),
        clientTurnId: ownerChatId,
        userMessage:
          "Have the review done, then make the images and a post for me to approve.",
      },
    });
    otherAccount = await connection("other");
    requestedAccount = await connection("requested");
  });

  // Keyed by the ids fixed up front, so a setup that stopped part way is
  // still cleaned up; each delete matches nothing when its rows never came.
  afterAll(async () => {
    await withFixtureSchemas(async (tx) => {
      await tx.socialPost.deleteMany({ where: { workspaceId } });
      await tx.projectImageAsset.deleteMany({ where: { workspaceId } });
      await tx.projectImageJob.deleteMany({ where: { workspaceId } });
      await tx.sokoBotTurn.deleteMany({ where: { sokoBotId } });
      await tx.sokoBot.deleteMany({ where: { id: sokoBotId } });
      await tx.fileResource.deleteMany({ where: { workspaceId } });
      await tx.project.deleteMany({ where: { workspaceId } });
      await tx.user.deleteMany({ where: { id: ownerId } });
    });
  });

  beforeEach(() => {
    provider.fetchQueueStatus.mockResolvedValue({ kind: "completed" });
    provider.fetchQueueResult.mockResolvedValue({
      kind: "media",
      media: [{ url: "https://v3b.fal.media/files/made.png" }],
    });
    provider.downloadMedia.mockResolvedValue({
      bytes: pngBytes(1024, 1024),
      contentType: "image/png",
    });
  });

  it("saves the draft on the requested account with the images get_image put in Files, awaiting approval", async () => {
    const turnId = await wakeTurn({ images: 2, maxCredits: 1_000 });
    const images = [await madeImage(turnId, 500), await madeImage(turnId, 500)];
    const post = (await call(turnId, "create_social_post", {
      projectId,
      socialConnectionId: requestedAccount,
      text: "Three words, two pictures.",
      media: images.map(({ fileId }) => ({ fileId })),
    })) as { id: string };

    const saved = await prisma.socialPost.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(saved).toMatchObject({
      status: "NEEDS_APPROVAL",
      socialConnectionId: requestedAccount,
      creatorSokoBotId: sokoBotId,
      scheduledAt: null,
    });
    expect(saved.socialConnectionId).not.toBe(otherAccount);
    // The attachments are the Files copies the images were resolved to.
    const files = await prisma.fileResource.findMany({
      where: { id: { in: images.map(({ fileId }) => fileId) } },
      select: { sourceId: true },
    });
    // Two pictures, each its own File: one listed twice would not do.
    expect(new Set(images.map(({ fileId }) => fileId)).size).toBe(2);
    expect(files).toHaveLength(2);
    const media = saved.media as { pathname: string; kind: string }[];
    expect(new Set(media.map((item) => item.pathname)).size).toBe(2);
    expect(media.map((item) => item.pathname).sort()).toEqual(
      files.map((file) => file.sourceId).sort(),
    );
    expect(media.every((item) => item.kind === "image")).toBe(true);
    // A third image is past the owner's count.
    const jobsBefore = await studioJobs();
    await expect(
      call(turnId, "generate_image", {
        projectId,
        prompt: "One more",
        maxCredits: 1,
      }),
    ).rejects.toThrow("The owner asked for 2 images in this plan");
    // Refused before anything was submitted.
    expect(await studioJobs()).toBe(jobsBefore);
  });

  it("refuses a retry's image past the owner's credits while it is under the image count", async () => {
    // What one image costs, from a plan of its own.
    const { credits } = await madeImage(await wakeTurn({ images: 1 }), 500);
    // Room for two images at that price, three images by count.
    const failed = await wakeTurn({ images: 3, maxCredits: 2 * credits });
    await madeImage(failed, credits);
    await prisma.sokoBotTurn.update({
      where: { id: failed },
      data: { status: "FAILED" },
    });
    // Core retries the plan on a new turn for the same occurrence.
    const retry = await eventTurn();
    await prisma.sokoBotDelegation.updateMany({
      where: { followUpTurnId: failed },
      data: { followUpTurnId: retry },
    });
    await prisma.sokoBotEventInbox.createMany({
      data: [
        {
          botId: sokoBotId,
          eventId: "review-done",
          entityId: "review-task",
          purpose: "delegation",
          turnId: failed,
        },
        {
          botId: sokoBotId,
          eventId: "review-done:follow-up-retry",
          entityId: "review-task",
          purpose: "delegation",
          turnId: retry,
        },
      ],
    });
    await madeImage(retry, credits);
    // Two images of three, but their credits already use the allowance.
    const jobsBefore = await studioJobs();
    await expect(
      call(retry, "generate_image", {
        projectId,
        prompt: "A third",
        maxCredits: credits,
      }),
    ).rejects.toThrow(
      `The owner allowed ${2 * credits} credits on media for this plan`,
    );
    expect(await studioJobs()).toBe(jobsBefore);
  });

  it("enforces one shared durable grantId balance across concurrent parallel children, retries, unsent releases, UNKNOWN holds, and expiry on PostgreSQL", async () => {
    const sharedGrantId = randomUUID();
    const { credits } = await madeImage(await wakeTurn({ images: 1 }), 500);
    const sharedAuthority = ownerAuthoritySchema.parse({
      version: 1,
      grantId: sharedGrantId,
      origin: "owner_chat",
      sokoBotId,
      workspaceId,
      ownerUserId: ownerId,
      rootTurnId: ownerChatId,
      targetScope: { kind: "workspace" },
      scope: "draft_and_workspace",
      socialMode: "draft_only",
      limits: {
        grantId: sharedGrantId,
        period: "lifetime",
        images: 2,
        maxMediaCredits: 2 * credits,
      },
      stopRule: { mode: "never" },
    });

    const childA = await eventTurn();
    const childB = await eventTurn();
    await prisma.sokoBotDelegation.createMany({
      data: [
        {
          turnId: ownerChatId,
          toolCallId: `parallel-a-${childA}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Parallel child A",
          followUpAllows: { images: 2, maxCredits: 2 * credits },
          authority: sharedAuthority,
          followUpTurnId: childA,
        },
        {
          turnId: ownerChatId,
          toolCallId: `parallel-b-${childB}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Parallel child B",
          followUpAllows: { images: 2, maxCredits: 2 * credits },
          authority: sharedAuthority,
          followUpTurnId: childB,
        },
      ],
    });

    const jobsBeforeConcurrent = await prisma.projectImageJob.count({
      where: { workspaceId },
    });
    // Race 3 concurrent generate_image calls across the two parallel children
    // sharing ONE 2-image grantId: exactly 2 settle, 1 is refused.
    const raced = await Promise.allSettled([
      call(childA, "generate_image", {
        projectId,
        prompt: "Shared grant concurrent 1",
        maxCredits: credits,
      }),
      call(childB, "generate_image", {
        projectId,
        prompt: "Shared grant concurrent 2",
        maxCredits: credits,
      }),
      call(childB, "generate_image", {
        projectId,
        prompt: "Shared grant concurrent 3",
        maxCredits: credits,
      }),
    ]);
    expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(raced.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await prisma.projectImageJob.count({ where: { workspaceId } })).toBe(
      jobsBeforeConcurrent + 2,
    );
    const settledRows = await prisma.sokoBotAuthoritySpend.findMany({
      where: { sokoBotId, grantId: sharedGrantId, status: "SETTLED" },
    });
    expect(settledRows).toHaveLength(2);

    // 2. Two children retrying one paid action (shared intentId -> same operationKey)
    //    settle a single reservation against their shared 1-image grant.
    const retryGrantId = randomUUID();
    const sharedIntent = await prisma.sokoBotIntent.create({
      data: {
        sokoBotId,
        workspaceId,
        requesterId: ownerId,
        originatingTurnId: ownerChatId,
        desiredOutcome: "Shared paid image",
        targetIds: [],
        allowedActions: [],
        acceptanceCriteria: [],
        evidenceIds: [],
        state: "ACTIVE",
        revision: 1,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const retryChild1 = await eventTurn();
    const retryChild2 = await eventTurn();
    await prisma.sokoBotTurn.updateMany({
      where: { id: { in: [retryChild1, retryChild2] } },
      data: { intentId: sharedIntent.id, intentRevision: 1 },
    });
    const retryGrantAuth = ownerAuthoritySchema.parse({
      ...sharedAuthority,
      grantId: retryGrantId,
      limits: {
        grantId: retryGrantId,
        period: "lifetime",
        images: 1,
        maxMediaCredits: credits,
      },
    });
    await prisma.sokoBotDelegation.createMany({
      data: [
        {
          turnId: ownerChatId,
          toolCallId: `retry-op-1-${retryChild1}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Retry child 1",
          authority: retryGrantAuth,
          followUpTurnId: retryChild1,
        },
        {
          turnId: ownerChatId,
          toolCallId: `retry-op-2-${retryChild2}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Retry child 2",
          authority: retryGrantAuth,
          followUpTurnId: retryChild2,
        },
      ],
    });
    const jobsBeforeRetryOp = await prisma.projectImageJob.count({
      where: { workspaceId },
    });
    const sameInput = {
      projectId,
      prompt: "One shared idempotent picture",
      maxCredits: credits,
    };
    const firstPaid = (await call(
      retryChild1,
      "generate_image",
      sameInput,
    )) as {
      jobId: string;
    };
    const replayedPaid = (await call(
      retryChild2,
      "generate_image",
      sameInput,
    )) as { jobId: string };
    expect(replayedPaid.jobId).toBe(firstPaid.jobId);
    expect(await prisma.projectImageJob.count({ where: { workspaceId } })).toBe(
      jobsBeforeRetryOp + 1,
    );
    expect(
      await prisma.sokoBotAuthoritySpend.count({
        where: { sokoBotId, grantId: retryGrantId, status: "SETTLED" },
      }),
    ).toBe(1);

    // 3. Confirmed unsent refusal (HTTPException) releases the reservation &
    //    operationKey for retry, whereas an ambiguous failure holds UNKNOWN.
    const lifecycleGrantId = randomUUID();
    const lifecycleTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `lifecycle-${lifecycleTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Lifecycle test",
        authority: ownerAuthoritySchema.parse({
          ...sharedAuthority,
          grantId: lifecycleGrantId,
          limits: {
            grantId: lifecycleGrantId,
            period: "lifetime",
            images: 1,
            maxMediaCredits: credits,
          },
        }),
        followUpTurnId: lifecycleTurn,
      },
    });
    provider.nextCreateImageJobError = new HTTPException(429, {
      message: "Studio busy before sending",
    });
    await expect(
      call(lifecycleTurn, "generate_image", {
        projectId,
        prompt: "Retryable unsent picture",
        maxCredits: credits,
      }),
    ).rejects.toThrow("Studio busy before sending");
    expect(
      await prisma.sokoBotAuthoritySpend.findMany({
        where: { sokoBotId, grantId: lifecycleGrantId },
        select: { status: true, operationKey: true },
      }),
    ).toEqual([{ status: "RELEASED", operationKey: null }]);

    // Ambiguous provider failure (non-HTTPException) holds UNKNOWN permanently.
    provider.nextCreateImageJobError = new Error("socket closed after submit");
    await expect(
      call(lifecycleTurn, "generate_image", {
        projectId,
        prompt: "Retryable unsent picture",
        maxCredits: credits,
      }),
    ).rejects.toThrow("socket closed after submit");
    expect(
      await prisma.sokoBotAuthoritySpend.count({
        where: { sokoBotId, grantId: lifecycleGrantId, status: "UNKNOWN" },
      }),
    ).toBe(1);
    // A fresh picture past the held UNKNOWN slot is refused.
    await expect(
      call(lifecycleTurn, "generate_image", {
        projectId,
        prompt: "Second picture after UNKNOWN",
        maxCredits: credits,
      }),
    ).rejects.toThrow("The owner asked for 1 image in this plan");

    // 4. Expired persisted OwnerAuthority fails closed before creating any job.
    const expiredTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `expired-${expiredTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Expired plan",
        authority: ownerAuthoritySchema.parse({
          ...sharedAuthority,
          grantId: randomUUID(),
          expiresAt: "2020-01-01T00:00:00.000Z",
        }),
        followUpTurnId: expiredTurn,
      },
    });
    const jobsBeforeExpired = await prisma.projectImageJob.count({
      where: { workspaceId },
    });
    await expect(
      call(expiredTurn, "generate_image", {
        projectId,
        prompt: "Should not run after expiry",
        maxCredits: credits,
      }),
    ).rejects.toThrow("has expired");
    expect(await prisma.projectImageJob.count({ where: { workspaceId } })).toBe(
      jobsBeforeExpired,
    );

    // 5. Project-scoped OwnerAuthority allows the matching Project and refuses a different Project.
    const scopedGrantId = randomUUID();
    const scopedTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `scoped-${scopedTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Make one image in the scoped Project",
        authority: ownerAuthoritySchema.parse({
          ...sharedAuthority,
          grantId: scopedGrantId,
          targetScope: { kind: "project", projectId },
          limits: {
            grantId: scopedGrantId,
            period: "lifetime",
            images: 1,
            maxMediaCredits: credits,
          },
        }),
        followUpTurnId: scopedTurn,
      },
    });
    const jobsBeforeScoped = await studioJobs();
    const scopedJob = (await call(scopedTurn, "generate_image", {
      projectId,
      prompt: "Scoped same-project illustration",
      maxCredits: credits,
    })) as { jobId: string };
    expect(scopedJob.jobId).toBeTruthy();
    expect(await studioJobs()).toBe(jobsBeforeScoped + 1);
    await expect(
      call(scopedTurn, "generate_image", {
        projectId: randomUUID(),
        prompt: "Wrong project illustration",
        maxCredits: credits,
      }),
    ).rejects.toThrow("scoped to a different Project");
    expect(await studioJobs()).toBe(jobsBeforeScoped + 1);

    // 6. Studio returning a confirmed FAILED status releases the spend ledger
    //    (matching tool-call REJECTED) so a retry succeeds, while SUBMISSION_UNCERTAIN
    //    holds UNKNOWN permanently.
    const returnedFailureGrantId = randomUUID();
    const returnedFailureTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `returned-fail-${returnedFailureTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Returned studio failure lifecycle",
        authority: ownerAuthoritySchema.parse({
          ...sharedAuthority,
          grantId: returnedFailureGrantId,
          limits: {
            grantId: returnedFailureGrantId,
            period: "lifetime",
            images: 1,
            maxMediaCredits: credits,
          },
        }),
        followUpTurnId: returnedFailureTurn,
      },
    });
    provider.nextCreateImageJobStatus = "FAILED";
    const returnedFailed = (await call(returnedFailureTurn, "generate_image", {
      projectId,
      prompt: "Studio returned FAILED before sending",
      maxCredits: credits,
    })) as { status: string };
    expect(returnedFailed.status).toBe("FAILED");
    expect(
      await prisma.sokoBotAuthoritySpend.findMany({
        where: { sokoBotId, grantId: returnedFailureGrantId },
        select: { status: true, operationKey: true },
      }),
    ).toEqual([{ status: "RELEASED", operationKey: null }]);
    // Retrying with the exact same input now succeeds against the 1-image grant.
    const retriedAfterFailed = (await call(
      returnedFailureTurn,
      "generate_image",
      {
        projectId,
        prompt: "Studio returned FAILED before sending",
        maxCredits: credits,
      },
    )) as { status: string; jobId: string };
    expect(retriedAfterFailed.status).toBe("QUEUED");
    expect(
      await prisma.sokoBotAuthoritySpend.count({
        where: {
          sokoBotId,
          grantId: returnedFailureGrantId,
          status: "SETTLED",
        },
      }),
    ).toBe(1);

    // SUBMISSION_UNCERTAIN stays UNKNOWN and blocks a second attempt.
    const uncertainGrantId = randomUUID();
    const uncertainTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `uncertain-${uncertainTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Uncertain studio submit",
        authority: ownerAuthoritySchema.parse({
          ...sharedAuthority,
          grantId: uncertainGrantId,
          limits: {
            grantId: uncertainGrantId,
            period: "lifetime",
            images: 1,
            maxMediaCredits: credits,
          },
        }),
        followUpTurnId: uncertainTurn,
      },
    });
    provider.nextCreateImageJobStatus = "SUBMISSION_UNCERTAIN";
    await call(uncertainTurn, "generate_image", {
      projectId,
      prompt: "Uncertain provider status",
      maxCredits: credits,
    });
    expect(
      await prisma.sokoBotAuthoritySpend.count({
        where: { sokoBotId, grantId: uncertainGrantId, status: "UNKNOWN" },
      }),
    ).toBe(1);
    await expect(
      call(uncertainTurn, "generate_image", {
        projectId,
        prompt: "Second image blocked by UNKNOWN",
        maxCredits: credits,
      }),
    ).rejects.toThrow("The owner asked for 1 image in this plan");

    // 7. Replaying an already-paid image (ALREADY_SATISFIED marker) does NOT
    //    consume the next image's allowance on a 2-image grant.
    const replayAllowanceGrantId = randomUUID();
    const replayTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `replay-allow-${replayTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Two images with an in-turn replay of the first",
        authority: ownerAuthoritySchema.parse({
          ...sharedAuthority,
          grantId: replayAllowanceGrantId,
          limits: {
            grantId: replayAllowanceGrantId,
            period: "lifetime",
            images: 2,
            maxMediaCredits: 2 * credits,
          },
        }),
        followUpTurnId: replayTurn,
      },
    });
    const jobsBeforeReplayAllowance = await studioJobs();
    const replayImg1 = (await call(replayTurn, "generate_image", {
      projectId,
      prompt: "First image to replay",
      maxCredits: credits,
    })) as { jobId: string };
    // Identical input on a fresh toolCallId writes an ALREADY_SATISFIED replay marker.
    const replayImg1Again = (await call(replayTurn, "generate_image", {
      projectId,
      prompt: "First image to replay",
      maxCredits: credits,
    })) as { jobId: string };
    expect(replayImg1Again.jobId).toBe(replayImg1.jobId);
    // Second distinct image MUST still fit inside the 2-image / 2*credits grant.
    const replayImg2 = (await call(replayTurn, "generate_image", {
      projectId,
      prompt: "Second distinct image after replay",
      maxCredits: credits,
    })) as { jobId: string };
    expect(replayImg2.jobId).not.toBe(replayImg1.jobId);
    expect(await studioJobs()).toBe(jobsBeforeReplayAllowance + 2);
    expect(
      await prisma.sokoBotAuthoritySpend.count({
        where: {
          sokoBotId,
          grantId: replayAllowanceGrantId,
          status: "SETTLED",
        },
      }),
    ).toBe(2);
    // Third distinct image is refused.
    await expect(
      call(replayTurn, "generate_image", {
        projectId,
        prompt: "Third image past allowance",
        maxCredits: credits,
      }),
    ).rejects.toThrow("The owner asked for 2 images in this plan");
    expect(await studioJobs()).toBe(jobsBeforeReplayAllowance + 2);

    // 8. A previously stranded RESERVED spend row whose durable tool-call
    //    receipt is already terminal REJECTED is repaired to RELEASED so a
    //    corrected image succeeds against the 1-image grant.
    const strandedGrantId = randomUUID();
    const strandedTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `stranded-${strandedTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Recover stranded reservation",
        authority: ownerAuthoritySchema.parse({
          ...sharedAuthority,
          grantId: strandedGrantId,
          limits: {
            grantId: strandedGrantId,
            period: "lifetime",
            images: 1,
            maxMediaCredits: credits,
          },
        }),
        followUpTurnId: strandedTurn,
      },
    });
    await prisma.sokoBotToolCall.create({
      data: {
        turnId: strandedTurn,
        toolCallId: "stranded-call-1",
        capability: "generate_image",
        actorBotId: sokoBotId,
        inputHash: "stranded-hash",
        input: { projectId, prompt: "Old failed prompt", maxCredits: credits },
        result: { status: "FAILED" },
        status: "COMPLETED",
        disposition: "REJECTED",
        verification: "NONE",
        operationKey: null,
      },
    });
    await prisma.sokoBotAuthoritySpend.create({
      data: {
        sokoBotId,
        workspaceId,
        grantId: strandedGrantId,
        operationKey: `stranded-op-${strandedTurn}`,
        turnId: strandedTurn,
        toolCallId: "stranded-call-1",
        capability: "generate_image",
        images: 1,
        videos: 0,
        credits,
        status: "RESERVED",
      },
    });
    const jobsBeforeStranded = await studioJobs();
    const recoveredJob = (await call(strandedTurn, "generate_image", {
      projectId,
      prompt: "Corrected prompt after stranded reservation",
      maxCredits: credits,
    })) as { jobId: string; status: string };
    expect(recoveredJob.status).toBe("QUEUED");
    expect(await studioJobs()).toBe(jobsBeforeStranded + 1);
    const strandedRows = await prisma.sokoBotAuthoritySpend.findMany({
      where: { sokoBotId, grantId: strandedGrantId },
      orderBy: { createdAt: "asc" },
      select: { toolCallId: true, status: true, operationKey: true },
    });
    expect(strandedRows).toEqual([
      {
        toolCallId: "stranded-call-1",
        status: "RELEASED",
        operationKey: null,
      },
      expect.objectContaining({ status: "SETTLED" }),
    ]);

    // 9. Public fractional credit caps (e.g. 2 * credits + 0.5) persist through
    //    deriveDelegationAuthority, DOUBLE PRECISION storage, and legacy restore.
    const perImageFractional = credits + 0.25;
    const totalFractionalCap = 2 * perImageFractional;
    const publicFractionalAllows = sokoBotFollowUpAllowsSchema.parse({
      images: 2,
      maxCredits: totalFractionalCap,
    });
    const fractionalAuthority = await deriveDelegationAuthority(
      {
        id: ownerChatId,
        sokoBotId,
        workspaceId,
        versionId: DEFAULT_SOKO_BOT_VERSION_ID,
        source: "CHAT",
        parentTurnId: null,
        askedByUserId: null,
        requestedByUserId: ownerId,
        actingUserId: ownerId,
        chainDepth: 0,
      },
      { followUpAllows: publicFractionalAllows },
    );
    expect(fractionalAuthority.limits?.maxMediaCredits).toBe(
      totalFractionalCap,
    );
    const fractionalGrantId = randomUUID();
    const fractionalTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `fractional-${fractionalTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Two images under a fractional credit cap",
        followUpAllows: publicFractionalAllows,
        authority: {
          ...fractionalAuthority,
          grantId: fractionalGrantId,
          limits: {
            ...fractionalAuthority.limits!,
            grantId: fractionalGrantId,
          },
        },
        followUpTurnId: fractionalTurn,
      },
    });
    await call(fractionalTurn, "generate_image", {
      projectId,
      prompt: "Fractional picture 1",
      maxCredits: perImageFractional,
    });
    // Over the remaining fractional allowance is refused cleanly.
    await expect(
      call(fractionalTurn, "generate_image", {
        projectId,
        prompt: "Fractional picture over budget",
        maxCredits: perImageFractional + 0.1,
      }),
    ).rejects.toThrow(
      `The owner allowed ${totalFractionalCap} credits on media for this plan, and ${perImageFractional} are set aside already`,
    );
    // Exact remaining fractional allowance succeeds and persists exact float.
    await call(fractionalTurn, "generate_image", {
      projectId,
      prompt: "Fractional picture 2",
      maxCredits: perImageFractional,
    });
    const fractionalLedger = await prisma.sokoBotAuthoritySpend.findMany({
      where: { sokoBotId, grantId: fractionalGrantId, status: "SETTLED" },
      select: { credits: true },
    });
    expect(fractionalLedger).toEqual([
      { credits: perImageFractional },
      { credits: perImageFractional },
    ]);
    // Legacy row (`authority: null`) with fractional followUpAllows also works.
    const legacyFractionalTurn = await wakeTurn({
      images: 1,
      maxCredits: perImageFractional,
    });
    await call(legacyFractionalTurn, "generate_image", {
      projectId,
      prompt: "Legacy fractional picture",
      maxCredits: perImageFractional,
    });

    // 10. Mixed Project A + Project B grants sharing one wake: a historical
    //     pre-migration Project A image never exhausts Project B's untouched grant.
    const projectB = await withFixtureSchemas(
      async (tx) =>
        (
          await tx.project.create({
            data: { workspaceId, name: "Second project fixture" },
          })
        ).id,
    );
    const mixedFailedTurn = await eventTurn();
    await prisma.sokoBotTurn.update({
      where: { id: mixedFailedTurn },
      data: { status: "FAILED" },
    });
    await prisma.sokoBotToolCall.create({
      data: {
        turnId: mixedFailedTurn,
        toolCallId: "legacy-proj-a-img",
        capability: "generate_image",
        actorBotId: sokoBotId,
        inputHash: "legacy-proj-a-hash",
        input: {
          projectId,
          prompt: "Old Project A picture",
          maxCredits: credits,
        },
        result: { status: "QUEUED" },
        status: "COMPLETED",
        disposition: "APPLIED",
        verification: "NONE",
      },
    });
    const mixedRetryTurn = await eventTurn();
    await prisma.sokoBotEventInbox.createMany({
      data: [
        {
          botId: sokoBotId,
          eventId: "mixed-done",
          entityId: "mixed-entity",
          purpose: "delegation",
          turnId: mixedFailedTurn,
        },
        {
          botId: sokoBotId,
          eventId: "mixed-done:follow-up-retry",
          entityId: "mixed-entity",
          purpose: "delegation",
          turnId: mixedRetryTurn,
        },
      ],
    });
    const mixedGrantA = randomUUID();
    const mixedGrantB = randomUUID();
    await prisma.sokoBotDelegation.createMany({
      data: [
        {
          turnId: ownerChatId,
          toolCallId: `mixed-a-${mixedRetryTurn}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Project A image",
          authority: ownerAuthoritySchema.parse({
            ...sharedAuthority,
            grantId: mixedGrantA,
            targetScope: { kind: "project", projectId },
            limits: {
              grantId: mixedGrantA,
              period: "lifetime",
              images: 1,
              maxMediaCredits: credits,
            },
          }),
          followUpTurnId: mixedRetryTurn,
        },
        {
          turnId: ownerChatId,
          toolCallId: `mixed-b-${mixedRetryTurn}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Project B image",
          authority: ownerAuthoritySchema.parse({
            ...sharedAuthority,
            grantId: mixedGrantB,
            targetScope: { kind: "project", projectId: projectB },
            limits: {
              grantId: mixedGrantB,
              period: "lifetime",
              images: 1,
              maxMediaCredits: credits,
            },
          }),
          followUpTurnId: mixedRetryTurn,
        },
      ],
    });
    // Project B succeeds against its untouched grant even though Project A's
    // grant was already spent by the pre-migration Project A image.
    const projBJob = (await call(mixedRetryTurn, "generate_image", {
      projectId: projectB,
      prompt: "Project B untouched grant picture",
      maxCredits: credits,
    })) as { jobId: string; status: string };
    expect(projBJob.status).toBe("QUEUED");
    await expect(
      call(mixedRetryTurn, "generate_image", {
        projectId,
        prompt: "Project A already spent by legacy call",
        maxCredits: credits,
      }),
    ).rejects.toThrow("The owner asked for 1 image in this plan");

    // 11. Two Projects authorized by ONE shared grantId retain both scopes
    //     independent of row order and charge one shared 2-image balance.
    const sharedMultiProjGrant = randomUUID();
    const sharedMultiProjTurn = await eventTurn();
    await prisma.sokoBotDelegation.createMany({
      data: [
        {
          turnId: ownerChatId,
          toolCallId: `shared-multi-a-${sharedMultiProjTurn}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Make image for Project A",
          authority: ownerAuthoritySchema.parse({
            ...sharedAuthority,
            grantId: sharedMultiProjGrant,
            targetScope: { kind: "project", projectId },
            limits: {
              grantId: sharedMultiProjGrant,
              period: "lifetime",
              images: 2,
              maxMediaCredits: 2 * credits,
            },
          }),
          followUpTurnId: sharedMultiProjTurn,
        },
        {
          turnId: ownerChatId,
          toolCallId: `shared-multi-b-${sharedMultiProjTurn}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Make image for Project B",
          authority: ownerAuthoritySchema.parse({
            ...sharedAuthority,
            grantId: sharedMultiProjGrant,
            targetScope: { kind: "project", projectId: projectB },
            limits: {
              grantId: sharedMultiProjGrant,
              period: "lifetime",
              images: 2,
              maxMediaCredits: 2 * credits,
            },
          }),
          followUpTurnId: sharedMultiProjTurn,
        },
      ],
    });
    // Project B (second delegation row) succeeds first, then Project A takes
    // the second image under the same shared grantId; a 3rd image is refused.
    const sharedImgB = (await call(sharedMultiProjTurn, "generate_image", {
      projectId: projectB,
      prompt: "Shared multi-project image on B",
      maxCredits: credits,
    })) as { status: string };
    expect(sharedImgB.status).toBe("QUEUED");
    const sharedImgA = (await call(sharedMultiProjTurn, "generate_image", {
      projectId,
      prompt: "Shared multi-project image on A",
      maxCredits: credits,
    })) as { status: string };
    expect(sharedImgA.status).toBe("QUEUED");
    expect(
      await prisma.sokoBotAuthoritySpend.count({
        where: {
          sokoBotId,
          grantId: sharedMultiProjGrant,
          status: "SETTLED",
        },
      }),
    ).toBe(2);
    await expect(
      call(sharedMultiProjTurn, "generate_image", {
        projectId: projectB,
        prompt: "Third image past shared 2-image grant",
        maxCredits: credits,
      }),
    ).rejects.toThrow("The owner asked for 2 images in this plan");

    // 12. A transient rollback on the terminal receipt-and-ledger transaction
    //     retries ONLY the DB commit with the exact observed Studio outcome
    //     (never re-running the provider and never overwriting a confirmed
    //     refund or queued job with UNKNOWN).
    const rollbackGrantId = randomUUID();
    const rollbackTurn = await eventTurn();
    await prisma.sokoBotDelegation.create({
      data: {
        turnId: ownerChatId,
        toolCallId: `rollback-${rollbackTurn}`,
        kind: "TASK",
        action: "create_task",
        followUp: "Rollback resilience test",
        authority: ownerAuthoritySchema.parse({
          ...sharedAuthority,
          grantId: rollbackGrantId,
          limits: {
            grantId: rollbackGrantId,
            period: "lifetime",
            images: 1,
            maxMediaCredits: credits,
          },
        }),
        followUpTurnId: rollbackTurn,
      },
    });
    const origTransaction = prisma.$transaction.bind(prisma);
    let failNextTerminalTx = false;
    let rolledBackCount = 0;
    const txSpy = vi.spyOn(prisma, "$transaction").mockImplementation(((
      ...args: unknown[]
    ) => {
      if (failNextTerminalTx) {
        failNextTerminalTx = false;
        rolledBackCount += 1;
        return Promise.reject(
          new Error("transient database rollback on terminal commit"),
        );
      }
      return (origTransaction as (...a: unknown[]) => unknown)(...args);
    }) as typeof prisma.$transaction);
    try {
      // 12a. Confirmed Studio refund (returned FAILED) survives a terminal tx rollback.
      const callsBeforeRefund = provider.createImageJobCalls;
      provider.nextCreateImageJobStatus = "FAILED";
      provider.onAfterCreateImageJob = () => {
        failNextTerminalTx = true;
      };
      const rolledBackRefund = (await call(rollbackTurn, "generate_image", {
        projectId,
        prompt: "Refunded image with terminal tx rollback",
        maxCredits: credits,
      })) as { status: string };
      expect(rolledBackRefund.status).toBe("FAILED");
      expect(rolledBackCount).toBe(1);
      expect(provider.createImageJobCalls).toBe(callsBeforeRefund + 1);
      expect(
        await prisma.sokoBotAuthoritySpend.findMany({
          where: { sokoBotId, grantId: rollbackGrantId },
          select: { status: true, operationKey: true },
        }),
      ).toEqual([{ status: "RELEASED", operationKey: null }]);

      // 12b. Confirmed queued job also survives a terminal tx rollback (stays SETTLED, not UNKNOWN)
      //      AND succeeds on the allowance freed by 12a's refund!
      const callsBeforeQueued = provider.createImageJobCalls;
      provider.onAfterCreateImageJob = () => {
        failNextTerminalTx = true;
      };
      const rolledBackQueued = (await call(rollbackTurn, "generate_image", {
        projectId,
        prompt: "Corrected queued image with terminal tx rollback",
        maxCredits: credits,
      })) as { status: string; jobId: string };
      expect(rolledBackQueued.status).toBe("QUEUED");
      expect(rolledBackCount).toBe(2);
      expect(provider.createImageJobCalls).toBe(callsBeforeQueued + 1);
      expect(
        await prisma.sokoBotAuthoritySpend.findMany({
          where: { sokoBotId, grantId: rollbackGrantId },
          orderBy: { createdAt: "asc" },
          select: { status: true },
        }),
      ).toEqual([{ status: "RELEASED" }, { status: "SETTLED" }]);
    } finally {
      provider.onAfterCreateImageJob = null;
      txSpy.mockRestore();
    }
  });
});
