import type { Prisma } from "@sokosumi/database";
import type { SocialPostMediaRef } from "@sokosumi/utils";
import { socialProviderProjectSelect } from "@/config/social-providers";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import prisma from "@/lib/db/prisma";
import type { ChatResultSnapshot } from "@/schemas/chat-result-preview.schema";
import { loadLiveResources } from "@/services/file-search.service";
import { isSocialPostProviderEnabled } from "@/services/social-posts.service";

export interface ResolvedWorkspace {
  workspaceId: string;
  userId: string | null;
  organizationId: string | null;
}

interface ResultOutput {
  transformation?: SocialPostMediaRef["transformation"];
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  openHref: string;
  previewHref: string;
  downloadHref?: string | null;
}

export function driveFileOutputs(
  organizationId: string | null,
  resources: Array<{
    id: string;
    displayName: string;
    mimeType: string | null;
    sizeBytes: number | null;
    sourceId?: string;
  }>,
  media: readonly SocialPostMediaRef[] = [],
): ResultOutput[] {
  const scope = organizationId
    ? `scope=org&organizationId=${encodeURIComponent(organizationId)}`
    : "scope=me";
  return resources.map((file) => {
    const href = `/api/drive/files/${encodeURIComponent(file.id)}/content?${scope}`;
    const transformation = media.find(
      (item) => item.pathname === file.sourceId,
    )?.transformation;
    return {
      ...(transformation ? { transformation } : {}),
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

export function entityKey(workspaceId: string, projectId: string, id: string) {
  return `${workspaceId}\0${projectId}\0${id}`;
}

interface SocialHydration {
  text: string;
  provider: string;
  status: string;
  revision: number;
  canApprove: boolean;
  canReject: boolean;
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
        revision: true,
        scheduledAt: true,
        publishedAt: true,
        timezone: true,
        media: true,
        threadParts: { select: { media: true }, orderBy: { position: "asc" } },
        project: { select: socialProviderProjectSelect },
        socialConnection: {
          select: {
            provider: true,
            externalHandle: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
    const pathnamesByPost = new Map<string, string[]>();
    const mediaByPost = new Map<string, SocialPostMediaRef[]>();
    const pathnamesByWorkspace = new Map<string, Set<string>>();
    for (const post of posts) {
      const media = [
        ...parseSocialPostMedia(post.media, post.id),
        ...(post.threadParts ?? []).flatMap((part) =>
          parseSocialPostMedia(part.media, post.id),
        ),
      ];
      mediaByPost.set(
        entityKey(post.workspaceId, post.projectId, post.id),
        media,
      );
      const pathnames = media.map((item) => item.pathname);
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
          sourceId?: string;
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
      const media = mediaByPost.get(key) ?? [];
      social.set(key, {
        text: post.text,
        provider: post.provider,
        status: post.status,
        revision: post.revision,
        canApprove:
          post.status === "NEEDS_APPROVAL" && isSocialPostProviderEnabled(post),
        canReject: post.status === "NEEDS_APPROVAL",
        scheduledAt: post.scheduledAt,
        publishedAt: post.publishedAt,
        timezone: post.timezone,
        socialConnection: post.socialConnection,
        outputs: driveFileOutputs(workspace.organizationId, resources, media),
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
