import { randomUUID } from "node:crypto";
import { AgentJobStatus, jobInclude, type Prisma } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { type ChatResultReference } from "@sokosumi/soko-bot";
import { formatTaskIdentifier } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import {
  requireJobRead,
  requireTaskReadForWorkspace,
} from "@/helpers/access-control";
import { readPreparedResultSnapshots } from "@/helpers/chat-result-metadata";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import { mapTaskTags } from "@/helpers/task-tags";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  type ChatResultAvailable,
  type ChatResultPreview,
  type ChatResultSnapshot,
  chatResultAvailableSchema,
  chatResultSnapshotSchema,
} from "@/schemas/chat-result-preview.schema";
import { loadLiveResources } from "@/services/file-search.service";
import { getAsset, getJob } from "@/services/image-studio-assets.service";
import { getSocialPost } from "@/services/social-posts.service";
import { taskScheduleVisibilityWhere } from "@/services/task-schedule.service";

export interface ChatResultActor {
  userId: string;
  workspaceId: string;
  kind?: FileActor["kind"];
}

/** Bounded display data for the existing Task/Project avatar components. */
function previewProject(
  project:
    | {
        id: string;
        name: string;
        identifier?: string | null;
        logo?: string | null;
      }
    | null
    | undefined,
) {
  return project
    ? {
        id: project.id,
        name: project.name.slice(0, 500),
        identifier: project.identifier ?? null,
        logo: project.logo ?? null,
      }
    : null;
}
function previewAssignee(source: {
  assignee?: {
    id: string;
    name: string;
    image: string | null;
    slug?: string;
  } | null;
  assigneeUser?: { id: string; name: string; image: string | null } | null;
  assigneeSokoBot?: {
    id: string;
    name: string | null;
    avatarImageUrl: string | null;
    avatarSeed: string | null;
  } | null;
}) {
  if (source.assignee)
    return {
      ...source.assignee,
      name: source.assignee.name.slice(0, 500),
      kind: "coworker" as const,
    };
  if (source.assigneeUser)
    return {
      ...source.assigneeUser,
      name: source.assigneeUser.name.slice(0, 500),
      kind: "user" as const,
    };
  const bot = source.assigneeSokoBot;
  return bot
    ? {
        id: bot.id,
        name: (bot.name ?? "Soko Bot").slice(0, 500),
        image: bot.avatarImageUrl,
        avatarSeed: bot.avatarSeed,
        kind: "sokoBot" as const,
      }
    : null;
}

/** Membership is checked afresh; a stored workspace id is never an access grant. */
async function readWorkspace(
  actor: ChatResultActor,
  client: Prisma.TransactionClient,
) {
  const workspace = await client.workspace.findFirst({
    where: sokoBotWorkspaceAccessWhere(actor.userId, actor.workspaceId),
    select: { id: true, userId: true, organizationId: true },
  });
  if (!workspace) throw notFound("Result unavailable");
  return {
    workspaceId: workspace.id,
    userId: workspace.userId,
    organizationId: workspace.organizationId,
  };
}

export async function resolveChatResultReference(
  input: {
    reference: ChatResultReference;
    actor: ChatResultActor;
    previewId?: string;
    capturedAt?: Date;
  },
  client: Prisma.TransactionClient = prisma,
): Promise<ChatResultSnapshot> {
  const { reference: ref, actor } = input;
  const workspace = await readWorkspace(actor, client);
  const base = {
    id: input.previewId ?? randomUUID(),
    state: "available" as const,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    kind: ref.kind,
  };
  const fileActor: FileActor = {
    userId: actor.userId,
    organizationId: workspace.organizationId,
    kind: actor.kind ?? "interactive",
  };
  async function files(ids: string[]) {
    const resources = await loadLiveResources({
      workspaceId: actor.workspaceId,
      actor: fileActor,
      resourceIds: ids.slice(0, 12),
    });
    return resources.map((file) => {
      const scope = workspace.organizationId
        ? `scope=org&organizationId=${encodeURIComponent(workspace.organizationId)}`
        : "scope=me";
      const href = `/api/drive/files/${encodeURIComponent(file.id)}/content?${scope}`;
      return {
        name: file.displayName.slice(0, 500),
        contentType: file.mimeType,
        sizeBytes: file.sizeBytes,
        openHref: `/drive/files/${encodeURIComponent(file.id)}?${scope}`,
        previewHref: href,
        downloadHref: `${href}&download=true`,
      };
    });
  }
  let data: ChatResultAvailable;
  switch (ref.kind) {
    case "project_selection": {
      const projects = await client.project.findMany({
        where: { workspaceId: actor.workspaceId, id: { in: ref.projectIds } },
        select: { id: true, name: true, identifier: true, logo: true },
        orderBy: { name: "asc" },
        take: 12,
      });
      data = chatResultAvailableSchema.parse({
        ...base,
        title: "Choose a project",
        status: null,
        sourceHref: "/projects",
        projectOptions: projects.map((project) => previewProject(project)),
      });
      break;
    }
    case "task": {
      const task = await requireTaskReadForWorkspace(
        workspace,
        ref.id,
        client,
        actor.userId,
        {
          assignee: {
            select: { id: true, name: true, image: true, slug: true },
          },
          assigneeUser: { select: { id: true, name: true, image: true } },
          assigneeSokoBot: {
            select: {
              id: true,
              name: true,
              avatarImageUrl: true,
              avatarSeed: true,
            },
          },
          project: {
            select: { id: true, name: true, identifier: true, logo: true },
          },
          participants: {
            take: 6,
            orderBy: { createdAt: "asc" },
            include: {
              user: { select: { id: true, name: true, image: true } },
            },
          },
          _count: { select: { events: { where: { comment: { not: null } } } } },
          schedule: true,
          events: {
            where: { status: "INPUT_REQUIRED" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { comment: true },
          },
        },
      );
      data = chatResultAvailableSchema.parse({
        ...base,
        title: task.name.slice(0, 500),
        task: {
          id: task.id,
          name: task.name.slice(0, 500),
          identifier: formatTaskIdentifier(
            task.project?.identifier,
            task.number,
          ),
          status: task.status,
          priority: task.priority ?? "NONE",
          visibility: task.visibility ?? "PUBLIC",
          createdAt: task.createdAt ?? null,
          runAt: task.runAt ?? null,
          project: previewProject(task.project),
          assignee: previewAssignee(task),
          participants: (task.participants ?? []).map(({ user }) => ({
            ...user,
            kind: "user",
          })),
          commentsCount: task._count?.events ?? 0,
          tags: mapTaskTags(task),
        },
        status: task.status,
        summary: task.description?.slice(0, 4000) ?? null,
        sourceHref: `/tasks/${encodeURIComponent(task.id)}`,
        assignee:
          task.assignee?.name ??
          task.assigneeUser?.name ??
          task.assigneeSokoBot?.name ??
          null,
        project: task.project?.name ?? null,
        question:
          task.status === "INPUT_REQUIRED"
            ? (task.events[0]?.comment?.slice(0, 4000) ?? null)
            : null,
        scheduledAt: task.schedule?.nextRunAt ?? null,
        timezone: task.schedule?.timezone ?? null,
        recurrence: task.schedule?.expr ?? null,
      });
      break;
    }
    case "task_schedule": {
      const schedule = await client.taskSchedule.findFirst({
        where: {
          id: ref.id,
          workspaceId: actor.workspaceId,
          ...taskScheduleVisibilityWhere({
            kind: "user",
            userId: actor.userId,
          }),
        },
        include: {
          project: {
            select: { id: true, name: true, identifier: true, logo: true },
          },
          assignee: {
            select: { id: true, name: true, image: true, slug: true },
          },
          assigneeUser: { select: { id: true, name: true, image: true } },
          assigneeSokoBot: {
            select: {
              id: true,
              name: true,
              avatarImageUrl: true,
              avatarSeed: true,
            },
          },
        },
      });
      if (!schedule) throw notFound("Result unavailable");
      data = chatResultAvailableSchema.parse({
        ...base,
        title: schedule.name.slice(0, 500),
        actor: previewAssignee(schedule),
        projectInfo: previewProject(schedule.project),
        status: schedule.state,
        summary: schedule.description?.slice(0, 4000) ?? null,
        sourceHref: `/schedules/${encodeURIComponent(schedule.id)}`,
        scheduledAt: schedule.nextRunAt,
        timezone: schedule.timezone,
        recurrence: schedule.expr,
        project: schedule.project?.name ?? null,
        assignee:
          schedule.assignee?.name ??
          schedule.assigneeUser?.name ??
          schedule.assigneeSokoBot?.name ??
          null,
      });
      break;
    }
    case "bot_schedule": {
      const schedule = await client.sokoBotSchedule.findFirst({
        where: {
          id: ref.id,
          userId: actor.userId,
          workspaceId: actor.workspaceId,
        },
        include: {
          sokoBot: {
            select: {
              id: true,
              name: true,
              avatarImageUrl: true,
              avatarSeed: true,
            },
          },
        },
      });
      if (!schedule) throw notFound("Result unavailable");
      data = chatResultAvailableSchema.parse({
        ...base,
        title: schedule.name.slice(0, 500),
        actor: schedule.sokoBot
          ? previewAssignee({ assigneeSokoBot: schedule.sokoBot })
          : null,
        status: schedule.enabled ? "ACTIVE" : "PAUSED",
        summary: schedule.prompt.slice(0, 4000),
        sourceHref: "/personal-assistant",
        scheduledAt: schedule.nextRunAt,
        timezone: schedule.timezone,
        recurrence: schedule.runOnce ? null : schedule.cronExpression,
      });
      break;
    }
    case "social_post": {
      await requireSocialBetaAccess(actor.userId, client);
      await requireProjectAccess(
        { ...actor, projectId: ref.projectId },
        client,
      );
      const post = await getSocialPost(
        {
          projectId: ref.projectId,
          postId: ref.id,
          workspaceId: actor.workspaceId,
        },
        client,
      );
      data = chatResultAvailableSchema.parse({
        ...base,
        title: post.text.slice(0, 160),
        social: {
          provider: post.provider,
          account: post.socialConnection
            ? {
                handle: post.socialConnection.externalHandle ?? null,
                displayName: post.socialConnection.displayName ?? null,
                avatarUrl: post.socialConnection.avatarUrl ?? null,
              }
            : null,
          timestamp: post.publishedAt ?? post.scheduledAt ?? null,
        },
        status: post.status,
        summary: post.text.slice(0, 4000),
        sourceHref: `/social?projectId=${encodeURIComponent(ref.projectId)}&postId=${encodeURIComponent(ref.id)}`,
        destination: [
          post.provider,
          post.socialConnection?.externalHandle ??
            post.socialConnection?.displayName,
        ]
          .filter(Boolean)
          .join(" · "),
        scheduledAt: post.scheduledAt,
        timezone: post.timezone,
        outputs: await files(
          (
            await client.fileResource.findMany({
              where: {
                workspaceId: actor.workspaceId,
                sourceKind: "DRIVE_UPLOAD",
                sourceId: { in: post.media.map((media) => media.pathname) },
              },
              select: { id: true },
              take: 12,
            })
          ).map((file) => file.id),
        ),
      });
      break;
    }
    case "studio_job": {
      const scope = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        projectId: ref.projectId,
      };
      // Reading a preview never reconciles a provider or starts a generation.
      const job = await getJob({ ...scope, jobId: ref.id });
      if (!job) throw notFound("Result unavailable");
      const asset = job.assetId
        ? await getAsset({ ...scope, assetId: job.assetId })
        : null;
      const href = `/studio?projectId=${encodeURIComponent(ref.projectId)}${asset ? `&v=${encodeURIComponent(asset.id)}` : ""}`;
      data = chatResultAvailableSchema.parse({
        ...base,
        title: job.prompt.slice(0, 160),
        status: job.status,
        summary: (job.error ?? job.prompt).slice(0, 4000),
        sourceHref: href,
        outputs: asset
          ? [
              {
                name: asset.prompt.slice(0, 160),
                contentType: asset.contentType,
                sizeBytes: asset.bytes,
                openHref: href,
                previewHref: `/api/projects/${encodeURIComponent(ref.projectId)}/image-studio/assets/${encodeURIComponent(asset.id)}/content`,
              },
            ]
          : [],
      });
      break;
    }
    case "job": {
      await requireJobRead(workspace, ref.id, client, actor.userId);
      const row = await client.job.findFirst({
        where: { id: ref.id, workspaceId: actor.workspaceId },
        include: jobInclude,
      });
      if (!row) throw notFound("Result unavailable");
      const job = mapJobWithStatus(row);
      const href = `/agents/${encodeURIComponent(job.agentId)}/jobs/${encodeURIComponent(job.id)}`;
      const outputs = await client.blob.findMany({
        where: {
          event: { jobId: job.id },
          status: "READY",
          fileUrl: { not: null },
        },
        take: 12,
      });
      data = chatResultAvailableSchema.parse({
        ...base,
        title: (job.name ?? job.agent.name).slice(0, 500),
        status: job.status,
        summary:
          (
            job.result ??
            (row.events?.[0]?.status === AgentJobStatus.FAILED
              ? row.events[0].result
              : null) ??
            job.input
          )?.slice(0, 4000) ?? null,
        assignee: job.agent.name,
        agent: { name: job.agent.name, icon: job.agent.icon ?? null },
        sourceHref: href,
        outputs: outputs.map((blob) => {
          const content = `/api/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(blob.id)}/content`;
          return {
            name: (blob.name ?? "Output").slice(0, 500),
            contentType: blob.mimeType,
            sizeBytes: blob.size == null ? null : Number(blob.size),
            openHref: content,
            previewHref: content,
            downloadHref: `${content}?download=true`,
          };
        }),
      });
      break;
    }
    case "file": {
      const outputs = await files([ref.id]);
      if (!outputs[0]) throw notFound("Result unavailable");
      data = chatResultAvailableSchema.parse({
        ...base,
        title: outputs[0].name,
        status: null,
        sourceHref: outputs[0].openHref,
        outputs,
      });
      break;
    }
    case "decision": {
      const decision = await client.sokoBotPendingDecision.findFirst({
        where: {
          id: ref.id,
          userId: actor.userId,
          workspaceId: actor.workspaceId,
        },
      });
      if (!decision) throw notFound("Result unavailable");
      const status =
        decision.status === "PENDING" && decision.expiresAt <= new Date()
          ? "EXPIRED"
          : decision.status;
      data = chatResultAvailableSchema.parse({
        ...base,
        title: decision.reason.slice(0, 500),
        status,
        summary: decision.reason.slice(0, 4000),
        sourceHref: "/personal-assistant",
        decision: { ...decision, status },
      });
      break;
    }
  }
  const snapshot = { workspaceId: actor.workspaceId, reference: ref, data };
  // The existing tool ledger stores at most 16 KB. Keep the card intact rather
  // than letting its JSON become the generic truncated-text result wrapper.
  for (const field of ["summary", "question"] as const) {
    if (
      Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 14_000 &&
      data[field]
    )
      data[field] = data[field].slice(0, 1000);
  }
  while (
    Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 14_000 &&
    data.outputs.length > 1
  )
    data.outputs.pop();
  const persisted = chatResultSnapshotSchema.safeParse(
    persistedToolResult(snapshot),
  );
  if (!persisted.success)
    throw unprocessableEntity(
      "Result is too large to preview; open its source",
    );
  return persisted.data;
}

export async function hydrateChatResultSnapshots(
  snapshots: ChatResultSnapshot[],
  viewerUserId: string,
): Promise<ChatResultPreview[]> {
  return Promise.all(
    snapshots.map(async (snapshot): Promise<ChatResultPreview> => {
      try {
        const current = await resolveChatResultReference({
          reference: snapshot.reference,
          actor: { userId: viewerUserId, workspaceId: snapshot.workspaceId },
          previewId: snapshot.data.id,
        });
        const allowedOutputs = new Set(
          current.data.outputs.map((output) => output.openHref),
        );
        return {
          ...snapshot.data,
          outputs: snapshot.data.outputs.filter((output) =>
            allowedOutputs.has(output.openHref),
          ),
          decision: current.data.decision,
          // Choices are live: removed projects and old names are never selectable.
          projectOptions: current.data.projectOptions,
        };
      } catch (error) {
        if (
          error instanceof HTTPException &&
          (error.status === 403 || error.status === 404)
        )
          return { id: snapshot.data.id, state: "unavailable" };
        throw error;
      }
    }),
  );
}

export async function collectTurnResultSnapshots(
  turnId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<ChatResultSnapshot[]> {
  const calls = await client.sokoBotToolCall.findMany({
    where: { turnId, capability: "preview_result", status: "COMPLETED" },
    orderBy: { createdAt: "asc" },
    take: 24,
    select: { result: true },
  });
  return readPreparedResultSnapshots(calls.map((call) => call.result));
}
