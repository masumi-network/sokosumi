import {
  isSokoBotCapability,
  isSokoBotDecisionTarget,
  type SokoBotCapability,
  type SokoBotTurnGrantClaims,
} from "@sokosumi/soko-bot";
import {
  type SokoBotPacketAudience,
  type SokoBotTurnReader,
} from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import * as ads from "./soko-bot-runtime/ads";
import * as authorization from "./soko-bot-runtime/authorization";
import * as chatOpen from "./soko-bot-runtime/chat-open";
import * as chatPost from "./soko-bot-runtime/chat-post";
import * as chatRooms from "./soko-bot-runtime/chat-rooms";
import * as cmo from "./soko-bot-runtime/cmo";
import * as contacts from "./soko-bot-runtime/contacts";
import * as context from "./soko-bot-runtime/context";
import * as decision from "./soko-bot-runtime/decision";
import * as dispatch from "./soko-bot-runtime/dispatch";
import * as driveAccess from "./soko-bot-runtime/drive-access";
import * as driveReads from "./soko-bot-runtime/drive-reads";
import * as driveWrites from "./soko-bot-runtime/drive-writes";
import * as execution from "./soko-bot-runtime/execution";
import { TOOL_CALLS_PER_FIFTEEN_MINUTES } from "./soko-bot-runtime/execution-limits";
import { PROJECT_SCOPED_TOOLS } from "./soko-bot-runtime/grant";
import * as mail from "./soko-bot-runtime/mail";
import * as mediaChecks from "./soko-bot-runtime/media-checks";
import * as mediaGeneration from "./soko-bot-runtime/media-generation";
import * as mediaReferences from "./soko-bot-runtime/media-references";
import * as memory from "./soko-bot-runtime/memory";
import type {
  RuntimeOperationArguments,
  RuntimeOperations,
} from "./soko-bot-runtime/operations";
import * as skills from "./soko-bot-runtime/skills";
import * as social from "./soko-bot-runtime/social";
import * as taskCreation from "./soko-bot-runtime/task-creation";
import * as taskMutations from "./soko-bot-runtime/task-mutations";
import * as taskReads from "./soko-bot-runtime/task-reads";
import * as taskReplies from "./soko-bot-runtime/task-replies";
import * as toolScope from "./soko-bot-runtime/tool-scope";
import * as workspaceFiles from "./soko-bot-runtime/workspace-files";

/**
 * The person a Task goes to: the owner, or a teammate Core checks belongs to
 * the workspace. A shared bot works for nobody, so it has no owner to assign.
 */
export function personAssignee(
  input: { assignToOwner?: true; memberId?: string },
  actingUserId: string | null,
): string | null {
  if (input.assignToOwner && input.memberId)
    throw new SokoBotRuntimeValidationError(
      "Give assignToOwner or memberId, not both",
    );
  if (input.memberId) return input.memberId;
  if (!input.assignToOwner) return null;
  if (!actingUserId)
    throw new SokoBotRuntimeValidationError(
      "A shared assistant has no owner to assign; pick a Coworker or a teammate",
    );
  return actingUserId;
}

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

export const WORKSPACE_UPLOAD_GRANTED_EVENT = "sandbox.upload_granted";

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

/**
 * A Project bot (a shared bot of one Project, such as CMO.xyz's Cuso) works in
 * that Project only: its project-scoped tools default to it and refuse any
 * other.
 */
export async function pinToBotProject(
  input: ExecuteSokoBotToolInput,
  sokoBotId: string,
): Promise<ExecuteSokoBotToolInput> {
  if (!PROJECT_SCOPED_TOOLS.has(input.capability)) return input;
  const bot = await prisma.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: { projectId: true },
  });
  if (!bot?.projectId) return input;
  const fields =
    input.input &&
    typeof input.input === "object" &&
    !Array.isArray(input.input)
      ? (input.input as Record<string, unknown>)
      : {};
  if (
    fields.projectId !== undefined &&
    fields.projectId !== null &&
    fields.projectId !== bot.projectId
  ) {
    throw new SokoBotRuntimeValidationError(
      "This bot works in its own Project only; use that Project.",
    );
  }
  return { ...input, input: { ...fields, projectId: bot.projectId } };
}

export interface ExecuteSokoBotToolInput extends RuntimeAuthorizationInput {
  capability: SokoBotCapability;
  toolCallId: string;
  input: unknown;
}

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

export class SokoBotRuntimeService {
  private readonly operations: RuntimeOperations = {
    authorize: (...args) => this.authorize(...args),
    getInstalledSkills: (...args) => this.getInstalledSkills(...args),
    getContext: (...args) => this.getContext(...args),
    executeAsAccepted: (...args) => this.executeAsAccepted(...args),
    expireDecision: (...args) => this.expireDecision(...args),
    listChats: (...args) => this.listChats(...args),
    ownerDirectRooms: (...args) => this.ownerDirectRooms(...args),
    ownerUnreadRooms: (...args) => this.ownerUnreadRooms(...args),
    chatRoomScope: (...args) => this.chatRoomScope(...args),
    ownerDirectRoom: (...args) => this.ownerDirectRoom(...args),
    requireChatMembership: (...args) => this.requireChatMembership(...args),
    openDirectChat: (...args) => this.openDirectChat(...args),
    askCoworker: (...args) => this.askCoworker(...args),
    requireUnattendedPostIsAllowed: (...args) =>
      this.requireUnattendedPostIsAllowed(...args),
    postChat: (...args) => this.postChat(...args),
    mayActForOwner: (...args) => this.mayActForOwner(...args),
    mediaPerTurn: (...args) => this.mediaPerTurn(...args),
    socialCommentScopeOf: (...args) => this.socialCommentScopeOf(...args),
    handleCmoComment: (...args) => this.handleCmoComment(...args),
    checkImageRequest: (...args) => this.checkImageRequest(...args),
    writeCmoPieceFiles: (...args) => this.writeCmoPieceFiles(...args),
    imageReferenceFiles: (...args) => this.imageReferenceFiles(...args),
    generateImage: (...args) => this.generateImage(...args),
    checkVideoRequest: (...args) => this.checkVideoRequest(...args),
    generateVideo: (...args) => this.generateVideo(...args),
    refuseCmoRunMedia: (...args) => this.refuseCmoRunMedia(...args),
    requireImageProject: (...args) => this.requireImageProject(...args),
    getStudioJob: (...args) => this.getStudioJob(...args),
    imageInOwnerDrive: (...args) => this.imageInOwnerDrive(...args),
    resolveSocialMedia: (...args) => this.resolveSocialMedia(...args),
    resolveAdImages: (...args) => this.resolveAdImages(...args),
    resolveSocialPostMedia: (...args) => this.resolveSocialPostMedia(...args),
    ownerDrive: (...args) => this.ownerDrive(...args),
    listFiles: (...args) => this.listFiles(...args),
    withInlineFiles: (...args) => this.withInlineFiles(...args),
    attachDriveFiles: (...args) => this.attachDriveFiles(...args),
    ownerFile: (...args) => this.ownerFile(...args),
    newsletterImageFileUrl: (...args) => this.newsletterImageFileUrl(...args),
    readCsvFile: (...args) => this.readCsvFile(...args),
    readFile: (...args) => this.readFile(...args),
    uploadFile: (...args) => this.uploadFile(...args),
    commitReceipt: (...args) => this.commitReceipt(...args),
    mailboxFor: (...args) => this.mailboxFor(...args),
    updateEmails: (...args) => this.updateEmails(...args),
    draftEmail: (...args) => this.draftEmail(...args),
    sendEmailDraft: (...args) => this.sendEmailDraft(...args),
    saveEmailAttachment: (...args) => this.saveEmailAttachment(...args),
    ownerDriveFile: (...args) => this.ownerDriveFile(...args),
    moveFile: (...args) => this.moveFile(...args),
    deleteFile: (...args) => this.deleteFile(...args),
    listSkills: (...args) => this.listSkills(...args),
    installSkill: (...args) => this.installSkill(...args),
    removeSkill: (...args) => this.removeSkill(...args),
    saveChatAttachment: (...args) => this.saveChatAttachment(...args),
    grantWorkspaceUpload: (...args) => this.grantWorkspaceUpload(...args),
    workspaceFileSource: (...args) => this.workspaceFileSource(...args),
    generateVoiceover: (...args) => this.generateVoiceover(...args),
    saveWorkspaceFile: (...args) => this.saveWorkspaceFile(...args),
    saveFileBytes: (...args) => this.saveFileBytes(...args),
    readChat: (...args) => this.readChat(...args),
    listTasks: (...args) => this.listTasks(...args),
    readTask: (...args) => this.readTask(...args),
    updateAssignedTask: (...args) => this.updateAssignedTask(...args),
    replyToTask: (...args) => this.replyToTask(...args),
    linkTasks: (...args) => this.linkTasks(...args),
    createDecision: (...args) => this.createDecision(...args),
    createTask: (...args) => this.createTask(...args),
    mutateTask: (...args) => this.mutateTask(...args),
    applyTaskMutation: (...args) => this.applyTaskMutation(...args),
    assignTask: (...args) => this.assignTask(...args),
    requireMutationAuthority: (...args) =>
      this.requireMutationAuthority(...args),
    reviewCmoPlan: (...args) => this.reviewCmoPlan(...args),
    saveCmoRecord: (...args) => this.saveCmoRecord(...args),
    requireWriteScope: (...args) => this.requireWriteScope(...args),
    updateMemory: (...args) => this.updateMemory(...args),
    executeTool: (...args) => this.executeTool(...args),
    tableActor: (...args) => this.tableActor(...args),
    executeContactTool: (...args) => this.executeContactTool(...args),
    exportContactsToTable: (...args) => this.exportContactsToTable(...args),
    findCoworkers: (...args) => this.findCoworkers(...args),
    findTeammates: (...args) => this.findTeammates(...args),
    executeContactResearch: (...args) => this.executeContactResearch(...args),
    executeProjectTool: (...args) => this.executeProjectTool(...args),
    findIntegrations: (...args) => this.findIntegrations(...args),
    requireSocialAccess: (...args) => this.requireSocialAccess(...args),
    requireCmoExecution: (...args) => this.requireCmoExecution(...args),
    requireAdsAccess: (...args) => this.requireAdsAccess(...args),
    executeAdsTool: (...args) => this.executeAdsTool(...args),
    executeSocialTool: (...args) => this.executeSocialTool(...args),
    resolveTaskIds: (...args) => this.resolveTaskIds(...args),
    requireNewsletterScope: (...args) => this.requireNewsletterScope(...args),
    requireOwnerSubscriberWord: (...args) =>
      this.requireOwnerSubscriberWord(...args),
    executeSeoTool: (...args) => this.executeSeoTool(...args),
    executeAuthorizedTool: (...args) => this.executeAuthorizedTool(...args),
    resolveDecision: (...args) => this.resolveDecision(...args),
  };

  authorize(
    ...args: RuntimeOperationArguments<typeof authorization.authorize>
  ) {
    return authorization.authorize(this.operations, ...args);
  }

  getInstalledSkills(
    ...args: RuntimeOperationArguments<typeof context.getInstalledSkills>
  ) {
    return context.getInstalledSkills(this.operations, ...args);
  }

  getContext(...args: RuntimeOperationArguments<typeof context.getContext>) {
    return context.getContext(this.operations, ...args);
  }

  private executeAsAccepted = (
    ...args: RuntimeOperationArguments<typeof taskCreation.executeAsAccepted>
  ) => taskCreation.executeAsAccepted(this.operations, ...args);

  private expireDecision = (
    ...args: RuntimeOperationArguments<typeof taskCreation.expireDecision>
  ) => taskCreation.expireDecision(this.operations, ...args);

  private listChats = (
    ...args: RuntimeOperationArguments<typeof chatRooms.listChats>
  ) => chatRooms.listChats(this.operations, ...args);

  private ownerDirectRooms = (
    ...args: RuntimeOperationArguments<typeof chatRooms.ownerDirectRooms>
  ) => chatRooms.ownerDirectRooms(this.operations, ...args);

  private ownerUnreadRooms = (
    ...args: RuntimeOperationArguments<typeof chatRooms.ownerUnreadRooms>
  ) => chatRooms.ownerUnreadRooms(this.operations, ...args);

  private chatRoomScope = (
    ...args: RuntimeOperationArguments<typeof chatRooms.chatRoomScope>
  ) => chatRooms.chatRoomScope(this.operations, ...args);

  private ownerDirectRoom = (
    ...args: RuntimeOperationArguments<typeof chatRooms.ownerDirectRoom>
  ) => chatRooms.ownerDirectRoom(this.operations, ...args);

  private requireChatMembership = (
    ...args: RuntimeOperationArguments<typeof chatRooms.requireChatMembership>
  ) => chatRooms.requireChatMembership(this.operations, ...args);

  private openDirectChat = (
    ...args: RuntimeOperationArguments<typeof chatOpen.openDirectChat>
  ) => chatOpen.openDirectChat(this.operations, ...args);

  private askCoworker = (
    ...args: RuntimeOperationArguments<typeof chatOpen.askCoworker>
  ) => chatOpen.askCoworker(this.operations, ...args);

  private requireUnattendedPostIsAllowed = (
    ...args: RuntimeOperationArguments<
      typeof chatPost.requireUnattendedPostIsAllowed
    >
  ) => chatPost.requireUnattendedPostIsAllowed(this.operations, ...args);

  private postChat = (
    ...args: RuntimeOperationArguments<typeof chatPost.postChat>
  ) => chatPost.postChat(this.operations, ...args);

  private mayActForOwner = (
    ...args: RuntimeOperationArguments<typeof chatPost.mayActForOwner>
  ) => chatPost.mayActForOwner(this.operations, ...args);

  private mediaPerTurn = (
    ...args: RuntimeOperationArguments<typeof mediaChecks.mediaPerTurn>
  ) => mediaChecks.mediaPerTurn(this.operations, ...args);

  private socialCommentScopeOf = (
    ...args: RuntimeOperationArguments<typeof mediaChecks.socialCommentScopeOf>
  ) => mediaChecks.socialCommentScopeOf(this.operations, ...args);

  private handleCmoComment = (
    ...args: RuntimeOperationArguments<typeof cmo.handleCmoComment>
  ) => cmo.handleCmoComment(this.operations, ...args);

  private checkImageRequest = (
    ...args: RuntimeOperationArguments<typeof mediaChecks.checkImageRequest>
  ) => mediaChecks.checkImageRequest(this.operations, ...args);

  private writeCmoPieceFiles = (
    ...args: RuntimeOperationArguments<
      typeof mediaGeneration.writeCmoPieceFiles
    >
  ) => mediaGeneration.writeCmoPieceFiles(this.operations, ...args);

  private imageReferenceFiles = (
    ...args: RuntimeOperationArguments<
      typeof mediaGeneration.imageReferenceFiles
    >
  ) => mediaGeneration.imageReferenceFiles(this.operations, ...args);

  private generateImage = (
    ...args: RuntimeOperationArguments<typeof mediaGeneration.generateImage>
  ) => mediaGeneration.generateImage(this.operations, ...args);

  private checkVideoRequest = (
    ...args: RuntimeOperationArguments<typeof mediaChecks.checkVideoRequest>
  ) => mediaChecks.checkVideoRequest(this.operations, ...args);

  private generateVideo = (
    ...args: RuntimeOperationArguments<typeof mediaGeneration.generateVideo>
  ) => mediaGeneration.generateVideo(this.operations, ...args);

  private refuseCmoRunMedia = (
    ...args: RuntimeOperationArguments<typeof mediaChecks.refuseCmoRunMedia>
  ) => mediaChecks.refuseCmoRunMedia(this.operations, ...args);

  private requireImageProject = (
    ...args: RuntimeOperationArguments<typeof mediaChecks.requireImageProject>
  ) => mediaChecks.requireImageProject(this.operations, ...args);

  private getStudioJob = (
    ...args: RuntimeOperationArguments<typeof mediaGeneration.getStudioJob>
  ) => mediaGeneration.getStudioJob(this.operations, ...args);

  private imageInOwnerDrive = (
    ...args: RuntimeOperationArguments<typeof mediaGeneration.imageInOwnerDrive>
  ) => mediaGeneration.imageInOwnerDrive(this.operations, ...args);

  private resolveSocialMedia = (
    ...args: RuntimeOperationArguments<
      typeof mediaReferences.resolveSocialMedia
    >
  ) => mediaReferences.resolveSocialMedia(this.operations, ...args);

  private resolveAdImages = (
    ...args: RuntimeOperationArguments<typeof mediaReferences.resolveAdImages>
  ) => mediaReferences.resolveAdImages(this.operations, ...args);

  private resolveSocialPostMedia = (
    ...args: RuntimeOperationArguments<
      typeof mediaReferences.resolveSocialPostMedia
    >
  ) => mediaReferences.resolveSocialPostMedia(this.operations, ...args);

  private ownerDrive = (
    ...args: RuntimeOperationArguments<typeof driveAccess.ownerDrive>
  ) => driveAccess.ownerDrive(this.operations, ...args);

  private listFiles = (
    ...args: RuntimeOperationArguments<typeof driveReads.listFiles>
  ) => driveReads.listFiles(this.operations, ...args);

  private withInlineFiles = (
    ...args: RuntimeOperationArguments<typeof driveReads.withInlineFiles>
  ) => driveReads.withInlineFiles(this.operations, ...args);

  private attachDriveFiles = (
    ...args: RuntimeOperationArguments<typeof driveReads.attachDriveFiles>
  ) => driveReads.attachDriveFiles(this.operations, ...args);

  private ownerFile = (
    ...args: RuntimeOperationArguments<typeof driveAccess.ownerFile>
  ) => driveAccess.ownerFile(this.operations, ...args);

  private newsletterImageFileUrl = (
    ...args: RuntimeOperationArguments<
      typeof driveWrites.newsletterImageFileUrl
    >
  ) => driveWrites.newsletterImageFileUrl(this.operations, ...args);

  private readCsvFile = (
    ...args: RuntimeOperationArguments<typeof driveReads.readCsvFile>
  ) => driveReads.readCsvFile(this.operations, ...args);

  private readFile = (
    ...args: RuntimeOperationArguments<typeof driveReads.readFile>
  ) => driveReads.readFile(this.operations, ...args);

  private uploadFile = (
    ...args: RuntimeOperationArguments<typeof driveWrites.uploadFile>
  ) => driveWrites.uploadFile(this.operations, ...args);

  private commitReceipt = <T>(
    ...args: RuntimeOperationArguments<typeof mail.commitReceipt<T>>
  ) => mail.commitReceipt<T>(this.operations, ...args);

  private mailboxFor = (
    ...args: RuntimeOperationArguments<typeof mail.mailboxFor>
  ) => mail.mailboxFor(this.operations, ...args);

  private updateEmails = (
    ...args: RuntimeOperationArguments<typeof mail.updateEmails>
  ) => mail.updateEmails(this.operations, ...args);

  private draftEmail = (
    ...args: RuntimeOperationArguments<typeof mail.draftEmail>
  ) => mail.draftEmail(this.operations, ...args);

  private sendEmailDraft = (
    ...args: RuntimeOperationArguments<typeof mail.sendEmailDraft>
  ) => mail.sendEmailDraft(this.operations, ...args);

  private saveEmailAttachment = (
    ...args: RuntimeOperationArguments<typeof mail.saveEmailAttachment>
  ) => mail.saveEmailAttachment(this.operations, ...args);

  private ownerDriveFile = (
    ...args: RuntimeOperationArguments<typeof driveAccess.ownerDriveFile>
  ) => driveAccess.ownerDriveFile(this.operations, ...args);

  private moveFile = (
    ...args: RuntimeOperationArguments<typeof driveWrites.moveFile>
  ) => driveWrites.moveFile(this.operations, ...args);

  private deleteFile = (
    ...args: RuntimeOperationArguments<typeof driveWrites.deleteFile>
  ) => driveWrites.deleteFile(this.operations, ...args);

  private listSkills = (
    ...args: RuntimeOperationArguments<typeof skills.listSkills>
  ) => skills.listSkills(this.operations, ...args);

  private installSkill = (
    ...args: RuntimeOperationArguments<typeof skills.installSkill>
  ) => skills.installSkill(this.operations, ...args);

  private removeSkill = (
    ...args: RuntimeOperationArguments<typeof skills.removeSkill>
  ) => skills.removeSkill(this.operations, ...args);

  private saveChatAttachment = (
    ...args: RuntimeOperationArguments<typeof driveWrites.saveChatAttachment>
  ) => driveWrites.saveChatAttachment(this.operations, ...args);

  grantWorkspaceUpload(
    ...args: RuntimeOperationArguments<
      typeof workspaceFiles.grantWorkspaceUpload
    >
  ) {
    return workspaceFiles.grantWorkspaceUpload(this.operations, ...args);
  }

  workspaceFileSource(
    ...args: RuntimeOperationArguments<
      typeof workspaceFiles.workspaceFileSource
    >
  ) {
    return workspaceFiles.workspaceFileSource(this.operations, ...args);
  }

  private generateVoiceover = (
    ...args: RuntimeOperationArguments<typeof workspaceFiles.generateVoiceover>
  ) => workspaceFiles.generateVoiceover(this.operations, ...args);

  private saveWorkspaceFile = (
    ...args: RuntimeOperationArguments<typeof workspaceFiles.saveWorkspaceFile>
  ) => workspaceFiles.saveWorkspaceFile(this.operations, ...args);

  private saveFileBytes = (
    ...args: RuntimeOperationArguments<typeof driveWrites.saveFileBytes>
  ) => driveWrites.saveFileBytes(this.operations, ...args);

  private readChat = (
    ...args: RuntimeOperationArguments<typeof chatRooms.readChat>
  ) => chatRooms.readChat(this.operations, ...args);

  private listTasks = (
    ...args: RuntimeOperationArguments<typeof taskReads.listTasks>
  ) => taskReads.listTasks(this.operations, ...args);

  private readTask = (
    ...args: RuntimeOperationArguments<typeof taskReads.readTask>
  ) => taskReads.readTask(this.operations, ...args);

  private updateAssignedTask = (
    ...args: RuntimeOperationArguments<typeof taskReplies.updateAssignedTask>
  ) => taskReplies.updateAssignedTask(this.operations, ...args);

  private replyToTask = (
    ...args: RuntimeOperationArguments<typeof taskReplies.replyToTask>
  ) => taskReplies.replyToTask(this.operations, ...args);

  private linkTasks = (
    ...args: RuntimeOperationArguments<typeof taskReplies.linkTasks>
  ) => taskReplies.linkTasks(this.operations, ...args);

  private createDecision = (
    ...args: RuntimeOperationArguments<typeof taskCreation.createDecision>
  ) => taskCreation.createDecision(this.operations, ...args);

  private createTask = (
    ...args: RuntimeOperationArguments<typeof taskCreation.createTask>
  ) => taskCreation.createTask(this.operations, ...args);

  private mutateTask = (
    ...args: RuntimeOperationArguments<typeof taskMutations.mutateTask>
  ) => taskMutations.mutateTask(this.operations, ...args);

  private applyTaskMutation = (
    ...args: RuntimeOperationArguments<typeof taskMutations.applyTaskMutation>
  ) => taskMutations.applyTaskMutation(this.operations, ...args);

  private assignTask = (
    ...args: RuntimeOperationArguments<typeof taskMutations.assignTask>
  ) => taskMutations.assignTask(this.operations, ...args);

  private requireMutationAuthority = (
    ...args: RuntimeOperationArguments<
      typeof authorization.requireMutationAuthority
    >
  ) => authorization.requireMutationAuthority(this.operations, ...args);

  private reviewCmoPlan = (
    ...args: RuntimeOperationArguments<typeof cmo.reviewCmoPlan>
  ) => cmo.reviewCmoPlan(this.operations, ...args);

  private saveCmoRecord = (
    ...args: RuntimeOperationArguments<typeof cmo.saveCmoRecord>
  ) => cmo.saveCmoRecord(this.operations, ...args);

  private requireWriteScope = (
    ...args: RuntimeOperationArguments<typeof authorization.requireWriteScope>
  ) => authorization.requireWriteScope(this.operations, ...args);

  private updateMemory = (
    ...args: RuntimeOperationArguments<typeof memory.updateMemory>
  ) => memory.updateMemory(this.operations, ...args);

  executeTool(
    ...args: RuntimeOperationArguments<typeof execution.executeTool>
  ) {
    return execution.executeTool(this.operations, ...args);
  }

  private tableActor = (
    ...args: RuntimeOperationArguments<typeof contacts.tableActor>
  ) => contacts.tableActor(this.operations, ...args);

  private executeContactTool = (
    ...args: RuntimeOperationArguments<typeof contacts.executeContactTool>
  ) => contacts.executeContactTool(this.operations, ...args);

  private exportContactsToTable = (
    ...args: RuntimeOperationArguments<typeof contacts.exportContactsToTable>
  ) => contacts.exportContactsToTable(this.operations, ...args);

  private findCoworkers = (
    ...args: RuntimeOperationArguments<typeof contacts.findCoworkers>
  ) => contacts.findCoworkers(this.operations, ...args);

  private findTeammates = (
    ...args: RuntimeOperationArguments<typeof contacts.findTeammates>
  ) => contacts.findTeammates(this.operations, ...args);

  private executeContactResearch = (
    ...args: RuntimeOperationArguments<typeof contacts.executeContactResearch>
  ) => contacts.executeContactResearch(this.operations, ...args);

  private executeProjectTool = (
    ...args: RuntimeOperationArguments<typeof contacts.executeProjectTool>
  ) => contacts.executeProjectTool(this.operations, ...args);

  private findIntegrations = (
    ...args: RuntimeOperationArguments<typeof contacts.findIntegrations>
  ) => contacts.findIntegrations(this.operations, ...args);

  private requireSocialAccess = (
    ...args: RuntimeOperationArguments<typeof social.requireSocialAccess>
  ) => social.requireSocialAccess(this.operations, ...args);

  private requireCmoExecution = (
    ...args: RuntimeOperationArguments<typeof social.requireCmoExecution>
  ) => social.requireCmoExecution(this.operations, ...args);

  private requireAdsAccess = (
    ...args: RuntimeOperationArguments<typeof ads.requireAdsAccess>
  ) => ads.requireAdsAccess(this.operations, ...args);

  private executeAdsTool = (
    ...args: RuntimeOperationArguments<typeof ads.executeAdsTool>
  ) => ads.executeAdsTool(this.operations, ...args);

  private executeSocialTool = (
    ...args: RuntimeOperationArguments<typeof social.executeSocialTool>
  ) => social.executeSocialTool(this.operations, ...args);

  private resolveTaskIds = (
    ...args: RuntimeOperationArguments<typeof toolScope.resolveTaskIds>
  ) => toolScope.resolveTaskIds(this.operations, ...args);

  private requireNewsletterScope = (
    ...args: RuntimeOperationArguments<typeof toolScope.requireNewsletterScope>
  ) => toolScope.requireNewsletterScope(this.operations, ...args);

  private requireOwnerSubscriberWord = (
    ...args: RuntimeOperationArguments<
      typeof toolScope.requireOwnerSubscriberWord
    >
  ) => toolScope.requireOwnerSubscriberWord(this.operations, ...args);

  private executeSeoTool = (
    ...args: RuntimeOperationArguments<typeof toolScope.executeSeoTool>
  ) => toolScope.executeSeoTool(this.operations, ...args);

  private executeAuthorizedTool = (
    ...args: RuntimeOperationArguments<typeof dispatch.executeAuthorizedTool>
  ) => dispatch.executeAuthorizedTool(this.operations, ...args);

  resolveDecision(
    ...args: RuntimeOperationArguments<typeof decision.resolveDecision>
  ) {
    return decision.resolveDecision(this.operations, ...args);
  }
}

export const sokoBotRuntimeService = new SokoBotRuntimeService();
