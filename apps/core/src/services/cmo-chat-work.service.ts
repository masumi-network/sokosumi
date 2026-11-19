import type { ProjectImageJobStatus } from "@sokosumi/database";
import { z } from "zod";

import prisma from "@/lib/db/prisma";
import { publicDriveUrl } from "@/lib/drive-blob";
import { type CusoTarget, requireCuso } from "@/services/cmo-cuso.service";
import {
  CMO_STYLE_PASSED,
  CMO_STYLE_REJECTED,
} from "@/services/cmo-media-maker.service";
import { loadLiveResources } from "@/services/file-search.service";
import { ensureStudioAssetDriveFile } from "@/services/image-studio-drive.service";

/**
 * Something Cuso started for the owner in chat that the chat shows where it
 * was asked for: while it is being made, and the thing itself once it is.
 */
export interface CmoChatWorkItem {
  /** The tool call that started it; stable across reloads. */
  id: string;
  kind: "image" | "video" | "audio";
  state: "making" | "ready" | "failed";
  at: Date;
  /** What was asked for: the prompt, or the words spoken. */
  title: string;
  /** Where the finished file plays from; null until it is ready. */
  url: string | null;
}

/** How many of the newest items the chat shows. */
const CMO_CHAT_WORK_SHOWN = 20;
/** Older chat work has scrolled far out of the chat's 50 messages. */
const CMO_CHAT_WORK_DAYS = 30;
/** A video takes minutes; one still not made after this never will be. */
const CMO_CHAT_WORK_GIVE_UP_MS = 60 * 60 * 1000;

const STUDIO_KIND = {
  generate_image: "image",
  generate_video: "video",
  generate_talking_video: "video",
} as const satisfies Record<string, CmoChatWorkItem["kind"]>;

const VOICEOVER = "generate_voiceover";

const MAKING = new Set<ProjectImageJobStatus>([
  "PENDING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
  "SUBMISSION_UNCERTAIN",
]);

const savedFileSchema = z.object({ id: z.string(), filename: z.string() });
const spokenSchema = z.object({ text: z.string() });

interface StudioJob {
  id: string;
  status: ProjectImageJobStatus;
  prompt: string;
  error: string | null;
  asset: { id: string } | null;
  idempotencyKey: string;
  referenceLibraryIds: string[];
  createdAt: Date;
}

/**
 * Where a studio job stands for the owner. A picture in an old print's look
 * is ready only once Core's style check passed it: one it turned down is
 * made again on the next model, under the same tool call.
 */
function studioState(job: StudioJob): CmoChatWorkItem["state"] {
  const waiting =
    Date.now() - job.createdAt.getTime() < CMO_CHAT_WORK_GIVE_UP_MS
      ? "making"
      : "failed";
  if (MAKING.has(job.status)) return waiting;
  if (job.status !== "SUCCEEDED" || !job.asset) return "failed";
  if (job.referenceLibraryIds.length === 0) return "ready";
  if (job.error === CMO_STYLE_PASSED) return "ready";
  return job.error?.startsWith(CMO_STYLE_REJECTED) ? "failed" : waiting;
}

/** Public addresses never change, so each is looked up once per process. */
const urlByPathname = new Map<string, string>();

async function publicUrl(pathname: string): Promise<string | null> {
  const known = urlByPathname.get(pathname);
  if (known) return known;
  const url = await publicDriveUrl(pathname).catch(() => null);
  if (url) urlByPathname.set(pathname, url);
  return url;
}

/**
 * What Cuso made, or is making, for the owner in chat, newest first: the
 * pictures, videos and voice-overs his chat turns started, each with where it
 * stands now. Read from his tool calls and the studio's jobs, so it survives
 * a reload and needs nothing from Cuso.
 */
export async function listCmoChatWork(
  input: CusoTarget,
): Promise<CmoChatWorkItem[]> {
  const cuso = await requireCuso(input);
  const calls = await prisma.sokoBotToolCall.findMany({
    where: {
      status: "COMPLETED",
      capability: { in: [...Object.keys(STUDIO_KIND), VOICEOVER] },
      turn: {
        sokoBotId: cuso.sokoBotId,
        createdAt: {
          gte: new Date(Date.now() - CMO_CHAT_WORK_DAYS * 24 * 60 * 60 * 1000),
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CMO_CHAT_WORK_SHOWN,
    select: {
      id: true,
      turnId: true,
      toolCallId: true,
      capability: true,
      createdAt: true,
      input: true,
      result: true,
    },
  });
  if (calls.length === 0) return [];
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: cuso.sokoBotId },
    select: { workspace: { select: { organizationId: true } } },
  });
  const drive = {
    workspaceId: cuso.workspaceId,
    organizationId: bot.workspace.organizationId,
    userId: input.userId,
  };
  const keyOf = (call: { turnId: string; toolCallId: string }) =>
    `soko-bot:${call.turnId}:${call.toolCallId}`;
  const studioCalls = calls.filter((call) => call.capability in STUDIO_KIND);
  const jobs: StudioJob[] = studioCalls.length
    ? await prisma.projectImageJob.findMany({
        where: {
          projectId: cuso.projectId,
          OR: studioCalls.map((call) => ({
            idempotencyKey: { startsWith: keyOf(call) },
          })),
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          prompt: true,
          error: true,
          asset: { select: { id: true } },
          idempotencyKey: true,
          referenceLibraryIds: true,
          createdAt: true,
        },
      })
    : [];
  const spoken = calls.flatMap((call) => {
    const saved = savedFileSchema.safeParse(call.result);
    return call.capability === VOICEOVER && saved.success
      ? [{ call, file: saved.data }]
      : [];
  });
  const files = await loadLiveResources({
    workspaceId: drive.workspaceId,
    actor: {
      userId: drive.userId,
      organizationId: drive.organizationId,
      kind: "oauth",
    },
    resourceIds: spoken.map(({ file }) => file.id),
  });

  const items = await Promise.all(
    calls.map(async (call): Promise<CmoChatWorkItem | null> => {
      const base = { id: call.id, at: call.createdAt };
      if (call.capability === VOICEOVER) {
        const saved = spoken.find((item) => item.call.id === call.id)?.file;
        const file = files.find((item) => item.id === saved?.id);
        // A voice-over the owner deleted since is no longer theirs to hear.
        if (!saved || !file) return null;
        const url = await publicUrl(file.sourceId);
        const words = spokenSchema.safeParse(call.input);
        return {
          ...base,
          kind: "audio",
          state: url ? "ready" : "failed",
          title: words.success ? words.data.text : saved.filename,
          url,
        };
      }
      const key = keyOf(call);
      // The newest try: a styled picture's later models share the call's key.
      const job = jobs
        .filter(
          (item) =>
            item.idempotencyKey === key ||
            item.idempotencyKey.startsWith(`${key}:style:`),
        )
        .at(-1);
      if (!job) return null;
      const kind = STUDIO_KIND[call.capability as keyof typeof STUDIO_KIND];
      const state = studioState(job);
      const file =
        state === "ready" && job.asset
          ? await ensureStudioAssetDriveFile({
              ...drive,
              projectId: cuso.projectId,
              assetId: job.asset.id,
              prompt: job.prompt,
              jobId: job.id,
            }).catch(() => null)
          : null;
      const url = file ? await publicUrl(file.pathname) : null;
      return {
        ...base,
        kind,
        // Finished, but its file cannot be shown: say so rather than wait.
        state: state === "ready" && !url ? "failed" : state,
        title: job.prompt,
        url,
      };
    }),
  );
  return items.filter((item): item is CmoChatWorkItem => item !== null);
}
