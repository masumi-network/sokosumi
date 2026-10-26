import { createHash, randomUUID } from "node:crypto";
import {
  AgentJobStatus,
  Channel,
  FileSourceKind,
  FileSourceScope,
  jobInclude,
  type Prisma,
  TaskStatus,
} from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { createAgentClient } from "@sokosumi/masumi";
import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import {
  sokoBotAgentIdInputSchema as agentIdInputSchema,
  type ChatResultReference,
  composeSystemPrompt,
  sokoBotCreateScheduleInputSchema as createScheduleInputSchema,
  sokoBotGenerateImageInputSchema as generateImageInputSchema,
  sokoBotGenerateVideoInputSchema as generateVideoInputSchema,
  sokoBotGetImageInputSchema as getImageInputSchema,
  isSokoBotCapability,
  isSokoBotDecisionTarget,
  sokoBotJobIdInputSchema as jobIdInputSchema,
  sokoBotLinkTasksInputSchema as linkTasksInputSchema,
  sokoBotListTasksInputSchema as listTasksInputSchema,
  sokoBotMemoryUpdateInputSchema as memoryUpdateInputSchema,
  parseSokoBotMemory,
  sokoBotProvideJobInputSchema as provideJobInputSchema,
  redactSokoBotSensitiveText,
  renderSokoBotMemory,
  sokoBotReplyToTaskInputSchema as replyToTaskInputSchema,
  SOKO_BOT_CAPABILITIES,
  SOKO_BOT_SANDBOX_CAPABILITIES,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
  type SokoBotDecisionTarget,
  type SokoBotTurnGrantClaims,
  sanitizeSokoBotMemoryMarkdown,
  sokoBotScheduleIdInputSchema as scheduleIdInputSchema,
  sokoBotSearchInputSchema as searchInputSchema,
  sokoBotAskCoworkerInputSchema,
  sokoBotDraftEmailInputSchema,
  sokoBotEvaluateWithJevInputSchema,
  sokoBotInstallSkillInputSchema,
  sokoBotListCalendarEventsInputSchema,
  sokoBotListFilesInputSchema,
  sokoBotListIntegrationToolsInputSchema,
  sokoBotListSkillsInputSchema,
  sokoBotManageReminderInputSchema,
  sokoBotMoveFileInputSchema,
  sokoBotOpenDirectChatInputSchema,
  sokoBotPostChatInputSchema,
  sokoBotPreviewResultInputSchema,
  sokoBotReadChatInputSchema,
  sokoBotReadEmailInputSchema,
  sokoBotReadFileInputSchema,
  sokoBotRemoveSkillInputSchema,
  sokoBotRunIntegrationToolInputSchema,
  sokoBotSaveEmailAttachmentInputSchema,
  sokoBotSearchInboxInputSchema,
  sokoBotSendEmailDraftInputSchema,
  sokoBotStartBackgroundRunInputSchema,
  sokoBotUpdateEmailsInputSchema,
  sokoBotUploadFileInputSchema,
  sokoBotArchiveTaskInputSchema as taskArchiveInputSchema,
  sokoBotAssignTaskInputSchema as taskAssignInputSchema,
  sokoBotCreateTaskInputSchema as taskCreateInputSchema,
  sokoBotTaskIdInputSchema as taskIdInputSchema,
  sokoBotUpdateTaskInputSchema as taskUpdateInputSchema,
  sokoBotUpdateAssignedTaskInputSchema as updateAssignedTaskInputSchema,
  sokoBotUpdateScheduleInputSchema as updateScheduleInputSchema,
} from "@sokosumi/soko-bot";
import {
  buildOrganizationDriveFilePathname,
  buildOrganizationDriveFilePathnameWithFolder,
  buildTaskFilePathname,
  buildUserDriveFilePathname,
  buildUserDriveFilePathnameWithFolder,
  CHAT_ROOM_FILE_MAX_SIZE_BYTES,
  clampTaskFileName,
  createDataTableSchema,
  parseChatRoomFileUrl,
  resolveTaskFileContentType,
  resolveUserUploadContentType,
  socialPostMediaKindForMime,
  tableBatchSchema,
  tableMutationSchema,
  tableQuerySchema,
} from "@sokosumi/utils";
import { head, list, put } from "@vercel/blob";
import { HTTPException } from "hono/http-exception";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { DAY_MS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { buildTaskWriteAccessWhere } from "@/helpers/access-control";
import { getAgentApiBaseUrl, toMasumiAgent } from "@/helpers/agent";
import { RESULT_SNAPSHOTS_KEY } from "@/helpers/chat-result-metadata";
import {
  batchTableRows,
  createDataTable,
  listDataTables,
  mutateDataTable,
  queryTableRows,
  readTableOperation,
  requireDataTable,
  resolveTableActor,
  type TableOperationCompletion,
} from "@/helpers/data-table";
import { moveDriveFile } from "@/helpers/drive-file-move";
import { createAgentJobForUser } from "@/helpers/job";
import { digestJob } from "@/helpers/job-digest";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { jsonInput } from "@/helpers/prisma-json";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import { findResolvableSokoBotDecision } from "@/helpers/soko-bot-management";
import {
  loadSokoBotPersona,
  SOKO_BOT_OWNER_NAME_SELECT,
  sokoBotAuthorLabel,
  sokoBotTurnAudience,
  sokoBotTurnReaderOf,
} from "@/helpers/soko-bot-owner";
import { loadSokoBotTurnAuthContext } from "@/helpers/soko-bot-turn-auth-context";
import { sokoBotForTurnMember } from "@/helpers/soko-bot-turn-authority";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import { applyGuardedTaskStatusUpdate } from "@/helpers/task-event-charge";
import { mapTaskLinkRelationToWriteData } from "@/helpers/task-link";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import {
  buildSokoBotReaderJobWhere,
  buildSokoBotReaderTaskWhere,
  type SokoBotPacketAudience,
  type SokoBotTurnReader,
  sokoBotSharedScopeOf,
} from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { FileActor } from "@/lib/files/actor";
import {
  FILE_CHUNK_OVERLAP_CHARS,
  FILE_CHUNK_TARGET_CHARS,
  joinExtractedChunks,
} from "@/lib/files/extraction";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { imageModel, resolveImageSettings } from "@/lib/image-studio/catalog";
import { ensureImageCatalogFresh } from "@/lib/image-studio/fal-catalog-refresh";
import {
  creditsPerImage,
  IMAGE_ASPECT_RATIOS,
} from "@/lib/image-studio/image-model";
import { videoModel } from "@/lib/image-studio/video-catalog";
import {
  creditsPerVideo,
  DEFAULT_ANIMATE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  defaultVideoSettings,
  HIGH_QUALITY_ANIMATE_MODEL_ID,
  HIGH_QUALITY_VIDEO_MODEL_ID,
  type VideoModel,
  type VideoSettings,
  validateVideoSettings,
} from "@/lib/image-studio/video-model";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";
import {
  ACTION_CAPABILITIES,
  actionInputHash,
  actionOperationKey,
  canonicalActionJson,
  commitActionReceipt,
  EXTERNAL_EFFECT_CAPABILITIES,
  externalActionReceipt,
  verifyTaskArchiveReceipt,
} from "@/lib/soko-bot/action-receipts";
import {
  agentWordScore,
  listHireableAgents,
  MAX_RATED_AGENTS,
  MIN_AGENT_FIT,
  queryWords,
  rateAgentFit,
} from "@/lib/soko-bot/agent-search";
import {
  chatChainMayWake,
  MAX_CHAT_CHAIN_DEPTH,
  nextChatChainDepth,
  ROOM_BOT_MESSAGE_WINDOW_MS,
  ROOM_BOT_MESSAGES_PER_HOUR,
} from "@/lib/soko-bot/chat-chain";
import {
  isContactCapability,
  runContactTool,
} from "@/lib/soko-bot/contact-tools";
import {
  addressCoworkers,
  createOrGetCoworkerQuestionRoom,
} from "@/lib/soko-bot/coworker-question-room";
import {
  decisionProposalTargets,
  describeDecision,
  parseDecisionProposal,
  parseHireAgentInput,
} from "@/lib/soko-bot/decision-proposal";
import {
  ambiguousDirectChatTargetMessage,
  directChatMemberWhere,
  directChatNeedle,
  SHARED_SOKO_BOT_NO_DIRECTS,
} from "@/lib/soko-bot/direct-chat-target";
import {
  assertEvaluationActor,
  assertEvaluationTool,
} from "@/lib/soko-bot/evaluation-dispatch";
import { evaluateWithJevForBot } from "@/lib/soko-bot/jev-tool";
import {
  mailSendRefusal,
  ownerAskedToSend,
} from "@/lib/soko-bot/mail-send-guard";
import {
  persistedToolResult,
  sanitizePersistedValue,
  truncateUtf8,
} from "@/lib/soko-bot/persisted-value";
import {
  skillChangeRefusal,
  sokoBotDriveFolder,
} from "@/lib/soko-bot/self-config-guards";
import { readSokoBotSource } from "@/lib/soko-bot/source-query";
import { OWN_SCHEDULE_CAPABILITIES } from "@/lib/soko-bot/system-routes";
import { roundCredits, taskCreditsCharged } from "@/lib/soko-bot/task-charges";
import { unattendedChaseRefusal } from "@/lib/soko-bot/unattended-comment";
import { unattendedHireRefusal } from "@/lib/soko-bot/unattended-hire";
import {
  type SokoBotWriteTargets,
  sokoBotProjectRefusal,
  sokoBotWriteScopeRefusal,
} from "@/lib/soko-bot/write-scope";
import {
  BEARER_USER_SELECT,
  isActiveUser,
} from "@/middleware/auth-active-user";
import {
  resolveMentionedCoworkerIds,
  resolveMentionedSokoBotIds,
  validateChatCoworkerIds,
} from "@/routes/v1/chats/rooms/helpers";
import { chatResultSnapshotSchema } from "@/schemas/chat-result-preview.schema";
import { dataTableSchema } from "@/schemas/data-table.schema";
import { projectSocialConnectionSchema } from "@/schemas/project-social-connection.schema";
import { socialPostSchema } from "@/schemas/social-post.schema";
import {
  hydrateChatResultSnapshots,
  resolveChatResultReference,
} from "@/services/chat-result-preview.service";
import { adoptDriveStoreIfPending } from "@/services/file-backfill.service";
import {
  activateDriveUploadResource,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";
import { downloadBlob } from "@/services/file-index.service";
import {
  type LiveResource,
  loadLiveResources,
  searchFiles,
} from "@/services/file-search.service";
import { getJob } from "@/services/image-studio-assets.service";
import { ensureStudioAssetDriveFile } from "@/services/image-studio-drive.service";
import {
  createImageJob,
  createVideoJob,
  DEFAULT_SETTINGS,
  type ImageJobSettings,
  reconcileProjectJobs,
} from "@/services/image-studio-jobs.service";
import { listProjectSocialConnections } from "@/services/project-social-connections.service";
import {
  listSocialAccountStatistics,
  refreshSocialAccountStatistics,
} from "@/services/social-account-statistics.service";
import { publishSocialPostNow } from "@/services/social-post-publisher.service";
import {
  listSocialPostStatistics,
  refreshSocialPostStatistics,
} from "@/services/social-post-statistics.service";
import {
  cancelSocialPost,
  createSocialPost,
  getSocialPost,
  listSocialPosts,
  scheduleSocialPost,
  updateSocialPost,
} from "@/services/social-posts.service";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";
import { enqueueSokoBotEffect } from "@/services/soko-bot-effect-outbox.service";
import { claimTaskEventAction } from "@/services/soko-bot-event-action.service";
import { listSokoBotIntegrationsForBot } from "@/services/soko-bot-integration-list.service";
import {
  activeIntegrationsForBot,
  createInboxDraft,
  fetchCalendarEvents,
  fetchInboxAttachment,
  fetchInboxMessage,
  fetchInboxPage,
  INBOX_ATTACHMENT_MAX_BYTES,
  listIntegrationTools,
  modifyInboxMessages,
  runIntegrationTool,
  sendInboxDraft,
} from "@/services/soko-bot-integrations.service";
import { criteriaForConfirmedSokoBotAction } from "@/services/soko-bot-outcome.service";
import { manageSokoBotReminder } from "@/services/soko-bot-proactive.service";
import {
  createSokoBotSchedule,
  deleteSokoBotSchedule,
  listSokoBotSchedules,
  SokoBotScheduleNotFoundError,
  SokoBotScheduleValidationError,
  updateSokoBotSchedule,
} from "@/services/soko-bot-schedule.service";
import {
  installSkill,
  listInstalledSkills,
  removeInstalledSkill,
  SokoBotSkillError,
  searchSkillsSh,
} from "@/services/soko-bot-skills.service";
import { readSokoBotTaskOutcome } from "@/services/soko-bot-task-outcome.service";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";
import {
  createTaskForActor,
  updateTaskForActor,
} from "@/services/task-domain.service";

function toolAssigneeFields(
  coworkerId: string | null | undefined,
  sokoBotId: string,
  ownerUserId?: string | null,
): {
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
} {
  if (ownerUserId) {
    if (coworkerId)
      throw new SokoBotRuntimeValidationError(
        "Give coworkerId or assignToOwner, not both",
      );
    return {
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: ownerUserId,
    };
  }
  if (coworkerId == null) return {};
  if (coworkerId === sokoBotId) {
    return { assigneeId: null, assigneeSokoBotId: sokoBotId };
  }
  return { assigneeId: coworkerId, assigneeSokoBotId: null };
}

/** A shared bot works for nobody, so it has no owner to assign. */
function ownerAssignee(
  assignToOwner: true | undefined,
  actingUserId: string | null,
): string | null {
  if (!assignToOwner) return null;
  if (!actingUserId)
    throw new SokoBotRuntimeValidationError(
      "A shared assistant has no owner to assign; pick a Coworker",
    );
  return actingUserId;
}

const MAX_BOT_COMMENTS_PER_TASK_PER_DAY = 3;
/** The longest Task description or comment the tool schemas accept. */
const TASK_TEXT_MAX_CHARS = 20_000;

const ACTIVE_STATUSES = ["STARTING", "RUNNING", "CANCEL_REQUESTED"] as const;
const DECISION_TTL_MS = 24 * 60 * 60 * 1_000;
const TOOL_CALL_STALE_MS = 2 * 60 * 1_000;
const TOOL_CALLS_PER_FIFTEEN_MINUTES = 64;

/**
 * Changes a turn may make through Core's tools, in proportion to how long it
 * may run: a fixed 64 stopped a six-hour background run after eight minutes.
 * Reads get `READ_CALLS_PER_WRITE_CALL` times as many.
 */
export function sokoBotToolCallLimit(turn: {
  createdAt: Date;
  deadlineAt: Date;
}): number {
  const fifteenMinutes = 15 * 60 * 1_000;
  const duration = turn.deadlineAt.getTime() - turn.createdAt.getTime();
  return Math.max(
    TOOL_CALLS_PER_FIFTEEN_MINUTES,
    Math.round((duration / fifteenMinutes) * TOOL_CALLS_PER_FIFTEEN_MINUTES),
  );
}
/**
 * Core tools that only read. They get their own, larger budget: a script
 * paging three years of mail reads thousands of times, and a six-hour CRM run
 * hit the shared cap of 1,536 after 97 minutes. Anything else (a change, a
 * background run, a provider refresh) counts against the turn's limit; sandbox
 * tools are recorded but not counted.
 */
const CORE_READ_CAPABILITIES: readonly SokoBotCapability[] =
  SOKO_BOT_CAPABILITIES.filter(
    (capability) =>
      /^(get|list|read|search|find)_|^(refresh_context|preview_result|evaluate_with_jev)$/.test(
        capability,
      ) && !SOKO_BOT_SANDBOX_CAPABILITIES.some((tool) => tool === capability),
  );
const CORE_READ_CALLS = {
  capability: { in: [...CORE_READ_CAPABILITIES] },
} satisfies Prisma.SokoBotToolCallWhereInput;
const CORE_WRITE_CALLS = {
  capability: {
    notIn: [...SOKO_BOT_SANDBOX_CAPABILITIES, ...CORE_READ_CAPABILITIES],
  },
} satisfies Prisma.SokoBotToolCallWhereInput;
const READ_CALLS_PER_WRITE_CALL = 10;
/** Enough for "ask Nina and Tom", far short of an organization. */
const MAX_DIRECTS_OPENED_PER_TURN = 5;
/** A few Coworkers sounded out before committing work, not a survey. */
const MAX_COWORKER_QUESTIONS_PER_TURN = 3;
/** Enough for a few variations; each one spends the owner's credits. */
const MAX_IMAGES_PER_TURN = 4;
/** A video costs several images and takes minutes; two is a choice, not a batch. */
const MAX_VIDEOS_PER_TURN = 2;

type SocialMediaInput = NonNullable<
  z.infer<(typeof SOKO_BOT_TOOL_INPUT_SCHEMAS)["create_social_post"]>["media"]
>[number];
type SocialMediaRef = Exclude<SocialMediaInput, { fileId: string }>;
const ERROR_DETAIL_MAX_BYTES = 1_000;
const SELLER_RESERVATION_MARKER_VERSION = 1;

interface SellerReservationMarker {
  version: typeof SELLER_RESERVATION_MARKER_VERSION;
  attemptId: string;
  reservedAt: string;
  proposalHash: string;
  error?: string;
}

/**
 * The Task an event turn's batch is about, when there is only one: a follow-up
 * created on that turn belongs to it. With several, the model has to say which.
 */
async function onlyEventTask(
  tx: Prisma.TransactionClient,
  turn: { id: string; sokoBotId: string },
): Promise<string> {
  const entries = await tx.sokoBotEventInbox.findMany({
    where: { turnId: turn.id, botId: turn.sokoBotId },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  const [only] = entries;
  if (entries.length === 1 && only) return only.entityId;
  throw new SokoBotRuntimeValidationError(
    entries.length
      ? `Set triggeringTaskId to the event's Task this follows up: one of ${entries.map((entry) => entry.entityId).join(", ")}.`
      : "This event turn has no Task to follow up, so it cannot create one.",
  );
}

function isTextMimeType(mimeType: string | null): boolean {
  return (
    !!mimeType &&
    (mimeType.startsWith("text/") || mimeType === "application/json")
  );
}

/** Drive text small enough to read whole. */
const MAX_DIRECT_READ_BYTES = 200_000;
const DIRECT_READ_ATTEMPTS = 4;
const DIRECT_READ_RETRY_MS = 5_000;

/**
 * A Drive text file's content, read from the blob itself, for a file search
 * has not indexed yet; null for anything else or when it cannot be read.
 */
async function readDriveText(file: LiveResource): Promise<string | null> {
  if (
    file.sourceKind !== "DRIVE_UPLOAD" ||
    !isTextMimeType(file.mimeType) ||
    (file.sizeBytes ?? Number.POSITIVE_INFINITY) > MAX_DIRECT_READ_BYTES
  )
    return null;
  // A pathname written again after a delete answers 404 for up to ~15s.
  for (let attempt = 1; ; attempt++) {
    try {
      const bytes = await downloadBlob(file.sourceId);
      return bytes ? new TextDecoder().decode(bytes) : null;
    } catch {
      if (attempt >= DIRECT_READ_ATTEMPTS) return null;
      await new Promise((resolve) => setTimeout(resolve, DIRECT_READ_RETRY_MS));
    }
  }
}

export interface RuntimeAuthorizationInput {
  sessionId: string;
  turnId: string;
  capability?: SokoBotCapability;
}

export interface SokoBotActionContext {
  confirmationTurnId?: string;
  turn: {
    id: string;
    sokoBotId: string;
    /** Who the turn acts for; see `sokoBotActingUserId`. */
    actingUserId: string | null;
    /** The member who asked (ADR 0057); null when the bot started on its own. */
    requestedByUserId: string | null;
    workspaceId: string;
    eveSessionId: string | null;
    // Required, not optional: both were silently dropped from authorize()'s
    // return once, which made every turn resolve the default version and
    // disabled the DRAFT-only rule for self-started work.
    versionId: string | null;
    source: string | null;
    /** Bot-to-bot hops behind this turn; see lib/soko-bot/chat-chain.ts. */
    chainDepth: number;
    intentId?: string | null;
    intentRevision?: number | null;
  };
  classificationConfidence: number;
}

export interface AuthorizedSokoBotRuntime extends SokoBotActionContext {
  grant: SokoBotTurnGrantClaims;
  toolCallLimit: number;
  askedByKind?: SokoBotPacketAudience;
  reader: SokoBotTurnReader;
}

export interface ExecuteSokoBotToolInput extends RuntimeAuthorizationInput {
  capability: SokoBotCapability;
  toolCallId: string;
  input: unknown;
}

/** Fields that name a Task by id in tool input. */
const TASK_ID_FIELDS = ["taskId", "peerTaskId"] as const;
const TASK_ID_PREFIX = 23;

export class SokoBotRuntimeAuthorizationError extends Error {}
export class SokoBotRuntimeConflictError extends Error {}
export class SokoBotRuntimeValidationError extends Error {}
/**
 * An outside-effect tool refused before it touched anything, so nothing
 * happened: the attempt is rejected, not of unknown outcome.
 */
export class SokoBotRefusedUnsentError extends SokoBotRuntimeValidationError {}
/** The studio refused an image before sending it: nothing happened. */
export class SokoBotImageRefusedError extends SokoBotRefusedUnsentError {}

/**
 * The member a tool runs as. A shared Soko Bot acting on its own acts for
 * nobody (ADR 0057), so a tool that needs a person refuses before it starts.
 */
function actingMemberOf(authorized: {
  turn: { actingUserId: string | null };
}): string {
  const { actingUserId } = authorized.turn;
  if (actingUserId === null)
    throw new SokoBotRefusedUnsentError(
      "This action runs as a member, and nobody asked for this turn. Say what you would do in your chat; a member's request starts a turn that can do it.",
    );
  return actingUserId;
}

/** A Drive folder a tool may write into, normalized; "" is the top level. */
function driveFolderFor(folder: string | undefined): string {
  const result = sokoBotDriveFolder(folder);
  if ("refusal" in result) throw new SokoBotRefusedUnsentError(result.refusal);
  return result.folder;
}

/** The member a skill change runs as, once the owner asked for it in chat. */
function requireOwnerSkillRequest(
  authorized: AuthorizedSokoBotRuntime,
): string {
  const refusal = skillChangeRefusal({
    source: authorized.turn.source,
    chainDepth: authorized.turn.chainDepth,
    askedByAssistant: authorized.askedByKind === "ASSISTANT",
    shared: Boolean(authorized.reader.sharedScope),
  });
  if (refusal) throw new SokoBotRefusedUnsentError(refusal);
  return actingMemberOf(authorized);
}

/** Who an action's operation key belongs to: the member, or the bot acting on its own. */
function actionPrincipalId(turn: {
  actingUserId: string | null;
  sokoBotId: string;
}): string {
  return turn.actingUserId ?? `soko_bot:${turn.sokoBotId}`;
}

/** Schedule tools never need approval; their domain errors become tool errors the model can read. */
async function runScheduleTool<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SokoBotScheduleNotFoundError ||
      error instanceof SokoBotScheduleValidationError
    ) {
      throw new SokoBotRuntimeValidationError(error.message);
    }
    throw error;
  }
}

/**
 * A schedule run gets update/delete for its own schedule even when the turn
 * that wrote the schedule had no schedule tools (an owner-made one). Those
 * extra tools reach that schedule only.
 */
async function requireOwnScheduleScope(
  tx: Prisma.TransactionClient,
  turnId: string,
  capability: SokoBotCapability,
  rawInput: unknown,
) {
  if (
    !(OWN_SCHEDULE_CAPABILITIES as readonly SokoBotCapability[]).includes(
      capability,
    )
  )
    return;
  const run = await tx.sokoBotScheduleRun.findUnique({
    where: { turnId },
    select: {
      schedule: { select: { id: true, name: true, capabilityNames: true } },
    },
  });
  if (!run || run.schedule.capabilityNames.includes(capability)) return;
  const ref = (
    capability === "update_schedule"
      ? updateScheduleInputSchema
      : scheduleIdInputSchema
  ).safeParse(rawInput);
  const own =
    ref.success &&
    (ref.data.scheduleId
      ? ref.data.scheduleId === run.schedule.id
      : ref.data.scheduleName?.trim().toLowerCase() ===
        run.schedule.name.trim().toLowerCase());
  if (!own)
    throw new SokoBotRuntimeValidationError(
      `This run may only change its own schedule "${run.schedule.name}" (${run.schedule.id})`,
    );
}

function sellerProposalHash(
  toolName: "hire_agent" | "provide_job_input",
  proposal: unknown,
): string {
  return createHash("sha256")
    .update(`${toolName}:${canonicalActionJson(proposal)}`)
    .digest("hex");
}

function createSellerReservationMarker(
  toolName: "hire_agent" | "provide_job_input",
  proposal: unknown,
): SellerReservationMarker {
  return {
    version: SELLER_RESERVATION_MARKER_VERSION,
    attemptId: randomUUID(),
    reservedAt: new Date().toISOString(),
    proposalHash: sellerProposalHash(toolName, proposal),
  };
}

function serializeSellerReservationMarker(
  marker: SellerReservationMarker,
  error?: unknown,
): string {
  return JSON.stringify({
    ...marker,
    ...(error === undefined ? {} : { error: persistedErrorDetail(error) }),
  });
}

function persistedErrorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Unknown error";
  return truncateUtf8(
    redactSokoBotSensitiveText(detail),
    ERROR_DETAIL_MAX_BYTES,
  );
}

function hashMemory(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

/**
 * The runtime executes inside Core, so a turn's scope is read from the row the
 * control plane wrote rather than from a signed grant carried across a network
 * hop. The claims shape is unchanged: capability scoping, the context snapshot
 * a turn is pinned to, and the memory version it was handed all still gate what
 * a tool call may do.
 */
function buildTurnGrant(
  turn: {
    id: string;
    sokoBotId: string;
    workspaceId: string;
    capabilityNames: string[];
    contextSnapshot: { id: string; packet: Prisma.JsonValue } | null;
    requestedByUserId: string | null;
    sokoBot: { userId: string | null };
  },
  sessionId: string,
): SokoBotTurnGrantClaims {
  if (!turn.contextSnapshot) {
    throw new SokoBotRuntimeAuthorizationError(
      "Context snapshot is unavailable",
    );
  }
  const packet = turn.contextSnapshot.packet;
  const memory =
    packet && typeof packet === "object" && !Array.isArray(packet)
      ? (packet as Record<string, unknown>).memory
      : null;
  const memoryVersion =
    memory && typeof memory === "object" && !Array.isArray(memory)
      ? (memory as Record<string, unknown>).version
      : null;
  return {
    issuer: "sokosumi-core",
    audience: "soko-bot-core",
    subject: turn.sokoBotId,
    jwtId: `in-process:${turn.id}`,
    sessionId,
    turnId: turn.id,
    sokoBotId: turn.sokoBotId,
    userId: sokoBotActingUserId(turn),
    workspaceId: turn.workspaceId,
    contextSnapshotId: turn.contextSnapshot.id,
    memoryRevisionId: null,
    memoryVersion: typeof memoryVersion === "number" ? memoryVersion : 0,
    capabilities: turn.capabilityNames.filter(isSokoBotCapability),
    issuedAt: 0,
    expiresAt: 0,
  };
}

async function requireSokoBotWorkspaceAccess(
  client: Pick<Prisma.TransactionClient, "workspace">,
  userId: string | null,
  workspaceId: string,
) {
  const workspace = await client.workspace.findFirst({
    where: sokoBotWorkspaceAccessWhere(userId, workspaceId),
    select: { id: true, organizationId: true },
  });
  if (!workspace) {
    throw new SokoBotRuntimeAuthorizationError(
      "Workspace access is no longer available",
    );
  }
  return workspace;
}

export function isSokoBotDecisionTargetAllowed(
  toolName: string,
  capabilities: readonly string[],
): boolean {
  return (
    isSokoBotDecisionTarget(toolName) &&
    isSokoBotCapability(toolName) &&
    capabilities.includes(toolName)
  );
}

/** Where the owner sees a Project's images, or one version of them. */
function studioLink(projectId: string, assetId?: string | null): string {
  const base = `/studio?projectId=${encodeURIComponent(projectId)}`;
  return assetId ? `${base}&v=${encodeURIComponent(assetId)}` : base;
}

/** Near misses shown when no Agent fits, so "none fits" still informs. */
const CLOSEST_AGENTS = 3;

/** Hireable Agents best suited to `query`, with prices and a fit rating. */
async function findHireableAgents(query: string | undefined) {
  const { agents: rows } = await listHireableAgents(500);
  const words = query ? queryWords(query) : [];
  const matched = rows
    .map((row) => ({ row, score: agentWordScore(words, row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);
  // Word hits first, then the most used Agents, so a request phrased in
  // other words than a listing still gets rated.
  const candidates = query
    ? [...new Set([...matched, ...rows])].slice(0, MAX_RATED_AGENTS)
    : rows.slice(0, 20);
  const ratings = query ? await rateAgentFit(query, candidates) : null;
  // Without Jev nothing was judged, so nothing may be called a non-fit: the
  // word matches, or else the most used Agents, go back unrated.
  const results = ratings
    ? candidates
        .filter((row) => (ratings.get(row.id) ?? 0) >= MIN_AGENT_FIT)
        .sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0))
    : (matched.length ? matched : candidates).slice(0, 10);
  const describe = (row: (typeof rows)[number]) => ({
    id: row.id,
    name: row.name,
    summary: (row.summary ?? row.description)?.slice(0, 300) ?? null,
    capability: row.capabilityName,
    paymentType: row.paymentType,
    riskClassification: row.riskClassification,
    price: row.price,
    fit: ratings?.has(row.id)
      ? Math.round((ratings.get(row.id) ?? 0) * 100) / 100
      : null,
  });
  if (!ratings || !query || results.length > 0)
    return { agents: results.map(describe), availableAgents: rows.length };
  // Nothing fits: the nearest listings let the bot say what the marketplace
  // does offer, and what it would cost, without passing them off as a fit.
  const closest = [...candidates]
    .sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0))
    .slice(0, CLOSEST_AGENTS);
  return {
    agents: [],
    closest: closest.map(describe),
    availableAgents: rows.length,
    note: `No available Agent fits "${query}" among the ${rows.length} listed. Tell the owner that none fits rather than hiring one that does something else. \`closest\` are the nearest listings: they do related work, not this; name them only as that, and offer another way to get it done, such as doing it yourself or a Task for a Coworker.`,
  };
}

export class SokoBotRuntimeService {
  async authorize(
    input: RuntimeAuthorizationInput,
  ): Promise<AuthorizedSokoBotRuntime> {
    const env = getEnv();
    if (!env.SOKO_BOT_ENABLED) {
      throw new SokoBotRuntimeAuthorizationError("Soko Bot is not enabled");
    }
    // Re-checked on every tool call, so a turn already running when an
    // administrator threw the switch stops at its next action instead of
    // finishing its work.
    if ((await getSokoBotAvailability()).disabled) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot is temporarily disabled by an administrator",
      );
    }
    const turn = await prisma.sokoBotTurn.findUnique({
      where: { id: input.turnId },
      select: {
        id: true,
        sokoBotId: true,
        requestedByUserId: true,
        workspaceId: true,
        eveSessionId: true,
        status: true,
        classification: true,
        userMessage: true,
        versionId: true,
        source: true,
        chainDepth: true,
        intentId: true,
        intentRevision: true,
        createdAt: true,
        deadlineAt: true,
        leaseExpiresAt: true,
        capabilityNames: true,
        contextSnapshot: { select: { id: true, packet: true } },
        sokoBot: {
          select: {
            userId: true,
            adminPausedAt: true,
            archivedAt: true,
            status: true,
            workspaceId: true,
            projectId: true,
          },
        },
      },
    });
    if (!turn || turn.sokoBot.archivedAt) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot turn is unavailable",
      );
    }
    if (
      !ACTIVE_STATUSES.includes(turn.status as (typeof ACTIVE_STATUSES)[number])
    ) {
      throw new SokoBotRuntimeAuthorizationError("Soko Bot turn is not active");
    }
    if (turn.status === "CANCEL_REQUESTED") {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot turn cancellation is pending",
      );
    }
    if (turn.sokoBot.status === "PAUSED" || turn.sokoBot.adminPausedAt) {
      throw new SokoBotRuntimeAuthorizationError("Soko Bot is paused");
    }
    const now = Date.now();
    if (
      turn.deadlineAt.getTime() <= now ||
      !turn.leaseExpiresAt ||
      turn.leaseExpiresAt.getTime() <= now
    ) {
      throw new SokoBotRuntimeAuthorizationError("Soko Bot turn lease expired");
    }
    const actingUserId = sokoBotActingUserId(turn);
    const grant = buildTurnGrant(turn, input.sessionId);
    if (input.capability && !grant.capabilities.includes(input.capability)) {
      throw new SokoBotRuntimeAuthorizationError(
        "Capability is not granted for this turn",
      );
    }
    let storedSessionId = turn.eveSessionId;
    if (storedSessionId === null) {
      storedSessionId = await serializableTransaction(async (tx) => {
        // Same bot-row-first order as administrator PAUSE. Session attachment
        // either commits before PAUSE or reloads its paused state and fails.
        await tx.$queryRaw`
          SELECT "id"
          FROM "soko_bot"
          WHERE "id" = ${turn.sokoBotId}::uuid
          FOR UPDATE
        `;
        await tx.$queryRaw`
          SELECT "id"
          FROM "soko_bot_turn"
          WHERE "id" = ${turn.id}::uuid
          FOR UPDATE
        `;
        const attachedAt = new Date();
        const attachable = await tx.sokoBotTurn.findFirst({
          where: {
            id: turn.id,
            sokoBotId: turn.sokoBotId,
            requestedByUserId: turn.requestedByUserId,
            workspaceId: turn.workspaceId,
            OR: [{ eveSessionId: null }, { eveSessionId: input.sessionId }],
            status: { in: ["STARTING", "RUNNING"] },
            deadlineAt: { gt: attachedAt },
            leaseExpiresAt: { gt: attachedAt },
            sokoBot: {
              adminPausedAt: null,
              archivedAt: null,
              status: { not: "PAUSED" },
            },
          },
          select: { eveSessionId: true, id: true, source: true },
        });
        if (!attachable) {
          throw new SokoBotRuntimeAuthorizationError(
            "Soko Bot turn is no longer eligible for session attachment",
          );
        }
        if (
          attachable.eveSessionId !== null &&
          attachable.eveSessionId !== input.sessionId
        ) {
          throw new SokoBotRuntimeAuthorizationError(
            "Soko Bot turn session attachment became stale",
          );
        }
        await requireSokoBotWorkspaceAccess(tx, actingUserId, turn.workspaceId);
        if (attachable.eveSessionId === null) {
          const boundTurn = await tx.sokoBotTurn.updateMany({
            where: {
              id: turn.id,
              eveSessionId: null,
              status: { in: ["STARTING", "RUNNING"] },
              deadlineAt: { gt: attachedAt },
              leaseExpiresAt: { gt: attachedAt },
              sokoBot: {
                adminPausedAt: null,
                archivedAt: null,
                status: { not: "PAUSED" },
              },
            },
            data: { eveSessionId: input.sessionId },
          });
          if (boundTurn.count !== 1) {
            throw new SokoBotRuntimeAuthorizationError(
              "Soko Bot turn session attachment became stale",
            );
          }
        }
        const runnable = await sokoBotForTurnMember(
          {
            sokoBotId: turn.sokoBotId,
            workspaceId: turn.workspaceId,
            actingUserId,
          },
          "runningNotAdminPaused",
          tx,
        );
        // The bot retains the prior completed turn's session for diagnostics.
        // Bot + turn locks and the attachable active-turn check above provide
        // the single-flight fence, so the new turn safely replaces that id.
        const boundBot = runnable
          ? await tx.sokoBot.updateMany({
              where: { id: runnable.id },
              data: { eveSessionId: input.sessionId },
            })
          : null;
        if (boundBot?.count !== 1) {
          throw new SokoBotRuntimeAuthorizationError(
            "Soko Bot runtime session attachment became stale",
          );
        }
        return input.sessionId;
      }, "Soko Bot session attachment collided with administrator control");
    } else {
      await requireSokoBotWorkspaceAccess(
        prisma,
        actingUserId,
        turn.workspaceId,
      );
    }
    if (storedSessionId !== input.sessionId) {
      throw new SokoBotRuntimeAuthorizationError("Runtime session mismatch");
    }

    return {
      grant,
      toolCallLimit: sokoBotToolCallLimit(turn),
      askedByKind: sokoBotTurnAudience(turn),
      reader: sokoBotTurnReaderOf(turn),
      turn: {
        id: turn.id,
        sokoBotId: turn.sokoBotId,
        actingUserId,
        requestedByUserId: turn.requestedByUserId,
        workspaceId: turn.workspaceId,
        eveSessionId: storedSessionId,
        versionId: turn.versionId,
        source: turn.source,
        chainDepth: turn.chainDepth,
        intentId: turn.intentId,
        intentRevision: turn.intentRevision,
      },
      classificationConfidence:
        typeof turn.classification === "object" &&
        turn.classification !== null &&
        "confidence" in turn.classification &&
        typeof turn.classification.confidence === "number"
          ? turn.classification.confidence
          : 1,
    };
  }

  /** Owner-installed skills, advertised by Eve as load-on-demand skills. */
  async getInstalledSkills(input: RuntimeAuthorizationInput) {
    const authorized = await this.authorize(input);
    const skills = await prisma.sokoBotInstalledSkill.findMany({
      where: { sokoBotId: authorized.turn.sokoBotId },
      orderBy: { createdAt: "asc" },
      select: { name: true, description: true, markdown: true },
    });
    return { skills };
  }

  async getContext(input: RuntimeAuthorizationInput) {
    const authorized = await this.authorize(input);
    const snapshot = await prisma.sokoBotContextSnapshot.findFirst({
      where: {
        id: authorized.grant.contextSnapshotId,
        turnId: authorized.turn.id,
      },
      select: {
        packet: true,
        hash: true,
        schemaVersion: true,
        generatedAt: true,
      },
    });
    if (!snapshot) {
      throw new SokoBotRuntimeAuthorizationError(
        "Context snapshot is unavailable",
      );
    }
    const version = await resolveSokoBotVersion(authorized.turn.versionId);
    const persona = await loadSokoBotPersona(authorized.turn.sokoBotId);
    return {
      ...snapshot,
      version: {
        id: version.id,
        name: version.name,
        model: version.model,
        systemPrompt: composeSystemPrompt(version, persona),
        skills: [...version.skills],
      },
    };
  }

  /**
   * Nothing waits for an owner: the proposal is recorded as a decision the
   * owner's policy accepts on the spot, then executed through the same
   * fenced, idempotent path an accepted approval uses.
   */
  private async executeAsAccepted(
    authorized: AuthorizedSokoBotRuntime,
    toolName: SokoBotDecisionTarget,
    proposal: unknown,
    toolCallId: string,
  ) {
    const decision = await this.createDecision(
      authorized,
      toolName,
      proposal,
      toolCallId,
    );
    const resolved = await this.resolveDecision(
      authorized.turn.actingUserId,
      decision.id,
      true,
      false,
    ).catch(async (error: unknown) => {
      // Nobody will answer a card, so one that failed must not linger as
      // "approval waiting" or be picked up by a later "yes".
      await this.expireDecision(decision.id);
      throw error;
    });
    return {
      executed: resolved.status === "ACCEPTED",
      decisionId: resolved.id,
      status: resolved.status,
      resultingEntityId: resolved.resultingEntityId,
    };
  }

  private async expireDecision(decisionId: string) {
    const expired = await prisma.sokoBotPendingDecision.updateMany({
      where: { id: decisionId, status: "PENDING" },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    });
    if (expired.count === 0) return;
    await prisma.sokoBotIntent.updateMany({
      where: {
        decisions: { some: { id: decisionId } },
        state: "AWAITING_CONFIRMATION",
      },
      data: { state: "CANCELLED", revision: { increment: 1 } },
    });
  }

  /** Everything a project manager needs to act on a Task without opening it. */
  /**
   * Rooms the bot itself belongs to. Membership is the whole authorization
   * boundary here: the bot is a Soko Bot in chat, so it sees exactly the
   * rooms a person added it to and nothing else in the workspace.
   */
  private async listChats(authorized: AuthorizedSokoBotRuntime) {
    const sokoBotId = authorized.turn.sokoBotId;
    const scope = await this.chatRoomScope(authorized, sokoBotId);
    const rooms = await prisma.chatRoom.findMany({
      where: scope,
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        groupName: true,
        kind: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    return {
      rooms: rooms.map((room) => ({
        roomId: room.id,
        name: room.groupName ?? room.name,
        kind: room.kind,
        messages: room._count.messages,
        lastActivityAt: room.updatedAt.toISOString(),
      })),
      ...(authorized.askedByKind === "OWNER"
        ? { ownerUnread: await this.ownerUnreadRooms(authorized, scope) }
        : {}),
    };
  }

  /**
   * The owner's unread chats as their sidebar counts them: every room the
   * owner is in within this workspace, the bot's own or not. Names and counts
   * only; reading a room still needs the bot's own membership.
   */
  private async ownerUnreadRooms(
    authorized: AuthorizedSokoBotRuntime,
    scope: Prisma.ChatRoomWhereInput,
  ) {
    const ownerId = authorized.turn.actingUserId;
    // A turn that acts for nobody has no owner whose unread chats to count.
    if (ownerId === null) return [];
    const rooms = await prisma.chatRoom.findMany({
      where: {
        archivedAt: null,
        organizationId: scope.organizationId,
        userMembers: { some: { userId: ownerId } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        groupName: true,
        kind: true,
        sokoBotMembers: {
          where: { sokoBotId: authorized.turn.sokoBotId },
          take: 1,
          select: { sokoBotId: true },
        },
        userMembers: {
          where: { userId: ownerId },
          take: 1,
          select: { mutedAt: true },
        },
      },
    });
    const { getChatRoomUnreadCounts } = await import(
      "@/routes/v1/chats/rooms/room-unread"
    );
    const unread = await getChatRoomUnreadCounts(
      rooms.map((room) => room.id),
      ownerId,
      prisma,
    );
    return rooms.flatMap((room) => {
      const count = unread.get(room.id)?.total ?? 0;
      if (count === 0) return [];
      return [
        {
          roomId: room.id,
          name: room.groupName ?? room.name,
          kind: room.kind,
          unread: count,
          youAreMember: room.sokoBotMembers.length > 0,
          ...(room.userMembers[0]?.mutedAt ? { muted: true } : {}),
        },
      ];
    });
  }

  /**
   * Rooms the bot may touch: its own Soko Bot memberships, bounded to the
   * workspace the turn runs in. Membership alone is not enough — a bot could
   * in principle be added to a room in another organization, and a turn must
   * never reach outside its own workspace.
   */
  private async chatRoomScope(
    authorized: AuthorizedSokoBotRuntime,
    sokoBotId: string,
    client: Prisma.TransactionClient = prisma,
  ): Promise<Prisma.ChatRoomWhereInput> {
    const workspace = await client.workspace.findUnique({
      where: { id: authorized.turn.workspaceId },
      select: { organizationId: true },
    });
    return {
      archivedAt: null,
      sokoBotMembers: { some: { sokoBotId: sokoBotId } },
      organizationId: workspace?.organizationId ?? null,
    };
  }

  /**
   * The single authorization boundary for chat: the bot may only touch rooms
   * it belongs to as a Soko Bot, in its own workspace. Re-checked on every
   * call because the room id comes from the model, so removal takes effect at
   * once.
   */
  private async requireChatMembership(
    authorized: AuthorizedSokoBotRuntime,
    roomId: string,
    client: Prisma.TransactionClient = prisma,
  ): Promise<{
    id: string;
    name: string;
    kind: string;
    sokoBotId: string;
    organizationId: string | null;
    authorName: string;
  }> {
    const sokoBotId = authorized.turn.sokoBotId;
    const room = await client.chatRoom.findFirst({
      where: {
        ...(await this.chatRoomScope(authorized, sokoBotId, client)),
        id: roomId,
      },
      select: {
        id: true,
        name: true,
        groupName: true,
        kind: true,
        organizationId: true,
        sokoBotMembers: {
          where: { sokoBotId: sokoBotId },
          take: 1,
          select: {
            sokoBot: {
              select: { name: true, user: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!room) {
      throw new SokoBotRuntimeValidationError(
        "You are not a member of that chat room",
      );
    }
    const bot = room.sokoBotMembers?.[0]?.sokoBot;
    return {
      id: room.id,
      name: room.groupName ?? room.name,
      kind: room.kind,
      sokoBotId,
      organizationId: room.organizationId ?? null,
      authorName: bot
        ? sokoBotDisplayName(bot)
        : sokoBotDisplayName({ name: null }),
    };
  }

  /**
   * Opens (or returns) the bot's direct room with one person in its owner's
   * organization, so it can reach a colleague it does not already share a room
   * with. Nobody can leave or archive a direct room — its participant set is
   * its identity — so an unwanted one is permanent, which is why opening one
   * is bounded rather than merely discouraged.
   *
   * Deliberately narrow. The target must be a member of the organization the
   * turn runs in — a bot must not be able to start a conversation with someone
   * outside the workspace it lives in — and it can never be another assistant:
   * a room with no person in it is one where a runaway is invisible.
   */
  private async openDirectChat(
    authorized: AuthorizedSokoBotRuntime,
    input: { person: string; message: string; toolCallId: string },
  ) {
    // Approaching somebody is the owner's call. A turn nobody asked for can
    // still say "I would ask Nina about this" in the owner's own chat and let
    // them decide, which costs nothing and embarrasses no one.
    if (authorized.turn.source !== "CHAT" || authorized.turn.chainDepth > 0) {
      throw new SokoBotRuntimeAuthorizationError(
        "Opening a chat with a colleague is for turns your owner asked for. Tell them who you would approach and why instead.",
      );
    }
    if (authorized.reader.sharedScope) {
      throw new SokoBotRuntimeValidationError(SHARED_SOKO_BOT_NO_DIRECTS);
    }
    // A turn may make 64 tool calls or more, so without a bound one instruction could
    // put the bot in front of every member of the organization at once.
    const opened = await prisma.sokoBotToolCall.count({
      where: {
        turnId: authorized.turn.id,
        capability: "open_direct_chat",
        NOT: { toolCallId: input.toolCallId },
      },
    });
    if (opened >= MAX_DIRECTS_OPENED_PER_TURN) {
      throw new SokoBotRuntimeValidationError(
        `One turn may open at most ${MAX_DIRECTS_OPENED_PER_TURN} direct chats. Tell the owner who else you would approach.`,
      );
    }
    const sokoBotId = authorized.turn.sokoBotId;
    const workspace = await prisma.workspace.findUnique({
      where: { id: authorized.turn.workspaceId },
      select: { organizationId: true },
    });
    const organizationId = workspace?.organizationId ?? null;
    if (!organizationId) {
      throw new SokoBotRuntimeValidationError(
        "Direct chats with colleagues need an organization workspace",
      );
    }
    // Resolved from a name or an email, not an opaque id: the packet carries
    // the owner and their coworkers, never the organization's roster, so a
    // tool that demanded a UUID could only ever be called with one that
    // happened to appear in the text — which is to say, almost never.
    const needle = directChatNeedle(input.person);
    // "@" on its own passes the schema and strips to nothing, which would
    // match a member whose display name is blank.
    if (!needle) {
      throw new SokoBotRuntimeValidationError(
        "Name the person to write to. Ask the owner who they mean.",
      );
    }
    const members = await prisma.member.findMany({
      where: directChatMemberWhere(organizationId, needle),
      select: { user: { select: { id: true, name: true, email: true } } },
      take: 5,
    });
    if (members.length === 0) {
      throw new SokoBotRuntimeAuthorizationError(
        `No member of this organization matches "${needle}". Ask the owner who they mean.`,
      );
    }
    if (members.length > 1) {
      throw new SokoBotRuntimeValidationError(
        ambiguousDirectChatTargetMessage(needle, members),
      );
    }
    const member = members[0]!;
    // The owner is reachable in their own direct room; opening a second one
    // would split the conversation in two. A teammate asking the bot to tell
    // its owner something posts there instead.
    if (member.user.id === authorized.turn.actingUserId) {
      const ownerRoom = await prisma.chatRoom.findFirst({
        where: {
          kind: "direct",
          archivedAt: null,
          sokoBotMembers: { some: { sokoBotId } },
          userMembers: { some: { userId: authorized.turn.actingUserId } },
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (!ownerRoom || authorized.askedByKind !== "TEAMMATE") {
        throw new SokoBotRuntimeValidationError(
          "You already have a direct chat with your owner",
        );
      }
      return this.postChat(authorized, {
        roomId: ownerRoom.id,
        content: input.message,
        toolCallId: input.toolCallId,
      });
    }
    const { createOrGetDirectRoom } = await import(
      "@/routes/v1/chats/rooms/helpers"
    );
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        false,
        "open_direct_chat",
      );
      const stillMember = await tx.member.findFirst({
        where: { organizationId, userId: member.user.id },
        select: { id: true },
      });
      if (!stillMember)
        throw new SokoBotRuntimeAuthorizationError(
          "The person is no longer a workspace member",
        );
      const { room, created } = await createOrGetDirectRoom({
        organizationId,
        currentUserId: member.user.id,
        memberUserIds: [],
        coworkerIds: [],
        sokoBotIds: [sokoBotId],
        sokoBotActorUserId: actingMemberOf(authorized),
        viewerUserId: null,
        transaction: tx,
      });
      return this.postChat(
        authorized,
        {
          roomId: room.id,
          content: input.message,
          toolCallId: input.toolCallId,
          via: {
            capability: "open_direct_chat",
            result: {
              name: room.name,
              created,
              withUserName: member.user.name,
            },
          },
        },
        tx,
      );
    }, "Opening the direct chat collided with another operation");
  }

  /**
   * Asks Coworkers something in a private channel of the owner, the bot and
   * them, before the bot commits work to them. The question is an ordinary
   * mention, so each Coworker answers in the room through the dispatch a
   * person's mention uses, and the bot reads the answer with `read_chat`.
   */
  private async askCoworker(
    authorized: AuthorizedSokoBotRuntime,
    input: { coworkerIds: string[]; question: string; toolCallId: string },
  ) {
    const ownerUserId = authorized.turn.actingUserId;
    // The owner is in the room and reads the answer; a teammate or another
    // assistant asking would put the owner's bot in a room they never see.
    if (
      authorized.turn.source !== "CHAT" ||
      authorized.turn.chainDepth > 0 ||
      authorized.askedByKind === "TEAMMATE" ||
      authorized.askedByKind === "ASSISTANT" ||
      !ownerUserId
    ) {
      throw new SokoBotRuntimeAuthorizationError(
        "Asking a Coworker is for your owner's own requests. Tell them who you would ask and what.",
      );
    }
    if (authorized.reader.sharedScope) {
      throw new SokoBotRuntimeValidationError(
        "A shared Soko Bot has no owner to ask Coworkers with. Create a DRAFT Task with the question instead.",
      );
    }
    const asked = await prisma.sokoBotToolCall.count({
      where: {
        turnId: authorized.turn.id,
        capability: "ask_coworker",
        NOT: { toolCallId: input.toolCallId },
      },
    });
    if (asked >= MAX_COWORKER_QUESTIONS_PER_TURN) {
      throw new SokoBotRuntimeValidationError(
        `One turn may ask Coworkers at most ${MAX_COWORKER_QUESTIONS_PER_TURN} times. Follow up in the rooms you opened with post_chat.`,
      );
    }
    const workspace = await prisma.workspace.findUnique({
      where: { id: authorized.turn.workspaceId },
      select: { organizationId: true },
    });
    const organizationId = workspace?.organizationId;
    if (!organizationId) {
      throw new SokoBotRuntimeValidationError(
        "Asking Coworkers in a group chat needs an organization workspace. Create a DRAFT Task with the question instead.",
      );
    }
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        false,
        "ask_coworker",
      );
      let coworkerIds: string[];
      try {
        coworkerIds = await validateChatCoworkerIds(
          input.coworkerIds,
          authorized.turn.workspaceId,
          tx,
        );
      } catch (error) {
        if (!(error instanceof HTTPException)) throw error;
        throw new SokoBotRuntimeValidationError(
          "Every Coworker you ask must be available here and able to chat; check the ids with find_coworkers. For one who cannot chat, put the question in a DRAFT Task.",
        );
      }
      const found = await tx.coworker.findMany({
        where: { id: { in: coworkerIds } },
        select: { id: true, name: true, slug: true },
      });
      const coworkers = coworkerIds.flatMap(
        (id) => found.find((coworker) => coworker.id === id) ?? [],
      );
      const room = await createOrGetCoworkerQuestionRoom(tx, {
        organizationId,
        ownerUserId,
        sokoBotId: authorized.turn.sokoBotId,
        coworkers,
      });
      return this.postChat(
        authorized,
        {
          roomId: room.id,
          content: addressCoworkers(
            input.question,
            coworkers,
            (coworker) =>
              resolveMentionedCoworkerIds({
                content: input.question,
                roomCoworkers: [coworker],
              }).length > 0,
          ),
          toolCallId: input.toolCallId,
          via: {
            capability: "ask_coworker",
            result: { name: room.name, created: room.created, coworkers },
          },
        },
        tx,
      );
    }, "Asking the Coworker collided with another operation");
  }

  /**
   * A direct room is permanent — nobody can leave or archive one — so being in
   * it must not become standing permission to write in it.
   *
   * `open_direct_chat` is deliberately limited to turns the owner asked for.
   * The room it leaves behind outlived that limit: every later schedule,
   * ingest or event turn found the room through `list_chats` and could reach
   * that colleague again with nobody having asked for it. One instruction to
   * write to Nina became a standing licence to keep writing to her.
   *
   * The owner's own direct is exempt, because briefing them there unprompted
   * is the entire point of a scheduled turn. Channels are exempt too: a person
   * can leave or mute one, and a bot added to a project room is expected to
   * speak in it.
   */
  private async requireUnattendedPostIsAllowed(
    authorized: AuthorizedSokoBotRuntime,
    room: { id: string; kind: string },
    client: Prisma.TransactionClient = prisma,
  ) {
    if (authorized.turn.source === "CHAT" || room.kind !== "direct") {
      return;
    }
    // A turn that acts for nobody has no owner in any direct room.
    const { actingUserId } = authorized.turn;
    const ownerIsMember =
      actingUserId !== null &&
      (await client.chatRoomUserMember.findFirst({
        where: { roomId: room.id, userId: actingUserId },
        select: { id: true },
      }));
    if (!ownerIsMember) {
      throw new SokoBotRuntimeAuthorizationError(
        "Writing to a colleague is for turns your owner asked for. Raise it in your owner's chat instead.",
      );
    }
  }

  /** Post into a room the bot belongs to, as the bot's Soko Bot identity. */
  private async postChat(
    authorized: AuthorizedSokoBotRuntime,
    input: {
      roomId: string;
      content: string;
      toolCallId: string;
      resultReferences?: ChatResultReference[];
      /** The tool that posted when it was not post_chat, and what it adds to the result. */
      via?: {
        capability: "open_direct_chat" | "ask_coworker";
        result: Record<string, unknown>;
      };
      publicationId?: string;
    },
    transaction?: Prisma.TransactionClient,
  ) {
    if (input.resultReferences?.length && authorized.askedByKind !== "OWNER") {
      throw new SokoBotRuntimeAuthorizationError(
        "Result previews are prepared for the owner's requests",
      );
    }
    const snapshots: Awaited<ReturnType<typeof resolveChatResultReference>>[] =
      [];
    for (const reference of input.resultReferences ?? []) {
      snapshots.push(
        await resolveChatResultReference({
          reference,
          actor: {
            userId: actingMemberOf(authorized),
            workspaceId: authorized.turn.workspaceId,
            kind: "soko_bot",
          },
        }),
      );
    }
    const persist = async (tx: Prisma.TransactionClient) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        false,
        input.via?.capability ?? "post_chat",
      );
      // A turn another assistant started may answer only where it was asked.
      // Unreachable while the bot-to-bot ceiling withholds `post_chat` — kept
      // because it is the guard that would matter the moment that ceiling is
      // widened again, and the failure it prevents is silent: text from the
      // requesting bot naming a room its own owner cannot see, and this bot
      // posting there on its behalf.
      if (authorized.turn.chainDepth > 0) {
        const origin = await tx.sokoBotTurn.findUnique({
          where: { id: authorized.turn.id },
          select: {
            chatMention: { select: { message: { select: { roomId: true } } } },
          },
        });
        const originRoomId = origin?.chatMention?.message.roomId;
        if (!originRoomId || originRoomId !== input.roomId) {
          throw new SokoBotRuntimeAuthorizationError(
            "You may only reply in the room you were asked in",
          );
        }
      }
      const room = await this.requireChatMembership(
        authorized,
        input.roomId,
        tx,
      );
      await this.requireUnattendedPostIsAllowed(authorized, room, tx);
      // Who this post summons. A bot may address another bot, but every hop is
      // counted: past the ceiling the message still posts and simply stops being
      // a summons, so an unattended exchange cannot run for ever.
      const chainDepth = nextChatChainDepth(authorized.turn.chainDepth);
      // Backstop the hop counter cannot provide: it reasons pairwise, so three
      // bots in a triangle could defeat it. This does not care who produced the
      // traffic, only how much of it a room has taken lately.
      const roomCoworkers = chatChainMayWake(chainDepth)
        ? await tx.chatRoomCoworkerMember.findMany({
            where: { roomId: room.id },
            select: {
              coworker: { select: { id: true, name: true, slug: true } },
            },
          })
        : [];
      const roomSokoBots = chatChainMayWake(chainDepth)
        ? await tx.chatRoomSokoBotMember.findMany({
            where: {
              roomId: room.id,
              sokoBotId: { not: room.sokoBotId },
            },
            select: {
              sokoBot: { select: { id: true, name: true } },
            },
          })
        : [];
      const mentionedCoworkerIds = resolveMentionedCoworkerIds({
        content: input.content,
        roomCoworkers: roomCoworkers.map(({ coworker }) => coworker),
      });
      const mentionedSokoBotIds = resolveMentionedSokoBotIds({
        content: input.content,
        roomSokoBots: roomSokoBots.map(({ sokoBot }) => ({
          id: sokoBot.id,
          name: sokoBotDisplayName({ name: sokoBot.name }),
        })),
      });
      // Queue unreadable content and inert mentions. The outbox activates both
      // only after rechecking the exact audience at the publication boundary.
      let replayedPublication = false;
      const message = await (async () => {
        if (input.publicationId) {
          const existing = await tx.chatRoomMessage.findFirst({
            where: {
              id: input.publicationId,
              roomId: room.id,
              senderSokoBotId: room.sokoBotId,
            },
            select: { id: true, createdAt: true },
          });
          if (existing) {
            replayedPublication = true;
            return existing;
          }
        }
        // Counted inside the transaction: read outside it, two bots posting at
        // once both see room for one more and the room takes both.
        const botMessagesThisHour = await tx.chatRoomMessage.count({
          where: {
            roomId: room.id,
            OR: [
              { senderCoworkerId: { not: null } },
              { senderSokoBotId: { not: null } },
            ],
            createdAt: {
              gte: new Date(Date.now() - ROOM_BOT_MESSAGE_WINDOW_MS),
            },
          },
        });
        if (botMessagesThisHour >= ROOM_BOT_MESSAGES_PER_HOUR) {
          throw new SokoBotRuntimeValidationError(
            `This room has taken ${botMessagesThisHour} assistant messages in the last hour and is rate limited. Say nothing further here for now.`,
          );
        }
        const created = await tx.chatRoomMessage.create({
          data: {
            roomId: room.id,
            ...(input.publicationId ? { id: input.publicationId } : {}),
            clientMessageId: `soko-bot-tool:${authorized.turn.id}:${input.toolCallId}`,
            senderSokoBotId: room.sokoBotId,
            content: "",
            deletedAt: new Date(),
            // Lets the reader see, on hover, that this is part of an assistant
            // exchange and how close it is to the point where it stops.
            metadata: {
              ...(snapshots.length
                ? { [RESULT_SNAPSHOTS_KEY]: sanitizePersistedValue(snapshots) }
                : {}),
              soko_bot_chain: {
                depth: chainDepth,
                max_depth: MAX_CHAT_CHAIN_DEPTH,
                room_messages_this_hour: botMessagesThisHour + 1,
                room_messages_per_hour: ROOM_BOT_MESSAGES_PER_HOUR,
              },
            },
          },
          select: { id: true, createdAt: true },
        });
        if (mentionedCoworkerIds.length > 0 || mentionedSokoBotIds.length > 0) {
          await tx.chatRoomMention.createMany({
            data: [
              ...mentionedCoworkerIds.map((coworkerId) => ({
                messageId: created.id,
                coworkerId,
                sokoBotId: null,
                chainDepth,
                status: "staged",
              })),
              ...mentionedSokoBotIds.map((sokoBotId) => ({
                messageId: created.id,
                coworkerId: null,
                sokoBotId: sokoBotId,
                chainDepth,
                status: "staged",
              })),
            ],
            skipDuplicates: true,
          });
        }
        await tx.chatRoom.update({
          where: { id: room.id },
          data: { updatedAt: new Date() },
        });
        return created;
      })();
      const result = {
        messageId: message.id,
        roomId: room.id,
        queuedAt: message.createdAt.toISOString(),
        queuedMentions:
          mentionedCoworkerIds.length + mentionedSokoBotIds.length,
        deliveryStatus: "QUEUED",
        ...input.via?.result,
      };
      const receipt = await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId: input.toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: message.id,
        effectEventId: message.id,
        result: persistedToolResult(result),
      });
      if (replayedPublication) return result;
      const audience = await tx.chatRoom.findUniqueOrThrow({
        where: { id: room.id },
        select: {
          userMembers: { select: { userId: true } },
          coworkerMembers: { select: { coworkerId: true } },
          sokoBotMembers: { select: { sokoBotId: true } },
        },
      });
      await enqueueSokoBotEffect(tx, {
        receiptId: receipt.id,
        purpose: "CHAT_MESSAGE",
        payload: {
          messageId: message.id,
          roomId: room.id,
          content: input.content,
          userIds: audience.userMembers.map((m) => m.userId).sort(),
          coworkerIds: audience.coworkerMembers.map((m) => m.coworkerId).sort(),
          botIds: audience.sokoBotMembers.map((m) => m.sokoBotId).sort(),
        },
      });
      return result;
    };
    return transaction
      ? persist(transaction)
      : serializableTransaction(
          persist,
          "Another assistant posted into this room at the same moment",
        );
  }

  /**
   * Everything that can refuse an image before anything is sent: an owner
   * chat turn, a Project the owner can open, and a price within maxCredits.
   * `executeTool` runs it before the external-effect reservation, so a
   * refusal is recorded as rejected rather than as an unknown outcome.
   */
  private async checkImageRequest(
    authorized: AuthorizedSokoBotRuntime,
    raw: unknown,
    toolCallId: string,
  ) {
    const input = generateImageInputSchema.parse(raw);
    if (
      authorized.turn.source !== "CHAT" ||
      authorized.turn.chainDepth > 0 ||
      authorized.askedByKind === "ASSISTANT"
    )
      throw new SokoBotRuntimeAuthorizationError(
        "Images are generated only when a person asks in chat. Describe the image you would make instead.",
      );
    const started = await prisma.sokoBotToolCall.count({
      where: {
        turnId: authorized.turn.id,
        capability: "generate_image",
        OR: [{ disposition: null }, { disposition: { not: "REJECTED" } }],
        NOT: { toolCallId },
      },
    });
    if (started >= MAX_IMAGES_PER_TURN)
      throw new SokoBotRuntimeValidationError(
        `One turn may start at most ${MAX_IMAGES_PER_TURN} images. Show your owner these first.`,
      );
    const aspectRatio = z
      .enum(IMAGE_ASPECT_RATIOS)
      .optional()
      .safeParse(input.aspectRatio);
    if (!aspectRatio.success)
      throw new SokoBotRuntimeValidationError(
        `Use one of these aspect ratios: ${IMAGE_ASPECT_RATIOS.join(", ")}.`,
      );
    this.requireImageProject(authorized, input.projectId);
    try {
      await requireProjectAccess({
        projectId: input.projectId,
        workspaceId: authorized.turn.workspaceId,
        userId: actingMemberOf(authorized),
      });
    } catch (error) {
      if (error instanceof HTTPException)
        throw new SokoBotRuntimeValidationError(
          "That Project is not one your owner can open.",
        );
      throw error;
    }
    await ensureImageCatalogFresh();
    const model = imageModel();
    const settings: ImageJobSettings = {
      ...DEFAULT_SETTINGS,
      ...(aspectRatio.data ? { aspectRatio: aspectRatio.data } : {}),
    };
    let credits: number;
    try {
      credits = creditsPerImage(
        model,
        resolveImageSettings(model.id, settings, 0),
      );
    } catch (error) {
      throw new SokoBotRuntimeValidationError(
        error instanceof Error ? error.message : "Invalid image settings",
      );
    }
    if (credits > input.maxCredits)
      throw new SokoBotRuntimeValidationError(
        `This image costs ${credits} credits, more than the ${input.maxCredits} allowed. Ask your owner before spending more.`,
      );
    return { input, model, settings, credits };
  }

  /** Starts an image in a Project's Content Studio, once checked. */
  private async generateImage(
    authorized: AuthorizedSokoBotRuntime,
    raw: unknown,
    toolCallId: string,
  ) {
    // Checked again here, after the reservation: a price or access change
    // since the preflight still refuses before anything is sent.
    const { input, model, settings, credits } = await this.checkImageRequest(
      authorized,
      raw,
      toolCallId,
    ).catch((error: unknown) => {
      throw new SokoBotImageRefusedError(
        error instanceof Error ? error.message : "Image refused",
      );
    });
    const studioUrl = studioLink(input.projectId);
    let job: Awaited<ReturnType<typeof createImageJob>>;
    try {
      job = await createImageJob({
        projectId: input.projectId,
        workspaceId: authorized.turn.workspaceId,
        userId: actingMemberOf(authorized),
        sessionId: null,
        prompt: input.prompt,
        modelId: model.id,
        settings,
        referenceAssetIds: [],
        parentAssetId: null,
        idempotencyKey: `soko-bot:${authorized.turn.id}:${toolCallId}`,
      });
    } catch (error) {
      // The studio's refusals (no balance, too many at once) come before it
      // sends anything, and are the model's to read.
      if (error instanceof HTTPException)
        throw new SokoBotImageRefusedError(error.message);
      throw error;
    }
    return {
      jobId: job.id,
      projectId: input.projectId,
      status: job.status,
      credits,
      studioUrl,
      note:
        job.status === "SUBMISSION_UNCERTAIN"
          ? "The provider did not confirm this request. Do not start it again; tell the owner."
          : "Started. An image takes about a minute; check it with get_image.",
    };
  }

  /**
   * Everything that can refuse a video before anything is sent, mirroring
   * {@link checkImageRequest}: an owner chat turn, a Project the owner can
   * open, a finished image to animate when one is named, and a price within
   * maxCredits.
   */
  private async checkVideoRequest(
    authorized: AuthorizedSokoBotRuntime,
    raw: unknown,
    toolCallId: string,
  ) {
    const input = generateVideoInputSchema.parse(raw);
    if (
      authorized.turn.source !== "CHAT" ||
      authorized.turn.chainDepth > 0 ||
      authorized.askedByKind === "ASSISTANT"
    )
      throw new SokoBotRuntimeAuthorizationError(
        "Videos are generated only when a person asks in chat. Describe the video you would make instead.",
      );
    const started = await prisma.sokoBotToolCall.count({
      where: {
        turnId: authorized.turn.id,
        capability: "generate_video",
        OR: [{ disposition: null }, { disposition: { not: "REJECTED" } }],
        NOT: { toolCallId },
      },
    });
    if (started >= MAX_VIDEOS_PER_TURN)
      throw new SokoBotRuntimeValidationError(
        `One turn may start at most ${MAX_VIDEOS_PER_TURN} videos. Show your owner these first.`,
      );
    this.requireImageProject(authorized, input.projectId);
    const scope = {
      projectId: input.projectId,
      workspaceId: authorized.turn.workspaceId,
      userId: actingMemberOf(authorized),
    };
    try {
      await requireProjectAccess(scope);
    } catch (error) {
      if (error instanceof HTTPException)
        throw new SokoBotRuntimeValidationError(
          "That Project is not one your owner can open.",
        );
      throw error;
    }

    let sourceAssetId: string | null = null;
    if (input.imageJobId) {
      const source = await getJob({ ...scope, jobId: input.imageJobId });
      if (!source || source.video !== null)
        throw new SokoBotRuntimeValidationError(
          "imageJobId must be a generate_image job in this Project.",
        );
      if (!source.assetId)
        throw new SokoBotRuntimeValidationError(
          "That image is not ready yet. Check it with get_image first.",
        );
      sourceAssetId = source.assetId;
    }

    await ensureImageCatalogFresh();
    const animate = sourceAssetId !== null;
    const high = input.quality === "high";
    let model: VideoModel;
    let settings: VideoSettings;
    let credits: number;
    try {
      model = videoModel(
        animate
          ? high
            ? HIGH_QUALITY_ANIMATE_MODEL_ID
            : DEFAULT_ANIMATE_MODEL_ID
          : high
            ? HIGH_QUALITY_VIDEO_MODEL_ID
            : DEFAULT_VIDEO_MODEL_ID,
      );
      settings = validateVideoSettings(
        model,
        {
          ...defaultVideoSettings(model),
          ...(input.aspectRatio && !animate
            ? { aspectRatio: input.aspectRatio }
            : {}),
          ...(input.durationSeconds
            ? { durationSeconds: input.durationSeconds }
            : {}),
        },
        animate,
      );
      credits = creditsPerVideo(model, settings);
    } catch (error) {
      throw new SokoBotRuntimeValidationError(
        error instanceof Error ? error.message : "Invalid video settings",
      );
    }
    if (credits > input.maxCredits)
      throw new SokoBotRuntimeValidationError(
        `This video costs ${credits} credits, more than the ${input.maxCredits} allowed. Ask your owner before spending more.`,
      );
    return { input, model, settings, credits, sourceAssetId };
  }

  /** Starts a video in a Project's Content Studio, once checked. */
  private async generateVideo(
    authorized: AuthorizedSokoBotRuntime,
    raw: unknown,
    toolCallId: string,
  ) {
    const { input, model, settings, credits, sourceAssetId } =
      await this.checkVideoRequest(authorized, raw, toolCallId).catch(
        (error: unknown) => {
          throw new SokoBotImageRefusedError(
            error instanceof Error ? error.message : "Video refused",
          );
        },
      );
    let job: Awaited<ReturnType<typeof createVideoJob>>;
    try {
      job = await createVideoJob({
        projectId: input.projectId,
        workspaceId: authorized.turn.workspaceId,
        userId: actingMemberOf(authorized),
        sessionId: null,
        prompt: input.prompt,
        modelId: model.id,
        settings,
        sourceAssetId,
        idempotencyKey: `soko-bot:${authorized.turn.id}:${toolCallId}`,
      });
    } catch (error) {
      if (error instanceof HTTPException)
        throw new SokoBotImageRefusedError(error.message);
      throw error;
    }
    return {
      jobId: job.id,
      projectId: input.projectId,
      status: job.status,
      credits,
      durationSeconds: settings.durationSeconds,
      studioUrl: studioLink(input.projectId),
      note:
        job.status === "SUBMISSION_UNCERTAIN"
          ? "The provider did not confirm this request. Do not start it again; tell the owner."
          : "Started. A video takes a few minutes; check it with get_video.",
    };
  }

  /** A project bot makes and reads images in its own Project only. */
  private requireImageProject(
    authorized: AuthorizedSokoBotRuntime,
    projectId: string,
  ) {
    const scope = authorized.reader.sharedScope;
    const refusal = sokoBotProjectRefusal(scope, [projectId]);
    if (refusal) throw new SokoBotRuntimeValidationError(refusal);
  }

  /** Where an image or video started with `generate_image` or `generate_video` has got to. */
  private async getStudioJob(
    authorized: AuthorizedSokoBotRuntime,
    raw: unknown,
  ) {
    const input = getImageInputSchema.parse(raw);
    this.requireImageProject(authorized, input.projectId);
    const scope = {
      projectId: input.projectId,
      workspaceId: authorized.turn.workspaceId,
      userId: actingMemberOf(authorized),
    };
    try {
      // Access before reconciling: reconciliation calls the provider, and a
      // Project id the owner cannot open must not reach it.
      await requireProjectAccess(scope);
      await reconcileProjectJobs(input.projectId);
      const job = await getJob({ ...scope, jobId: input.jobId });
      if (!job) return null;
      // A copy that fails leaves the image where it is, in the studio; the
      // bot is told there is no Files copy rather than the call failing.
      const file = job.assetId
        ? await this.imageInOwnerDrive(authorized, {
            projectId: input.projectId,
            assetId: job.assetId,
            jobId: job.id,
            prompt: job.prompt,
          }).catch((error: unknown) => {
            console.warn("[soko-bot] could not copy an image into Files", {
              jobId: job.id,
              error: error instanceof Error ? error.message : "unknown",
            });
            return null;
          })
        : null;
      return {
        jobId: job.id,
        status: job.status,
        failureReason: job.failureReason ?? null,
        studioUrl: studioLink(input.projectId, job.assetId),
        ...(job.assetId ? { file } : {}),
      };
    } catch (error) {
      if (error instanceof HTTPException)
        throw new SokoBotRuntimeValidationError(error.message);
      throw error;
    }
  }

  /**
   * A ready studio image, copied once into the owner's Files. Studio images
   * live in the studio's private store, where neither list_files nor the
   * Social tools can reach them, so "make an image and post it" failed. The
   * copy is keyed by the job, so asking again returns the same file.
   */
  private async imageInOwnerDrive(
    authorized: AuthorizedSokoBotRuntime,
    image: {
      projectId: string;
      assetId: string;
      jobId: string;
      prompt: string;
    },
  ): Promise<{ id: string; name: string; link: string } | null> {
    const drive = await this.ownerDrive(authorized);
    const file = await ensureStudioAssetDriveFile({
      projectId: image.projectId,
      assetId: image.assetId,
      workspaceId: drive.key.workspaceId,
      organizationId:
        drive.key.scope === "organization" ? drive.key.ownerId : null,
      userId: drive.actor.userId,
      prompt: image.prompt,
      jobId: image.jobId,
    });
    if (!file) return null;
    return { id: file.id, name: file.name, link: `/drive/files/${file.id}` };
  }

  /**
   * Social media given as `{ fileId }` becomes the Drive reference the Social
   * service stores. The bot never sees a file's storage address, so without
   * this it could not attach any file at all.
   */
  private async resolveSocialMedia(
    authorized: AuthorizedSokoBotRuntime,
    media: readonly SocialMediaInput[] | undefined,
  ): Promise<SocialMediaRef[] | undefined> {
    if (!media) return undefined;
    const ids = media.flatMap((item) =>
      "fileId" in item ? [item.fileId] : [],
    );
    if (ids.length === 0) return media as SocialMediaRef[];
    const drive = await this.ownerDrive(authorized);
    const files = await loadLiveResources({
      workspaceId: drive.key.workspaceId,
      actor: drive.actor,
      resourceIds: ids,
    });
    return Promise.all(
      media.map(async (item) => {
        if (!("fileId" in item)) return item;
        const file = files.find((candidate) => candidate.id === item.fileId);
        if (!file || file.sourceKind !== FileSourceKind.DRIVE_UPLOAD)
          throw new SokoBotRuntimeValidationError(
            `File ${item.fileId} is not in the owner's Files; use an id from list_files, get_image or get_video`,
          );
        const mimeType = file.mimeType ?? "";
        const kind = socialPostMediaKindForMime(mimeType);
        if (!kind)
          throw new SokoBotRuntimeValidationError(
            `"${file.displayName}" is not an image or video a Social post can carry`,
          );
        return {
          pathname: file.sourceId,
          fileUrl: (await head(file.sourceId)).url,
          name: file.displayName,
          size: file.sizeBytes ?? 0,
          mimeType,
          kind,
        };
      }),
    );
  }

  /**
   * The Drive the owner sees on their Files page in the bot's workspace: the
   * organization's in an organization workspace, their own in the personal
   * one. Always writing to the personal Drive made a file "in my Files"
   * invisible where the owner looked, while the bot still found it.
   */
  private async ownerDrive(authorized: AuthorizedSokoBotRuntime) {
    const userId = actingMemberOf(authorized);
    const workspace = await prisma.workspace.findUnique({
      where: { id: authorized.turn.workspaceId },
      select: { id: true, organizationId: true },
    });
    if (!workspace)
      throw new SokoBotRuntimeValidationError("Workspace not found");
    const { id: workspaceId, organizationId } = workspace;
    return {
      key: organizationId
        ? {
            workspaceId,
            scope: "organization" as const,
            ownerId: organizationId,
          }
        : { workspaceId, scope: "user" as const, ownerId: userId },
      pathname: (filename: string) =>
        organizationId
          ? buildOrganizationDriveFilePathname(organizationId, filename)
          : buildUserDriveFilePathname(userId, filename),
      pathnameIn: (folder: string, filename: string) =>
        organizationId
          ? buildOrganizationDriveFilePathnameWithFolder(
              organizationId,
              folder,
              filename,
            )
          : buildUserDriveFilePathnameWithFolder(userId, folder, filename),
      actor: {
        userId,
        organizationId,
        kind: "soko_bot",
        sokoBotScope: authorized.reader.sharedScope,
      } satisfies FileActor,
    };
  }

  /** Searches the owner's Drive, or lists its newest files. */
  private async listFiles(
    authorized: AuthorizedSokoBotRuntime,
    input: { query?: string; limit?: number },
  ) {
    const drive = await this.ownerDrive(authorized);
    // Files from before the catalog are adopted on visits, as the Drive
    // search route does; a failure here must not fail the search.
    await adoptDriveStoreIfPending(drive.key);
    const query = input.query?.trim() || null;
    const { items } = await searchFiles({
      workspaceId: drive.key.workspaceId,
      actor: drive.actor,
      query,
      filters: {},
      sortBy: query ? "relevance" : "modified",
      sortOrder: "desc",
      cursor: null,
      limit: input.limit ?? 20,
    });
    return {
      files: items.map((file) => ({
        id: file.id,
        name: file.displayName,
        type: file.mimeType,
        size: file.sizeBytes,
        updatedAt: file.updatedAt,
        category: file.category?.displayName ?? null,
        tags: file.tags.map((tag) => tag.displayName),
        folder: file.folderPath,
        passage: file.snippet?.text.slice(0, 300) ?? null,
        extraction: file.extractionState,
      })),
    };
  }

  /** The text the catalog extracted from one Drive file. */
  /**
   * The text of attached files, appended to a brief or comment. A Coworker
   * works from a Task's text: Hannah saw neither the Task's file list nor
   * the attachment the bot made, and asked three times for the brief.
   */
  private async withInlineFiles(
    authorized: AuthorizedSokoBotRuntime,
    text: string,
    fileIds: readonly string[] | undefined,
  ): Promise<string> {
    let room = TASK_TEXT_MAX_CHARS - text.length;
    const parts = [text];
    for (const fileId of new Set(fileIds ?? [])) {
      if (room < 200) break;
      const file = await this.readFile(authorized, { fileId }).catch(
        () => null,
      );
      if (!file?.text) continue;
      const header = `\n\n--- ${file.name} ---\n`;
      const body = file.text.slice(0, room - header.length - 40);
      parts.push(
        header +
          body +
          (body.length < file.text.length
            ? "\n[… cut; the full file is attached]"
            : ""),
      );
      room -= header.length + body.length + 40;
    }
    return parts.join("");
  }

  /**
   * Copies Drive files onto a Task as its inputs. A Coworker reads the Task,
   * not the owner's Files: "review index.html in your Files" left Hannah
   * with nothing to open. Called after the action that proved write access.
   */
  private async attachDriveFiles(
    authorized: AuthorizedSokoBotRuntime,
    taskId: string,
    fileIds: readonly string[],
  ) {
    const drive = await this.ownerDrive(authorized);
    const files = await loadLiveResources({
      workspaceId: drive.key.workspaceId,
      actor: drive.actor,
      resourceIds: [...new Set(fileIds)],
    });
    const attached: { fileId: string; name: string }[] = [];
    const skipped: { fileId: string; reason: string }[] = [];
    for (const fileId of new Set(fileIds)) {
      const file = files.find((candidate) => candidate.id === fileId);
      if (!file) {
        skipped.push({
          fileId,
          reason: "not found; use an id from list_files",
        });
        continue;
      }
      const name = clampTaskFileName(file.displayName);
      // A page the bot built is attached as its source text: Task files are
      // public blobs, and served as HTML they would run in a reader's browser.
      const contentType =
        resolveTaskFileContentType(name, file.mimeType ?? "") ??
        (isTextMimeType(file.mimeType)
          ? resolveTaskFileContentType(name, "text/plain")
          : null);
      const bytes =
        file.sourceKind === "DRIVE_UPLOAD" && contentType
          ? await downloadBlob(file.sourceId)
          : null;
      if (!bytes || !contentType) {
        skipped.push({
          fileId,
          reason: "this kind of file cannot be attached",
        });
        continue;
      }
      const blob = await put(
        buildTaskFilePathname(taskId, name),
        Buffer.from(bytes),
        { access: "public", contentType, addRandomSuffix: true },
      );
      await prisma.taskFile.upsert({
        where: { taskId_fileUrl: { taskId, fileUrl: blob.url } },
        create: {
          taskId,
          name,
          fileUrl: blob.url,
          mimeType: contentType,
          size: BigInt(bytes.byteLength),
          uploadedBySokoBotId: authorized.turn.sokoBotId,
        },
        update: {},
      });
      attached.push({ fileId, name });
    }
    return { attached, ...(skipped.length ? { skipped } : {}) };
  }

  private async readFile(
    authorized: AuthorizedSokoBotRuntime,
    input: { fileId: string; maxChars?: number },
  ) {
    const drive = await this.ownerDrive(authorized);
    const [file] = await loadLiveResources({
      workspaceId: drive.key.workspaceId,
      actor: drive.actor,
      resourceIds: [input.fileId],
    });
    if (!file)
      throw new SokoBotRuntimeValidationError(
        "File not found; use an id from list_files",
      );
    const limit = input.maxChars ?? 20_000;
    // Enough chunks to fill the limit, and one more to know there is more.
    const needed = Math.ceil(
      limit / (FILE_CHUNK_TARGET_CHARS - FILE_CHUNK_OVERLAP_CHARS),
    );
    const chunks = await prisma.fileChunk.findMany({
      where: {
        version: { resourceId: file.id, revision: file.contentRevision },
      },
      orderBy: { ordinal: "asc" },
      take: needed + 1,
      select: { text: true },
    });
    const indexed = joinExtractedChunks(chunks.slice(0, needed));
    const moreIndexed = chunks.length > needed;
    const direct = indexed ? null : await readDriveText(file);
    const text = indexed || direct || "";
    return {
      id: file.id,
      name: file.displayName,
      type: file.mimeType,
      text: text.slice(0, limit),
      truncated: text.length > limit || moreIndexed,
      ...(direct
        ? {
            note: "Read from the file itself; search has not indexed it yet.",
          }
        : text
          ? {}
          : {
              note:
                file.extractionState === "PENDING" ||
                file.extractionState === "RUNNING"
                  ? "The file is still being processed; its text is not ready yet."
                  : `No text was extracted${file.extractionReason ? ` (${file.extractionReason})` : ""}.`,
            }),
    };
  }

  /**
   * Write a text file into the owner's Drive. Core uploads server-side rather
   * than minting a client grant, because a tool call cannot perform the
   * browser's second step; the catalog steps are the same as a human upload,
   * so the file is searchable, tagged and related like any other. Replacing
   * an existing file is a new version of it, as a human re-upload is.
   */
  private async uploadFile(
    authorized: AuthorizedSokoBotRuntime,
    input: {
      filename: string;
      content?: string;
      attachmentUrl?: string;
      contentType?: string;
      overwrite?: boolean;
      folder?: string;
    },
  ) {
    const folder = driveFolderFor(input.folder);
    if (input.attachmentUrl) {
      if (input.content !== undefined)
        throw new SokoBotRefusedUnsentError(
          "Give either content or attachmentUrl, not both",
        );
      return this.saveChatAttachment(authorized, {
        filename: input.filename,
        url: input.attachmentUrl,
        overwrite: input.overwrite,
        folder,
      });
    }
    if (input.content === undefined)
      throw new SokoBotRefusedUnsentError(
        "Give the file's text as content, or a chat attachment's link as attachmentUrl",
      );
    const drive = await this.ownerDrive(authorized);
    const pathname = folder
      ? drive.pathnameIn(folder, input.filename)
      : drive.pathname(input.filename);
    const contentType = input.contentType ?? "text/markdown";
    // Text only: this tool writes what the model composed, never binary.
    if (!isTextMimeType(contentType)) {
      throw new SokoBotRefusedUnsentError(
        "Only text files can be written with upload_file",
      );
    }
    // A reused name must not silently replace an owner's file: replacing one
    // takes an explicit `overwrite`, and only a text file can be replaced.
    const existing = (await list({ prefix: pathname, limit: 1 })).blobs.find(
      (blob) => blob.pathname === pathname,
    );
    if (existing && !input.overwrite) {
      throw new SokoBotRefusedUnsentError(
        `A file named "${input.filename}" already exists. To replace its content, call upload_file again with overwrite: true; to keep it, choose another name.`,
      );
    }
    if (existing && !isTextMimeType((await head(existing.url)).contentType)) {
      throw new SokoBotRefusedUnsentError(
        `"${input.filename}" is not a text file, so upload_file cannot replace it; choose another name`,
      );
    }
    const key = { ...drive.key, pathname };
    const sizeBytes = Buffer.byteLength(input.content, "utf8");
    const displayName = pathname.split("/").pop() ?? input.filename;
    await reserveDriveUploadResource({
      key,
      displayName,
      mimeType: contentType,
      sizeBytes,
    });
    await put(pathname, input.content, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: Boolean(existing),
    });
    const activated = await activateDriveUploadResource({
      key,
      sizeBytes,
      mimeType: contentType,
    });
    nudgeFileIndexing();
    // The blob URL is public and never handed out: anyone holding it could
    // read the file without signing in. The file page checks access.
    return {
      id: activated?.resourceId ?? null,
      filename: displayName,
      replaced: Boolean(existing),
      link: activated ? `/drive/files/${activated.resourceId}` : null,
      size: sizeBytes,
      folder: folder || null,
      // Where the owner finds it, stated so a reply cannot claim elsewhere.
      savedTo:
        drive.key.scope === "organization"
          ? "Files in this organization's workspace, visible to its members"
          : "Files in the owner's personal workspace",
    };
  }

  /** The receipt for a write that already happened outside a transaction. */
  private async commitReceipt<T>(
    authorized: AuthorizedSokoBotRuntime,
    toolCallId: string,
    targetId: string,
    result: T,
  ): Promise<T> {
    await prisma.$transaction((tx) =>
      commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId,
        result: persistedToolResult(result),
      }),
    );
    return result;
  }

  private async mailboxFor(
    authorized: AuthorizedSokoBotRuntime,
    provider: string | undefined,
  ) {
    const integrations = await activeIntegrationsForBot(
      authorized.turn.sokoBotId,
      "email",
      provider,
    );
    if (integrations.length === 0)
      throw new SokoBotRefusedUnsentError("No connected mailbox");
    if (integrations.length > 1)
      throw new SokoBotRefusedUnsentError(
        "Several mailboxes are connected; say which provider",
      );
    return integrations[0];
  }

  /** Marks mail read or unread, or archives it. */
  private async updateEmails(
    authorized: AuthorizedSokoBotRuntime,
    input: {
      provider?: string;
      messageIds: string[];
      read?: boolean;
      archive?: boolean;
    },
    toolCallId: string,
  ) {
    if (input.read === undefined && !input.archive)
      throw new SokoBotRuntimeValidationError("Say read, unread or archive");
    const integration = await this.mailboxFor(authorized, input.provider);
    try {
      await modifyInboxMessages(integration, input.messageIds, input);
    } catch (error) {
      throw new SokoBotRuntimeValidationError(
        `The mailbox refused the change: ${error instanceof Error ? error.message : "unknown error"}. It may need reconnecting with write access.`,
      );
    }
    return this.commitReceipt(authorized, toolCallId, integration.id, {
      updated: input.messageIds.length,
      read: input.read,
      archived: Boolean(input.archive),
    });
  }

  /** Writes a draft in the owner's mailbox; nothing is sent. */
  private async draftEmail(
    authorized: AuthorizedSokoBotRuntime,
    input: {
      provider?: string;
      to: string[];
      cc?: string[];
      subject: string;
      body: string;
      replyToMessageId?: string;
    },
    toolCallId: string,
  ) {
    const integration = await this.mailboxFor(authorized, input.provider);
    const threadId = input.replyToMessageId
      ? ((await fetchInboxMessage(integration, input.replyToMessageId))
          .threadId ?? undefined)
      : undefined;
    const draftId = await createInboxDraft(integration, { ...input, threadId });
    await prisma.sokoBotMailDraft.create({
      data: {
        sokoBotId: authorized.turn.sokoBotId,
        provider: integration.provider.id,
        draftId,
        to: input.to,
        subject: input.subject,
        turnId: authorized.turn.id,
      },
    });
    return this.commitReceipt(authorized, toolCallId, draftId, {
      draftId,
      to: input.to,
      subject: input.subject,
      sent: false,
      note: "Show your owner the draft. Send it only when they explicitly say to in a later message.",
    });
  }

  /**
   * Sends a draft this bot wrote, only when its owner, in their own chat,
   * saw it in an earlier turn and now explicitly says to send it.
   */
  private async sendEmailDraft(
    authorized: AuthorizedSokoBotRuntime,
    input: { draftId: string },
    toolCallId: string,
  ) {
    const refusal = mailSendRefusal({
      source: authorized.turn.source,
      chainDepth: authorized.turn.chainDepth,
      askedByAssistant: authorized.askedByKind === "ASSISTANT",
      shared: Boolean(authorized.reader.sharedScope),
    });
    if (refusal) throw new SokoBotRefusedUnsentError(refusal);
    const draft = await prisma.sokoBotMailDraft.findUnique({
      where: {
        sokoBotId_draftId: {
          sokoBotId: authorized.turn.sokoBotId,
          draftId: input.draftId,
        },
      },
    });
    if (!draft)
      throw new SokoBotRefusedUnsentError("Only drafts you wrote can be sent");
    if (draft.sentAt)
      throw new SokoBotRefusedUnsentError("This draft was already sent");
    if (draft.turnId === authorized.turn.id)
      throw new SokoBotRefusedUnsentError(
        "Show your owner the draft first; send it after they say so in a new message",
      );
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: authorized.turn.id },
      select: { userMessage: true },
    });
    if (!(await ownerAskedToSend(turn.userMessage, draft)))
      throw new SokoBotRefusedUnsentError(
        "Your owner has not explicitly said to send this draft. Ask them.",
      );
    const [integration] = await activeIntegrationsForBot(
      authorized.turn.sokoBotId,
      "email",
      draft.provider,
    );
    if (!integration)
      throw new SokoBotRefusedUnsentError("The mailbox is no longer connected");
    await sendInboxDraft(integration, draft.draftId);
    await prisma.sokoBotMailDraft.update({
      where: { id: draft.id },
      data: { sentAt: new Date(), sentByTurnId: authorized.turn.id },
    });
    return this.commitReceipt(authorized, toolCallId, draft.draftId, {
      sent: true,
      to: draft.to,
      subject: draft.subject,
    });
  }

  /** Saves one mail attachment into the owner's Files. */
  private async saveEmailAttachment(
    authorized: AuthorizedSokoBotRuntime,
    input: {
      provider?: string;
      messageId: string;
      attachmentId: string;
      filename: string;
      folder?: string;
      saveAs?: string;
    },
    toolCallId: string,
  ) {
    const folder = driveFolderFor(input.folder);
    const integration = await this.mailboxFor(authorized, input.provider);
    if (!integration.provider.tools.getAttachment)
      throw new SokoBotRefusedUnsentError(
        `${integration.provider.name} attachments cannot be saved yet`,
      );
    // Gmail hands out a new attachment id on every read, so a name match on
    // a fresh read stands in for an id from an earlier one.
    const message = await fetchInboxMessage(integration, input.messageId);
    const attachment =
      message.attachments.find((item) => item.id === input.attachmentId) ??
      message.attachments.find((item) => item.filename === input.filename);
    if (!attachment)
      throw new SokoBotRefusedUnsentError(
        `That email has no attachment "${input.filename}"; read_email lists its attachments`,
      );
    if (attachment.size && attachment.size > INBOX_ATTACHMENT_MAX_BYTES)
      throw new SokoBotRefusedUnsentError(
        "That attachment is larger than 25 MB",
      );
    const saved = await this.saveFileBytes(authorized, {
      filename: input.saveAs ?? attachment.filename,
      folder,
      contentType: attachment.mimeType,
      read: async () => {
        const bytes = await fetchInboxAttachment(integration, {
          messageId: input.messageId,
          attachmentId: attachment.id,
          filename: attachment.filename,
        });
        if (bytes.byteLength > INBOX_ATTACHMENT_MAX_BYTES)
          throw new SokoBotRefusedUnsentError(
            "That attachment is larger than 25 MB",
          );
        return bytes;
      },
    });
    return this.commitReceipt(
      authorized,
      toolCallId,
      saved.id ?? `${input.messageId}:${attachment.id}`,
      saved,
    );
  }

  /** Moves one of the owner's Drive files into a folder of the same Drive. */
  private async moveFile(
    authorized: AuthorizedSokoBotRuntime,
    input: { fileId: string; folder: string },
    toolCallId: string,
  ) {
    const folder = driveFolderFor(input.folder);
    const drive = await this.ownerDrive(authorized);
    const resource = await prisma.fileResource.findFirst({
      where: {
        id: input.fileId,
        workspaceId: drive.key.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope:
          drive.key.scope === "organization"
            ? FileSourceScope.ORGANIZATION
            : FileSourceScope.USER,
        tombstonedAt: null,
        ...(drive.key.scope === "organization"
          ? { ownerOrganizationId: drive.key.ownerId }
          : { ownerUserId: drive.key.ownerId }),
      },
      select: { id: true, sourceId: true, displayName: true },
    });
    if (!resource)
      throw new SokoBotRefusedUnsentError(
        "No file with that id in your owner's Files; files from Tasks stay with their Task",
      );
    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token)
      throw new SokoBotRuntimeValidationError("File storage is not configured");
    try {
      await moveDriveFile({
        sourcePathname: resource.sourceId,
        targetFolderPath: folder,
        scope: drive.key.scope,
        ownerId: drive.key.ownerId,
        workspaceId: drive.key.workspaceId,
        token,
      });
    } catch (error) {
      if (error instanceof HTTPException && error.status < 500)
        throw new SokoBotRefusedUnsentError(error.message);
      throw error;
    }
    return this.commitReceipt(authorized, toolCallId, resource.id, {
      id: resource.id,
      filename: resource.displayName,
      folder: folder || null,
      link: `/drive/files/${resource.id}`,
    });
  }

  private async listSkills(
    authorized: AuthorizedSokoBotRuntime,
    input: { query?: string },
  ) {
    const userId = actingMemberOf(authorized);
    const [installed, catalog] = await Promise.all([
      listInstalledSkills(userId, authorized.turn.workspaceId),
      input.query ? searchSkillsSh(input.query).catch(() => null) : [],
    ]);
    return {
      installed: installed.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        source: skill.slug,
      })),
      ...(input.query
        ? catalog === null
          ? { catalogUnavailable: true }
          : { catalog }
        : {}),
    };
  }

  private async installSkill(
    authorized: AuthorizedSokoBotRuntime,
    input: { source: string; skillName?: string },
    toolCallId: string,
  ) {
    const userId = requireOwnerSkillRequest(authorized);
    try {
      const result = await installSkill({
        userId,
        workspaceId: authorized.turn.workspaceId,
        source: input.source,
        skillName: input.skillName ?? null,
      });
      return result.skill
        ? await this.commitReceipt(authorized, toolCallId, result.skill.id, {
            installed: {
              id: result.skill.id,
              name: result.skill.name,
              description: result.skill.description,
            },
          })
        : {
            installed: null,
            chooseOne: result.candidates.map((candidate) => ({
              skillName: candidate.name,
              description: candidate.description,
            })),
          };
    } catch (error) {
      if (error instanceof SokoBotSkillError)
        throw new SokoBotRefusedUnsentError(error.message);
      throw error;
    }
  }

  private async removeSkill(
    authorized: AuthorizedSokoBotRuntime,
    input: { skill: string },
    toolCallId: string,
  ) {
    const userId = requireOwnerSkillRequest(authorized);
    const installed = await listInstalledSkills(
      userId,
      authorized.turn.workspaceId,
    );
    const wanted = input.skill.toLowerCase();
    const skill = installed.find(
      (entry) =>
        entry.id === input.skill || entry.name.toLowerCase() === wanted,
    );
    if (!skill)
      throw new SokoBotRefusedUnsentError(
        "No installed skill by that id or name; list_skills shows them",
      );
    await removeInstalledSkill(userId, skill.id);
    return this.commitReceipt(authorized, toolCallId, skill.id, {
      removed: { id: skill.id, name: skill.name },
    });
  }

  /**
   * Copy a file someone attached in chat into the owner's Drive. Chat
   * attachments live under the sender's chat prefix, out of reach of
   * list_files and the Social tools, so "post these screenshots" had no way
   * to use them. Only a link posted in a room both the bot and its owner are
   * in qualifies, so a link cannot pull in an arbitrary file.
   */
  private async saveChatAttachment(
    authorized: AuthorizedSokoBotRuntime,
    input: {
      filename: string;
      url: string;
      overwrite?: boolean;
      folder: string;
    },
  ) {
    const file = parseChatRoomFileUrl(input.url);
    if (!file)
      throw new SokoBotRefusedUnsentError(
        "That link is not a file attached in a Sokosumi chat",
      );
    const room = await this.requireChatMembership(authorized, file.roomId);
    const posted = await prisma.chatRoomMessage.findFirst({
      where: {
        roomId: room.id,
        deletedAt: null,
        content: { contains: input.url },
        // The owner must be in the room too; acting for nobody, the bot's
        // own membership above is the whole check.
        ...(authorized.turn.actingUserId === null
          ? {}
          : {
              room: {
                userMembers: {
                  some: { userId: authorized.turn.actingUserId },
                },
              },
            }),
      },
      select: { id: true },
    });
    if (!posted)
      throw new SokoBotRefusedUnsentError(
        "That attachment was not posted in a chat you and your owner are in",
      );
    const meta = await head(input.url);
    if (meta.size > CHAT_ROOM_FILE_MAX_SIZE_BYTES)
      throw new SokoBotRefusedUnsentError("That attachment is too large");
    return this.saveFileBytes(authorized, {
      filename: input.filename,
      folder: input.folder,
      overwrite: input.overwrite,
      contentType: meta.contentType,
      read: async () => {
        const response = await fetch(meta.url, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok)
          throw new SokoBotRuntimeValidationError(
            "The attachment could not be read; try again",
          );
        return Buffer.from(await response.arrayBuffer());
      },
    });
  }

  /** Saves a file's bytes into the owner's Files; `read` runs once the name is free. */
  private async saveFileBytes(
    authorized: AuthorizedSokoBotRuntime,
    input: {
      filename: string;
      folder: string;
      overwrite?: boolean;
      contentType: string;
      read: () => Promise<Buffer>;
    },
  ) {
    const contentType =
      resolveUserUploadContentType(input.filename, input.contentType) ??
      input.contentType;
    const drive = await this.ownerDrive(authorized);
    const pathname = input.folder
      ? drive.pathnameIn(input.folder, input.filename)
      : drive.pathname(input.filename);
    const existing = (await list({ prefix: pathname, limit: 1 })).blobs.find(
      (blob) => blob.pathname === pathname,
    );
    if (existing && !input.overwrite)
      throw new SokoBotRefusedUnsentError(
        `A file named "${input.filename}" already exists. To replace it, call upload_file again with overwrite: true; to keep it, choose another name.`,
      );
    const bytes = await input.read();
    const key = { ...drive.key, pathname };
    const displayName = pathname.split("/").pop() ?? input.filename;
    await reserveDriveUploadResource({
      key,
      displayName,
      mimeType: contentType,
      sizeBytes: bytes.byteLength,
    });
    await put(pathname, bytes, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: Boolean(existing),
    });
    const activated = await activateDriveUploadResource({
      key,
      sizeBytes: bytes.byteLength,
      mimeType: contentType,
    });
    nudgeFileIndexing();
    return {
      id: activated?.resourceId ?? null,
      filename: displayName,
      replaced: Boolean(existing),
      link: activated ? `/drive/files/${activated.resourceId}` : null,
      size: bytes.byteLength,
      folder: input.folder || null,
      savedTo:
        drive.key.scope === "organization"
          ? "Files in this organization's workspace, visible to its members"
          : "Files in the owner's personal workspace",
    };
  }

  /** Recent messages in one room the bot belongs to, newest first. */
  private async readChat(
    authorized: AuthorizedSokoBotRuntime,
    input: { roomId: string; limit?: number; before?: string },
  ) {
    const room = await this.requireChatMembership(authorized, input.roomId);
    const messages = await prisma.chatRoomMessage.findMany({
      where: {
        roomId: room.id,
        deletedAt: null,
        ...(input.before ? { createdAt: { lt: new Date(input.before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 30,
      select: {
        id: true,
        content: true,
        createdAt: true,
        senderUser: { select: { name: true } },
        senderCoworker: { select: { id: true, name: true } },
        senderSokoBot: { select: { id: true, name: true } },
      },
    });
    return {
      roomId: room.id,
      name: room.name,
      messages: messages.map((message) => ({
        id: message.id,
        at: message.createdAt.toISOString(),
        from:
          message.senderUser?.name ??
          message.senderCoworker?.name ??
          (message.senderSokoBot
            ? sokoBotDisplayName({ name: message.senderSokoBot.name })
            : "unknown"),
        /** True when the bot itself wrote it. */
        fromYou: message.senderSokoBot?.id === room.sokoBotId,
        // Chat is untrusted text: the operating contract already tells the bot
        // never to follow instructions found in content it reads.
        content: message.content.slice(0, 4_000),
      })),
    };
  }

  /** The owner's board, filtered; `readTask` gives one Task in full. */
  private async listTasks(authorized: AuthorizedSokoBotRuntime, raw: unknown) {
    const input = listTasksInputSchema.parse(raw);
    const now = Date.now();
    const finished = [...SETTLED_TASK_STATUSES];
    const contains = (value: string) => ({
      contains: value,
      mode: "insensitive" as const,
    });
    const assignee = input.assignee?.trim();
    const where: Prisma.TaskWhereInput = {
      AND: [
        { workspaceId: authorized.turn.workspaceId, archivedAt: null },
        buildSokoBotReaderTaskWhere(authorized.reader),
        // An exact status is the question itself; `state` would only
        // contradict it (FAILED is finished, yet "open" is the default).
        input.status
          ? { status: { in: [input.status].flat() } }
          : input.state === "open"
            ? { status: { notIn: finished } }
            : input.state === "finished"
              ? { status: { in: finished } }
              : {},
        input.projectId ? { projectId: input.projectId } : {},
        input.idleDays
          ? {
              updatedAt: {
                lte: new Date(now - input.idleDays * DAY_MS),
              },
            }
          : {},
        // Every word, in the name or description: one phrase rarely matches.
        ...(input.query ?? "")
          .split(/\s+/)
          .filter((word) => word.length >= 2)
          .map((word) => ({
            OR: [{ name: contains(word) }, { description: contains(word) }],
          })),
        assignee?.toLowerCase() === "unassigned"
          ? { assigneeId: null, assigneeUserId: null, assigneeSokoBotId: null }
          : assignee
            ? {
                OR: [
                  { assignee: { name: contains(assignee) } },
                  { assigneeUser: { name: contains(assignee) } },
                  { assigneeSokoBot: { name: contains(assignee) } },
                ],
              }
            : {},
      ],
    };
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: input.limit,
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
          assignee: { select: { name: true } },
          assigneeUser: { select: { name: true } },
          assigneeSokoBot: { select: { name: true } },
          project: { select: { id: true, name: true } },
          events: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { status: true, comment: true, createdAt: true },
          },
        },
      }),
      prisma.task.count({ where }),
    ]);
    // Counts past the page: "what is stuck" needs every INPUT_REQUIRED Task,
    // not the ones among the latest few that happened to be listed.
    const byStatus = await prisma.task.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });
    const charged = await taskCreditsCharged(tasks.map((task) => task.id));
    return {
      tasks: tasks.map((task) => {
        const latest = task.events[0];
        return {
          id: task.id,
          name: task.name,
          status: task.status,
          assignee: task.assignee
            ? { kind: "coworker", name: task.assignee.name }
            : task.assigneeUser
              ? { kind: "member", name: task.assigneeUser.name }
              : task.assigneeSokoBot
                ? { kind: "assistant", name: task.assigneeSokoBot.name }
                : null,
          project: task.project,
          idleDays: Math.floor((now - task.updatedAt.getTime()) / DAY_MS),
          updatedAt: task.updatedAt.toISOString(),
          ...(charged.has(task.id)
            ? { creditsCharged: roundCredits(charged.get(task.id)!) }
            : {}),
          latest: latest
            ? {
                status: latest.status,
                comment: latest.comment?.slice(0, 200) ?? null,
                at: latest.createdAt.toISOString(),
              }
            : null,
        };
      }),
      total,
      byStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  private async readTask(authorized: AuthorizedSokoBotRuntime, taskId: string) {
    const ownerId = authorized.turn.actingUserId;
    const visiblePeerTask = {
      workspaceId: authorized.turn.workspaceId,
      archivedAt: null,
      ...buildSokoBotReaderTaskWhere(authorized.reader),
    };
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        workspaceId: authorized.turn.workspaceId,
        // Explicit owner reads may inspect retained archive history; shared
        // audience reads and related-task discovery still exclude archives.
        // A turn for nobody has no owner, so it reads no archive.
        ...(authorized.askedByKind === "OWNER" && ownerId !== null
          ? {
              AND: [{ OR: [{ archivedAt: null }, { ownerId }] }],
            }
          : { archivedAt: null }),
        ...buildSokoBotReaderTaskWhere(authorized.reader),
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        creatorUserId: true,
        assigneeUserId: true,
        assigneeId: true,
        assigneeSokoBotId: true,
        description: true,
        status: true,
        archivedAt: true,
        updatedAt: true,
        assignee: { select: { id: true, name: true } },
        assigneeSokoBot: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        events: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 8,
          select: {
            id: true,
            status: true,
            comment: true,
            createdAt: true,
            coworkerId: true,
            userId: true,
            sokoBotId: true,
            sokoBot: { select: SOKO_BOT_OWNER_NAME_SELECT },
          },
        },
        files: {
          where: { status: "READY" },
          take: 10,
          select: {
            name: true,
            fileUrl: true,
            sourceUrl: true,
            mimeType: true,
          },
        },
        linksFrom: {
          where: {
            toTask: {
              is: visiblePeerTask,
            },
          },
          select: {
            type: true,
            note: true,
            toTask: { select: { id: true, name: true, status: true } },
          },
        },
        linksTo: {
          where: {
            fromTask: {
              is: visiblePeerTask,
            },
          },
          select: {
            type: true,
            note: true,
            fromTask: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
    if (!task) return null;
    const actor = (event: {
      coworkerId: string | null;
      userId: string | null;
      sokoBotId: string | null;
    }) =>
      event.sokoBotId
        ? event.sokoBotId === authorized.turn.sokoBotId
          ? "you"
          : "another_bot"
        : event.coworkerId
          ? "coworker"
          : event.userId
            ? event.userId === task.ownerId
              ? "owner"
              : "teammate"
            : "system";
    return {
      id: task.id,
      name: task.name,
      ownerId: task.ownerId,
      requesterUserId: task.creatorUserId,
      assigneeUserId: task.assigneeUserId,
      assigneeCoworkerId: task.assigneeId,
      assigneeSokoBotId: task.assigneeSokoBotId,
      status: task.status,
      archivedAt: task.archivedAt,
      description: task.description,
      assignee: task.assignee ?? task.assigneeSokoBot,
      project: task.project,
      updatedAt: task.updatedAt,
      creditsCharged: roundCredits(
        (await taskCreditsCharged([task.id])).get(task.id) ?? 0,
      ),
      events: [...task.events].reverse().map((event) => ({
        id: event.id,
        at: event.createdAt,
        author: {
          userId: event.userId,
          coworkerId: event.coworkerId,
          sokoBotId: event.sokoBotId,
        },
        by: actor(event),
        // Whose assistant wrote it: another owner's bot speaks for that
        // owner, never for yours.
        ...(event.sokoBot && event.sokoBotId !== authorized.turn.sokoBotId
          ? {
              byName: sokoBotAuthorLabel(event.sokoBot),
            }
          : {}),
        status: event.status,
        comment: event.comment,
      })),
      files: task.files,
      fulfillment: await readSokoBotTaskOutcome(prisma, {
        turnId: authorized.turn.id,
        sokoBotId: authorized.turn.sokoBotId,
        workspaceId: authorized.turn.workspaceId,
        userId: authorized.turn.actingUserId,
        intentId: authorized.turn.intentId,
        intentRevision: authorized.turn.intentRevision,
        audience: authorized.askedByKind,
        taskId: task.id,
      }),
      links: [
        ...task.linksFrom.map((link) => ({
          relation: link.type,
          direction: "from-this",
          task: link.toTask,
          note: link.note,
        })),
        ...task.linksTo.map((link) => ({
          relation: link.type,
          direction: "to-this",
          task: link.fromTask,
          note: link.note,
        })),
      ],
    };
  }

  /** Progress a Task this Soko Bot is assigned to; no credits involved. */
  private async updateAssignedTask(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
    toolCallId: string,
  ) {
    const input = updateAssignedTaskInputSchema.parse(rawInput);
    const allowed: Record<string, TaskStatus[]> = {
      READY: [
        TaskStatus.RUNNING,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
      ],
      RUNNING: [
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
      ],
      INPUT_REQUIRED: [
        TaskStatus.RUNNING,
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
      ],
      QUEUED: [TaskStatus.RUNNING, TaskStatus.COMPLETED, TaskStatus.FAILED],
    };
    const persisted = await serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        false,
        "update_assigned_task",
        { taskIds: [input.taskId] },
      );
      const claim = await claimTaskEventAction(
        tx,
        {
          ...authorized.turn,
          turnId: authorized.turn.id,
          source: authorized.turn.source ?? "CHAT",
        },
        input.taskId,
        "TASK_STATE",
      );
      if (!claim.allowed)
        throw new SokoBotRuntimeAuthorizationError(
          "This turn has no current authority for this task event action",
        );
      const task = await tx.task.findFirst({
        where: {
          id: input.taskId,
          workspaceId: authorized.turn.workspaceId,
          archivedAt: null,
        },
        select: {
          id: true,
          ownerId: true,
          status: true,
          assigneeSokoBotId: true,
        },
      });
      if (!task)
        throw new SokoBotRuntimeValidationError(
          "Task not found; copy its id exactly from list_tasks or get_task_status",
        );
      if (task.assigneeSokoBotId !== authorized.turn.sokoBotId) {
        throw new SokoBotRuntimeValidationError(
          "You are not the assignee of this Task; use reply_to_task to comment",
        );
      }
      const next = TaskStatus[input.status];
      if (!(allowed[task.status] ?? []).includes(next)) {
        throw new SokoBotRuntimeValidationError(
          `Task is ${task.status}; cannot set ${input.status}`,
        );
      }
      const event = await tx.taskEvent.create({
        data: {
          taskId: task.id,
          status: next,
          comment: input.comment,
          channel: Channel.SOKOSUMI,
          sokoBotId: authorized.turn.sokoBotId,
        },
        select: { id: true },
      });
      await applyGuardedTaskStatusUpdate({
        tx,
        taskId: task.id,
        expectedStatus: task.status,
        eventStatus: next,
      });
      await tx.sokoBotTaskWatch.upsert({
        where: {
          sokoBotId_taskId: {
            sokoBotId: authorized.turn.sokoBotId,
            taskId: task.id,
          },
        },
        create: {
          sokoBotId: authorized.turn.sokoBotId,
          taskId: task.id,
          lastSeenEventAt: new Date(),
          lastSeenStatus: next,
        },
        update: { lastSeenEventAt: new Date(), lastSeenStatus: next },
      });
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "update_assigned_task",
          outcome: next,
          lastSeenStatus: next,
          taskId: task.id,
        },
      });
      const result = { taskId: task.id, status: next, eventId: event.id };
      const receipt = await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: task.id,
        effectEventId: event.id,
        result: persistedToolResult(result),
      });
      if (claim.claimId)
        await tx.sokoBotTaskActionClaim.update({
          where: { id: claim.claimId },
          data: { receiptId: receipt.id },
        });
      return {
        result,
        eventId: event.id,
        ownerId: task.ownerId,
      };
    }, "Soko Bot task update collided with another request");
    return persisted.result;
  }

  /** Comment on a Task, optionally resuming it (INPUT_REQUIRED/FAILED/… → READY). */
  private async replyToTask(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
    toolCallId: string,
    options?: { transaction: Prisma.TransactionClient; publicationId: string },
  ) {
    const input = replyToTaskInputSchema.parse(rawInput);
    const resumable: TaskStatus[] = [
      TaskStatus.INPUT_REQUIRED,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
      TaskStatus.COMPLETED,
      TaskStatus.APPROVAL_REQUIRED,
      TaskStatus.AWAITING_EXTERNAL,
    ];
    const persist = async (tx: Prisma.TransactionClient) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        false,
        "reply_to_task",
      );
      const claim = input.status
        ? await claimTaskEventAction(
            tx,
            {
              ...authorized.turn,
              turnId: authorized.turn.id,
              source: authorized.turn.source ?? "CHAT",
            },
            input.taskId,
            "TASK_STATE",
          )
        : { allowed: true, claimId: null };
      if (!claim.allowed)
        throw new SokoBotRuntimeAuthorizationError(
          "This turn has no current authority for this task event action",
        );
      const task = await tx.task.findFirst({
        where: {
          id: input.taskId,
          workspaceId: authorized.turn.workspaceId,
          archivedAt: null,
          ...buildSokoBotReaderTaskWhere(authorized.reader),
        },
        select: {
          id: true,
          name: true,
          ownerId: true,
          status: true,
          assigneeId: true,
          assigneeSokoBotId: true,
        },
      });
      if (!task)
        throw new SokoBotRuntimeValidationError(
          "Task not found; copy its id exactly from list_tasks or get_task_status",
        );
      if (!input.status && !options?.publicationId) {
        const events = await tx.taskEvent.findMany({
          where: {
            taskId: task.id,
            sokoBotId: authorized.turn.sokoBotId,
            status: null,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
          },
          select: { id: true, comment: true },
        });
        const recent = events.filter((event) => {
          const match =
            /^\[Open table\]\(\/drive\/tables\/([0-9a-f-]+)\)$/.exec(
              event.comment ?? "",
            );
          const tableId = z.uuid().safeParse(match?.[1]);
          return (
            !tableId.success ||
            event.comment !== `[Open table](/drive/tables/${tableId.data})` ||
            event.id !==
              uuidv5(
                `table-created:task:${task.id}:${authorized.turn.sokoBotId}`,
                tableId.data,
              )
          );
        }).length;
        if (recent >= MAX_BOT_COMMENTS_PER_TASK_PER_DAY) {
          throw new SokoBotRuntimeValidationError(
            `You already commented ${recent} times on this Task today; hold further comments unless they are urgent`,
          );
        }
      }
      const close =
        (input.status === "CANCELED" || input.status === "COMPLETED") &&
        task.status !== input.status
          ? TaskStatus[input.status]
          : null;
      // Cancelling or completing ends the work for good, so it is the owner's
      // call and only on the owner's own Tasks, as in the app's status picker;
      // commenting stays open to any visible one. A turn for nobody has no
      // owner, so it closes nothing.
      const { actingUserId } = authorized.turn;
      if (close && (actingUserId === null || task.ownerId !== actingUserId))
        throw new SokoBotRuntimeValidationError(
          "Only the owner's own Tasks can be canceled or completed; comment instead",
        );
      const changeStatus =
        input.status === "READY" &&
        task.status !== TaskStatus.READY &&
        task.status !== TaskStatus.RUNNING;
      const nextStatus = changeStatus ? TaskStatus.READY : close;
      if (changeStatus) {
        if (!resumable.includes(task.status)) {
          throw new SokoBotRuntimeValidationError(
            `Task is ${task.status}; only ${resumable.join(", ")} can be set READY. To leave a comment without changing the status, omit \`status\`.`,
          );
        }
        if (!task.assigneeId && !task.assigneeSokoBotId) {
          throw new SokoBotRuntimeValidationError(
            "Task has no assignee; use assign_task instead",
          );
        }
      }
      const previous = options?.publicationId
        ? await tx.taskEvent.findFirst({
            where: {
              id: options.publicationId,
              taskId: task.id,
              sokoBotId: authorized.turn.sokoBotId,
            },
            select: { id: true },
          })
        : null;
      const event =
        previous ??
        (await tx.taskEvent.create({
          data: {
            ...(options?.publicationId ? { id: options.publicationId } : {}),
            taskId: task.id,
            status: nextStatus,
            comment: input.comment,
            channel: Channel.SOKOSUMI,
            sokoBotId: authorized.turn.sokoBotId,
          },
          select: { id: true },
        }));
      if (nextStatus) {
        await applyGuardedTaskStatusUpdate({
          tx,
          taskId: task.id,
          expectedStatus: task.status,
          eventStatus: nextStatus,
        });
      }
      const status = nextStatus ?? task.status;
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "reply_to_task",
          outcome: status,
          lastSeenStatus: status,
          taskId: task.id,
        },
      });
      const result = {
        id: task.id,
        name: task.name,
        status,
        commented: true,
        eventId: event.id,
        statusChanged: nextStatus !== null,
      };
      const receipt = await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: task.id,
        effectEventId: event.id,
        result: persistedToolResult(result),
      });
      if (claim.claimId)
        await tx.sokoBotTaskActionClaim.update({
          where: { id: claim.claimId },
          data: { receiptId: receipt.id },
        });
      return {
        result,
        eventId: event.id,
        ownerId: task.ownerId,
        eventStatus: nextStatus,
      };
    };
    const persisted = options?.transaction
      ? await persist(options.transaction)
      : await serializableTransaction(
          persist,
          "Soko Bot task reply collided with another action",
        );
    return persisted.result;
  }

  private async linkTasks(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
    toolCallId: string,
  ) {
    const input = linkTasksInputSchema.parse(rawInput);
    if (input.taskId === input.peerTaskId) {
      throw new SokoBotRuntimeValidationError("A task cannot link to itself");
    }
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(tx, authorized, false, "link_tasks");
      const tasks = await tx.task.findMany({
        where: {
          id: { in: [input.taskId, input.peerTaskId] },
          workspaceId: authorized.turn.workspaceId,
          archivedAt: null,
          ...buildSokoBotReaderTaskWhere(authorized.reader),
        },
        select: { id: true, name: true },
      });
      if (tasks.length !== 2) {
        throw new SokoBotRuntimeValidationError(
          "One of the tasks was not found",
        );
      }
      const data = mapTaskLinkRelationToWriteData(
        input.taskId,
        input.peerTaskId,
        input.relation,
      );
      const existing = await tx.taskLink.findFirst({
        where: {
          OR: [
            { fromTaskId: data.fromTaskId, toTaskId: data.toTaskId },
            { fromTaskId: data.toTaskId, toTaskId: data.fromTaskId },
          ],
        },
        select: { id: true, type: true },
      });
      if (existing) {
        const result = {
          linked: true,
          existing: true,
          relation: existing.type,
          id: existing.id,
        };
        if (existing.type !== data.type)
          throw new SokoBotRuntimeValidationError(
            "A different relationship already exists",
          );
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: existing.id,
          disposition: "ALREADY_SATISFIED",
          result: persistedToolResult(result),
        });
        return result;
      }
      const link = await tx.taskLink.create({
        data: { ...data, note: input.note ?? null },
        select: { id: true, type: true },
      });
      const result = {
        linked: true,
        existing: false,
        relation: link.type,
        id: link.id,
      };
      await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId: link.id,
        result: persistedToolResult(result),
      });
      return result;
    }, "Soko Bot task link collided with another action");
  }

  private async createDecision(
    authorized: SokoBotActionContext,
    toolName: SokoBotDecisionTarget,
    proposal: unknown,
    toolCallId: string,
  ) {
    const parsedProposal = parseDecisionProposal(toolName, proposal);
    const proposalJson = jsonInput(parsedProposal);
    const reason = await describeDecision(toolName, parsedProposal);
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        false,
        toolName,
        decisionProposalTargets(toolName, parsedProposal),
      );
      // A model that retries an approval-gated call with the same input must
      // not fan out into several identical approvals for the owner.
      const existing = await tx.sokoBotPendingDecision.findFirst({
        where: {
          turnId: authorized.turn.id,
          toolName,
          status: "PENDING",
          proposal: { equals: proposalJson },
        },
        select: { id: true, status: true, expiresAt: true },
      });
      if (existing) return existing;
      const intentTurn = await tx.sokoBotTurn.findFirst({
        where: { id: authorized.turn.id },
        select: { intentId: true },
      });
      if (intentTurn?.intentId) {
        await tx.sokoBotIntent.updateMany({
          where: {
            id: intentTurn.intentId,
            state: { in: ["ACTIVE", "AWAITING_CONFIRMATION"] },
          },
          data: {
            state: "AWAITING_CONFIRMATION",
            desiredOutcome: reason,
            allowedActions: [toolName],
            expiresAt: new Date(Date.now() + DECISION_TTL_MS),
          },
        });
      }
      const decision = await tx.sokoBotPendingDecision.create({
        data: {
          intentId: intentTurn?.intentId,
          sokoBotId: authorized.turn.sokoBotId,
          turnId: authorized.turn.id,
          requestedByUserId: authorized.turn.requestedByUserId,
          workspaceId: authorized.turn.workspaceId,
          toolName,
          reason,
          proposal: proposalJson,
          expiresAt: new Date(Date.now() + DECISION_TTL_MS),
        },
        select: { id: true, status: true, expiresAt: true },
      });
      await tx.sokoBotToolCall.update({
        where: {
          turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
        },
        data: { status: "COMPLETED", result: persistedToolResult(decision) },
      });
      return decision;
    }, "Soko Bot decision collided with cancellation");
  }

  private async createTask(
    authorized: SokoBotActionContext,
    rawInput: unknown,
    toolCallId: string,
    approved = false,
  ) {
    // Self-started turns may start work, not only draft it: an assistant that
    // spots a meeting to prepare for and leaves a DRAFT has not helped. The
    // brakes are the owner's daily cap and pause, plus the version prompt's
    // instruction to weigh cost and ask first when the work looks expensive.
    const input = taskCreateInputSchema.parse(rawInput);
    return serializableTransaction(async (tx) => {
      const workspace = await this.requireMutationAuthority(
        tx,
        authorized,
        approved,
        "create_task",
        decisionProposalTargets("create_task", input),
      );
      const triggeringTaskId =
        input.triggeringTaskId ??
        (authorized.turn.source === "EVENT"
          ? await onlyEventTask(tx, authorized.turn)
          : undefined);
      const claim = triggeringTaskId
        ? await claimTaskEventAction(
            tx,
            {
              ...authorized.turn,
              turnId: authorized.turn.id,
              source: authorized.turn.source ?? "CHAT",
            },
            triggeringTaskId,
            "CREATE_TASK",
          )
        : { allowed: true, claimId: null };
      if (!claim.allowed)
        throw new SokoBotRuntimeAuthorizationError(
          "This turn has no current authority for this task event action",
        );
      if (approved) {
        await tx.sokoBotToolCall.upsert({
          where: {
            turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
          },
          create: {
            turnId: authorized.turn.id,
            toolCallId,
            capability: "create_task",
            operationKey: actionOperationKey({
              workspaceId: authorized.turn.workspaceId,
              principalId: actionPrincipalId(authorized.turn),
              intentRevision: toolCallId,
              capability: "create_task",
              inputHash: actionInputHash(rawInput),
            }),
            inputHash: actionInputHash(rawInput),
            actorBotId: authorized.turn.sokoBotId,
          },
          update: {},
        });
      }
      const effectEventId = randomUUID();
      const task = await createTaskForActor(
        {
          actor: {
            kind: "soko_bot",
            sokoBotId: authorized.turn.sokoBotId,
          },
          ownerId: authorized.turn.actingUserId,
          organizationId: workspace.organizationId,
          workspaceId: authorized.turn.workspaceId,
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          ...toolAssigneeFields(
            input.coworkerId,
            authorized.turn.sokoBotId,
            ownerAssignee(input.assignToOwner, authorized.turn.actingUserId),
          ),
          status: input.status,
          channel: Channel.SOKOSUMI,
          effectEventId,
        },
        tx,
      );
      const result = {
        id: task.id,
        name: task.name,
        status: task.status,
        assigneeId: task.assigneeId,
      };
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "create_task",
          outcome: result.status,
          lastSeenStatus: result.status,
          taskId: result.id,
          followUp: input.followUp,
        },
      });
      {
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: task.id,
          effectEventId,
          claimId: claim.claimId,
          observedVersion: task.updatedAt?.toISOString(),
          result: persistedToolResult(result),
        });
      }
      return result;
    }, "Soko Bot Task creation collided with another action");
  }

  private async mutateTask(
    authorized: SokoBotActionContext,
    rawInput: unknown,
    toolCallId: string,
    options: { capability: "update_task" | "archive_task"; approved?: boolean },
  ) {
    const { capability, approved = false } = options;
    // Archiving is managing the Task (ADR 0057): never for nobody, not even
    // as a no-op on an archived one.
    if (capability === "archive_task" && authorized.turn.actingUserId === null)
      throw new SokoBotRefusedUnsentError(
        "Archiving a Task needs an Organization owner or admin; suggest it in your chat instead",
      );
    const input: ReturnType<typeof taskUpdateInputSchema.parse> & {
      archive: boolean;
    } =
      capability === "archive_task"
        ? { ...taskArchiveInputSchema.parse(rawInput), archive: true }
        : { ...taskUpdateInputSchema.parse(rawInput), archive: false };
    return this.applyTaskMutation(
      authorized,
      rawInput,
      toolCallId,
      input,
      capability,
      approved,
    );
  }

  private async applyTaskMutation(
    authorized: SokoBotActionContext,
    rawInput: unknown,
    toolCallId: string,
    input: ReturnType<typeof taskUpdateInputSchema.parse> & {
      archive: boolean;
    },
    capability: "update_task" | "archive_task",
    approved: boolean,
  ) {
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        approved,
        capability,
        {
          taskIds: [input.taskId],
          projectIds: input.projectId === undefined ? [] : [input.projectId],
        },
      );
      const claim = await claimTaskEventAction(
        tx,
        {
          ...authorized.turn,
          turnId: authorized.turn.id,
          source: authorized.turn.source ?? "CHAT",
        },
        input.taskId,
        "TASK_STATE",
      );
      if (!claim.allowed)
        throw new SokoBotRuntimeAuthorizationError(
          "This turn has no current authority for this task event action",
        );
      if (approved) {
        await tx.sokoBotToolCall.upsert({
          where: {
            turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
          },
          create: {
            turnId: authorized.turn.id,
            toolCallId,
            capability,
            operationKey: actionOperationKey({
              workspaceId: authorized.turn.workspaceId,
              principalId: actionPrincipalId(authorized.turn),
              intentRevision: toolCallId,
              capability,
              inputHash: actionInputHash(rawInput),
            }),
            inputHash: actionInputHash(rawInput),
            actorBotId: authorized.turn.sokoBotId,
          },
          update: {},
        });
      }
      const before = await tx.task.findFirst({
        where: {
          id: input.taskId,
          workspaceId: authorized.turn.workspaceId,
          // What the owner may change in the app, not only what they created.
          // Acting on its own, a shared bot changes public Tasks only; the
          // write scope check above already bounded them to its scope.
          ...(authorized.turn.actingUserId === null
            ? { visibility: "PUBLIC" as const }
            : buildTaskWriteAccessWhere(authorized.turn.actingUserId)),
        },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          projectId: true,
          archivedAt: true,
          updatedAt: true,
          assigneeId: true,
          assigneeSokoBotId: true,
          assigneeUserId: true,
        },
      });
      // A Task the bot can see but the owner may not change gets a reason the
      // owner can act on, not a bare "Task not found".
      if (
        !before &&
        (await tx.task.findFirst({
          where: { id: input.taskId, workspaceId: authorized.turn.workspaceId },
          select: { id: true },
        }))
      )
        throw new SokoBotRuntimeAuthorizationError(
          "This Task belongs to someone else and is private, so only its owner can change or archive it",
        );
      const unassign =
        input.unassign === true &&
        Boolean(
          before?.assigneeId ||
            before?.assigneeSokoBotId ||
            before?.assigneeUserId,
        );
      if (input.archive && before?.archivedAt) {
        const event = await tx.taskEvent.create({
          data: {
            taskId: before.id,
            sokoBotId: authorized.turn.sokoBotId,
            comment:
              "Verified that this Task was already archived; history retained",
          },
        });
        const result = {
          id: before.id,
          name: before.name,
          status: before.status,
          assigneeId: before.assigneeId,
          before: {
            projectId: before.projectId,
            archivedAt: before.archivedAt,
          },
          after: { projectId: before.projectId, archivedAt: before.archivedAt },
        };
        await tx.sokoBotDelegation.create({
          data: {
            turnId: authorized.turn.id,
            toolCallId,
            kind: "TASK",
            action: capability,
            outcome: before.status,
            lastSeenStatus: before.status,
            taskId: before.id,
          },
        });
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: before.id,
          effectEventId: event.id,
          claimId: claim.claimId,
          observedVersion: before.updatedAt.toISOString(),
          disposition: "ALREADY_SATISFIED",
          result: persistedToolResult(result),
        });
        return result;
      }
      if (
        before &&
        !input.archive &&
        (input.name === undefined || input.name === before.name) &&
        (input.description === undefined ||
          input.description === before.description) &&
        (input.status === undefined || input.status === before.status) &&
        (input.projectId === undefined ||
          input.projectId === before.projectId) &&
        !unassign
      ) {
        if (
          input.expectedUpdatedAt &&
          before.updatedAt.toISOString() !== input.expectedUpdatedAt
        )
          throw new SokoBotRuntimeConflictError("Task changed; read it again");
        const unchanged = {
          id: before.id,
          name: before.name,
          status: before.status,
          assigneeId: before.assigneeId,
          before: {
            projectId: before.projectId,
            archivedAt: before.archivedAt,
          },
          after: { projectId: before.projectId, archivedAt: before.archivedAt },
        };
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: before.id,
          claimId: claim.claimId,
          observedVersion: before.updatedAt?.toISOString(),
          disposition: "ALREADY_SATISFIED",
          result: persistedToolResult(unchanged),
        });
        return unchanged;
      }
      const effectEventId = randomUUID();
      const task = await updateTaskForActor(
        {
          actor: {
            kind: "soko_bot",
            sokoBotId: authorized.turn.sokoBotId,
          },
          userId: authorized.turn.actingUserId,
          workspaceId: authorized.turn.workspaceId,
          taskId: input.taskId,
          intent: "metadata",
          name: input.name,
          description: input.description,
          projectId: input.projectId,
          ...(unassign ? { assigneeId: null } : {}),
          expectedUpdatedAt: input.expectedUpdatedAt
            ? new Date(input.expectedUpdatedAt)
            : undefined,
          archive: input.archive,
          status: input.status,
          channel: Channel.SOKOSUMI,
          effectEventId,
        },
        tx,
      );
      const updated = {
        id: task.id,
        name: task.name,
        status: task.status,
        assigneeId: task.assigneeId,
        before: {
          projectId: before?.projectId ?? null,
          archivedAt: before?.archivedAt ?? null,
        },
        after: { projectId: task.projectId, archivedAt: task.archivedAt },
      };
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: capability,
          outcome: updated.status,
          lastSeenStatus: updated.status,
          taskId: updated.id,
        },
      });
      {
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: task.id,
          effectEventId,
          claimId: claim.claimId,
          observedVersion: task.updatedAt?.toISOString(),
          result: persistedToolResult(updated),
        });
      }
      return updated;
    }, "Soko Bot Task update collided with another action");
  }

  private async assignTask(
    authorized: SokoBotActionContext,
    rawInput: unknown,
    toolCallId: string,
    approved = false,
  ) {
    const input = taskAssignInputSchema.parse(rawInput);
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        approved,
        "assign_task",
        { taskIds: [input.taskId] },
      );
      const status = input.ready ? TaskStatus.READY : TaskStatus.DRAFT;
      const claim = await claimTaskEventAction(
        tx,
        {
          ...authorized.turn,
          turnId: authorized.turn.id,
          source: authorized.turn.source ?? "CHAT",
        },
        input.taskId,
        "TASK_STATE",
      );
      if (!claim.allowed)
        throw new SokoBotRuntimeAuthorizationError(
          "This turn has no current authority for this task event action",
        );
      if (approved) {
        await tx.sokoBotToolCall.upsert({
          where: {
            turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
          },
          create: {
            turnId: authorized.turn.id,
            toolCallId,
            capability: "assign_task",
            operationKey: actionOperationKey({
              workspaceId: authorized.turn.workspaceId,
              principalId: actionPrincipalId(authorized.turn),
              intentRevision: toolCallId,
              capability: "assign_task",
              inputHash: actionInputHash(rawInput),
            }),
            inputHash: actionInputHash(rawInput),
            actorBotId: authorized.turn.sokoBotId,
          },
          update: {},
        });
      }
      const effectEventId = randomUUID();
      const task = await updateTaskForActor(
        {
          actor: {
            kind: "soko_bot",
            sokoBotId: authorized.turn.sokoBotId,
          },
          userId: authorized.turn.actingUserId,
          workspaceId: authorized.turn.workspaceId,
          taskId: input.taskId,
          intent: "assignment",
          ...toolAssigneeFields(
            input.coworkerId,
            authorized.turn.sokoBotId,
            ownerAssignee(input.assignToOwner, authorized.turn.actingUserId),
          ),
          status,
          channel: Channel.SOKOSUMI,
          effectEventId,
        },
        tx,
      );
      const updated = {
        id: task.id,
        name: task.name,
        status: task.status,
        assigneeId: task.assigneeId,
      };
      await tx.sokoBotDelegation.create({
        data: {
          turnId: authorized.turn.id,
          toolCallId,
          kind: "TASK",
          action: "assign_task",
          outcome: updated.status,
          lastSeenStatus: updated.status,
          taskId: updated.id,
          followUp: input.followUp,
        },
      });
      {
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: task.id,
          effectEventId,
          claimId: claim.claimId,
          observedVersion: task.updatedAt?.toISOString(),
          result: persistedToolResult(updated),
        });
      }
      return updated;
    }, "Soko Bot Task assignment collided with another action");
  }

  private async requireMutationAuthority(
    tx: Prisma.TransactionClient,
    authorized: SokoBotActionContext,
    approved: boolean,
    capability?: SokoBotCapability,
    targets: SokoBotWriteTargets = {},
  ) {
    const now = new Date();
    if (approved && authorized.confirmationTurnId) {
      await tx.$queryRaw`SELECT "id" FROM "soko_bot_turn" WHERE "id" = ${authorized.confirmationTurnId}::uuid FOR UPDATE`;
      const confirmation = await tx.sokoBotTurn.findFirst({
        where: {
          id: authorized.confirmationTurnId,
          sokoBotId: authorized.turn.sokoBotId,
          requestedByUserId: authorized.turn.requestedByUserId,
          workspaceId: authorized.turn.workspaceId,
          source: "CHAT",
          chainDepth: 0,
          status: { in: ["STARTING", "RUNNING"] },
          deadlineAt: { gt: now },
          leaseExpiresAt: { gt: now },
          cancellationRequestedAt: null,
        },
        select: { id: true },
      });
      if (!confirmation)
        throw new SokoBotRuntimeAuthorizationError(
          "Confirmation turn is no longer writable",
        );
    }
    if (approved) {
      // Serialize approved decisions with administrator PAUSE. Whichever
      // transaction locks the bot first defines whether this mutation lands
      // before the pause or is rejected after it.
      await tx.$queryRaw`
        SELECT "id"
        FROM "soko_bot"
        WHERE "id" = ${authorized.turn.sokoBotId}::uuid
        FOR UPDATE
      `;
    } else {
      // Serialize runtime writes with cancellation. A plain status read allows
      // Task/memory writes to commit after cancelTurn changes this row.
      await tx.$queryRaw`
        SELECT "id"
        FROM "soko_bot_turn"
        WHERE "id" = ${authorized.turn.id}::uuid
        FOR UPDATE
      `;
      // Serialize runtime effects with pause as well as turn cancellation.
      await tx.$queryRaw`SELECT "id" FROM "soko_bot" WHERE "id" = ${authorized.turn.sokoBotId}::uuid FOR UPDATE`;
    }
    const intentTurn = await tx.sokoBotTurn.findFirst({
      where: { id: authorized.turn.id },
      select: { intentId: true, intentRevision: true },
    });
    if (intentTurn?.intentId) {
      await tx.$queryRaw`SELECT "id" FROM "soko_bot_intent" WHERE "id" = ${intentTurn.intentId}::uuid FOR UPDATE`;
      const intent = await tx.sokoBotIntent.findFirst({
        where: {
          id: intentTurn.intentId,
          revision: intentTurn.intentRevision ?? undefined,
          sokoBotId: authorized.turn.sokoBotId,
          workspaceId: authorized.turn.workspaceId,
          state: { notIn: ["CANCELLED", "SUPERSEDED", "EXPIRED"] },
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (!intent)
        throw new SokoBotRuntimeAuthorizationError(
          "Intent is expired, cancelled or superseded",
        );
    }
    const workspace = await requireSokoBotWorkspaceAccess(
      tx,
      authorized.turn.actingUserId,
      authorized.turn.workspaceId,
    );
    if (approved) {
      const activeBot = await sokoBotForTurnMember(
        authorized.turn,
        "runningNotAdminPaused",
        tx,
      );
      if (!activeBot) {
        throw new SokoBotRuntimeAuthorizationError(
          "Soko Bot is paused or unavailable",
        );
      }
      await this.requireWriteScope(tx, activeBot, targets);
      return workspace;
    }

    const writable = await tx.sokoBotTurn.findFirst({
      where: {
        id: authorized.turn.id,
        sokoBotId: authorized.turn.sokoBotId,
        requestedByUserId: authorized.turn.requestedByUserId,
        workspaceId: authorized.turn.workspaceId,
        status: { in: ["STARTING", "RUNNING"] },
        deadlineAt: { gt: now },
        leaseExpiresAt: { gt: now },
        cancellationRequestedAt: null,
        ...(capability ? { capabilityNames: { has: capability } } : {}),
        sokoBot: {
          archivedAt: null,
          adminPausedAt: null,
          status: { not: "PAUSED" },
        },
      },
      select: {
        id: true,
        sokoBot: {
          select: {
            id: true,
            userId: true,
            workspaceId: true,
            projectId: true,
          },
        },
      },
    });
    if (!writable) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot turn is no longer writable",
      );
    }
    await this.requireWriteScope(tx, writable.sokoBot, targets);
    return workspace;
  }

  /** A shared bot writes only inside its scope; a personal bot is unchanged. */
  private async requireWriteScope(
    tx: Prisma.TransactionClient,
    bot: Parameters<typeof sokoBotSharedScopeOf>[0] | undefined,
    targets: SokoBotWriteTargets,
  ) {
    const refusal = await sokoBotWriteScopeRefusal(
      tx,
      bot ? sokoBotSharedScopeOf(bot) : null,
      targets,
    );
    if (refusal) throw new SokoBotRuntimeValidationError(refusal);
  }

  private async updateMemory(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
    toolCallId: string,
  ) {
    const input = memoryUpdateInputSchema.parse(rawInput);
    let markdown: string;
    try {
      markdown = renderSokoBotMemory(
        parseSokoBotMemory(input.markdown, { secretHandling: "reject" }),
      );
    } catch (error) {
      throw new SokoBotRuntimeValidationError(
        error instanceof Error ? error.message : "Soko Bot memory is invalid",
      );
    }
    const hash = hashMemory(markdown);
    return serializableTransaction(async (tx) => {
      await this.requireMutationAuthority(
        tx,
        authorized,
        false,
        "update_memory",
      );
      const bot = await tx.sokoBot.findUniqueOrThrow({
        where: { id: authorized.turn.sokoBotId },
        select: { memoryVersion: true },
      });
      if (bot.memoryVersion !== authorized.grant.memoryVersion) {
        const latestRevision =
          bot.memoryVersion > authorized.grant.memoryVersion
            ? await tx.sokoBotMemoryRevision.findUnique({
                where: {
                  sokoBotId_version: {
                    sokoBotId: authorized.turn.sokoBotId,
                    version: bot.memoryVersion,
                  },
                },
                select: { sourceTurnId: true },
              })
            : null;
        if (latestRevision?.sourceTurnId !== authorized.turn.id) {
          throw new SokoBotRuntimeConflictError("Memory changed during turn");
        }
      }
      const version = bot.memoryVersion + 1;
      const revision = await tx.sokoBotMemoryRevision.create({
        data: {
          sokoBotId: authorized.turn.sokoBotId,
          sourceTurnId: authorized.turn.id,
          version,
          hash,
          markdown,
          source: "runtime",
        },
        select: { id: true, version: true, hash: true, markdown: true },
      });
      await tx.sokoBot.update({
        where: { id: authorized.turn.sokoBotId },
        data: { memoryVersion: version, memoryHash: hash },
      });
      await tx.sokoBotToolCall.update({
        where: {
          turnId_toolCallId: { turnId: authorized.turn.id, toolCallId },
        },
        data: {
          status: "COMPLETED",
          result: persistedToolResult(revision),
          actorBotId: authorized.turn.sokoBotId,
          targetId: revision.id,
          disposition: "APPLIED",
          verification: "LOCAL_TRANSACTION",
          committedAt: new Date(),
        },
      });
      return revision;
    }, "Memory changed during turn");
  }

  async executeTool(input: ExecuteSokoBotToolInput): Promise<unknown> {
    const authorized = await this.authorize(input);
    assertEvaluationActor({
      ...authorized.turn,
      userId: authorized.turn.actingUserId,
      clientTurnId: authorized.turn.id,
    });
    assertEvaluationTool(input.capability, input.input);
    const inputHash = actionInputHash(input.input ?? null);
    const operationKey = ACTION_CAPABILITIES.has(input.capability)
      ? actionOperationKey({
          workspaceId: authorized.turn.workspaceId,
          principalId: actionPrincipalId(authorized.turn),
          intentRevision: authorized.turn.intentId
            ? `${authorized.turn.intentId}:${authorized.turn.intentRevision}`
            : authorized.turn.id,
          capability: input.capability,
          inputHash,
        })
      : null;
    let existing = await prisma.sokoBotToolCall.findUnique({
      where: {
        turnId_toolCallId: {
          turnId: input.turnId,
          toolCallId: input.toolCallId,
        },
      },
    });
    if (!existing) {
      existing = await serializableTransaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "soko_bot_turn"
          WHERE "id" = ${input.turnId}::uuid
          FOR UPDATE
        `;
        const raced = await tx.sokoBotToolCall.findUnique({
          where: {
            turnId_toolCallId: {
              turnId: input.turnId,
              toolCallId: input.toolCallId,
            },
          },
        });
        if (raced) return raced;
        if (operationKey) {
          const operation = await tx.sokoBotToolCall.findUnique({
            where: { operationKey },
          });
          if (operation) return operation;
        }
        const isRead = CORE_READ_CAPABILITIES.includes(input.capability);
        const callCount = await tx.sokoBotToolCall.count({
          where: {
            turnId: input.turnId,
            ...(isRead ? CORE_READ_CALLS : CORE_WRITE_CALLS),
          },
        });
        const limit = isRead
          ? authorized.toolCallLimit * READ_CALLS_PER_WRITE_CALL
          : authorized.toolCallLimit;
        if (callCount >= limit) {
          throw new SokoBotRuntimeConflictError(
            "Soko Bot turn tool-call limit reached",
          );
        }
        await tx.sokoBotToolCall.create({
          data: {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
            capability: input.capability,
            operationKey,
            actorBotId: authorized.turn.sokoBotId,
            inputHash,
            input: persistedToolResult(input.input ?? null),
          },
        });
        return null;
      }, "Soko Bot tool-call reservation collided with another call");
    }
    if (existing) {
      if (
        existing.inputHash !== inputHash ||
        existing.capability !== input.capability
      ) {
        throw new SokoBotRuntimeAuthorizationError(
          "Tool call id was reused with different input",
        );
      }
      if (existing.disposition === "UNKNOWN") {
        throw new SokoBotRuntimeConflictError(
          "Effect outcome is unknown; reconciliation is required before retrying",
        );
      }
      if (existing.status === "COMPLETED") {
        let replayResult = existing.result;
        if (input.capability === "preview_result") {
          if (authorized.askedByKind !== "OWNER")
            throw new SokoBotRuntimeAuthorizationError(
              "Result previews are prepared for the owner's requests",
            );
          const snapshot = chatResultSnapshotSchema.parse(existing.result);
          const [preview] = await hydrateChatResultSnapshots(
            [snapshot],
            actingMemberOf(authorized),
          );
          if (!preview || preview.state !== "available")
            throw new SokoBotRuntimeAuthorizationError("Result unavailable");
          return { ...snapshot, data: preview };
        }
        if (
          [
            "create_social_post",
            "update_social_post",
            "schedule_social_post",
            "cancel_social_post",
            "publish_social_post",
            "refresh_social_post_statistics",
            "refresh_social_account_statistics",
          ].includes(input.capability)
        ) {
          await this.requireSocialAccess(authorized);
        }
        if (input.capability === "refresh_social_post_statistics") {
          const params =
            SOKO_BOT_TOOL_INPUT_SCHEMAS.refresh_social_post_statistics.parse(
              input.input,
            );
          // Recheck project access and return the cache without another provider fetch.
          return socialPostSchema.parse(
            await getSocialPost({
              ...params,
              workspaceId: authorized.turn.workspaceId,
            }),
          );
        }
        if (input.capability === "refresh_social_account_statistics") {
          const params =
            SOKO_BOT_TOOL_INPUT_SCHEMAS.refresh_social_account_statistics.parse(
              input.input,
            );
          const result = await listSocialAccountStatistics({
            projectId: params.projectId,
            connectionId: params.connectionId,
            workspaceId: authorized.turn.workspaceId,
            limit: 1,
          });
          const account = result.accounts.find(
            (account) => account.id === params.connectionId,
          );
          if (!account)
            throw new SokoBotRuntimeAuthorizationError(
              "Social account is no longer available",
            );
          return { account, importedPostCount: 0 };
        }
        if (
          input.capability === "list_tables" ||
          input.capability === "read_table"
        ) {
          return this.executeAuthorizedTool(input);
        }
        if (
          input.capability === "list_project_social_accounts" ||
          input.capability === "list_social_posts" ||
          input.capability === "list_social_post_statistics" ||
          input.capability === "list_social_account_statistics" ||
          input.capability === "get_social_post"
        ) {
          const result = await this.executeAuthorizedTool(input);
          await prisma.sokoBotToolCall.updateMany({
            where: {
              turnId: input.turnId,
              toolCallId: input.toolCallId,
              status: "COMPLETED",
            },
            data: { result: persistedToolResult(result) },
          });
          return result;
        }
        if (
          ["create_table", "write_table_rows", "update_table_columns"].includes(
            input.capability,
          )
        ) {
          const actor = await this.tableActor(authorized, input.input);
          let key: string;
          let request: unknown;
          if (input.capability === "create_table") {
            const body = createDataTableSchema.parse(input.input);
            key = body.key;
            request = { create: body };
          } else {
            const { tableId } = z
              .object({ tableId: z.uuid() })
              .parse(input.input);
            if (input.capability === "write_table_rows") {
              const body = tableBatchSchema.parse(input.input);
              key = body.key;
              request = {
                id: tableId,
                batch: body,
                taskId: actor.taskId ?? body.taskId,
              };
            } else {
              const body = tableMutationSchema.parse(input.input);
              const { removeColumnIds } =
                SOKO_BOT_TOOL_INPUT_SCHEMAS.update_table_columns.parse(
                  input.input,
                );
              key = body.key;
              request = removeColumnIds?.length
                ? { id: tableId, metadata: body, removeColumnIds }
                : { id: tableId, metadata: body };
            }
          }
          const operation = await readTableOperation(actor, key, request);
          if (existing.targetId && operation.tableId !== existing.targetId)
            throw new SokoBotRuntimeConflictError(
              "Table receipt target changed",
            );
          replayResult =
            input.capability === "create_table"
              ? {
                  table: operation.result,
                  url: `/drive/tables/${operation.tableId}`,
                  instruction:
                    "Table created. Present this link now; enrich in bounded batches. Reuse this table ID for follow-ups.",
                }
              : operation.result;
        }
        if (
          input.capability === "archive_task" &&
          !(await verifyTaskArchiveReceipt(
            prisma,
            existing.replayedReceiptId ?? existing.id,
          ))
        ) {
          throw new SokoBotRuntimeConflictError(
            "Archived task history could not be verified",
          );
        }
        if (
          operationKey &&
          (existing.turnId !== input.turnId ||
            existing.toolCallId !== input.toolCallId)
        ) {
          await prisma.sokoBotToolCall.upsert({
            where: {
              turnId_toolCallId: {
                turnId: input.turnId,
                toolCallId: input.toolCallId,
              },
            },
            create: {
              turnId: input.turnId,
              toolCallId: input.toolCallId,
              capability: input.capability,
              actorBotId: authorized.turn.sokoBotId,
              inputHash,
              input: persistedToolResult(input.input ?? null),
              result: persistedToolResult(existing.result),
              status: "COMPLETED",
              replayedReceiptId: existing.replayedReceiptId ?? existing.id,
              disposition: "ALREADY_SATISFIED",
              verification: "NONE",
            },
            // Never replace a real action receipt with a replay marker.
            update: {},
          });
        }
        return replayResult;
      }
      if (
        existing.status === "FAILED" &&
        !EXTERNAL_EFFECT_CAPABILITIES.has(input.capability) &&
        existing.disposition === "REJECTED" &&
        existing.verification === "NONE" &&
        !existing.committedAt
      ) {
        const reopened = await prisma.sokoBotToolCall.updateMany({
          where: {
            id: existing.id,
            status: "FAILED",
            disposition: "REJECTED",
            verification: "NONE",
            committedAt: null,
          },
          data: {
            status: "PENDING",
            disposition: null,
            operationKey,
            errorKind: null,
            errorDetail: null,
          },
        });
        if (reopened.count !== 1)
          throw new SokoBotRuntimeConflictError(
            "Tool call retry was claimed concurrently",
          );
      } else {
        if (existing.status === "FAILED") {
          throw new SokoBotRuntimeConflictError("Tool call previously failed");
        }
        if (EXTERNAL_EFFECT_CAPABILITIES.has(input.capability)) {
          await prisma.sokoBotToolCall.updateMany({
            where: {
              id: existing.id,
              status: "PENDING",
              updatedAt: { lt: new Date(Date.now() - TOOL_CALL_STALE_MS) },
            },
            data: {
              status: "FAILED",
              disposition: "UNKNOWN",
              verification: "NONE",
            },
          });
          throw new SokoBotRuntimeConflictError(
            "Effect outcome is unknown; reconciliation is required before retrying",
          );
        }
        if (existing.turnId && existing.turnId !== input.turnId) {
          throw new SokoBotRuntimeConflictError(
            "Previous-turn operation requires reconciliation before retrying",
          );
        }
        const reclaimed = await prisma.sokoBotToolCall.updateMany({
          where: {
            id: existing.id,
            status: "PENDING",
            updatedAt: {
              lt: new Date(Date.now() - TOOL_CALL_STALE_MS),
            },
          },
          data: {
            updatedAt: new Date(),
            errorKind: null,
            errorDetail: null,
          },
        });
        if (reclaimed.count === 0) {
          throw new SokoBotRuntimeConflictError(
            "Tool call is already executing",
          );
        }
      }
      // A semantic retry may carry a new call id. The original reserved row
      // remains authoritative for its transaction and finalization.
      if (existing.toolCallId)
        input = { ...input, toolCallId: existing.toolCallId };
    }

    if (
      input.capability === "generate_image" ||
      input.capability === "generate_video"
    ) {
      try {
        if (input.capability === "generate_image")
          await this.checkImageRequest(
            authorized,
            input.input,
            input.toolCallId,
          );
        else
          await this.checkVideoRequest(
            authorized,
            input.input,
            input.toolCallId,
          );
      } catch (error) {
        // Refused before anything was sent: rejected, and the same request
        // may be made again once whatever refused it has changed.
        await prisma.sokoBotToolCall.updateMany({
          where: {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
            status: "PENDING",
          },
          data: {
            status: "FAILED",
            disposition: "REJECTED",
            operationKey: null,
            errorKind: error instanceof Error ? error.name : "unknown",
            errorDetail: persistedErrorDetail(error),
          },
        });
        throw error;
      }
    }
    const externalEffect = EXTERNAL_EFFECT_CAPABILITIES.has(input.capability);
    if (externalEffect) {
      // Fence cancellation and capability revocation at the durable dispatch
      // boundary. A crash after this commit remains UNKNOWN, never retryable.
      await serializableTransaction(async (tx) => {
        await this.requireMutationAuthority(
          tx,
          authorized,
          false,
          input.capability,
        );
        const reserved = await tx.sokoBotToolCall.updateMany({
          where: {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
            status: "PENDING",
          },
          data: { disposition: "UNKNOWN", verification: "NONE" },
        });
        if (reserved.count !== 1)
          throw new SokoBotRuntimeConflictError(
            "External action reservation is unavailable",
          );
      }, "External action reservation changed concurrently");
    }
    try {
      const result = await this.executeAuthorizedTool(input);
      await prisma.sokoBotToolCall.updateMany({
        where: {
          turnId: input.turnId,
          toolCallId: input.toolCallId,
          ...(externalEffect
            ? {
                status: { in: ["PENDING", "COMPLETED"] },
                disposition: "UNKNOWN",
                verification: "NONE",
              }
            : { status: "PENDING" }),
        },
        data: {
          ...(externalEffect
            ? externalActionReceipt(input.capability, result)
            : {}),
          status: "COMPLETED",
          result: persistedToolResult(result ?? null),
        },
      });
      return result;
    } catch (error) {
      const refusedUnsent = error instanceof SokoBotRefusedUnsentError;
      await prisma.sokoBotToolCall.updateMany({
        where: {
          turnId: input.turnId,
          toolCallId: input.toolCallId,
          ...(externalEffect
            ? {
                status: { in: ["PENDING", "COMPLETED"] },
                disposition: "UNKNOWN",
                verification: "NONE",
              }
            : { status: "PENDING" }),
        },
        data: {
          status: "FAILED",
          // A rolled-back local attempt is not an enduring semantic
          // reservation, and neither is an effect refused before it was sent.
          ...(!externalEffect || refusedUnsent ? { operationKey: null } : {}),
          disposition: ACTION_CAPABILITIES.has(input.capability)
            ? EXTERNAL_EFFECT_CAPABILITIES.has(input.capability) &&
              !refusedUnsent
              ? "UNKNOWN"
              : "REJECTED"
            : undefined,
          errorKind: error instanceof Error ? error.name : "unknown",
          errorDetail: persistedErrorDetail(error),
        },
      });
      throw error;
    }
  }

  private async tableActor(
    authorized: AuthorizedSokoBotRuntime,
    rawInput: unknown,
  ) {
    const auth = await loadSokoBotTurnAuthContext(authorized.turn);
    if (!auth)
      throw new SokoBotRuntimeAuthorizationError("Soko Bot is unavailable");
    const actor = await resolveTableActor(auth, auth.workspaceId);
    const { taskId } = z
      .object({ taskId: z.string().max(200).optional() })
      .parse(rawInput);
    const ownerChat =
      authorized.turn.source === "CHAT" &&
      authorized.askedByKind !== "ASSISTANT" &&
      authorized.turn.chainDepth === 0;
    if (!ownerChat && !taskId)
      throw new SokoBotRuntimeAuthorizationError(
        "Task-driven table operations require an assigned taskId",
      );
    return { ...actor, taskId, ownerChat };
  }

  /**
   * Contacts are the workspace's shared set: a bot reads and writes them as
   * the member its turn acts for, personal and shared bots alike.
   */
  private async executeContactTool(
    input: ExecuteSokoBotToolInput,
    authorized: AuthorizedSokoBotRuntime,
  ) {
    const { capability } = input;
    if (!isContactCapability(capability))
      throw new SokoBotRuntimeValidationError("Not a contacts tool");
    const userId = actingMemberOf(authorized);
    await requireSokoBotWorkspaceAccess(
      prisma,
      userId,
      authorized.turn.workspaceId,
    );
    const actor = {
      workspaceId: authorized.turn.workspaceId,
      userId,
      sokoBotId: authorized.turn.sokoBotId,
    };
    return runContactTool(capability, input.input, actor, {
      authorize: (tx) =>
        this.requireMutationAuthority(tx, authorized, false, capability),
      commit: (tx, targetId, result) =>
        commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId: input.toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId,
          result: persistedToolResult(result),
        }),
    });
  }

  /** Social tools use the turn's owner/workspace, never actor fields from model input. */
  private async requireSocialAccess(
    authorized: AuthorizedSokoBotRuntime,
    tx: Prisma.TransactionClient = prisma,
  ) {
    if (
      authorized.turn.chainDepth > 0 ||
      authorized.askedByKind === "ASSISTANT" ||
      authorized.askedByKind === "TEAMMATE"
    ) {
      throw new SokoBotRuntimeAuthorizationError(
        "Project social tools are only available for the owner",
      );
    }
    const userId = actingMemberOf(authorized);
    const owner = await tx.user.findUnique({
      where: { id: userId },
      select: BEARER_USER_SELECT,
    });
    if (!isActiveUser(owner)) {
      throw new SokoBotRuntimeAuthorizationError(
        "Social account owner is no longer active",
      );
    }
    const workspace = await requireSokoBotWorkspaceAccess(
      tx,
      userId,
      authorized.turn.workspaceId,
    );
    await requireAssignedOrganizationSeat(userId, workspace.organizationId, tx);
    await requireSocialBetaAccess(userId, tx);
    return workspace;
  }

  private async executeSocialTool(
    input: ExecuteSokoBotToolInput,
    authorized: AuthorizedSokoBotRuntime,
  ) {
    const { workspaceId } = authorized.turn;
    const userId = actingMemberOf(authorized);
    switch (input.capability) {
      case "list_project_social_accounts": {
        const params =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.list_project_social_accounts.parse(
            input.input,
          );
        await this.requireSocialAccess(authorized);
        return z
          .array(projectSocialConnectionSchema)
          .parse(
            await listProjectSocialConnections({ ...params, workspaceId }),
          );
      }
      case "list_social_posts": {
        const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.list_social_posts.parse(
          input.input,
        );
        await this.requireSocialAccess(authorized);
        const result = await listSocialPosts({ ...params, workspaceId });
        return {
          ...result,
          posts: result.posts.map((post) => socialPostSchema.parse(post)),
        };
      }
      case "list_social_post_statistics": {
        const params =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.list_social_post_statistics.parse(
            input.input,
          );
        await this.requireSocialAccess(authorized);
        const result = await listSocialPostStatistics({
          ...params,
          workspaceId,
          publishedFrom: params.publishedFrom
            ? new Date(params.publishedFrom)
            : undefined,
          publishedUntil: params.publishedUntil
            ? new Date(params.publishedUntil)
            : undefined,
        });
        return {
          ...result,
          posts: result.posts.map((post) => socialPostSchema.parse(post)),
        };
      }
      case "refresh_social_post_statistics": {
        const params =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.refresh_social_post_statistics.parse(
            input.input,
          );
        await this.requireSocialAccess(authorized);
        return socialPostSchema.parse(
          await refreshSocialPostStatistics({ ...params, workspaceId, userId }),
        );
      }
      case "list_social_account_statistics": {
        const params =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.list_social_account_statistics.parse(
            input.input,
          );
        await this.requireSocialAccess(authorized);
        return listSocialAccountStatistics({
          ...params,
          workspaceId,
          publishedFrom: params.publishedFrom
            ? new Date(params.publishedFrom)
            : undefined,
          publishedUntil: params.publishedUntil
            ? new Date(params.publishedUntil)
            : undefined,
        });
      }
      case "refresh_social_account_statistics": {
        const params =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.refresh_social_account_statistics.parse(
            input.input,
          );
        await this.requireSocialAccess(authorized);
        return refreshSocialAccountStatistics({
          ...params,
          workspaceId,
          userId,
        });
      }
      case "get_social_post": {
        const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.get_social_post.parse(
          input.input,
        );
        await this.requireSocialAccess(authorized);
        return socialPostSchema.parse(
          await getSocialPost({ ...params, workspaceId }),
        );
      }
      case "publish_social_post": {
        const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.publish_social_post.parse(
          input.input,
        );
        await this.requireSocialAccess(authorized);
        // The external-effect reservation fences retries before the provider call.
        // The publisher owns revision checks, claiming, and delivery reconciliation.
        return socialPostSchema.parse(
          await publishSocialPostNow({ ...params, workspaceId, userId }),
        );
      }
      case "create_social_post":
      case "update_social_post":
      case "schedule_social_post":
      case "cancel_social_post": {
        // Resolved before the transaction: it reads the blob store, and a
        // serializable transaction should not wait on the network.
        const media =
          input.capability === "create_social_post" ||
          input.capability === "update_social_post"
            ? await this.resolveSocialMedia(
                authorized,
                SOKO_BOT_TOOL_INPUT_SCHEMAS[input.capability].parse(input.input)
                  .media,
              )
            : undefined;
        return serializableTransaction(async (tx) => {
          await this.requireMutationAuthority(
            tx,
            authorized,
            false,
            input.capability,
          );
          const workspace = await this.requireSocialAccess(authorized, tx);
          const scope = {
            workspaceId,
            userId,
            organizationId: workspace.organizationId,
          };
          const post = await (async () => {
            switch (input.capability) {
              case "create_social_post": {
                const params =
                  SOKO_BOT_TOOL_INPUT_SCHEMAS.create_social_post.parse(
                    input.input,
                  );
                return createSocialPost(
                  {
                    ...params,
                    ...scope,
                    media,
                    sokoBotId: authorized.turn.sokoBotId,
                    scheduledAt: params.scheduledAt
                      ? new Date(params.scheduledAt)
                      : undefined,
                  },
                  tx,
                );
              }
              case "update_social_post": {
                const params =
                  SOKO_BOT_TOOL_INPUT_SCHEMAS.update_social_post.parse(
                    input.input,
                  );
                return updateSocialPost({ ...params, ...scope, media }, tx);
              }
              case "schedule_social_post": {
                const params =
                  SOKO_BOT_TOOL_INPUT_SCHEMAS.schedule_social_post.parse(
                    input.input,
                  );
                return scheduleSocialPost(
                  {
                    ...params,
                    ...scope,
                    scheduledAt: new Date(params.scheduledAt),
                  },
                  tx,
                );
              }
              case "cancel_social_post": {
                const params =
                  SOKO_BOT_TOOL_INPUT_SCHEMAS.cancel_social_post.parse(
                    input.input,
                  );
                return cancelSocialPost({ ...params, ...scope }, tx);
              }
              default:
                throw new SokoBotRuntimeValidationError(
                  "Unsupported social mutation",
                );
            }
          })();
          const result = socialPostSchema.parse(post);
          await commitActionReceipt(tx, {
            turnId: authorized.turn.id,
            toolCallId: input.toolCallId,
            actorBotId: authorized.turn.sokoBotId,
            targetId: post.id,
            observedVersion: String(post.revision),
            result: persistedToolResult(result),
          });
          return result;
        }, "Social post changed concurrently");
      }
      default:
        throw new SokoBotRuntimeValidationError("Unsupported social tool");
    }
  }

  /**
   * Cheaper models garble the tail of a long id they copy: Joseph read the
   * right Task, then sent four reply_to_task calls with `…7facc56a2e6a` for
   * `…7facc56b861e`. A uuid v7's first 23 characters are its millisecond and
   * random bits, so one visible Task matching them is the Task meant.
   */
  private async resolveTaskIds(
    authorized: AuthorizedSokoBotRuntime,
    value: unknown,
  ): Promise<unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const input = { ...(value as Record<string, unknown>) };
    const visible = {
      workspaceId: authorized.turn.workspaceId,
      ...buildSokoBotReaderTaskWhere(authorized.reader),
    };
    for (const field of TASK_ID_FIELDS) {
      const id = input[field];
      if (typeof id !== "string" || id.length < TASK_ID_PREFIX) continue;
      const exact = await prisma.task.findFirst({
        where: { ...visible, id },
        select: { id: true },
      });
      if (exact) continue;
      const matches = await prisma.task.findMany({
        where: { ...visible, id: { startsWith: id.slice(0, TASK_ID_PREFIX) } },
        select: { id: true },
        take: 2,
      });
      if (matches.length === 1 && matches[0]) input[field] = matches[0].id;
    }
    return input;
  }

  private async executeAuthorizedTool(
    raw: ExecuteSokoBotToolInput,
  ): Promise<unknown> {
    const authorized = await this.authorize(raw);
    const input = {
      ...raw,
      input: await this.resolveTaskIds(authorized, raw.input),
    };
    switch (input.capability) {
      case "list_project_social_accounts":
      case "list_social_posts":
      case "list_social_post_statistics":
      case "refresh_social_post_statistics":
      case "list_social_account_statistics":
      case "refresh_social_account_statistics":
      case "get_social_post":
      case "create_social_post":
      case "update_social_post":
      case "schedule_social_post":
      case "cancel_social_post":
      case "publish_social_post":
        return this.executeSocialTool(input, authorized);
      case "start_background_run":
      case "list_background_runs":
      case "stop_background_run": {
        const runs = await import(
          "@/services/soko-bot-background-runs.service"
        );
        if (input.capability === "list_background_runs")
          return runs.listBackgroundRuns(authorized);
        if (input.capability === "stop_background_run")
          return runs.stopBackgroundRun(
            authorized,
            SOKO_BOT_TOOL_INPUT_SCHEMAS.stop_background_run.parse(input.input)
              .runId,
          );
        return runs.startBackgroundRun(
          authorized,
          sokoBotStartBackgroundRunInputSchema.parse(input.input),
        );
      }
      case "search_contacts":
      case "get_contact":
      case "list_contact_lists":
      case "find_contact_duplicates":
      case "upsert_contact":
      case "update_contact":
      case "log_contact_interaction":
      case "merge_contacts":
      case "manage_contact_lists":
        return this.executeContactTool(input, authorized);
      case "list_tables":
      case "read_table":
      case "create_table":
      case "write_table_rows":
      case "update_table_columns": {
        const scopedActor = await this.tableActor(authorized, input.input);
        const { taskId } = scopedActor;
        const actor = scopedActor;
        if (input.capability === "list_tables")
          return listDataTables(
            scopedActor,
            z
              .object({
                cursor: z.uuid().optional(),
                limit: z.number().int().min(1).max(100).optional(),
              })
              .parse(input.input),
          );
        const complete: TableOperationCompletion = async (tx, operation) => {
          await this.requireMutationAuthority(
            tx,
            authorized,
            false,
            input.capability,
            { taskIds: [taskId] },
          );
          const table =
            input.capability === "create_table"
              ? dataTableSchema.parse(operation.result)
              : null;
          const result = table
            ? {
                table,
                url: `/drive/tables/${table.id}`,
                instruction:
                  "Table created. Present this link now; enrich in bounded batches. Reuse this table ID for follow-ups.",
              }
            : operation.result;
          if (table) {
            const turn = await tx.sokoBotTurn.findUnique({
              where: { id: authorized.turn.id },
              select: {
                chatMention: {
                  select: { message: { select: { roomId: true } } },
                },
              },
            });
            const publications = [
              ...(turn?.chatMention
                ? [
                    {
                      capability: "post_chat" as const,
                      destination: turn.chatMention.message.roomId,
                    },
                  ]
                : []),
              ...(taskId
                ? [
                    {
                      capability: "reply_to_task" as const,
                      destination: taskId,
                    },
                  ]
                : []),
            ];
            for (const publication of publications) {
              // Table creation never grants independent chat/task write permission.
              if (
                !authorized.grant.capabilities.includes(publication.capability)
              ) {
                throw new SokoBotRuntimeAuthorizationError(
                  "Table link publication requires its own capability grant",
                );
              }
              await this.requireMutationAuthority(
                tx,
                authorized,
                false,
                publication.capability,
              );
              const kind =
                publication.capability === "post_chat" ? "chat" : "task";
              const publicationId = uuidv5(
                `table-created:${kind}:${publication.destination}:${actor.actorId}`,
                table.id,
              );
              const childToolCallId = `${input.toolCallId}:table-link:${kind}`;
              const content =
                kind === "chat"
                  ? `[${table.title.replaceAll("[", "").replaceAll("]", "")}](/drive/tables/${table.id})`
                  : `[Open table](/drive/tables/${table.id})`;
              const childInput =
                publication.capability === "post_chat"
                  ? { roomId: publication.destination, content }
                  : { taskId: publication.destination, comment: content };
              const childInputHash = actionInputHash(childInput);
              const child = await tx.sokoBotToolCall.upsert({
                where: {
                  turnId_toolCallId: {
                    turnId: authorized.turn.id,
                    toolCallId: childToolCallId,
                  },
                },
                create: {
                  turnId: authorized.turn.id,
                  toolCallId: childToolCallId,
                  capability: publication.capability,
                  actorBotId: actor.actorId,
                  inputHash: childInputHash,
                  input: persistedToolResult(childInput),
                  status: "PENDING",
                },
                update: {},
              });
              if (
                child.capability !== publication.capability ||
                child.inputHash !== childInputHash
              ) {
                throw new SokoBotRuntimeAuthorizationError(
                  "Table link tool call ID was reused with different input",
                );
              }
              if (child.status === "COMPLETED") continue;
              if (
                (await tx.sokoBotToolCall.count({
                  where: { turnId: authorized.turn.id, ...CORE_WRITE_CALLS },
                })) > authorized.toolCallLimit
              ) {
                throw new SokoBotRuntimeConflictError(
                  "Soko Bot turn tool-call limit reached",
                );
              }
              if (publication.capability === "post_chat") {
                await this.postChat(
                  authorized,
                  {
                    roomId: publication.destination,
                    content,
                    toolCallId: childToolCallId,
                    publicationId,
                  },
                  tx,
                );
              } else {
                await this.replyToTask(
                  authorized,
                  { taskId: publication.destination, comment: content },
                  childToolCallId,
                  { transaction: tx, publicationId },
                );
              }
            }
          }
          await commitActionReceipt(tx, {
            turnId: authorized.turn.id,
            toolCallId: input.toolCallId,
            actorBotId: actor.actorId,
            targetId: operation.tableId,
            disposition: operation.replayed ? "ALREADY_SATISFIED" : "APPLIED",
            result: persistedToolResult(result),
          });
        };
        if (input.capability === "create_table") {
          const table = await createDataTable(
            scopedActor,
            createDataTableSchema.parse(input.input),
            complete,
          );
          return {
            table,
            url: `/drive/tables/${table.id}`,
            instruction:
              "Table created. Present this link now; enrich in bounded batches. Reuse this table ID for follow-ups.",
          };
        }
        const { tableId } = z
          .object({ tableId: z.uuid(), taskId: z.string().optional() })
          .parse(input.input);
        if (input.capability === "read_table")
          return {
            table: dataTableSchema.parse(
              await requireDataTable(scopedActor, tableId),
            ),
            ...(await queryTableRows(
              scopedActor,
              tableId,
              tableQuerySchema.parse(input.input),
            )),
          };
        if (input.capability === "write_table_rows")
          return batchTableRows(
            scopedActor,
            tableId,
            tableBatchSchema.parse(input.input),
            complete,
          );
        const { removeColumnIds } =
          SOKO_BOT_TOOL_INPUT_SCHEMAS.update_table_columns.parse(input.input);
        // Deleting columns deletes their data: only on the owner's word.
        const { isOwnerDirected } = await import("@/lib/soko-bot/turn-loop");
        if (
          removeColumnIds?.length &&
          !(await isOwnerDirected(authorized.turn.id))
        )
          throw new SokoBotRuntimeValidationError(
            "Columns are only deleted when the owner asks in chat; ask them first",
          );
        return mutateDataTable(
          scopedActor,
          tableId,
          { ...tableMutationSchema.parse(input.input), removeColumnIds },
          complete,
        );
      }
      case "refresh_context":
        return this.getContext(input);
      case "find_coworkers": {
        const { query } = searchInputSchema.parse(input.input);
        return prisma.coworker.findMany({
          where: {
            archivedAt: null,
            AND: [
              {
                OR: [
                  { isWhitelisted: true },
                  // A shared bot sees no member's private assignments.
                  ...(authorized.reader.sharedScope
                    ? []
                    : [
                        {
                          assignments: {
                            some: { userId: actingMemberOf(authorized) },
                          },
                        },
                      ]),
                  {
                    workspaceAccess: {
                      some: {
                        workspaceId: authorized.turn.workspaceId,
                        status: "GRANTED",
                      },
                    },
                  },
                ],
              },
              ...(query
                ? [
                    {
                      OR: [
                        {
                          name: {
                            contains: query,
                            mode: "insensitive" as const,
                          },
                        },
                        {
                          description: {
                            contains: query,
                            mode: "insensitive" as const,
                          },
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
          take: 20,
          select: {
            id: true,
            name: true,
            caption: true,
            description: true,
            capabilities: true,
          },
        });
      }
      case "create_task": {
        const { fileIds, ...task } = taskCreateInputSchema.parse(input.input);
        const created = await this.createTask(
          authorized,
          {
            ...task,
            description: await this.withInlineFiles(
              authorized,
              task.description ?? "",
              fileIds,
            ),
          },
          input.toolCallId,
        );
        return fileIds?.length
          ? {
              ...created,
              attachedFiles: await this.attachDriveFiles(
                authorized,
                created.id,
                fileIds,
              ),
            }
          : created;
      }
      case "update_task":
      case "archive_task":
        return this.mutateTask(authorized, input.input, input.toolCallId, {
          capability: input.capability,
        });
      case "assign_task":
        return this.assignTask(authorized, input.input, input.toolCallId);
      case "get_task_status": {
        const { taskId } = taskIdInputSchema.parse(input.input);
        return this.readTask(authorized, taskId);
      }
      case "list_tasks":
        return this.listTasks(authorized, input.input);
      case "update_assigned_task":
        return this.updateAssignedTask(
          authorized,
          input.input,
          input.toolCallId,
        );
      case "reply_to_task": {
        const { fileIds, ...reply } = replyToTaskInputSchema.parse(input.input);
        const chaseRefusal = await unattendedChaseRefusal({
          turn: authorized.turn,
          comment: reply.comment,
          shared: !!authorized.reader.sharedScope,
        });
        if (chaseRefusal) throw new SokoBotRuntimeValidationError(chaseRefusal);
        const replied = await this.replyToTask(
          authorized,
          {
            ...reply,
            comment: await this.withInlineFiles(
              authorized,
              reply.comment,
              fileIds,
            ),
          },
          input.toolCallId,
        );
        return fileIds?.length
          ? {
              ...replied,
              attachedFiles: await this.attachDriveFiles(
                authorized,
                reply.taskId,
                fileIds,
              ),
            }
          : replied;
      }
      case "link_tasks":
        return this.linkTasks(authorized, input.input, input.toolCallId);
      case "find_agents": {
        const { query } = searchInputSchema.parse(input.input);
        return findHireableAgents(query);
      }
      case "get_agent_input_schema": {
        const { agentId } = agentIdInputSchema.parse(input.input);
        // Availability is checked after the lookup for the same reason the
        // Task lookup does it that way: an agent that is listed but offline
        // is not a missing one, and saying so sends the bot hunting for an
        // id it already had right. `isShown` stays in the lookup, though —
        // an unlisted Agent must read as absent, or a bot holding a stray
        // UUID could enumerate rows `find_agents` deliberately hides.
        const agent = await prisma.agent.findFirst({
          where: { id: agentId, isShown: true },
          select: {
            id: true,
            name: true,
            status: true,
            blockchainIdentifier: true,
            apiBaseUrl: true,
            metadataOverride: { select: { apiBaseUrl: true } },
          },
        });
        if (!agent) throw new SokoBotRuntimeValidationError("Agent not found");
        // The same endpoint `toMasumiAgent` will use: an Agent reachable only
        // through its metadata override is hireable, and reporting it as
        // unavailable sends the bot looking for a different one.
        if (agent.status !== "ONLINE" || !getAgentApiBaseUrl(agent)) {
          throw new SokoBotRuntimeValidationError(
            `This Agent is not available to hire right now (${agent.status.toLowerCase()}). Pick another from find_agents.`,
          );
        }
        const result = await createAgentClient().fetchAgentInputSchema(
          toMasumiAgent(agent),
        );
        if (result.isErr())
          throw new SokoBotRuntimeValidationError(result.error);
        return inputSchemaSchema.parse(result.value);
      }
      case "hire_agent": {
        const hire = parseHireAgentInput(input.input);
        const refusal = await unattendedHireRefusal({
          turn: authorized.turn,
          shared: !!authorized.reader.sharedScope,
          maxCredits: hire.maxCredits,
          ceiling: getEnv().SOKO_BOT_UNATTENDED_MAX_HIRE_CREDITS,
          toolCallId: input.toolCallId,
        });
        if (refusal) throw new SokoBotRuntimeValidationError(refusal);
        return this.executeAsAccepted(
          authorized,
          input.capability,
          input.input,
          input.toolCallId,
        );
      }
      case "get_job_status": {
        const { jobId } = jobIdInputSchema.parse(input.input);
        const row = await prisma.job.findFirst({
          where: {
            AND: [
              { id: jobId, workspaceId: authorized.turn.workspaceId },
              buildSokoBotReaderJobWhere(authorized.reader),
            ],
          },
          include: jobInclude,
        });
        if (!row) return null;
        const job = mapJobWithStatus(row);
        return {
          id: job.id,
          name: job.name ?? job.agent.name,
          agent: { id: job.agentId, name: job.agent.name },
          url: new URL(
            `/agents/${encodeURIComponent(job.agentId)}/jobs/${encodeURIComponent(job.id)}`,
            getEnv().WEB_APP_BASE_URL,
          ).toString(),
          updatedAt: job.updatedAt.toISOString(),
          ...digestJob(job),
          trust: "untrusted-data",
        };
      }
      case "provide_job_input":
        provideJobInputSchema.parse(input.input);
        return this.executeAsAccepted(
          authorized,
          input.capability,
          input.input,
          input.toolCallId,
        );
      case "read_memory":
        return prisma.sokoBotMemoryRevision
          .findFirst({
            where: { sokoBotId: authorized.turn.sokoBotId },
            orderBy: { version: "desc" },
            select: { id: true, version: true, hash: true, markdown: true },
          })
          .then((revision) => {
            if (!revision) return null;
            const markdown = sanitizeSokoBotMemoryMarkdown(revision.markdown);
            return { ...revision, markdown, hash: hashMemory(markdown) };
          });
      case "update_memory":
        return this.updateMemory(authorized, input.input, input.toolCallId);
      case "manage_reminder": {
        const parsed = sokoBotManageReminderInputSchema.parse(input.input);
        return serializableTransaction(async (tx) => {
          await this.requireMutationAuthority(
            tx,
            authorized,
            false,
            "manage_reminder",
          );
          const reminder = await manageSokoBotReminder(tx, {
            sokoBotId: authorized.turn.sokoBotId,
            ...parsed,
          });
          if (!reminder.applied || !reminder.id)
            throw new SokoBotRuntimeValidationError(
              "Reminder changed or action is invalid; read it again",
            );
          await commitActionReceipt(tx, {
            turnId: authorized.turn.id,
            toolCallId: input.toolCallId,
            actorBotId: authorized.turn.sokoBotId,
            targetId: reminder.id,
            result: persistedToolResult(reminder),
          });
          return reminder;
        }, "Reminder changed concurrently");
      }
      case "list_schedules":
        return listSokoBotSchedules(authorized.turn.sokoBotId);
      case "list_chats":
        return this.listChats(authorized);
      case "read_chat": {
        const parsed = sokoBotReadChatInputSchema.parse(input.input);
        return this.readChat(authorized, parsed);
      }
      case "open_direct_chat": {
        const parsed = sokoBotOpenDirectChatInputSchema.parse(input.input);
        return this.openDirectChat(authorized, {
          ...parsed,
          toolCallId: input.toolCallId,
        });
      }
      case "ask_coworker": {
        const parsed = sokoBotAskCoworkerInputSchema.parse(input.input);
        return this.askCoworker(authorized, {
          ...parsed,
          toolCallId: input.toolCallId,
        });
      }
      case "preview_result": {
        const { reference } = sokoBotPreviewResultInputSchema.parse(
          input.input,
        );
        // A colleague's prompt cannot turn the owner's private data into a result.
        if (authorized.askedByKind !== "OWNER") {
          throw new SokoBotRuntimeAuthorizationError(
            "Result previews are prepared for the owner's requests",
          );
        }
        return resolveChatResultReference({
          reference,
          actor: {
            userId: actingMemberOf(authorized),
            workspaceId: authorized.turn.workspaceId,
            kind: "soko_bot",
          },
        });
      }
      case "post_chat": {
        const parsed = sokoBotPostChatInputSchema.parse(input.input);
        return this.postChat(authorized, {
          ...parsed,
          toolCallId: input.toolCallId,
        });
      }
      case "list_files": {
        const parsed = sokoBotListFilesInputSchema.parse(input.input);
        return this.listFiles(authorized, parsed);
      }
      case "upload_file": {
        const parsed = sokoBotUploadFileInputSchema.parse(input.input);
        return this.uploadFile(authorized, parsed);
      }
      case "move_file":
        return this.moveFile(
          authorized,
          sokoBotMoveFileInputSchema.parse(input.input),
          input.toolCallId,
        );
      case "list_skills":
        return this.listSkills(
          authorized,
          sokoBotListSkillsInputSchema.parse(input.input),
        );
      case "install_skill":
        return this.installSkill(
          authorized,
          sokoBotInstallSkillInputSchema.parse(input.input),
          input.toolCallId,
        );
      case "remove_skill":
        return this.removeSkill(
          authorized,
          sokoBotRemoveSkillInputSchema.parse(input.input),
          input.toolCallId,
        );
      case "generate_image":
        return this.generateImage(authorized, input.input, input.toolCallId);
      case "get_image":
        return this.getStudioJob(authorized, input.input);
      case "generate_video":
        return this.generateVideo(authorized, input.input, input.toolCallId);
      case "get_video":
        return this.getStudioJob(authorized, input.input);
      case "read_file":
        return this.readFile(
          authorized,
          sokoBotReadFileInputSchema.parse(input.input),
        );
      case "list_integrations":
        return listSokoBotIntegrationsForBot(authorized.turn.sokoBotId).then(
          (result) =>
            result.integrations.filter((i) => i.status !== "DISCONNECTED"),
        );
      case "search_inbox": {
        const parsed = sokoBotSearchInboxInputSchema.parse(input.input);
        const integrations = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "email",
          parsed.provider,
        );
        const limit = parsed.limit ?? 20;
        // A token belongs to one mailbox; across several, a merged page cut
        // to the limit would skip mail the token has already moved past.
        if (parsed.pageToken && integrations.length !== 1)
          throw new SokoBotRuntimeValidationError(
            "pageToken needs the provider of the page it came from",
          );
        let nextPageToken: string | null = null;
        const result = await readSokoBotSource({
          source: "MAIL",
          filters: {
            query: parsed.query ?? "",
            since: parsed.since ?? "",
            unreadOnly: String(parsed.unreadOnly ?? false),
          },
          queries: integrations.map((integration) => async () => {
            const page = await fetchInboxPage(integration, {
              query: parsed.query,
              since: parsed.since ? new Date(parsed.since) : undefined,
              unreadOnly: parsed.unreadOnly,
              limit,
              pageToken: parsed.pageToken,
            });
            if (integrations.length === 1) nextPageToken = page.nextPageToken;
            return page.messages;
          }),
        });
        return {
          coverage: {
            ...result.coverage,
            includedCount: Math.min(result.rows.length, limit),
            omittedCount: Math.max(0, result.rows.length - limit),
          },
          failedSources: result.failedSources,
          note: result.note,
          messages: result.rows
            .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
            .slice(0, limit),
          nextPageToken,
        };
      }
      case "read_email": {
        const parsed = sokoBotReadEmailInputSchema.parse(input.input);
        const [integration] = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "email",
          parsed.provider,
        );
        if (!integration) {
          throw new SokoBotRuntimeValidationError(
            `No connected mailbox for provider ${parsed.provider}`,
          );
        }
        return fetchInboxMessage(integration, parsed.messageId);
      }
      case "update_emails":
        return this.updateEmails(
          authorized,
          sokoBotUpdateEmailsInputSchema.parse(input.input),
          input.toolCallId,
        );
      case "draft_email":
        return this.draftEmail(
          authorized,
          sokoBotDraftEmailInputSchema.parse(input.input),
          input.toolCallId,
        );
      case "save_email_attachment":
        return this.saveEmailAttachment(
          authorized,
          sokoBotSaveEmailAttachmentInputSchema.parse(input.input),
          input.toolCallId,
        );
      case "send_email_draft":
        return this.sendEmailDraft(
          authorized,
          sokoBotSendEmailDraftInputSchema.parse(input.input),
          input.toolCallId,
        );
      case "evaluate_with_jev": {
        const parsed = sokoBotEvaluateWithJevInputSchema.parse(input.input);
        let evaluation: Awaited<ReturnType<typeof evaluateWithJevForBot>>;
        try {
          evaluation = await evaluateWithJevForBot(parsed);
        } catch {
          throw new SokoBotRuntimeValidationError(
            "Jev is unavailable right now; judge these yourself.",
          );
        }
        // Jev is overhead like routing: on the turn's total, not billed.
        await prisma.sokoBotTurn.update({
          where: { id: authorized.turn.id },
          data: {
            overheadCostUsdMicros: {
              increment: BigInt(Math.round(evaluation.costUsd * 1_000_000)),
            },
          },
        });
        return evaluation.result;
      }
      case "list_integration_tools": {
        const parsed = sokoBotListIntegrationToolsInputSchema.parse(
          input.input,
        );
        const [integration] = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "generic",
          parsed.provider.toLowerCase(),
        );
        if (!integration) {
          throw new SokoBotRuntimeValidationError(
            `No connected account for provider ${parsed.provider} (mailboxes use search_inbox)`,
          );
        }
        return {
          tools: await listIntegrationTools(integration, {
            query: parsed.query,
            limit: parsed.limit ?? 20,
          }),
        };
      }
      case "run_integration_tool": {
        const parsed = sokoBotRunIntegrationToolInputSchema.parse(input.input);
        const [integration] = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "generic",
          parsed.provider.toLowerCase(),
        );
        if (!integration) {
          throw new SokoBotRuntimeValidationError(
            `No connected account for provider ${parsed.provider}`,
          );
        }
        return runIntegrationTool(
          integration,
          parsed.tool,
          parsed.arguments ?? {},
        );
      }
      case "list_calendar_events": {
        const parsed = sokoBotListCalendarEventsInputSchema.parse(input.input);
        const from = parsed.from ? new Date(parsed.from) : new Date();
        const to = parsed.to
          ? new Date(parsed.to)
          : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1_000);
        const integrations = await activeIntegrationsForBot(
          authorized.turn.sokoBotId,
          "calendar",
          parsed.provider,
        );
        if (to <= from)
          throw new SokoBotRuntimeValidationError(
            "Calendar window must end after it starts",
          );
        const limit = parsed.limit ?? 50;
        const result = await readSokoBotSource({
          source: "CALENDAR",
          filters: { from: from.toISOString(), to: to.toISOString() },
          queries: integrations.map(
            (integration) => () =>
              fetchCalendarEvents(integration, { from, to, limit }),
          ),
        });
        const tzRow = await prisma.sokoBot.findUnique({
          where: { id: authorized.turn.sokoBotId },
          select: { ingestTimezone: true },
        });
        const timeZone = tzRow?.ingestTimezone ?? "UTC";
        const local = (iso: string | null) =>
          iso
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone,
                weekday: "short",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(iso))
            : null;
        return {
          timeZone,
          coverage: {
            ...result.coverage,
            includedCount: Math.min(result.rows.length, limit),
            omittedCount: Math.max(0, result.rows.length - limit),
          },
          failedSources: result.failedSources,
          note: result.note,
          events: result.rows
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            .slice(0, limit)
            .map((event) => ({
              ...event,
              startsAtLocal: local(event.startsAt),
              endsAtLocal: local(event.endsAt),
            })),
        };
      }
      case "create_schedule":
      case "update_schedule":
      case "delete_schedule":
        return runScheduleTool(() =>
          serializableTransaction(async (tx) => {
            await this.requireMutationAuthority(
              tx,
              authorized,
              false,
              input.capability,
            );
            if (authorized.turn.source === "SCHEDULE")
              await requireOwnScheduleScope(
                tx,
                authorized.turn.id,
                input.capability,
                input.input,
              );
            const {
              actingUserId: userId,
              workspaceId,
              sokoBotId,
            } = authorized.turn;
            const scope = { userId, workspaceId, sokoBotId };
            const schedule =
              input.capability === "create_schedule"
                ? await createSokoBotSchedule(
                    {
                      ...scope,
                      ...createScheduleInputSchema.parse(input.input),
                      capabilityNames: authorized.grant.capabilities,
                    },
                    tx,
                  )
                : input.capability === "update_schedule"
                  ? await updateSokoBotSchedule(
                      {
                        ...scope,
                        ...updateScheduleInputSchema.parse(input.input),
                      },
                      tx,
                    )
                  : await deleteSokoBotSchedule(
                      scope.userId,
                      { ...scope, ...scheduleIdInputSchema.parse(input.input) },
                      tx,
                    );
            const result =
              input.capability === "delete_schedule"
                ? { ...schedule, deleted: true }
                : schedule;
            await commitActionReceipt(tx, {
              turnId: authorized.turn.id,
              toolCallId: input.toolCallId,
              actorBotId: authorized.turn.sokoBotId,
              targetId: schedule.id,
              result: persistedToolResult(result),
            });
            return result;
          }, "Schedule action collided with another operation"),
        );
    }
  }

  async resolveDecision(
    /** Null only when the bot accepts its own card in a turn for nobody. */
    resolverUserId: string | null,
    decisionId: string,
    accepted: boolean,
    ownerConfirmed = true,
    confirmationTurnId?: string,
  ) {
    const decision = await findResolvableSokoBotDecision(
      resolverUserId,
      decisionId,
      accepted,
      ownerConfirmed,
    );
    if (!decision)
      throw new SokoBotRuntimeValidationError("Pending decision not found");
    // Whoever answers, the decision acts for the member who asked.
    const actingUserId = sokoBotActingUserId(decision);
    if (
      decision.status === "PENDING" &&
      decision.expiresAt.getTime() <= Date.now()
    ) {
      await prisma.sokoBotPendingDecision.update({
        where: { id: decision.id },
        data: { status: "EXPIRED", resolvedAt: new Date() },
      });
      throw new SokoBotRuntimeConflictError("Pending decision expired");
    }
    if (decision.intentId) {
      const intent = await prisma.sokoBotIntent.findFirst({
        where: {
          id: decision.intentId,
          ...(decision.requestedByUserId
            ? { requesterId: decision.requestedByUserId }
            : {}),
          state: { in: ["AWAITING_CONFIRMATION", "IN_PROGRESS"] },
          expiresAt: { gt: new Date() },
        },
      });
      if (!intent)
        throw new SokoBotRuntimeConflictError(
          "Pending intent is no longer valid",
        );
    }
    if (!accepted) {
      if (decision.intentId)
        await prisma.sokoBotIntent.update({
          where: { id: decision.intentId },
          data: { state: "CANCELLED", revision: { increment: 1 } },
        });
      const rejected = await prisma.sokoBotPendingDecision.updateMany({
        where: { id: decision.id, status: "PENDING" },
        data: {
          status: "REJECTED",
          resolvedAt: new Date(),
          resolvedByUserId: resolverUserId,
        },
      });
      if (rejected.count === 0) {
        throw new SokoBotRuntimeConflictError(
          "Pending decision was already resolved",
        );
      }
      return prisma.sokoBotPendingDecision.findUniqueOrThrow({
        where: { id: decision.id },
      });
    }

    const decisionToolCallId = `decision:${decision.id}`;
    const externalDecision =
      decision.toolName === "hire_agent" ||
      decision.toolName === "provide_job_input";
    const actionContext: SokoBotActionContext = {
      confirmationTurnId,
      turn: {
        id: decision.turnId,
        sokoBotId: decision.sokoBotId,
        actingUserId,
        requestedByUserId: decision.requestedByUserId,
        workspaceId: decision.workspaceId,
        eveSessionId: decision.turn.eveSessionId,
        versionId: decision.turn.versionId,
        source: decision.turn.source,
        chainDepth: decision.turn.chainDepth,
      },
      classificationConfidence: 1,
    };
    const receiptKey = {
      turnId: decision.turnId,
      toolCallId: decisionToolCallId,
    };
    const receiptIdentity = {
      ...receiptKey,
      capability: decision.toolName,
      inputHash: actionInputHash(decision.proposal),
      actorBotId: decision.sokoBotId,
      operationKey: actionOperationKey({
        workspaceId: decision.workspaceId,
        principalId: actionPrincipalId({
          actingUserId,
          sokoBotId: decision.sokoBotId,
        }),
        intentRevision: decisionToolCallId,
        capability: decision.toolName,
        inputHash: actionInputHash(decision.proposal),
      }),
    };
    const reserveExternalReceipt = async (tx: Prisma.TransactionClient) => {
      await this.requireMutationAuthority(
        tx,
        actionContext,
        ownerConfirmed,
        undefined,
        decision.toolName === "hire_agent" ||
          decision.toolName === "provide_job_input"
          ? decisionProposalTargets(decision.toolName, decision.proposal)
          : {},
      );
      const receipt = await tx.sokoBotToolCall.findUnique({
        where: { turnId_toolCallId: receiptKey },
      });
      if (receipt && receipt.disposition !== "REJECTED") {
        failureDisposition = "retain";
        throw new SokoBotRuntimeConflictError(
          "External decision outcome requires reconciliation before retrying",
        );
      }
      if (receipt) {
        await tx.sokoBotToolCall.update({
          where: { id: receipt.id, disposition: "REJECTED" },
          data: {
            status: "PENDING",
            disposition: "UNKNOWN",
            verification: "NONE",
            committedAt: null,
          },
        });
      } else {
        await tx.sokoBotToolCall.create({
          data: {
            ...receiptIdentity,
            disposition: "UNKNOWN",
            verification: "NONE",
          },
        });
      }
    };
    const acknowledgeExternalReceipt = async (
      targetId: string,
      tx: Prisma.TransactionClient = prisma,
    ) => {
      const data = {
        status: "COMPLETED" as const,
        disposition: "APPLIED" as const,
        verification: "PROVIDER_ACK" as const,
        targetId,
        committedAt: new Date(),
        result: {
          executed: true,
          status: "ACCEPTED",
          resultingEntityId: targetId,
        },
      };
      await tx.sokoBotToolCall.upsert({
        where: { turnId_toolCallId: receiptKey },
        create: { ...receiptIdentity, ...data },
        update: data,
      });
    };

    let resumeProcessing = false;
    if (decision.status === "PROCESSING") {
      const existingDelegation = await prisma.sokoBotDelegation.findUnique({
        where: {
          turnId_toolCallId: {
            turnId: decision.turnId,
            toolCallId: decisionToolCallId,
          },
        },
        select: {
          action: true,
          outcome: true,
          taskId: true,
          jobId: true,
        },
      });
      let recoveredEntityId = existingDelegation?.taskId ?? null;
      if (decision.toolName === "hire_agent") {
        recoveredEntityId = existingDelegation?.jobId ?? null;
      } else if (decision.toolName === "provide_job_input") {
        const proposal = provideJobInputSchema.parse(decision.proposal);
        const existingInput = await prisma.jobInput.findUnique({
          where: { eventId: proposal.eventId },
          select: { id: true },
        });
        recoveredEntityId = existingInput?.id ?? null;
      }
      if (recoveredEntityId) {
        if (decision.toolName === "archive_task") {
          const receipt = await prisma.sokoBotToolCall.findUnique({
            where: { turnId_toolCallId: receiptKey },
            select: { id: true },
          });
          if (
            !receipt ||
            !(await verifyTaskArchiveReceipt(prisma, receipt.id))
          ) {
            throw new SokoBotRuntimeConflictError(
              "Archived task history could not be verified",
            );
          }
        }
        if (externalDecision)
          await acknowledgeExternalReceipt(recoveredEntityId);
        const [, recoveredDecision] = await prisma.$transaction([
          prisma.sokoBotDelegation.updateMany({
            where: {
              turnId: decision.turnId,
              toolCallId: decisionToolCallId,
            },
            data: {
              outcome: "accepted",
              error: null,
              ...(decision.toolName === "hire_agent"
                ? { jobId: recoveredEntityId }
                : {}),
            },
          }),
          prisma.sokoBotPendingDecision.update({
            where: { id: decision.id },
            data: {
              status: "ACCEPTED",
              resolvedAt: new Date(),
              resolvedByUserId: decision.firstResolverUserId,
              resultingEntityId: recoveredEntityId,
            },
          }),
        ]);
        return recoveredDecision;
      }
      const taskTarget = [
        "create_task",
        "update_task",
        "archive_task",
        "assign_task",
      ].includes(decision.toolName);
      const safelyRetryableJobReservation =
        (decision.toolName === "hire_agent" ||
          decision.toolName === "provide_job_input") &&
        (!existingDelegation || existingDelegation.outcome === "failed");
      if (
        (taskTarget && !existingDelegation) ||
        safelyRetryableJobReservation
      ) {
        resumeProcessing = true;
      } else {
        throw new SokoBotRuntimeConflictError(
          "Pending decision processing outcome is ambiguous",
        );
      }
    }

    if (
      !isSokoBotDecisionTargetAllowed(
        decision.toolName,
        decision.turn.capabilityNames,
      )
    ) {
      throw new SokoBotRuntimeAuthorizationError(
        "Decision target was not granted for its turn",
      );
    }

    if (!resumeProcessing) {
      const claimed = await prisma.sokoBotPendingDecision.updateMany({
        where: { id: decision.id, status: "PENDING" },
        data: { status: "PROCESSING", resolvedByUserId: resolverUserId },
      });
      if (claimed.count === 0) {
        throw new SokoBotRuntimeConflictError(
          "Pending decision was already resolved",
        );
      }
    }

    let failureDisposition: "restore" | "retain" = "restore";
    let sellerReservationMarker: SellerReservationMarker | null = null;
    try {
      const activeBot = await sokoBotForTurnMember(
        actionContext.turn,
        "running",
      );
      const workspace = await prisma.workspace.findFirst({
        where: sokoBotWorkspaceAccessWhere(actingUserId, decision.workspaceId),
        select: { id: true, organizationId: true },
      });
      if (!activeBot) {
        throw new SokoBotRuntimeAuthorizationError(
          "Soko Bot is paused or unavailable",
        );
      }
      if (!workspace) {
        throw new SokoBotRuntimeAuthorizationError(
          "Workspace access is no longer available",
        );
      }

      const proposal = decision.proposal as Record<string, unknown>;
      if (ownerConfirmed && decision.intentId) {
        await prisma.sokoBotIntent.update({
          where: { id: decision.intentId },
          data: {
            acceptanceCriteria: criteriaForConfirmedSokoBotAction(
              decision.toolName,
              proposal,
            ),
          },
        });
      }
      let resultingEntityId: string | null = null;
      if (decision.toolName === "hire_agent") {
        const { followUp, ...hire } = parseHireAgentInput(proposal);
        const existingDelegation = await prisma.sokoBotDelegation.findUnique({
          where: {
            turnId_toolCallId: {
              turnId: decision.turnId,
              toolCallId: decisionToolCallId,
            },
          },
          select: { jobId: true, outcome: true, error: true },
        });
        if (existingDelegation?.jobId) {
          await acknowledgeExternalReceipt(existingDelegation.jobId);
          return prisma.sokoBotPendingDecision.update({
            where: { id: decision.id },
            data: {
              status: "ACCEPTED",
              resolvedAt: new Date(),
              resolvedByUserId: decision.firstResolverUserId,
              resultingEntityId: existingDelegation.jobId,
            },
          });
        }
        if (existingDelegation && existingDelegation.outcome !== "failed") {
          failureDisposition = "retain";
          throw new SokoBotRuntimeConflictError(
            "Agent hire is already processing",
          );
        }
        const job = await createAgentJobForUser({
          owner: {
            ownerId: actingUserId,
            organizationId: workspace.organizationId,
            workspaceId: decision.workspaceId,
          },
          creator: { kind: "soko_bot", sokoBotId: decision.sokoBotId },
          agentInput: hire,
          beforeSellerStart: async () => {
            sellerReservationMarker = createSellerReservationMarker(
              "hire_agent",
              decision.proposal,
            );
            const marker = serializeSellerReservationMarker(
              sellerReservationMarker,
            );
            await serializableTransaction(async (tx) => {
              // Same bot-row-first order as administrator PAUSE. Whichever
              // transaction wins determines whether seller dispatch may start.
              await tx.$queryRaw`
                SELECT "id"
                FROM "soko_bot"
                WHERE "id" = ${decision.sokoBotId}::uuid
                FOR UPDATE
              `;
              const activeBot = await sokoBotForTurnMember(
                actionContext.turn,
                "running",
                tx,
              );
              if (!activeBot) {
                throw new SokoBotRuntimeAuthorizationError(
                  "Soko Bot is paused or unavailable",
                );
              }
              await reserveExternalReceipt(tx);
              if (existingDelegation?.outcome === "failed") {
                const reserved = await tx.sokoBotDelegation.updateMany({
                  where: {
                    turnId: decision.turnId,
                    toolCallId: decisionToolCallId,
                    outcome: "failed",
                    error: existingDelegation.error ?? null,
                  },
                  data: { outcome: "processing", error: marker },
                });
                if (reserved.count !== 1) {
                  failureDisposition = "retain";
                  throw new SokoBotRuntimeConflictError(
                    "Agent hire retry was already reserved",
                  );
                }
              } else {
                await tx.sokoBotDelegation.create({
                  data: {
                    turnId: decision.turnId,
                    toolCallId: decisionToolCallId,
                    kind: "JOB",
                    action: "hire_agent",
                    outcome: "processing",
                    error: marker,
                    followUp,
                  },
                });
              }
            }, "Soko Bot hire reservation collided with administrator control");
            // Reservation is durable. Never return this decision to PENDING
            // after crossing into seller-side execution: a retry could create
            // and charge a second Job if the first response was lost.
            failureDisposition = "retain";
          },
          afterSellerStartFailure: async (failure) => {
            const marker = sellerReservationMarker;
            await prisma.sokoBotDelegation.update({
              where: {
                turnId_toolCallId: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                },
              },
              data: {
                outcome:
                  failure.kind === "unreachable" ? "failed" : "ambiguous",
                error: marker
                  ? serializeSellerReservationMarker(
                      marker,
                      new Error(failure.message),
                    )
                  : persistedErrorDetail(new Error(failure.message)),
              },
            });
            // Explicit pre-acceptance rejection is safe to retry. Unknown or
            // invalid-success outcomes may already have seller work running.
            failureDisposition =
              failure.kind === "unreachable" ? "restore" : "retain";
            if (failure.kind === "unreachable")
              await prisma.sokoBotToolCall.updateMany({
                where: { ...receiptKey, disposition: "UNKNOWN" },
                data: {
                  status: "FAILED",
                  disposition: "REJECTED",
                  verification: "NONE",
                },
              });
          },
          afterLocalJobCreate: async (job, tx) => {
            const marker = sellerReservationMarker;
            if (!marker) {
              throw new SokoBotRuntimeConflictError(
                "Agent hire reservation is missing",
              );
            }
            const attached = await tx.sokoBotDelegation.updateMany({
              where: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
                outcome: "processing",
                error: serializeSellerReservationMarker(marker),
              },
              data: { outcome: "accepted", jobId: job.id, error: null },
            });
            if (attached.count !== 1) {
              throw new SokoBotRuntimeConflictError(
                "Agent hire reservation changed before local commit",
              );
            }
            await acknowledgeExternalReceipt(job.id, tx);
          },
        });
        resultingEntityId = job.id;
      } else if (decision.toolName === "provide_job_input") {
        const input = provideJobInputSchema.parse(proposal);
        const durableInput = await prisma.jobInput.findUnique({
          where: { eventId: input.eventId },
          select: { id: true },
        });
        if (durableInput) {
          resultingEntityId = durableInput.id;
        } else {
          const event = await prisma.jobEvent.findFirst({
            where: {
              id: input.eventId,
              jobId: input.jobId,
              status: AgentJobStatus.AWAITING_INPUT,
              // Job writes belong to the Owner (ADR 0057): never nobody.
              job: {
                ownerId: actingMemberOf({ turn: { actingUserId } }),
                workspaceId: decision.workspaceId,
              },
            },
            include: {
              input: true,
              job: {
                include: { agent: { include: { metadataOverride: true } } },
              },
            },
          });
          if (!event || event.input || !event.inputSchema) {
            throw new SokoBotRuntimeConflictError(
              "Job no longer awaits this input",
            );
          }
          const existingDelegation = await prisma.sokoBotDelegation.findUnique({
            where: {
              turnId_toolCallId: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
              },
            },
            select: { outcome: true, error: true },
          });
          if (existingDelegation && existingDelegation.outcome !== "failed") {
            failureDisposition = "retain";
            throw new SokoBotRuntimeConflictError(
              "Agent Job input is already processing",
            );
          }
          sellerReservationMarker = createSellerReservationMarker(
            "provide_job_input",
            decision.proposal,
          );
          const marker = serializeSellerReservationMarker(
            sellerReservationMarker,
          );
          await serializableTransaction(async (tx) => {
            await tx.$queryRaw`
              SELECT "id"
              FROM "soko_bot"
              WHERE "id" = ${decision.sokoBotId}::uuid
              FOR UPDATE
            `;
            const activeBot = await sokoBotForTurnMember(
              actionContext.turn,
              "running",
              tx,
            );
            if (!activeBot) {
              throw new SokoBotRuntimeAuthorizationError(
                "Soko Bot is paused or unavailable",
              );
            }
            await reserveExternalReceipt(tx);
            if (existingDelegation?.outcome === "failed") {
              const reserved = await tx.sokoBotDelegation.updateMany({
                where: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                  outcome: "failed",
                  error: existingDelegation.error ?? null,
                },
                data: { outcome: "processing", error: marker },
              });
              if (reserved.count !== 1) {
                failureDisposition = "retain";
                throw new SokoBotRuntimeConflictError(
                  "Agent Job input retry was already reserved",
                );
              }
            } else {
              await tx.sokoBotDelegation.create({
                data: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                  kind: "JOB",
                  action: "provide_job_input",
                  outcome: "processing",
                  jobId: event.job.id,
                  error: marker,
                },
              });
            }
          }, "Soko Bot input reservation collided with administrator control");
          // provide_input has no idempotency key. Only explicit rejection may
          // reopen the decision; every other failure remains durably fenced.
          failureDisposition = "retain";
          const result = await createAgentClient().provideJobInput(
            {
              id: event.job.agent.id,
              name: event.job.agent.name,
              blockchainIdentifier:
                event.job.agentBlockchainIdentifier ??
                event.job.agent.blockchainIdentifier,
              apiBaseUrl:
                event.job.agentApiBaseUrl ?? event.job.agent.apiBaseUrl ?? "",
            },
            event.job.agentJobId,
            event.inputSchema,
            input.inputData,
          );
          if (result.isErr()) {
            await prisma.sokoBotDelegation.update({
              where: {
                turnId_toolCallId: {
                  turnId: decision.turnId,
                  toolCallId: decisionToolCallId,
                },
              },
              data: {
                outcome:
                  result.error.kind === "unreachable" ? "failed" : "ambiguous",
                error: serializeSellerReservationMarker(
                  sellerReservationMarker,
                  new Error(result.error.message),
                ),
              },
            });
            failureDisposition =
              result.error.kind === "unreachable" ? "restore" : "retain";
            if (result.error.kind === "unreachable")
              await prisma.sokoBotToolCall.updateMany({
                where: { ...receiptKey, disposition: "UNKNOWN" },
                data: {
                  status: "FAILED",
                  disposition: "REJECTED",
                  verification: "NONE",
                },
              });
            throw new SokoBotRuntimeValidationError(result.error.message);
          }
          try {
            const jobInput = await prisma.jobInput.create({
              data: {
                eventId: event.id,
                input: JSON.stringify(input.inputData),
                inputHash: result.value.input_hash,
                signature: result.value.signature,
              },
            });
            resultingEntityId = jobInput.id;
          } catch (error) {
            const recoveredInput = await prisma.jobInput.findUnique({
              where: { eventId: event.id },
              select: { id: true },
            });
            if (recoveredInput) {
              resultingEntityId = recoveredInput.id;
            } else {
              await prisma.sokoBotDelegation.update({
                where: {
                  turnId_toolCallId: {
                    turnId: decision.turnId,
                    toolCallId: decisionToolCallId,
                  },
                },
                data: {
                  outcome: "ambiguous",
                  error: serializeSellerReservationMarker(
                    sellerReservationMarker,
                    error,
                  ),
                },
              });
              throw error;
            }
          }
          await prisma.sokoBotDelegation.update({
            where: {
              turnId_toolCallId: {
                turnId: decision.turnId,
                toolCallId: decisionToolCallId,
              },
            },
            data: { outcome: "accepted", error: null },
          });
        }
      } else if (decision.toolName === "create_task") {
        const authorized: SokoBotActionContext = {
          confirmationTurnId,
          turn: {
            id: decision.turnId,
            sokoBotId: decision.sokoBotId,
            actingUserId,
            requestedByUserId: decision.requestedByUserId,
            workspaceId: decision.workspaceId,
            eveSessionId: decision.turn.eveSessionId,
            versionId: decision.turn.versionId,
            source: decision.turn.source,
            chainDepth: decision.turn.chainDepth,
          },
          classificationConfidence: 1,
        };
        const task = await this.createTask(
          authorized,
          proposal,
          `decision:${decision.id}`,
          true,
        );
        resultingEntityId = task.id;
      } else if (
        decision.toolName === "update_task" ||
        decision.toolName === "archive_task"
      ) {
        const updated = await this.mutateTask(
          {
            confirmationTurnId,
            turn: {
              id: decision.turnId,
              sokoBotId: decision.sokoBotId,
              actingUserId,
              requestedByUserId: decision.requestedByUserId,
              workspaceId: decision.workspaceId,
              eveSessionId: decision.turn.eveSessionId,
              versionId: decision.turn.versionId,
              source: decision.turn.source,
              chainDepth: decision.turn.chainDepth,
            },
            classificationConfidence: 1,
          },
          proposal,
          `decision:${decision.id}`,
          { capability: decision.toolName, approved: true },
        );
        // An approved call skips the gate that asks for approval.
        if ("approvalRequired" in updated)
          throw new SokoBotRuntimeConflictError(
            "An approved Task change asked for approval again",
          );
        resultingEntityId = updated.id;
      } else if (decision.toolName === "assign_task") {
        const updated = await this.assignTask(
          {
            confirmationTurnId,
            turn: {
              id: decision.turnId,
              sokoBotId: decision.sokoBotId,
              actingUserId,
              requestedByUserId: decision.requestedByUserId,
              workspaceId: decision.workspaceId,
              eveSessionId: decision.turn.eveSessionId,
              versionId: decision.turn.versionId,
              source: decision.turn.source,
              chainDepth: decision.turn.chainDepth,
            },
            classificationConfidence: 1,
          },
          proposal,
          `decision:${decision.id}`,
          true,
        );
        resultingEntityId = updated.id;
      }

      if (externalDecision && resultingEntityId)
        await acknowledgeExternalReceipt(resultingEntityId);
      if (decision.intentId)
        await prisma.sokoBotIntent.update({
          where: { id: decision.intentId },
          data: {
            state: "IN_PROGRESS",
            evidenceIds: resultingEntityId ? [resultingEntityId] : [],
          },
        });
      return await prisma.sokoBotPendingDecision.update({
        where: { id: decision.id },
        data: {
          status: "ACCEPTED",
          resolvedAt: new Date(),
          resolvedByUserId: decision.firstResolverUserId,
          resultingEntityId,
        },
      });
    } catch (error) {
      if (failureDisposition === "restore") {
        await prisma.sokoBotPendingDecision.updateMany({
          where: { id: decision.id, status: "PROCESSING" },
          data: { status: "PENDING", resolvedByUserId: null },
        });
      } else {
        await prisma.sokoBotDelegation.updateMany({
          where: {
            turnId: decision.turnId,
            toolCallId: decisionToolCallId,
            outcome: "processing",
          },
          data: {
            outcome: "ambiguous",
            error: sellerReservationMarker
              ? serializeSellerReservationMarker(sellerReservationMarker, error)
              : persistedErrorDetail(error),
          },
        });
      }
      throw error;
    }
  }
}

export const sokoBotRuntimeService = new SokoBotRuntimeService();
