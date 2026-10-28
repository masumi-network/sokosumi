import { randomUUID } from "node:crypto";
import { jobInclude, type Prisma } from "@sokosumi/database";
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
import { digestJob, plainExcerpt } from "@/helpers/job-digest";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
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

interface ResolvedWorkspace {
  workspaceId: string;
  userId: string | null;
  organizationId: string | null;
}

interface ResultOutput {
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  openHref: string;
  previewHref: string;
  downloadHref?: string | null;
}

function driveFileOutputs(
  organizationId: string | null,
  resources: Array<{
    id: string;
    displayName: string;
    mimeType: string | null;
    sizeBytes: number | null;
  }>,
): ResultOutput[] {
  const scope = organizationId
    ? `scope=org&organizationId=${encodeURIComponent(organizationId)}`
    : "scope=me";
  return resources.map((file) => {
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

function projectKey(workspaceId: string, projectId: string) {
  return `${workspaceId}\0${projectId}`;
}

function entityKey(workspaceId: string, projectId: string, id: string) {
  return `${workspaceId}\0${projectId}\0${id}`;
}

interface SocialHydration {
  text: string;
  provider: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  timezone: string | null;
  socialConnection: {
    externalHandle: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  outputs: ResultOutput[];
}

interface StudioHydration {
  status: string;
  prompt: string;
  error: string | null;
  asset: {
    id: string;
    prompt: string;
    contentType: string;
    bytes: number;
  } | null;
}

export interface ChatResultHydrationScope {
  workspaces: Map<string, ResolvedWorkspace>;
  social: Map<string, SocialHydration>;
  studio: Map<string, StudioHydration>;
}

function emptyHydrationScope(): ChatResultHydrationScope {
  return { workspaces: new Map(), social: new Map(), studio: new Map() };
}

/** Org membership is already proven by the workspace query's `members.some`. */
function canReadProject(workspace: ResolvedWorkspace, viewerUserId: string) {
  if (workspace.userId) return workspace.userId === viewerUserId;
  return workspace.organizationId !== null;
}

/**
 * One read per resource kind for a whole result page.
 *
 * An empty id list is not a query: Prisma renders it as `AND 1=0`.
 */
export async function preloadChatResultHydration(
  snapshots: ChatResultSnapshot[],
  viewerUserId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<ChatResultHydrationScope> {
  if (snapshots.length === 0) return emptyHydrationScope();

  const workspaceRows = await client.workspace.findMany({
    where: {
      id: {
        in: [...new Set(snapshots.map((snapshot) => snapshot.workspaceId))],
      },
      OR: [
        { userId: viewerUserId },
        { organization: { members: { some: { userId: viewerUserId } } } },
      ],
    },
    select: { id: true, userId: true, organizationId: true },
  });
  const workspaces = new Map<string, ResolvedWorkspace>(
    workspaceRows.map((row) => [
      row.id,
      {
        workspaceId: row.id,
        userId: row.userId,
        organizationId: row.organizationId,
      },
    ]),
  );
  const projectIdsByWorkspace = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    const ref = snapshot.reference;
    if (ref.kind !== "social_post" && ref.kind !== "studio_job") continue;
    const workspace = workspaces.get(snapshot.workspaceId);
    if (!workspace || !canReadProject(workspace, viewerUserId)) {
      continue;
    }
    const ids = projectIdsByWorkspace.get(snapshot.workspaceId) ?? new Set();
    ids.add(ref.projectId);
    projectIdsByWorkspace.set(snapshot.workspaceId, ids);
  }
  const allowedProjects = new Set<string>();
  if (projectIdsByWorkspace.size > 0) {
    const projects = await client.project.findMany({
      where: {
        OR: [...projectIdsByWorkspace].map(([workspaceId, ids]) => ({
          workspaceId,
          id: { in: [...ids] },
        })),
      },
      select: { id: true, workspaceId: true },
    });
    for (const project of projects) {
      allowedProjects.add(projectKey(project.workspaceId, project.id));
    }
  }

  const socialRefs = new Map<
    string,
    { id: string; projectId: string; workspaceId: string }
  >();
  const studioRefs = new Map<
    string,
    { id: string; projectId: string; workspaceId: string }
  >();
  for (const snapshot of snapshots) {
    const ref = snapshot.reference;
    if (ref.kind !== "social_post" && ref.kind !== "studio_job") continue;
    if (!allowedProjects.has(projectKey(snapshot.workspaceId, ref.projectId))) {
      continue;
    }
    const key = entityKey(snapshot.workspaceId, ref.projectId, ref.id);
    const target = ref.kind === "social_post" ? socialRefs : studioRefs;
    target.set(key, {
      id: ref.id,
      projectId: ref.projectId,
      workspaceId: snapshot.workspaceId,
    });
  }

  const social = new Map<string, SocialHydration>();
  if (socialRefs.size > 0) {
    const posts = await client.socialPost.findMany({
      where: {
        OR: [...socialRefs.values()].map((ref) => ({
          id: ref.id,
          projectId: ref.projectId,
          workspaceId: ref.workspaceId,
        })),
      },
      select: {
        id: true,
        projectId: true,
        workspaceId: true,
        text: true,
        provider: true,
        status: true,
        scheduledAt: true,
        publishedAt: true,
        timezone: true,
        media: true,
        socialConnection: {
          select: {
            externalHandle: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
    const pathnamesByPost = new Map<string, string[]>();
    const pathnamesByWorkspace = new Map<string, Set<string>>();
    for (const post of posts) {
      const pathnames = parseSocialPostMedia(post.media, post.id).map(
        (media) => media.pathname,
      );
      pathnamesByPost.set(
        entityKey(post.workspaceId, post.projectId, post.id),
        pathnames,
      );
      if (pathnames.length === 0) continue;
      const paths = pathnamesByWorkspace.get(post.workspaceId) ?? new Set();
      for (const pathname of pathnames) paths.add(pathname);
      pathnamesByWorkspace.set(post.workspaceId, paths);
    }
    const fileRows =
      pathnamesByWorkspace.size === 0
        ? []
        : await client.fileResource.findMany({
            where: {
              OR: [...pathnamesByWorkspace].map(([workspaceId, sourceIds]) => ({
                workspaceId,
                sourceKind: "DRIVE_UPLOAD" as const,
                sourceId: { in: [...sourceIds] },
              })),
            },
            select: { id: true, workspaceId: true, sourceId: true },
            orderBy: { id: "asc" },
          });
    const fileIdsByPost = new Map<string, string[]>();
    const fileIdsByWorkspace = new Map<string, string[]>();
    for (const post of posts) {
      const key = entityKey(post.workspaceId, post.projectId, post.id);
      const wanted = new Set(pathnamesByPost.get(key) ?? []);
      const ids: string[] = [];
      if (wanted.size > 0) {
        for (const file of fileRows) {
          if (
            file.workspaceId !== post.workspaceId ||
            !wanted.has(file.sourceId)
          ) {
            continue;
          }
          ids.push(file.id);
          if (ids.length === 12) break;
        }
      }
      fileIdsByPost.set(key, ids);
      if (ids.length === 0) continue;
      const list = fileIdsByWorkspace.get(post.workspaceId) ?? [];
      list.push(...ids);
      fileIdsByWorkspace.set(post.workspaceId, list);
    }
    const liveByWorkspace = new Map<
      string,
      Map<
        string,
        {
          id: string;
          displayName: string;
          mimeType: string | null;
          sizeBytes: number | null;
        }
      >
    >();
    for (const [workspaceId, ids] of fileIdsByWorkspace) {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) continue;
      const resources = await loadLiveResources({
        workspaceId,
        actor: {
          userId: viewerUserId,
          organizationId: workspace.organizationId,
          kind: "interactive",
        },
        resourceIds: [...new Set(ids)],
      });
      liveByWorkspace.set(
        workspaceId,
        new Map(resources.map((resource) => [resource.id, resource])),
      );
    }
    for (const post of posts) {
      const key = entityKey(post.workspaceId, post.projectId, post.id);
      const workspace = workspaces.get(post.workspaceId);
      if (!workspace) continue;
      const live = liveByWorkspace.get(post.workspaceId);
      const resources = (fileIdsByPost.get(key) ?? []).flatMap((id) => {
        const resource = live?.get(id);
        return resource ? [resource] : [];
      });
      social.set(key, {
        text: post.text,
        provider: post.provider,
        status: post.status,
        scheduledAt: post.scheduledAt,
        publishedAt: post.publishedAt,
        timezone: post.timezone,
        socialConnection: post.socialConnection,
        outputs: driveFileOutputs(workspace.organizationId, resources),
      });
    }
  }

  const studio = new Map<string, StudioHydration>();
  if (studioRefs.size > 0) {
    const jobs = await client.projectImageJob.findMany({
      where: {
        OR: [...studioRefs.values()].map((ref) => ({
          id: ref.id,
          projectId: ref.projectId,
        })),
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        prompt: true,
        error: true,
        asset: {
          select: { id: true, prompt: true, contentType: true, bytes: true },
        },
      },
    });
    const jobsById = new Map(
      jobs.map((job) => [`${job.projectId}\0${job.id}`, job]),
    );
    for (const [key, ref] of studioRefs) {
      const job = jobsById.get(`${ref.projectId}\0${ref.id}`);
      if (!job) continue;
      studio.set(key, {
        status: job.status,
        prompt: job.prompt,
        error: job.error,
        asset: job.asset,
      });
    }
  }

  return { workspaces, social, studio };
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
    scope?: ChatResultHydrationScope;
  },
  client: Prisma.TransactionClient = prisma,
): Promise<ChatResultSnapshot> {
  const { reference: ref, actor, scope } = input;
  const workspace = scope
    ? scope.workspaces.get(actor.workspaceId)
    : await readWorkspace(actor, client);
  if (!workspace) throw notFound("Result unavailable");
  const base = {
    id: input.previewId ?? randomUUID(),
    state: "available" as const,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    kind: ref.kind,
  };
  const organizationId = workspace.organizationId;
  const fileActor: FileActor = {
    userId: actor.userId,
    organizationId,
    kind: actor.kind ?? "interactive",
  };
  async function files(ids: string[]) {
    const resources = await loadLiveResources({
      workspaceId: actor.workspaceId,
      actor: fileActor,
      resourceIds: ids.slice(0, 12),
    });
    return driveFileOutputs(organizationId, resources);
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
          requestedByUserId: actor.userId,
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
      const cached = scope?.social.get(
        entityKey(actor.workspaceId, ref.projectId, ref.id),
      );
      const post = cached
        ? cached
        : await (async () => {
            if (scope) throw notFound("Result unavailable");
            await requireProjectAccess(
              { ...actor, projectId: ref.projectId },
              client,
            );
            const loaded = await getSocialPost(
              {
                projectId: ref.projectId,
                postId: ref.id,
                workspaceId: actor.workspaceId,
              },
              client,
            );
            const pathnames = loaded.media.map((media) => media.pathname);
            return {
              text: loaded.text,
              provider: loaded.provider,
              status: loaded.status,
              scheduledAt: loaded.scheduledAt,
              publishedAt: loaded.publishedAt,
              timezone: loaded.timezone,
              socialConnection: loaded.socialConnection,
              outputs: await files(
                pathnames.length === 0
                  ? []
                  : (
                      await client.fileResource.findMany({
                        where: {
                          workspaceId: actor.workspaceId,
                          sourceKind: "DRIVE_UPLOAD",
                          sourceId: { in: pathnames },
                        },
                        select: { id: true },
                        orderBy: { id: "asc" },
                        take: 12,
                      })
                    ).map((file) => file.id),
              ),
            };
          })();
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
        outputs: post.outputs,
      });
      break;
    }
    case "studio_job": {
      const projectScope = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        projectId: ref.projectId,
      };
      // Reading a preview never reconciles a provider or starts a generation.
      const cached = scope?.studio.get(
        entityKey(actor.workspaceId, ref.projectId, ref.id),
      );
      const job = cached
        ? cached
        : await (async () => {
            if (scope) throw notFound("Result unavailable");
            const loaded = await getJob({ ...projectScope, jobId: ref.id });
            if (!loaded) throw notFound("Result unavailable");
            const asset = loaded.assetId
              ? await getAsset({ ...projectScope, assetId: loaded.assetId })
              : null;
            return {
              status: loaded.status,
              prompt: loaded.prompt,
              error: loaded.error,
              asset,
            };
          })();
      const href = `/studio?projectId=${encodeURIComponent(ref.projectId)}${job.asset ? `&v=${encodeURIComponent(job.asset.id)}` : ""}`;
      data = chatResultAvailableSchema.parse({
        ...base,
        title: job.prompt.slice(0, 160),
        status: job.status,
        summary: (job.error ?? job.prompt).slice(0, 4000),
        sourceHref: href,
        outputs: job.asset
          ? [
              {
                name: job.asset.prompt.slice(0, 160),
                contentType: job.asset.contentType,
                sizeBytes: job.asset.bytes,
                openHref: href,
                previewHref: `/api/projects/${encodeURIComponent(ref.projectId)}/image-studio/assets/${encodeURIComponent(job.asset.id)}/content`,
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
      const digest = digestJob(job);
      const href = `/agents/${encodeURIComponent(job.agentId)}/jobs/${encodeURIComponent(job.id)}`;
      const outputs = job.events
        .flatMap((event) => event.blobs)
        .filter((blob) => blob.status === "READY" && blob.fileUrl)
        .slice(0, 12);
      const finished = digest.result ?? digest.error;
      data = chatResultAvailableSchema.parse({
        ...base,
        title: (job.name ?? job.agent.name).slice(0, 500),
        status: job.status,
        summary: finished ? plainExcerpt(finished, 600) : null,
        details: finished ? [] : digest.input,
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
          requestedByUserId: actor.userId,
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
  scope?: ChatResultHydrationScope,
): Promise<ChatResultPreview[]> {
  const resolved =
    scope ?? (await preloadChatResultHydration(snapshots, viewerUserId));
  return Promise.all(
    snapshots.map(async (snapshot): Promise<ChatResultPreview> => {
      try {
        const current = await resolveChatResultReference({
          reference: snapshot.reference,
          actor: { userId: viewerUserId, workspaceId: snapshot.workspaceId },
          previewId: snapshot.data.id,
          scope: resolved,
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
          // A hired Agent's Job keeps working after the turn; its card is live.
          ...(snapshot.data.kind === "job"
            ? {
                status: current.data.status,
                summary: current.data.summary,
                details: current.data.details,
                outputs: current.data.outputs,
              }
            : {}),
          // Auto tags, the project and the assignee usually land seconds
          // after the turn; the card keeps the name and status it reported.
          task:
            current.data.task && snapshot.data.task
              ? {
                  ...current.data.task,
                  name: snapshot.data.task.name,
                  status: snapshot.data.task.status,
                }
              : snapshot.data.task,
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
