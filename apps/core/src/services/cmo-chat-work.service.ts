import {
  jobInclude,
  type ProjectImageJobStatus,
  type TaskStatus,
} from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { z } from "zod";

import { digestJob, plainExcerpt } from "@/helpers/job-digest";
import prisma from "@/lib/db/prisma";
import { publicDriveUrl } from "@/lib/drive-blob";
import {
  type CmoChatPerson,
  type CmoChatRecord,
  type CmoChatStep,
  type CmoChatTable,
  listCmoChatRecords,
  readCmoChatRecordText,
  readCmoChatTable,
} from "@/services/cmo-chat-records.service";
import {
  CmoNotFoundError,
  type CusoTarget,
  requireCuso,
} from "@/services/cmo-cuso.service";
import {
  CMO_STYLE_PASSED,
  CMO_STYLE_REJECTED,
} from "@/services/cmo-media-maker.service";
import {
  type LiveResource,
  loadLiveResources,
} from "@/services/file-search.service";
import { ensureStudioAssetDriveFile } from "@/services/image-studio-drive.service";
import {
  isTextMimeType,
  readDriveText,
} from "@/services/soko-bot-runtime/drive-reading";

/** A file that came out of the work, at its public address. */
export interface CmoChatWorkFile {
  name: string;
  url: string;
}

/**
 * Something Cuso started for the owner in chat that the chat shows where it
 * was asked for: while it is being made, and the thing itself once it is. A
 * picture, video or voice-over he made, a file he wrote, or work he handed to
 * a Coworker (a Task) or a hired Agent (a Job).
 */
export interface CmoChatWorkItem {
  /** The tool call that started it; stable across reloads. */
  id: string;
  kind:
    | "image"
    | "video"
    | "audio"
    | "file"
    | "task"
    | "agent"
    | CmoChatRecord["kind"];
  /**
   * `waiting` is handed work that needs the owner before it goes on;
   * `stopped` is a background run somebody called off.
   */
  state: "making" | "waiting" | "ready" | "failed" | "stopped";
  at: Date;
  /** What it is: the prompt, the words spoken, the file's or the work's name. */
  title: string;
  /** Where the finished file plays or downloads from; null otherwise. */
  url: string | null;
  /** Who does handed work: the Coworker or the Agent. */
  by: string | null;
  /** Handed work: what is asked while it waits, the result's start once done. */
  text: string | null;
  /** Its full words can be read with `readCmoChatWorkText`. */
  readable: boolean;
  /** Files handed work came back with. */
  files: CmoChatWorkFile[];
  /** A table's columns and first rows. */
  table: CmoChatTable | null;
  /** The first people of a contact list or a lookup. */
  people: CmoChatPerson[];
  /** Everyone that list or lookup holds, shown or not. */
  total: number | null;
  /** A running background run's plan. */
  steps: CmoChatStep[];
  /** A background run's own turn: its report in the room is this card. */
  turnId: string | null;
}

/** How many of the newest items the chat shows. */
const CMO_CHAT_WORK_SHOWN = 20;
/** Older chat work has scrolled far out of the chat's 50 messages. */
const CMO_CHAT_WORK_DAYS = 30;
/** A video takes minutes; one still not made after this never will be. */
const CMO_CHAT_WORK_GIVE_UP_MS = 60 * 60 * 1000;
/** How much of a result or a question the card itself shows. */
const CMO_CHAT_WORK_EXCERPT = 280;
const CMO_CHAT_WORK_FILES = 6;

const STUDIO_KIND = {
  generate_image: "image",
  generate_video: "video",
  generate_talking_video: "video",
} as const satisfies Record<string, CmoChatWorkItem["kind"]>;

const VOICEOVER = "generate_voiceover";
const SAVED_FILE = "upload_file";
const HIRED_AGENT = "hire_agent";
const HANDED_TASK = ["create_task", "assign_task"];

const CAPABILITIES = [
  ...Object.keys(STUDIO_KIND),
  VOICEOVER,
  SAVED_FILE,
  HIRED_AGENT,
  ...HANDED_TASK,
];

const MAKING = new Set<ProjectImageJobStatus>([
  "PENDING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
  "SUBMISSION_UNCERTAIN",
]);

/** A Task that stands still until its owner answers, approves or pays. */
const TASK_WAITS = new Set<TaskStatus>([
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
]);

const AGENT_FAILED = new Set<string>([
  SokosumiJobStatus.FAILED,
  SokosumiJobStatus.PAYMENT_FAILED,
  SokosumiJobStatus.REFUND_PENDING,
  SokosumiJobStatus.REFUND_RESOLVED,
  SokosumiJobStatus.DISPUTE_PENDING,
  SokosumiJobStatus.DISPUTE_RESOLVED,
]);

const savedFileSchema = z.object({ id: z.string(), filename: z.string() });
const spokenSchema = z.object({ text: z.string() });
const hiredSchema = z.object({ resultingEntityId: z.string() });

const CALL_SELECT = {
  id: true,
  turnId: true,
  toolCallId: true,
  capability: true,
  createdAt: true,
  input: true,
  result: true,
  targetId: true,
} as const;

interface WorkCall {
  id: string;
  turnId: string;
  toolCallId: string;
  capability: string;
  createdAt: Date;
  input: unknown;
  result: unknown;
  targetId: string | null;
}

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

function taskState(status: TaskStatus): CmoChatWorkItem["state"] {
  if (status === "COMPLETED") return "ready";
  if (status === "FAILED" || status === "CANCELED") return "failed";
  return TASK_WAITS.has(status) ? "waiting" : "making";
}

function agentState(status: string): CmoChatWorkItem["state"] {
  if (status === SokosumiJobStatus.COMPLETED) return "ready";
  if (status === SokosumiJobStatus.INPUT_REQUIRED) return "waiting";
  return AGENT_FAILED.has(status) ? "failed" : "making";
}

/** The Job a `hire_agent` call started, from its receipt. */
function hiredJobId(call: WorkCall): string | null {
  return hiredSchema.safeParse(call.result).data?.resultingEntityId ?? null;
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

const TASK_SELECT = {
  id: true,
  name: true,
  status: true,
  assignee: { select: { name: true } },
  events: {
    where: { comment: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { status: true, comment: true, coworkerId: true },
  },
  files: {
    where: { origin: "TASK_OUTPUT", status: "READY", fileUrl: { not: null } },
    orderBy: { createdAt: "asc" },
    take: CMO_CHAT_WORK_FILES,
    select: { name: true, fileUrl: true },
  },
} as const;

interface HandedTask {
  id: string;
  name: string;
  status: TaskStatus;
  assignee: { name: string } | null;
  events: {
    status: TaskStatus | null;
    comment: string | null;
    coworkerId: string | null;
  }[];
  files: { name: string; fileUrl: string | null }[];
}

/** What the Coworker came back with: the words it finished the Task on. */
function taskResult(task: HandedTask): string | null {
  const finished =
    task.events.find((event) => event.status === "COMPLETED") ??
    task.events.find((event) => event.coworkerId !== null);
  return finished?.comment?.trim() || null;
}

/** What a Task that stands still asks of its owner. */
function taskQuestion(task: HandedTask): string | null {
  const asked = task.events.find(
    (event) => event.status !== null && TASK_WAITS.has(event.status),
  );
  return asked?.comment?.trim() || null;
}

async function loadJobs(workspaceId: string, jobIds: string[]) {
  if (jobIds.length === 0) return [];
  const rows = await prisma.job.findMany({
    where: { id: { in: jobIds }, workspaceId },
    include: jobInclude,
  });
  return rows.map((row) => {
    const job = mapJobWithStatus(row);
    return { id: job.id, name: job.name ?? job.agent.name, job };
  });
}

interface Drive {
  workspaceId: string;
  organizationId: string | null;
  userId: string;
}

async function driveOf(
  cuso: { sokoBotId: string; workspaceId: string },
  userId: string,
): Promise<Drive> {
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: cuso.sokoBotId },
    select: { workspace: { select: { organizationId: true } } },
  });
  return {
    workspaceId: cuso.workspaceId,
    organizationId: bot.workspace.organizationId,
    userId,
  };
}

function liveFiles(drive: Drive, resourceIds: string[]) {
  return loadLiveResources({
    workspaceId: drive.workspaceId,
    actor: {
      userId: drive.userId,
      organizationId: drive.organizationId,
      kind: "oauth",
    },
    resourceIds,
  });
}

/** What only a record (a table, contacts, a run) carries. */
const NO_RECORD = {
  table: null,
  people: [],
  total: null,
  steps: [],
  turnId: null,
};
const NOT_HANDED = {
  ...NO_RECORD,
  by: null,
  text: null,
  readable: false,
  files: [],
};

/**
 * What Cuso made, or is making, for the owner in chat, newest first: the
 * pictures, videos, voice-overs and files his chat turns made, and the work
 * he handed to a Coworker or a hired Agent, each with where it stands now.
 * Read from his tool calls and the records they made, so it survives a
 * reload and needs nothing from Cuso.
 */
export async function listCmoChatWork(
  input: CusoTarget,
): Promise<CmoChatWorkItem[]> {
  const cuso = await requireCuso(input);
  const calls: WorkCall[] = await prisma.sokoBotToolCall.findMany({
    where: {
      status: "COMPLETED",
      capability: { in: CAPABILITIES },
      turn: {
        sokoBotId: cuso.sokoBotId,
        createdAt: {
          gte: new Date(Date.now() - CMO_CHAT_WORK_DAYS * 24 * 60 * 60 * 1000),
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CMO_CHAT_WORK_SHOWN,
    select: CALL_SELECT,
  });
  const records = (await listCmoChatRecords(cuso)).map(
    (record): CmoChatWorkItem => ({ ...record, url: null, files: [] }),
  );
  if (calls.length === 0) return records;
  const drive = await driveOf(cuso, input.userId);
  const keyOf = (call: WorkCall) =>
    `soko-bot:${call.turnId}:${call.toolCallId}`;
  const studioCalls = calls.filter((call) => call.capability in STUDIO_KIND);
  const taskIds = calls.flatMap((call) =>
    HANDED_TASK.includes(call.capability) && call.targetId
      ? [call.targetId]
      : [],
  );
  const fileIds = calls.flatMap((call) => {
    if (call.capability === SAVED_FILE && call.targetId) return [call.targetId];
    const spoken = savedFileSchema.safeParse(call.result);
    return call.capability === VOICEOVER && spoken.success
      ? [spoken.data.id]
      : [];
  });
  const [studioJobs, tasks, jobs, files] = await Promise.all([
    studioCalls.length
      ? (prisma.projectImageJob.findMany({
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
        }) as Promise<StudioJob[]>)
      : [],
    taskIds.length
      ? (prisma.task.findMany({
          where: {
            id: { in: taskIds },
            workspaceId: cuso.workspaceId,
            archivedAt: null,
          },
          select: TASK_SELECT,
        }) as Promise<HandedTask[]>)
      : [],
    loadJobs(
      cuso.workspaceId,
      calls.flatMap((call) =>
        call.capability === HIRED_AGENT ? (hiredJobId(call) ?? []) : [],
      ),
    ),
    liveFiles(drive, fileIds),
  ]);

  // A Task made and then assigned, or a file written twice, shows once:
  // where Cuso first touched it.
  const firstCallOf = new Map<string, string>();
  for (const call of [...calls].reverse()) {
    const subject = call.capability === HIRED_AGENT ? null : call.targetId;
    if (subject && !firstCallOf.has(subject)) firstCallOf.set(subject, call.id);
  }
  const repeats = (call: WorkCall) =>
    call.targetId !== null &&
    firstCallOf.has(call.targetId) &&
    firstCallOf.get(call.targetId) !== call.id;

  const items = await Promise.all(
    calls.map(async (call): Promise<CmoChatWorkItem | null> => {
      const base = { id: call.id, at: call.createdAt };
      if (HANDED_TASK.includes(call.capability)) {
        const task = tasks.find((item) => item.id === call.targetId);
        // A Task with no Coworker on it is a note for a person, not work
        // under way: Cuso's own words say what he noted.
        if (!task?.assignee || repeats(call)) return null;
        const state = taskState(task.status);
        const words =
          state === "ready"
            ? taskResult(task)
            : state === "waiting"
              ? taskQuestion(task)
              : null;
        return {
          ...base,
          ...NO_RECORD,
          kind: "task",
          state,
          title: task.name,
          url: null,
          by: task.assignee.name,
          text: words ? plainExcerpt(words, CMO_CHAT_WORK_EXCERPT) : null,
          readable: state === "ready" && words !== null,
          files: task.files.flatMap((file) =>
            file.fileUrl ? [{ name: file.name, url: file.fileUrl }] : [],
          ),
        };
      }
      if (call.capability === HIRED_AGENT) {
        const hired = jobs.find((item) => item.id === hiredJobId(call));
        if (!hired) return null;
        const digest = digestJob(hired.job);
        const state = agentState(digest.status);
        const words =
          state === "ready"
            ? digest.result
            : state === "failed"
              ? digest.error
              : null;
        return {
          ...base,
          ...NO_RECORD,
          kind: "agent",
          state,
          title: hired.name,
          url: null,
          by: hired.job.agent.name,
          text: words ? plainExcerpt(words, CMO_CHAT_WORK_EXCERPT) : null,
          readable: state === "ready" && digest.result !== null,
          files: digest.files
            .slice(0, CMO_CHAT_WORK_FILES)
            .map(({ name, url }) => ({ name, url })),
        };
      }
      if (call.capability === SAVED_FILE) {
        const file = files.find((item) => item.id === call.targetId);
        // A file the owner deleted since is no longer theirs to open.
        if (!file || repeats(call)) return null;
        const url = await publicUrl(file.sourceId);
        return {
          ...base,
          ...NOT_HANDED,
          kind: "file",
          state: url ? "ready" : "failed",
          title: file.displayName,
          url,
          readable: isTextMimeType(file.mimeType),
        };
      }
      if (call.capability === VOICEOVER) {
        const saved = savedFileSchema.safeParse(call.result).data;
        const file = files.find((item) => item.id === saved?.id);
        // A voice-over the owner deleted since is no longer theirs to hear.
        if (!saved || !file) return null;
        const url = await publicUrl(file.sourceId);
        const words = spokenSchema.safeParse(call.input);
        return {
          ...base,
          ...NOT_HANDED,
          kind: "audio",
          state: url ? "ready" : "failed",
          title: words.success ? words.data.text : saved.filename,
          url,
        };
      }
      const key = keyOf(call);
      // The newest try: a styled picture's later models share the call's key.
      const job = studioJobs
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
        ...NOT_HANDED,
        kind,
        // Finished, but its file cannot be shown: say so rather than wait.
        state: state === "ready" && !url ? "failed" : state,
        title: job.prompt,
        url,
      };
    }),
  );
  return [
    ...items.filter((item): item is CmoChatWorkItem => item !== null),
    ...records,
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * The full words of one item, for reading inside CMO: a file Cuso wrote,
 * or what a Coworker or a hired Agent came back with.
 */
export async function readCmoChatWorkText(
  input: CusoTarget & { id: string },
): Promise<string> {
  const cuso = await requireCuso(input);
  const call: WorkCall | null = await prisma.sokoBotToolCall.findFirst({
    where: {
      id: input.id,
      status: "COMPLETED",
      capability: { in: [SAVED_FILE, HIRED_AGENT, ...HANDED_TASK] },
      turn: { sokoBotId: cuso.sokoBotId },
    },
    select: CALL_SELECT,
  });
  const text = call
    ? await wordsOf(call, cuso, input.userId)
    : await readCmoChatRecordText(cuso, input.id);
  if (!text) throw new CmoNotFoundError("There is nothing to read here yet");
  return text;
}

/** A table Cuso made or wrote into, in full, for "Show all" in the chat. */
export async function readCmoChatWorkTable(
  input: CusoTarget & { id: string },
): Promise<{ title: string; table: CmoChatTable }> {
  const found = await readCmoChatTable(await requireCuso(input), input.id);
  if (!found) throw new CmoNotFoundError("This table is no longer there");
  return found;
}

async function wordsOf(
  call: WorkCall,
  cuso: { sokoBotId: string; workspaceId: string },
  userId: string,
): Promise<string | null> {
  if (call.capability === HIRED_AGENT) {
    const jobId = hiredJobId(call);
    const [hired] = jobId ? await loadJobs(cuso.workspaceId, [jobId]) : [];
    return hired?.job.result?.trim() || null;
  }
  if (!call.targetId) return null;
  if (call.capability === SAVED_FILE) {
    const [file]: LiveResource[] = await liveFiles(
      await driveOf(cuso, userId),
      [call.targetId],
    );
    return file ? readDriveText(file) : null;
  }
  const task: HandedTask | null = await prisma.task.findFirst({
    where: {
      id: call.targetId,
      workspaceId: cuso.workspaceId,
      archivedAt: null,
      status: "COMPLETED",
    },
    select: TASK_SELECT,
  });
  return task ? taskResult(task) : null;
}
