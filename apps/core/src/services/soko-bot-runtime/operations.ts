import type * as ads from "./ads";
import type * as authorization from "./authorization";
import type * as chatOpen from "./chat-open";
import type * as chatPost from "./chat-post";
import type * as chatRooms from "./chat-rooms";
import type * as cmo from "./cmo";
import type * as contacts from "./contacts";
import type * as context from "./context";
import type * as decision from "./decision";
import type * as dispatch from "./dispatch";
import type * as driveAccess from "./drive-access";
import type * as driveReads from "./drive-reads";
import type * as driveWrites from "./drive-writes";
import type * as execution from "./execution";
import type * as mail from "./mail";
import type * as mediaChecks from "./media-checks";
import type * as mediaGeneration from "./media-generation";
import type * as mediaReferences from "./media-references";
import type * as memory from "./memory";
import type * as skills from "./skills";
import type * as social from "./social";
import type * as taskCreation from "./task-creation";
import type * as taskMutations from "./task-mutations";
import type * as taskReads from "./task-reads";
import type * as taskReplies from "./task-replies";
import type * as toolScope from "./tool-scope";
import type * as workspaceFiles from "./workspace-files";

export type RuntimeOperationArguments<F extends (...args: never[]) => unknown> =
  Parameters<F> extends [unknown, ...infer A] ? A : never;

/** The service's existing operations, passed as callbacks without shared mutable state. */
export interface RuntimeOperations {
  authorize: (
    ...args: RuntimeOperationArguments<typeof authorization.authorize>
  ) => ReturnType<typeof authorization.authorize>;
  getInstalledSkills: (
    ...args: RuntimeOperationArguments<typeof context.getInstalledSkills>
  ) => ReturnType<typeof context.getInstalledSkills>;
  getContext: (
    ...args: RuntimeOperationArguments<typeof context.getContext>
  ) => ReturnType<typeof context.getContext>;
  executeAsAccepted: (
    ...args: RuntimeOperationArguments<typeof taskCreation.executeAsAccepted>
  ) => ReturnType<typeof taskCreation.executeAsAccepted>;
  expireDecision: (
    ...args: RuntimeOperationArguments<typeof taskCreation.expireDecision>
  ) => ReturnType<typeof taskCreation.expireDecision>;
  listChats: (
    ...args: RuntimeOperationArguments<typeof chatRooms.listChats>
  ) => ReturnType<typeof chatRooms.listChats>;
  ownerDirectRooms: (
    ...args: RuntimeOperationArguments<typeof chatRooms.ownerDirectRooms>
  ) => ReturnType<typeof chatRooms.ownerDirectRooms>;
  ownerUnreadRooms: (
    ...args: RuntimeOperationArguments<typeof chatRooms.ownerUnreadRooms>
  ) => ReturnType<typeof chatRooms.ownerUnreadRooms>;
  chatRoomScope: (
    ...args: RuntimeOperationArguments<typeof chatRooms.chatRoomScope>
  ) => ReturnType<typeof chatRooms.chatRoomScope>;
  ownerDirectRoom: (
    ...args: RuntimeOperationArguments<typeof chatRooms.ownerDirectRoom>
  ) => ReturnType<typeof chatRooms.ownerDirectRoom>;
  requireChatMembership: (
    ...args: RuntimeOperationArguments<typeof chatRooms.requireChatMembership>
  ) => ReturnType<typeof chatRooms.requireChatMembership>;
  openDirectChat: (
    ...args: RuntimeOperationArguments<typeof chatOpen.openDirectChat>
  ) => ReturnType<typeof chatOpen.openDirectChat>;
  askCoworker: (
    ...args: RuntimeOperationArguments<typeof chatOpen.askCoworker>
  ) => ReturnType<typeof chatOpen.askCoworker>;
  requireUnattendedPostIsAllowed: (
    ...args: RuntimeOperationArguments<
      typeof chatPost.requireUnattendedPostIsAllowed
    >
  ) => ReturnType<typeof chatPost.requireUnattendedPostIsAllowed>;
  postChat: (
    ...args: RuntimeOperationArguments<typeof chatPost.postChat>
  ) => ReturnType<typeof chatPost.postChat>;
  mayActForOwner: (
    ...args: RuntimeOperationArguments<typeof chatPost.mayActForOwner>
  ) => ReturnType<typeof chatPost.mayActForOwner>;
  mediaPerTurn: (
    ...args: RuntimeOperationArguments<typeof mediaChecks.mediaPerTurn>
  ) => ReturnType<typeof mediaChecks.mediaPerTurn>;
  socialCommentScopeOf: (
    ...args: RuntimeOperationArguments<typeof mediaChecks.socialCommentScopeOf>
  ) => ReturnType<typeof mediaChecks.socialCommentScopeOf>;
  handleCmoComment: (
    ...args: RuntimeOperationArguments<typeof cmo.handleCmoComment>
  ) => ReturnType<typeof cmo.handleCmoComment>;
  checkImageRequest: (
    ...args: RuntimeOperationArguments<typeof mediaChecks.checkImageRequest>
  ) => ReturnType<typeof mediaChecks.checkImageRequest>;
  writeCmoPieceFiles: (
    ...args: RuntimeOperationArguments<
      typeof mediaGeneration.writeCmoPieceFiles
    >
  ) => ReturnType<typeof mediaGeneration.writeCmoPieceFiles>;
  imageReferenceFiles: (
    ...args: RuntimeOperationArguments<
      typeof mediaGeneration.imageReferenceFiles
    >
  ) => ReturnType<typeof mediaGeneration.imageReferenceFiles>;
  generateImage: (
    ...args: RuntimeOperationArguments<typeof mediaGeneration.generateImage>
  ) => ReturnType<typeof mediaGeneration.generateImage>;
  checkVideoRequest: (
    ...args: RuntimeOperationArguments<typeof mediaChecks.checkVideoRequest>
  ) => ReturnType<typeof mediaChecks.checkVideoRequest>;
  generateVideo: (
    ...args: RuntimeOperationArguments<typeof mediaGeneration.generateVideo>
  ) => ReturnType<typeof mediaGeneration.generateVideo>;
  refuseCmoRunMedia: (
    ...args: RuntimeOperationArguments<typeof mediaChecks.refuseCmoRunMedia>
  ) => ReturnType<typeof mediaChecks.refuseCmoRunMedia>;
  requireImageProject: (
    ...args: RuntimeOperationArguments<typeof mediaChecks.requireImageProject>
  ) => ReturnType<typeof mediaChecks.requireImageProject>;
  getStudioJob: (
    ...args: RuntimeOperationArguments<typeof mediaGeneration.getStudioJob>
  ) => ReturnType<typeof mediaGeneration.getStudioJob>;
  imageInOwnerDrive: (
    ...args: RuntimeOperationArguments<typeof mediaGeneration.imageInOwnerDrive>
  ) => ReturnType<typeof mediaGeneration.imageInOwnerDrive>;
  resolveSocialMedia: (
    ...args: RuntimeOperationArguments<
      typeof mediaReferences.resolveSocialMedia
    >
  ) => ReturnType<typeof mediaReferences.resolveSocialMedia>;
  resolveAdImages: (
    ...args: RuntimeOperationArguments<typeof mediaReferences.resolveAdImages>
  ) => ReturnType<typeof mediaReferences.resolveAdImages>;
  resolveSocialPostMedia: (
    ...args: RuntimeOperationArguments<
      typeof mediaReferences.resolveSocialPostMedia
    >
  ) => ReturnType<typeof mediaReferences.resolveSocialPostMedia>;
  ownerDrive: (
    ...args: RuntimeOperationArguments<typeof driveAccess.ownerDrive>
  ) => ReturnType<typeof driveAccess.ownerDrive>;
  listFiles: (
    ...args: RuntimeOperationArguments<typeof driveReads.listFiles>
  ) => ReturnType<typeof driveReads.listFiles>;
  withInlineFiles: (
    ...args: RuntimeOperationArguments<typeof driveReads.withInlineFiles>
  ) => ReturnType<typeof driveReads.withInlineFiles>;
  attachDriveFiles: (
    ...args: RuntimeOperationArguments<typeof driveReads.attachDriveFiles>
  ) => ReturnType<typeof driveReads.attachDriveFiles>;
  ownerFile: (
    ...args: RuntimeOperationArguments<typeof driveAccess.ownerFile>
  ) => ReturnType<typeof driveAccess.ownerFile>;
  newsletterImageFileUrl: (
    ...args: RuntimeOperationArguments<
      typeof driveWrites.newsletterImageFileUrl
    >
  ) => ReturnType<typeof driveWrites.newsletterImageFileUrl>;
  readCsvFile: (
    ...args: RuntimeOperationArguments<typeof driveReads.readCsvFile>
  ) => ReturnType<typeof driveReads.readCsvFile>;
  readFile: (
    ...args: RuntimeOperationArguments<typeof driveReads.readFile>
  ) => ReturnType<typeof driveReads.readFile>;
  uploadFile: (
    ...args: RuntimeOperationArguments<typeof driveWrites.uploadFile>
  ) => ReturnType<typeof driveWrites.uploadFile>;
  commitReceipt: <T>(
    ...args: RuntimeOperationArguments<typeof mail.commitReceipt<T>>
  ) => ReturnType<typeof mail.commitReceipt<T>>;
  mailboxFor: (
    ...args: RuntimeOperationArguments<typeof mail.mailboxFor>
  ) => ReturnType<typeof mail.mailboxFor>;
  updateEmails: (
    ...args: RuntimeOperationArguments<typeof mail.updateEmails>
  ) => ReturnType<typeof mail.updateEmails>;
  draftEmail: (
    ...args: RuntimeOperationArguments<typeof mail.draftEmail>
  ) => ReturnType<typeof mail.draftEmail>;
  sendEmailDraft: (
    ...args: RuntimeOperationArguments<typeof mail.sendEmailDraft>
  ) => ReturnType<typeof mail.sendEmailDraft>;
  saveEmailAttachment: (
    ...args: RuntimeOperationArguments<typeof mail.saveEmailAttachment>
  ) => ReturnType<typeof mail.saveEmailAttachment>;
  ownerDriveFile: (
    ...args: RuntimeOperationArguments<typeof driveAccess.ownerDriveFile>
  ) => ReturnType<typeof driveAccess.ownerDriveFile>;
  moveFile: (
    ...args: RuntimeOperationArguments<typeof driveWrites.moveFile>
  ) => ReturnType<typeof driveWrites.moveFile>;
  deleteFile: (
    ...args: RuntimeOperationArguments<typeof driveWrites.deleteFile>
  ) => ReturnType<typeof driveWrites.deleteFile>;
  listSkills: (
    ...args: RuntimeOperationArguments<typeof skills.listSkills>
  ) => ReturnType<typeof skills.listSkills>;
  installSkill: (
    ...args: RuntimeOperationArguments<typeof skills.installSkill>
  ) => ReturnType<typeof skills.installSkill>;
  removeSkill: (
    ...args: RuntimeOperationArguments<typeof skills.removeSkill>
  ) => ReturnType<typeof skills.removeSkill>;
  saveChatAttachment: (
    ...args: RuntimeOperationArguments<typeof driveWrites.saveChatAttachment>
  ) => ReturnType<typeof driveWrites.saveChatAttachment>;
  grantWorkspaceUpload: (
    ...args: RuntimeOperationArguments<
      typeof workspaceFiles.grantWorkspaceUpload
    >
  ) => ReturnType<typeof workspaceFiles.grantWorkspaceUpload>;
  workspaceFileSource: (
    ...args: RuntimeOperationArguments<
      typeof workspaceFiles.workspaceFileSource
    >
  ) => ReturnType<typeof workspaceFiles.workspaceFileSource>;
  generateVoiceover: (
    ...args: RuntimeOperationArguments<typeof workspaceFiles.generateVoiceover>
  ) => ReturnType<typeof workspaceFiles.generateVoiceover>;
  saveWorkspaceFile: (
    ...args: RuntimeOperationArguments<typeof workspaceFiles.saveWorkspaceFile>
  ) => ReturnType<typeof workspaceFiles.saveWorkspaceFile>;
  saveFileBytes: (
    ...args: RuntimeOperationArguments<typeof driveWrites.saveFileBytes>
  ) => ReturnType<typeof driveWrites.saveFileBytes>;
  readChat: (
    ...args: RuntimeOperationArguments<typeof chatRooms.readChat>
  ) => ReturnType<typeof chatRooms.readChat>;
  listTasks: (
    ...args: RuntimeOperationArguments<typeof taskReads.listTasks>
  ) => ReturnType<typeof taskReads.listTasks>;
  readTask: (
    ...args: RuntimeOperationArguments<typeof taskReads.readTask>
  ) => ReturnType<typeof taskReads.readTask>;
  updateAssignedTask: (
    ...args: RuntimeOperationArguments<typeof taskReplies.updateAssignedTask>
  ) => ReturnType<typeof taskReplies.updateAssignedTask>;
  replyToTask: (
    ...args: RuntimeOperationArguments<typeof taskReplies.replyToTask>
  ) => ReturnType<typeof taskReplies.replyToTask>;
  linkTasks: (
    ...args: RuntimeOperationArguments<typeof taskReplies.linkTasks>
  ) => ReturnType<typeof taskReplies.linkTasks>;
  createDecision: (
    ...args: RuntimeOperationArguments<typeof taskCreation.createDecision>
  ) => ReturnType<typeof taskCreation.createDecision>;
  createTask: (
    ...args: RuntimeOperationArguments<typeof taskCreation.createTask>
  ) => ReturnType<typeof taskCreation.createTask>;
  mutateTask: (
    ...args: RuntimeOperationArguments<typeof taskMutations.mutateTask>
  ) => ReturnType<typeof taskMutations.mutateTask>;
  applyTaskMutation: (
    ...args: RuntimeOperationArguments<typeof taskMutations.applyTaskMutation>
  ) => ReturnType<typeof taskMutations.applyTaskMutation>;
  assignTask: (
    ...args: RuntimeOperationArguments<typeof taskMutations.assignTask>
  ) => ReturnType<typeof taskMutations.assignTask>;
  requireMutationAuthority: (
    ...args: RuntimeOperationArguments<
      typeof authorization.requireMutationAuthority
    >
  ) => ReturnType<typeof authorization.requireMutationAuthority>;
  reviewCmoPlan: (
    ...args: RuntimeOperationArguments<typeof cmo.reviewCmoPlan>
  ) => ReturnType<typeof cmo.reviewCmoPlan>;
  saveCmoRecord: (
    ...args: RuntimeOperationArguments<typeof cmo.saveCmoRecord>
  ) => ReturnType<typeof cmo.saveCmoRecord>;
  requireWriteScope: (
    ...args: RuntimeOperationArguments<typeof authorization.requireWriteScope>
  ) => ReturnType<typeof authorization.requireWriteScope>;
  updateMemory: (
    ...args: RuntimeOperationArguments<typeof memory.updateMemory>
  ) => ReturnType<typeof memory.updateMemory>;
  executeTool: (
    ...args: RuntimeOperationArguments<typeof execution.executeTool>
  ) => ReturnType<typeof execution.executeTool>;
  tableActor: (
    ...args: RuntimeOperationArguments<typeof contacts.tableActor>
  ) => ReturnType<typeof contacts.tableActor>;
  executeContactTool: (
    ...args: RuntimeOperationArguments<typeof contacts.executeContactTool>
  ) => ReturnType<typeof contacts.executeContactTool>;
  exportContactsToTable: (
    ...args: RuntimeOperationArguments<typeof contacts.exportContactsToTable>
  ) => ReturnType<typeof contacts.exportContactsToTable>;
  findCoworkers: (
    ...args: RuntimeOperationArguments<typeof contacts.findCoworkers>
  ) => ReturnType<typeof contacts.findCoworkers>;
  findTeammates: (
    ...args: RuntimeOperationArguments<typeof contacts.findTeammates>
  ) => ReturnType<typeof contacts.findTeammates>;
  executeContactResearch: (
    ...args: RuntimeOperationArguments<typeof contacts.executeContactResearch>
  ) => ReturnType<typeof contacts.executeContactResearch>;
  executeProjectTool: (
    ...args: RuntimeOperationArguments<typeof contacts.executeProjectTool>
  ) => ReturnType<typeof contacts.executeProjectTool>;
  findIntegrations: (
    ...args: RuntimeOperationArguments<typeof contacts.findIntegrations>
  ) => ReturnType<typeof contacts.findIntegrations>;
  requireSocialAccess: (
    ...args: RuntimeOperationArguments<typeof social.requireSocialAccess>
  ) => ReturnType<typeof social.requireSocialAccess>;
  requireCmoExecution: (
    ...args: RuntimeOperationArguments<typeof social.requireCmoExecution>
  ) => ReturnType<typeof social.requireCmoExecution>;
  requireAdsAccess: (
    ...args: RuntimeOperationArguments<typeof ads.requireAdsAccess>
  ) => ReturnType<typeof ads.requireAdsAccess>;
  executeAdsTool: (
    ...args: RuntimeOperationArguments<typeof ads.executeAdsTool>
  ) => ReturnType<typeof ads.executeAdsTool>;
  executeSocialTool: (
    ...args: RuntimeOperationArguments<typeof social.executeSocialTool>
  ) => ReturnType<typeof social.executeSocialTool>;
  resolveTaskIds: (
    ...args: RuntimeOperationArguments<typeof toolScope.resolveTaskIds>
  ) => ReturnType<typeof toolScope.resolveTaskIds>;
  requireNewsletterScope: (
    ...args: RuntimeOperationArguments<typeof toolScope.requireNewsletterScope>
  ) => ReturnType<typeof toolScope.requireNewsletterScope>;
  requireOwnerSubscriberWord: (
    ...args: RuntimeOperationArguments<
      typeof toolScope.requireOwnerSubscriberWord
    >
  ) => ReturnType<typeof toolScope.requireOwnerSubscriberWord>;
  executeSeoTool: (
    ...args: RuntimeOperationArguments<typeof toolScope.executeSeoTool>
  ) => ReturnType<typeof toolScope.executeSeoTool>;
  executeAuthorizedTool: (
    ...args: RuntimeOperationArguments<typeof dispatch.executeAuthorizedTool>
  ) => ReturnType<typeof dispatch.executeAuthorizedTool>;
  resolveDecision: (
    ...args: RuntimeOperationArguments<typeof decision.resolveDecision>
  ) => ReturnType<typeof decision.resolveDecision>;
}
