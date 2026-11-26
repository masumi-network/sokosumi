import { randomUUID } from "node:crypto";
import { DEFAULT_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
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
    }) =>
      db.projectImageJob.create({
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
          status: "QUEUED",
          falRequestId: `fal-${randomUUID()}`,
          submitAttempts: 1,
          submittedAt: new Date(),
        },
      }),
  };
});
vi.mock("@/services/x-subscription-tier.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveXSubscriptionType: async (connection: {
    subscriptionType: string | null;
  }) => connection.subscriptionType,
}));

import prisma from "@/lib/db/prisma";
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
    const media = saved.media as { pathname: string; kind: string }[];
    expect(media.map((item) => item.pathname).sort()).toEqual(
      files.map((file) => file.sourceId).sort(),
    );
    expect(media.every((item) => item.kind === "image")).toBe(true);
    // A third image is past the owner's count.
    await expect(
      call(turnId, "generate_image", {
        projectId,
        prompt: "One more",
        maxCredits: 1,
      }),
    ).rejects.toThrow("The owner asked for 2 images in this plan");
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
    await expect(
      call(retry, "generate_image", {
        projectId,
        prompt: "A third",
        maxCredits: credits,
      }),
    ).rejects.toThrow(
      `The owner allowed ${2 * credits} credits on media for this plan`,
    );
  });
});
