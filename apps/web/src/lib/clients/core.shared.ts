import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { mapCorePublicSharedResourceResponse } from "@/lib/clients/core.job-share";
import type {
  ActivateEnterpriseContractRequest,
  AgentStatus,
  CreateAdminVendorData,
  CreateChatRoomMessageRequest,
  CreateChatRoomRequest,
  CreateEnterpriseContractRequest,
  DeleteHermesMeInstanceIntegrationsByProviderData,
  DeleteJobsByIdShareError,
  DeleteProjectsByIdJobsByJobIdData,
  DeleteProjectsByIdTasksByTaskIdData,
  DeleteTasksByIdShareError,
  GetAgentsByIdJobsData,
  GetAgentsByIdReviewsData,
  GetAgentsData,
  GetCategoriesData,
  GetChatsRoomsByIdMessagesData,
  GetChatsRoomsData,
  GetCoworkersData,
  GetEnterpriseContractsData,
  GetHermesMeMessagesData,
  GetHistoryData,
  GetJobsData,
  GetNotificationsData,
  GetProjectsData,
  GetProjectsStatsData,
  GetShareByTokenError,
  GetTasksData,
  HermesApproveConfirmationRequest,
  HermesFinalizeIntegrationRequest,
  HermesInitiateIntegrationRequest,
  HermesPatchScheduleRequest,
  HermesRejectConfirmationRequest,
  HermesStartOnboardingRequest,
  HermesUpdateInstanceRequest,
  MarkHermesInboxSeenRequest,
  Notice,
  PaginationMetadata,
  PatchAdminVendorData,
  PatchChatsRoomsByIdData,
  PatchChatsRoomsByIdMessagesByMessageIdData,
  PatchCoworkersByIdData,
  PatchCoworkersByIdWhitelistData,
  PatchEnterpriseContractRequest,
  PatchJobsByIdData,
  PatchNotificationsByIdReadData,
  PatchProjectsByIdData,
  PatchTasksByIdData,
  PatchVendorData,
  PostAgentsByIdJobsData,
  PostAgentsByIdJobsError,
  PostAgentsByIdRatingsData,
  PostChatsRoomsByIdFilesData,
  PostChatsRoomsByIdMessagesByMessageIdReactionsData,
  PostChatsRoomsByIdMessagesData,
  PostChatsRoomsData,
  PostJobsByIdInputsData,
  PostOrganizationsByIdFilesCleanupData,
  PostOrganizationsByIdFilesData,
  PostOrganizationsByIdInviteLinksData,
  PostProjectsByIdJobsData,
  PostProjectsByIdTasksData,
  PostProjectsData,
  PostTasksByIdFilesData,
  PostTasksByIdLinksData,
  PostTasksData,
  PostUsersByIdFilesData,
  PostVendorsByIdFilesCleanupData,
  PostVendorsByIdFilesData,
  PutJobsByIdShareError,
  PutOrganizationsByIdDesignMdData,
  PutTaskScheduleRequest,
  PutTasksByIdShareError,
  PutUsersByIdDesignMdData,
  SetHermesSecretRequest,
} from "@/lib/clients/generated/core";
import {
  addAdminOrganizationMember as coreAddAdminOrganizationMember,
  assignAdminOrganizationMemberSeat as coreAssignAdminOrganizationMemberSeat,
  assignCoworkerDeveloper as coreAssignCoworkerDeveloper,
  claimCoupon as coreClaimCoupon,
  createAdminFreeCreditGrant as coreCreateAdminFreeCreditGrant,
  createAdminInvoice as coreCreateAdminInvoice,
  createAdminVendor as coreCreateAdminVendor,
  createCreditCheckoutSession as coreCreateCreditCheckoutSession,
  deleteAdminAgentMetadataOverride as coreDeleteAdminAgentMetadataOverride,
  deleteAdminInvoice as coreDeleteAdminInvoice,
  deleteChatsRoomsByIdMembersMe as coreDeleteChatsRoomsByIdMembersMe,
  deleteCoworkersById as coreDeleteCoworkersById,
  deleteCoworkersByIdImage as coreDeleteCoworkersByIdImage,
  deleteHermesMeInstance as coreDeleteHermesMeInstance,
  deleteHermesMeInstanceIntegrationsByProvider as coreDeleteHermesMeInstanceIntegrationsByProvider,
  deleteHermesMeInstanceSkillsBySlug as coreDeleteHermesMeInstanceSkillsBySlug,
  deleteJobsByIdShare as coreDeleteJobsByIdShare,
  deleteOrganizationsByIdInviteLinksByToken as coreDeleteOrganizationsByIdInviteLinksByToken,
  deleteOrganizationsByIdMembersByMemberIdSeat as coreDeleteOrganizationsByIdMembersByMemberIdSeat,
  deleteProjectsById as coreDeleteProjectsById,
  deleteProjectsByIdJobsByJobId as coreDeleteProjectsByIdJobsByJobId,
  deleteProjectsByIdTasksByTaskId as coreDeleteProjectsByIdTasksByTaskId,
  deleteTasksById as coreDeleteTasksById,
  deleteTasksByIdLinksByLinkId as coreDeleteTasksByIdLinksByLinkId,
  deleteTasksByIdSchedule as coreDeleteTasksByIdSchedule,
  deleteTasksByIdShare as coreDeleteTasksByIdShare,
  deleteUsersByIdOauthConsentsByConsentId as coreDeleteUsersByIdOauthConsentsByConsentId,
  getAdminAgent as coreGetAdminAgent,
  getAdminInvoice as coreGetAdminInvoice,
  getAdminOrganizationBySlug as coreGetAdminOrganizationBySlug,
  getAdminTask as coreGetAdminTask,
  getAgents as coreGetAgents,
  getAgentsById as coreGetAgentsById,
  getAgentsByIdInputSchema as coreGetAgentsByIdInputSchema,
  getAgentsByIdJobs as coreGetAgentsByIdJobs,
  getAgentsByIdRatingsEligibility as coreGetAgentsByIdRatingsEligibility,
  getAgentsByIdReviews as coreGetAgentsByIdReviews,
  getAgentsByIdReviewsMe as coreGetAgentsByIdReviewsMe,
  getCategories as coreGetCategories,
  getChatsRooms as coreGetChatsRooms,
  getChatsRoomsById as coreGetChatsRoomsById,
  getChatsRoomsByIdMessages as coreGetChatsRoomsByIdMessages,
  getCheckoutSessionAnalytics as coreGetCheckoutSessionAnalytics,
  getCouponDetails as coreGetCouponDetails,
  getCoworkers as coreGetCoworkers,
  getCoworkersById as coreGetCoworkersById,
  getCreditTopUpPriceCatalog as coreGetCreditTopUpPriceCatalog,
  getDeveloperOwnedCoworkerTask as coreGetDeveloperOwnedCoworkerTask,
  getEnterpriseContracts as coreGetEnterpriseContracts,
  getEnterpriseContractsById as coreGetEnterpriseContractsById,
  getEnterpriseContractsByIdPeriodsPreview as coreGetEnterpriseContractsByIdPeriodsPreview,
  getHermesMeInstance as coreGetHermesMeInstance,
  getHermesMeInstanceIntegrations as coreGetHermesMeInstanceIntegrations,
  getHermesMeInstanceOnboardingProgress as coreGetHermesMeInstanceOnboardingProgress,
  getHermesMeInstanceSchedules as coreGetHermesMeInstanceSchedules,
  getHermesMeInstanceSkills as coreGetHermesMeInstanceSkills,
  getHermesMeInstanceSkillsCatalog as coreGetHermesMeInstanceSkillsCatalog,
  getHermesMeInstanceSkillsCatalogCurated as coreGetHermesMeInstanceSkillsCatalogCurated,
  getHermesMeInstanceSkillsCatalogDetail as coreGetHermesMeInstanceSkillsCatalogDetail,
  getHermesMeInstanceSkillsCatalogSearch as coreGetHermesMeInstanceSkillsCatalogSearch,
  getHermesMeInstanceSkillsPreinstalled as coreGetHermesMeInstanceSkillsPreinstalled,
  getHermesMeMessages as coreGetHermesMeMessages,
  getHermesMeUnreadCount as coreGetHermesMeUnreadCount,
  getHistory as coreGetHistory,
  getInvitationsById as coreGetInvitationsById,
  getJobs as coreGetJobs,
  getJobsById as coreGetJobsById,
  getNotifications as coreGetNotifications,
  getNotificationsUnreadCount as coreGetNotificationsUnreadCount,
  getOrganizationBySlug as coreGetOrganizationBySlug,
  getOrganizationEnterpriseContractSummary as coreGetOrganizationEnterpriseContractSummary,
  getOrganizationInviteLinksByToken as coreGetOrganizationInviteLinksByToken,
  getOrganizationsById as coreGetOrganizationsById,
  getOrganizationsByIdBillingDetails as coreGetOrganizationsByIdBillingDetails,
  getOrganizationsByIdBillingPlan as coreGetOrganizationsByIdBillingPlan,
  getOrganizationsByIdInvitations as coreGetOrganizationsByIdInvitations,
  getOrganizationsByIdInviteLinks as coreGetOrganizationsByIdInviteLinks,
  getOrganizationsByIdMembers as coreGetOrganizationsByIdMembers,
  getOrganizationsByIdSeatSummary as coreGetOrganizationsByIdSeatSummary,
  getOrganizationsByIdStripeCustomer as coreGetOrganizationsByIdStripeCustomer,
  getOrganizationsByIdSubscription as coreGetOrganizationsByIdSubscription,
  getOrganizationsByIdVendorGrants as coreGetOrganizationsByIdVendorGrants,
  getProjects as coreGetProjects,
  getProjectsById as coreGetProjectsById,
  getProjectsStats as coreGetProjectsStats,
  getShareByToken as coreGetShareByToken,
  getSubscriptionCatalog as coreGetSubscriptionCatalog,
  getTasks as coreGetTasks,
  getTasksById as coreGetTasksById,
  getTasksByIdLinks as coreGetTasksByIdLinks,
  getTasksByIdWorkspace as coreGetTasksByIdWorkspace,
  getToolsSiteIcon as coreGetToolsSiteIcon,
  getUsersByIdBillingDetails as coreGetUsersByIdBillingDetails,
  getUsersByIdCredits as coreGetUsersByIdCredits,
  getUsersByIdMembers as coreGetUsersByIdMembers,
  getUsersByIdNoticesPending as coreGetUsersByIdNoticesPending,
  getUsersByIdOrganizations as coreGetUsersByIdOrganizations,
  getUsersByIdOrganizationsByOrganizationIdCredits as coreGetUsersByIdOrganizationsByOrganizationIdCredits,
  getUsersByIdOrganizationsByOrganizationIdMember as coreGetUsersByIdOrganizationsByOrganizationIdMember,
  getUsersByIdStripeCustomer as coreGetUsersByIdStripeCustomer,
  getUsersByIdSubscription as coreGetUsersByIdSubscription,
  getUsersByIdVendorGrants as coreGetUsersByIdVendorGrants,
  getWorkspacesById as coreGetWorkspacesById,
  getWorkspacesDesignMd as coreGetWorkspacesDesignMd,
  listAdminAgents as coreListAdminAgents,
  listAdminInvoices as coreListAdminInvoices,
  listAdminOrganizationMembers as coreListAdminOrganizationMembers,
  listAdminOrganizations as coreListAdminOrganizations,
  listAdminTasks as coreListAdminTasks,
  listAdminUsers as coreListAdminUsers,
  listAdminVendors as coreListAdminVendors,
  listCoworkerAssignments as coreListCoworkerAssignments,
  listCreditPrices as coreListCreditPrices,
  listDeveloperOwnedCoworkerTasks as coreListDeveloperOwnedCoworkerTasks,
  listMyVendorMemberships as coreListMyVendorMemberships,
  listVendorMembers as coreListVendorMembers,
  listVendors as coreListVendors,
  markAdminInvoicePaid as coreMarkAdminInvoicePaid,
  patchAdminAgentMetadataOverride as corePatchAdminAgentMetadataOverride,
  patchAdminVendor as corePatchAdminVendor,
  patchChatsRoomsById as corePatchChatsRoomsById,
  patchChatsRoomsByIdMessagesByMessageId as corePatchChatsRoomsByIdMessagesByMessageId,
  patchCoworkersById as corePatchCoworkersById,
  patchCoworkersByIdWhitelist as corePatchCoworkersByIdWhitelist,
  patchEnterpriseContractsById as corePatchEnterpriseContractsById,
  patchHermesMeInstance as corePatchHermesMeInstance,
  patchHermesMeInstanceSchedulesByScheduleId as corePatchHermesMeInstanceSchedulesByScheduleId,
  patchJobsById as corePatchJobsById,
  patchNotificationsByIdRead as corePatchNotificationsByIdRead,
  patchNotificationsReadAll as corePatchNotificationsReadAll,
  patchProjectsById as corePatchProjectsById,
  patchTasksById as corePatchTasksById,
  patchVendor as corePatchVendor,
  postAgentsByIdJobs as corePostAgentsByIdJobs,
  postAgentsByIdRatings as corePostAgentsByIdRatings,
  postChatsRooms as corePostChatsRooms,
  postChatsRoomsByIdArchive as corePostChatsRoomsByIdArchive,
  postChatsRoomsByIdFiles as corePostChatsRoomsByIdFiles,
  postChatsRoomsByIdMessages as corePostChatsRoomsByIdMessages,
  postChatsRoomsByIdMessagesByMessageIdReactions as corePostChatsRoomsByIdMessagesByMessageIdReactions,
  postChatsRoomsByIdRead as corePostChatsRoomsByIdRead,
  postChatsRoomsByIdRestore as corePostChatsRoomsByIdRestore,
  postCoworkersByIdImage as corePostCoworkersByIdImage,
  postCoworkersByIdUnarchive as corePostCoworkersByIdUnarchive,
  postEnterpriseContracts as corePostEnterpriseContracts,
  postEnterpriseContractsByIdActivate as corePostEnterpriseContractsByIdActivate,
  postEnterpriseContractsByIdCancel as corePostEnterpriseContractsByIdCancel,
  postHermesMeInboxSeen as corePostHermesMeInboxSeen,
  postHermesMeInstance as corePostHermesMeInstance,
  postHermesMeInstanceConfirmationsByConfirmationIdApprove as corePostHermesMeInstanceConfirmationsByConfirmationIdApprove,
  postHermesMeInstanceConfirmationsByConfirmationIdReject as corePostHermesMeInstanceConfirmationsByConfirmationIdReject,
  postHermesMeInstanceIntegrationsFinalize as corePostHermesMeInstanceIntegrationsFinalize,
  postHermesMeInstanceIntegrationsInitiate as corePostHermesMeInstanceIntegrationsInitiate,
  postHermesMeInstanceOnboard as corePostHermesMeInstanceOnboard,
  postHermesMeInstanceSkills as corePostHermesMeInstanceSkills,
  postHermesMeSecrets as corePostHermesMeSecrets,
  postJobsByIdInputs as corePostJobsByIdInputs,
  postJobsByIdRefund as corePostJobsByIdRefund,
  postOrganizationInviteLinksByTokenAccept as corePostOrganizationInviteLinksByTokenAccept,
  postOrganizationsByIdFiles as corePostOrganizationsByIdFiles,
  postOrganizationsByIdFilesCleanup as corePostOrganizationsByIdFilesCleanup,
  postOrganizationsByIdInviteLinks as corePostOrganizationsByIdInviteLinks,
  postOrganizationsByIdStripeCustomer as corePostOrganizationsByIdStripeCustomer,
  postOrganizationsByIdVendorGrants as corePostOrganizationsByIdVendorGrants,
  postOrganizationsByIdVendorGrantsByGrantIdApprove as corePostOrganizationsByIdVendorGrantsByGrantIdApprove,
  postOrganizationsByIdVendorGrantsByGrantIdDeny as corePostOrganizationsByIdVendorGrantsByGrantIdDeny,
  postOrganizationsByIdVendorGrantsByGrantIdRevoke as corePostOrganizationsByIdVendorGrantsByGrantIdRevoke,
  postProjects as corePostProjects,
  postProjectsByIdJobs as corePostProjectsByIdJobs,
  postProjectsByIdTasks as corePostProjectsByIdTasks,
  postTasks as corePostTasks,
  postTasksByIdEvents as corePostTasksByIdEvents,
  postTasksByIdFiles as corePostTasksByIdFiles,
  postTasksByIdLinks as corePostTasksByIdLinks,
  postUsersByIdFiles as corePostUsersByIdFiles,
  postUsersByIdNoticesByNoticeIdAcknowledge as corePostUsersByIdNoticesByNoticeIdAcknowledge,
  postUsersByIdStripeCustomer as corePostUsersByIdStripeCustomer,
  postUsersByIdVendorGrants as corePostUsersByIdVendorGrants,
  postUsersByIdVendorGrantsByGrantIdApprove as corePostUsersByIdVendorGrantsByGrantIdApprove,
  postUsersByIdVendorGrantsByGrantIdDeny as corePostUsersByIdVendorGrantsByGrantIdDeny,
  postUsersByIdVendorGrantsByGrantIdRevoke as corePostUsersByIdVendorGrantsByGrantIdRevoke,
  postVendorsByIdFiles as corePostVendorsByIdFiles,
  postVendorsByIdFilesCleanup as corePostVendorsByIdFilesCleanup,
  putJobsByIdShare as corePutJobsByIdShare,
  putJobsByIdWorkspace as corePutJobsByIdWorkspace,
  putOrganizationsByIdDesignMd as corePutOrganizationsByIdDesignMd,
  putOrganizationsByIdMembersByMemberIdSeat as corePutOrganizationsByIdMembersByMemberIdSeat,
  putOrganizationsByIdSubscriptionSeats as corePutOrganizationsByIdSubscriptionSeats,
  putTasksByIdSchedule as corePutTasksByIdSchedule,
  putTasksByIdShare as corePutTasksByIdShare,
  putTasksByIdWorkspace as corePutTasksByIdWorkspace,
  putUsersByIdDesignMd as corePutUsersByIdDesignMd,
  putUsersByIdPreferredOrganization as corePutUsersByIdPreferredOrganization,
  removeAdminOrganizationMember as coreRemoveAdminOrganizationMember,
  searchAdminOrganizations as coreSearchAdminOrganizations,
  searchAdminUsers as coreSearchAdminUsers,
  unassignAdminOrganizationMemberSeat as coreUnassignAdminOrganizationMemberSeat,
  unassignCoworkerDeveloper as coreUnassignCoworkerDeveloper,
  updateAdminOrganizationMemberRole as coreUpdateAdminOrganizationMemberRole,
  NoticeKind,
} from "@/lib/clients/generated/core";
import type { Client } from "@/lib/clients/generated/core/client";

export type CoreApiPagination = PaginationMetadata;

export interface CoreApiMeta {
  requestId?: string;
  timestamp?: string;
  pagination?: CoreApiPagination;
}

export interface CoreApiResponse<T> {
  data: T;
  meta?: CoreApiMeta;
}

export class CoreApiRequestError extends Error {
  details?: unknown;
  /**
   * Stable machine-readable error kind from the Core error envelope (e.g.
   * `organization_not_found`). Prefer matching on this over `message`, which
   * may be reworded at any time. See `CORE_API_ERROR_KINDS` in
   * `@sokosumi/utils`.
   */
  kind?: string;
  status?: number;

  constructor(
    message: string,
    options?: { details?: unknown; kind?: string; status?: number },
  ) {
    super(message);
    this.name = "CoreApiRequestError";
    this.details = options?.details;
    this.kind = options?.kind;
    this.status = options?.status;
  }
}

type CoreOperationResult<TData, TError> = {
  data?: TData;
  error?: TError;
  /** Present for HTTP outcomes; omitted when the client reports a network-level failure. */
  response?: Response;
};

type GetClient = () => Client | Promise<Client>;
const CURRENT_USER_PATH_ID = "me";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function transformHistoryResponseEnvelope(data: any) {
  data.data = data.data.map((item: any) => ({
    ...item,
    updatedAt: toDate(item.updatedAt),
    archivedAt: item.archivedAt ? toDate(item.archivedAt) : null,
  }));
  if (data.meta?.timestamp) {
    data.meta.timestamp = toDate(data.meta.timestamp);
  }

  return data;
}

function transformTaskListResponseEnvelope(data: any) {
  data.data = (data.data ?? []).map((item: any) => {
    item.createdAt = toDate(item.createdAt);
    item.updatedAt = toDate(item.updatedAt);
    if (item.nextRunAt) {
      item.nextRunAt = toDate(item.nextRunAt);
    }

    return item;
  });
  if (data.meta?.timestamp) {
    data.meta.timestamp = toDate(data.meta.timestamp);
  }

  return data;
}

function transformTaskResponseEnvelope(data: any) {
  const task = data.data;

  task.createdAt = toDate(task.createdAt);
  task.updatedAt = toDate(task.updatedAt);
  if (task.nextRunAt) {
    task.nextRunAt = toDate(task.nextRunAt);
  }
  task.events = task.events.map((event: any) => ({
    ...event,
    createdAt: toDate(event.createdAt),
    updatedAt: toDate(event.updatedAt),
  }));
  task.jobs = task.jobs.map((job: any) => ({
    ...job,
    createdAt: toDate(job.createdAt),
    updatedAt: toDate(job.updatedAt),
    completedAt: job.completedAt ? toDate(job.completedAt) : null,
  }));
  task.share = task.share
    ? {
        ...task.share,
        createdAt: toDate(task.share.createdAt),
        updatedAt: toDate(task.share.updatedAt),
      }
    : null;
  task.links = task.links.map((link: any) => ({
    ...link,
    createdAt: toDate(link.createdAt),
    updatedAt: toDate(link.updatedAt),
  }));
  data.meta.timestamp = toDate(data.meta.timestamp);

  return data;
}

function extractErrorMessage(error: unknown, status?: number): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (error && typeof error === "object") {
    const typedError = error as {
      error?: unknown;
      message?: unknown;
    };

    if (
      typeof typedError.message === "string" &&
      typedError.message.length > 0
    ) {
      return typedError.message;
    }

    if (typeof typedError.error === "string" && typedError.error.length > 0) {
      return typedError.error;
    }
  }

  if (typeof status === "number") {
    return `API error: ${status}`;
  }

  return "Failed to communicate with Core API";
}

function extractErrorKind(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    const typedError = error as { kind?: unknown };

    if (typeof typedError.kind === "string" && typedError.kind.length > 0) {
      return typedError.kind;
    }
  }

  return undefined;
}

async function executeOperation<TData, TError>(
  getClient: GetClient,
  operation: (client: Client) => Promise<CoreOperationResult<TData, TError>>,
  fallbackMessage: string,
): Promise<TData> {
  const client = await getClient();

  let result: CoreOperationResult<TData, TError>;
  try {
    result = await operation(client);
  } catch (error) {
    throw new CoreApiRequestError(
      error instanceof Error ? error.message : fallbackMessage,
      { details: error },
    );
  }

  if (result.error) {
    const message = extractErrorMessage(result.error, result.response?.status);
    throw new CoreApiRequestError(message, {
      details: result.error,
      kind: extractErrorKind(result.error),
      status: result.response?.status,
    });
  }

  const isNoContentSuccess =
    result.response?.ok === true &&
    (result.response.status === 204 || result.response.status === 205);

  if (result.data == null && !isNoContentSuccess) {
    const message = extractErrorMessage(result.error, result.response?.status);
    throw new CoreApiRequestError(message, {
      details: result.error,
      kind: extractErrorKind(result.error),
      status: result.response?.status,
    });
  }

  return result.data as TData;
}

export function mapCoreApiStatusToCommonErrorCode(
  status?: number,
): CommonErrorCode {
  switch (status) {
    case 401:
    case 403:
      return CommonErrorCode.UNAUTHORIZED;
    case 404:
      return CommonErrorCode.NOT_FOUND;
    case 400:
    case 409:
    case 422:
      return CommonErrorCode.BAD_INPUT;
    default:
      return CommonErrorCode.INTERNAL_SERVER_ERROR;
  }
}

export function toCoreApiActionError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError) {
    let message = error.message;

    if (
      error.status === 503 &&
      !message.toLowerCase().includes("unavailable")
    ) {
      message = "The service is currently unavailable.";
    }

    return {
      message,
      code: mapCoreApiStatusToCommonErrorCode(error.status),
    };
  }

  return {
    message:
      error instanceof Error
        ? error.message
        : "Failed to communicate with Core API",
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
  };
}

export function createCoreClient(getClient: GetClient) {
  async function getChatRooms(query?: GetChatsRoomsData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetChatsRooms({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch chat rooms",
    );
  }

  /**
   * Creates a chat room. A `direct` room is create-or-get: Core returns the
   * existing room for the same participant set instead of a duplicate.
   */
  async function createChatRoom(
    body: CreateChatRoomRequest & NonNullable<PostChatsRoomsData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostChatsRooms({
          client,
          body,
        }),
      "Failed to create chat room",
    );
  }

  async function getChatRoom(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch chat room",
    );
  }

  async function updateChatRoom(
    id: string,
    body: NonNullable<PatchChatsRoomsByIdData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchChatsRoomsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update chat room",
    );
  }

  async function archiveChatRoom(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdArchive({
          client,
          path: { id },
        }),
      "Failed to archive chat room",
    );
  }

  async function restoreChatRoom(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdRestore({
          client,
          path: { id },
        }),
      "Failed to restore chat room",
    );
  }

  async function leaveChatRoom(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteChatsRoomsByIdMembersMe({
          client,
          path: { id },
        }),
      "Failed to leave chat room",
    );
  }

  async function markChatRoomRead(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdRead({
          client,
          path: { id },
        }),
      "Failed to mark chat room read",
    );
  }

  async function getChatRoomMessages(
    id: string,
    query?: GetChatsRoomsByIdMessagesData["query"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetChatsRoomsByIdMessages({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch chat room messages",
    );
  }

  async function addChatRoomMessage(
    id: string,
    body: CreateChatRoomMessageRequest &
      NonNullable<PostChatsRoomsByIdMessagesData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMessages({
          client,
          path: { id },
          body,
        }),
      "Failed to add chat room message",
    );
  }

  async function toggleChatRoomMessageReaction(
    id: string,
    messageId: string,
    body: NonNullable<
      PostChatsRoomsByIdMessagesByMessageIdReactionsData["body"]
    >,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdMessagesByMessageIdReactions({
          client,
          path: { id, messageId },
          body,
        }),
      "Failed to update chat room message reaction",
    );
  }

  async function updateChatRoomMessage(
    id: string,
    messageId: string,
    body: NonNullable<PatchChatsRoomsByIdMessagesByMessageIdData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchChatsRoomsByIdMessagesByMessageId({
          client,
          path: { id, messageId },
          body,
        }),
      "Failed to update chat room message",
    );
  }

  async function getTasks(query?: GetTasksData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetTasks({
          client,
          query,
          cache: "no-store",
          responseTransformer: async (data) =>
            transformTaskListResponseEnvelope(data),
        }),
      "Failed to fetch tasks",
    );
  }

  async function getHistory(query?: GetHistoryData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetHistory({
          client,
          query,
          cache: "no-store",
          responseTransformer: async (data) =>
            transformHistoryResponseEnvelope(data),
        }),
      "Failed to fetch history",
    );
  }

  async function getNotifications(query?: GetNotificationsData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetNotifications({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch notifications",
    );
  }

  async function getNotificationsUnreadCount() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetNotificationsUnreadCount({
          client,
          cache: "no-store",
        }),
      "Failed to fetch notification unread count",
    );
  }

  async function patchNotificationRead(
    path: PatchNotificationsByIdReadData["path"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchNotificationsByIdRead({
          client,
          path,
          cache: "no-store",
        }),
      "Failed to mark notification as read",
    );
  }

  async function patchNotificationsReadAll() {
    return executeOperation(
      getClient,
      (client) =>
        corePatchNotificationsReadAll({
          client,
          cache: "no-store",
        }),
      "Failed to mark all notifications as read",
    );
  }

  async function getTaskById(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetTasksById({
          client,
          path: { id },
          cache: "no-store",
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to fetch task",
    );
  }

  async function getTaskWorkspace(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetTasksByIdWorkspace({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to resolve task workspace",
    );
  }

  async function getJobs(query?: GetJobsData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetJobs({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch jobs",
    );
  }

  async function listAdminInvoices(query: {
    status?:
      | "unfinished"
      | "all"
      | "draft"
      | "open"
      | "paid"
      | "uncollectible"
      | "void";
    recipientType?: "user" | "organization";
    recipientId?: string;
    limit?: number;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminInvoices({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list admin invoices",
    );
  }

  async function createAdminInvoice(body: {
    targetType: "user" | "organization";
    targetId: string;
    credits: number;
    ttlDays: number | null;
    priceId: string | null;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreCreateAdminInvoice({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to create admin invoice",
    );
  }

  async function createAdminFreeCreditGrant(body: {
    targetType: "user" | "organization";
    targetId: string;
    credits: number;
    ttlDays: number | null;
    referenceNote: string | null;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreCreateAdminFreeCreditGrant({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to grant free credits",
    );
  }

  async function getAdminInvoice(invoiceId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAdminInvoice({
          client,
          path: { id: invoiceId },
          cache: "no-store",
        }),
      "Failed to fetch admin invoice",
    );
  }

  async function markAdminInvoicePaid(invoiceId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreMarkAdminInvoicePaid({
          client,
          path: { id: invoiceId },
          cache: "no-store",
        }),
      "Failed to mark admin invoice paid",
    );
  }

  async function deleteAdminInvoice(invoiceId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteAdminInvoice({
          client,
          path: { id: invoiceId },
          cache: "no-store",
        }),
      "Failed to delete admin invoice",
    );
  }

  async function listCreditPrices() {
    return executeOperation(
      getClient,
      (client) =>
        coreListCreditPrices({
          client,
          cache: "no-store",
        }),
      "Failed to list credit prices",
    );
  }

  async function getCreditTopUpPriceCatalog() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetCreditTopUpPriceCatalog({
          client,
          cache: "no-store",
        }),
      "Failed to fetch credit top-up price catalog",
    );
  }

  async function getSubscriptionCatalog() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetSubscriptionCatalog({
          client,
          cache: "no-store",
        }),
      "Failed to fetch subscription catalog",
    );
  }

  async function createCreditCheckoutSession(body: {
    organizationId?: string | null;
    credits: number;
    returnPath?: string;
    promotionCodeId?: string;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreCreateCreditCheckoutSession({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to create credit checkout session",
    );
  }

  async function getCheckoutSessionAnalytics(sessionId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetCheckoutSessionAnalytics({
          client,
          path: { sessionId },
          cache: "no-store",
        }),
      "Failed to fetch checkout session analytics",
    );
  }

  async function getCouponDetails(couponId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetCouponDetails({
          client,
          path: { couponId },
          cache: "no-store",
        }),
      "Failed to fetch coupon details",
    );
  }

  async function claimCoupon(
    couponId: string,
    body: { organizationId?: string | null } = {},
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreClaimCoupon({
          client,
          path: { couponId },
          body,
          cache: "no-store",
        }),
      "Failed to claim coupon",
    );
  }

  async function listAdminUsers(query: {
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminUsers({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list users",
    );
  }

  async function listAdminAgents(query: {
    q?: string;
    cursor?: string;
    limit?: number;
    status?: AgentStatus;
    sortBy?:
      | "displayName"
      | "registryName"
      | "hasOverride"
      | "status"
      | "createdAt";
    sortOrder?: "asc" | "desc";
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminAgents({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list agents",
    );
  }

  async function getAdminAgent(agentId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAdminAgent({
          client,
          path: { id: agentId },
          cache: "no-store",
        }),
      "Failed to fetch admin agent",
    );
  }

  async function patchAdminAgentMetadataOverride(
    agentId: string,
    body: Parameters<typeof corePatchAdminAgentMetadataOverride>[0]["body"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchAdminAgentMetadataOverride({
          client,
          path: { id: agentId },
          body,
          cache: "no-store",
        }),
      "Failed to update agent metadata override",
    );
  }

  async function deleteAdminAgentMetadataOverride(agentId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteAdminAgentMetadataOverride({
          client,
          path: { id: agentId },
          cache: "no-store",
        }),
      "Failed to delete agent metadata override",
    );
  }

  async function listAdminTasks(query: {
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminTasks({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list tasks",
    );
  }

  async function getAdminTask(taskId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAdminTask({
          client,
          path: { id: taskId },
          cache: "no-store",
        }),
      "Failed to fetch admin task",
    );
  }

  async function listDeveloperOwnedCoworkerTasks(query: {
    coworkerId?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreListDeveloperOwnedCoworkerTasks({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list developer tasks",
    );
  }

  async function getDeveloperOwnedCoworkerTask(taskId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetDeveloperOwnedCoworkerTask({
          client,
          path: { id: taskId },
          cache: "no-store",
        }),
      "Failed to fetch developer task",
    );
  }

  async function searchAdminUsers(query: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreSearchAdminUsers({
          client,
          query: { query },
          cache: "no-store",
        }),
      "Failed to search users",
    );
  }

  async function searchAdminOrganizations(query: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreSearchAdminOrganizations({
          client,
          query: { query },
          cache: "no-store",
        }),
      "Failed to search organizations",
    );
  }

  async function getAdminOrganizationBySlug(slug: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAdminOrganizationBySlug({
          client,
          path: { slug },
          cache: "no-store",
        }),
      "Failed to fetch organization overview",
    );
  }

  async function listAdminOrganizations(query: {
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminOrganizations({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list organizations",
    );
  }

  async function listAdminOrganizationMembers(
    slug: string,
    query: { cursor?: string; limit?: number },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminOrganizationMembers({
          client,
          path: { slug },
          query,
          cache: "no-store",
        }),
      "Failed to list organization members",
    );
  }

  async function addAdminOrganizationMember(
    slug: string,
    body: { userId: string; role: "owner" | "admin" | "member" },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreAddAdminOrganizationMember({
          client,
          path: { slug },
          body,
          cache: "no-store",
        }),
      "Failed to add organization member",
    );
  }

  async function removeAdminOrganizationMember(slug: string, memberId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreRemoveAdminOrganizationMember({
          client,
          path: { slug, memberId },
          cache: "no-store",
        }),
      "Failed to remove organization member",
    );
  }

  async function updateAdminOrganizationMemberRole(
    slug: string,
    memberId: string,
    body: { role: "owner" | "admin" | "member" },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreUpdateAdminOrganizationMemberRole({
          client,
          path: { slug, memberId },
          body,
          cache: "no-store",
        }),
      "Failed to update organization member role",
    );
  }

  async function assignAdminOrganizationMemberSeat(
    slug: string,
    memberId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreAssignAdminOrganizationMemberSeat({
          client,
          path: { slug, memberId },
          cache: "no-store",
        }),
      "Failed to assign organization seat",
    );
  }

  async function unassignAdminOrganizationMemberSeat(
    slug: string,
    memberId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreUnassignAdminOrganizationMemberSeat({
          client,
          path: { slug, memberId },
          cache: "no-store",
        }),
      "Failed to unassign organization seat",
    );
  }

  async function getOrganizationEnterpriseContractSummary(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationEnterpriseContractSummary({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch enterprise contract summary",
    );
  }

  async function getJobById(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetJobsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch job",
    );
  }

  async function getProjects(query?: GetProjectsData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetProjects({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch projects",
    );
  }

  async function getProjectsStats(query?: GetProjectsStatsData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetProjectsStats({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch project stats",
    );
  }

  async function postProjects(body: NonNullable<PostProjectsData["body"]>) {
    return executeOperation(
      getClient,
      (client) =>
        corePostProjects({
          client,
          body,
        }),
      "Failed to create project",
    );
  }

  async function getOrganizationMembers(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdMembers({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization members",
    );
  }

  async function getOrganizationPendingInvitations(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdInvitations({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization invitations",
    );
  }

  async function getOrganizationInviteLinks(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdInviteLinks({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization invite links",
    );
  }

  async function getOrganizationVendorGrants(
    organizationId: string,
    query?: {
      status?: "PENDING" | "GRANTED" | "DENIED" | "REVOKED";
      vendorId?: string;
    },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdVendorGrants({
          client,
          path: { id: organizationId },
          query,
          cache: "no-store",
        }),
      "Failed to fetch vendor grants",
    );
  }

  async function createOrganizationVendorGrant(
    organizationId: string,
    body: {
      vendorId: string;
    },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdVendorGrants({
          client,
          path: { id: organizationId },
          body,
        }),
      "Failed to create vendor grant",
    );
  }

  async function approveOrganizationVendorGrant(
    organizationId: string,
    grantId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdVendorGrantsByGrantIdApprove({
          client,
          path: { id: organizationId, grantId },
        }),
      "Failed to approve vendor grant",
    );
  }

  async function denyOrganizationVendorGrant(
    organizationId: string,
    grantId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdVendorGrantsByGrantIdDeny({
          client,
          path: { id: organizationId, grantId },
        }),
      "Failed to deny vendor grant",
    );
  }

  async function revokeOrganizationVendorGrant(
    organizationId: string,
    grantId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdVendorGrantsByGrantIdRevoke({
          client,
          path: { id: organizationId, grantId },
        }),
      "Failed to revoke vendor grant",
    );
  }

  async function getMyVendorGrants(query?: {
    status?: "PENDING" | "GRANTED" | "DENIED" | "REVOKED";
    vendorId?: string;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdVendorGrants({
          client,
          path: { id: "me" },
          query,
          cache: "no-store",
        }),
      "Failed to fetch personal vendor grants",
    );
  }

  async function createMyVendorGrant(body: { vendorId: string }) {
    return executeOperation(
      getClient,
      (client) =>
        corePostUsersByIdVendorGrants({
          client,
          path: { id: "me" },
          body,
        }),
      "Failed to create personal vendor grant",
    );
  }

  async function approveMyVendorGrant(grantId: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostUsersByIdVendorGrantsByGrantIdApprove({
          client,
          path: { id: "me", grantId },
        }),
      "Failed to approve personal vendor grant",
    );
  }

  async function denyMyVendorGrant(grantId: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostUsersByIdVendorGrantsByGrantIdDeny({
          client,
          path: { id: "me", grantId },
        }),
      "Failed to deny personal vendor grant",
    );
  }

  async function revokeMyVendorGrant(grantId: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostUsersByIdVendorGrantsByGrantIdRevoke({
          client,
          path: { id: "me", grantId },
        }),
      "Failed to revoke personal vendor grant",
    );
  }

  /**
   * Seat usage summary for an organization the caller is a member of:
   * assigned and purchased seat counts alongside the resolved paid plan.
   */
  async function getOrganizationSeatSummary(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdSeatSummary({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization seat summary",
    );
  }

  /**
   * Assigns a seat to an organization member. Core enforces that the caller
   * is an organization owner or admin and runs the assignment, capacity
   * check, and resulting credit grants (with per-seat amounts resolved from
   * the Stripe subscription catalog) in a single transaction.
   */
  async function assignOrganizationSeat(
    organizationId: string,
    memberId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePutOrganizationsByIdMembersByMemberIdSeat({
          client,
          path: { id: organizationId, memberId },
        }),
      "Failed to assign organization seat",
    );
  }

  /**
   * Unassigns an organization member's seat. Core enforces that the caller is
   * an organization owner or admin and runs the unassignment and resulting
   * credit grants in a single transaction.
   */
  async function unassignOrganizationSeat(
    organizationId: string,
    memberId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteOrganizationsByIdMembersByMemberIdSeat({
          client,
          path: { id: organizationId, memberId },
        }),
      "Failed to unassign organization seat",
    );
  }

  /**
   * Immediately updates the purchased seat count on an organization's active
   * subscription. Core enforces that the caller is an organization owner or
   * admin, blocks self-serve changes while an enterprise contract is active,
   * and keeps seats at or above the assigned member count. Stripe-backed
   * subscriptions are invoiced for the change right away.
   */
  async function updateOrganizationSubscriptionSeats(
    organizationId: string,
    seats: number,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePutOrganizationsByIdSubscriptionSeats({
          client,
          path: { id: organizationId },
          body: { seats },
        }),
      "Failed to update organization subscription seats",
    );
  }

  async function getInvitationById(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetInvitationsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch invitation",
    );
  }

  async function getOrganizationStripeCustomer(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdStripeCustomer({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization Stripe customer",
    );
  }

  /**
   * Ensures a Stripe customer exists for an organization (any-member):
   * returns the existing customer id or creates the Stripe customer and
   * returns the new id. Local persistence happens via the Stripe
   * `customer.created` webhook.
   */
  async function createOrganizationStripeCustomer(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdStripeCustomer({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to create organization Stripe customer",
    );
  }

  async function getOrganizationBillingDetails(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdBillingDetails({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization billing details",
    );
  }

  async function getOrganizationBillingPlan(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdBillingPlan({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization billing plan",
    );
  }

  async function getOrganizationActiveSubscription(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationsByIdSubscription({
          client,
          path: { id: organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization subscription",
    );
  }

  async function getMyActiveSubscription() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdSubscription({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user subscription",
    );
  }

  async function getMyOrganizationCredits(organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdOrganizationsByOrganizationIdCredits({
          client,
          path: { id: CURRENT_USER_PATH_ID, organizationId },
          cache: "no-store",
        }),
      "Failed to fetch organization credits",
    );
  }

  async function getMyStripeCustomer() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdStripeCustomer({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user Stripe customer",
    );
  }

  /**
   * Ensures a Stripe customer exists for the current user: returns the
   * existing customer id or creates the Stripe customer and returns the new
   * id. Local persistence happens via the Stripe `customer.created` webhook.
   */
  async function createMyStripeCustomer() {
    return executeOperation(
      getClient,
      (client) =>
        corePostUsersByIdStripeCustomer({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to create user Stripe customer",
    );
  }

  async function getMyBillingDetails() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdBillingDetails({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user billing details",
    );
  }

  async function getUserBillingDetails(userId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdBillingDetails({
          client,
          path: { id: userId },
          cache: "no-store",
        }),
      "Failed to fetch user billing details",
    );
  }

  /**
   * Revokes the current user's OAuth consent: Core deletes the consent,
   * revokes the client's refresh tokens, and deletes its access tokens in a
   * single transaction.
   */
  async function revokeMyOauthConsent(consentId: string, clientId: string) {
    await executeOperation(
      getClient,
      (client) =>
        coreDeleteUsersByIdOauthConsentsByConsentId({
          client,
          path: { id: CURRENT_USER_PATH_ID, consentId },
          query: { clientId },
        }),
      "Failed to revoke OAuth client access",
    );
  }

  async function getProjectsById(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetProjectsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch project",
    );
  }

  async function patchProjectsById(
    id: string,
    body: NonNullable<PatchProjectsByIdData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchProjectsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update project",
    );
  }

  async function deleteProjectsById(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteProjectsById({
          client,
          path: { id },
        }),
      "Failed to delete project",
    );
  }

  async function postProjectsByIdJobs(
    id: string,
    body: NonNullable<PostProjectsByIdJobsData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostProjectsByIdJobs({
          client,
          path: { id },
          body,
        }),
      "Failed to add job to project",
    );
  }

  async function deleteProjectsByIdJobsByJobId(
    path: DeleteProjectsByIdJobsByJobIdData["path"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdJobsByJobId({
          client,
          path,
        }),
      "Failed to remove job from project",
    );
  }

  async function postProjectsByIdTasks(
    id: string,
    body: NonNullable<PostProjectsByIdTasksData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostProjectsByIdTasks({
          client,
          path: { id },
          body,
        }),
      "Failed to add task to project",
    );
  }

  async function deleteProjectsByIdTasksByTaskId(
    path: DeleteProjectsByIdTasksByTaskIdData["path"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteProjectsByIdTasksByTaskId({
          client,
          path,
        }),
      "Failed to remove task from project",
    );
  }

  async function patchJob(
    id: string,
    body: NonNullable<PatchJobsByIdData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchJobsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update job",
    );
  }

  async function requestJobRefund(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostJobsByIdRefund({
          client,
          path: { id },
        }),
      "Failed to request job refund",
    );
  }

  async function getAgentById(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAgentsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch agent",
    );
  }

  async function getAgents(
    query?: GetAgentsData["query"],
    cacheOptions?: { revalidate: number; tags?: string[] },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAgents({
          client,
          query,
          // The agent catalog (GET /v1/agents) is global — it carries no
          // per-user fields and is not user/workspace-scoped — so callers may
          // opt into cross-request revalidation caching. Next keys the fetch
          // cache by URL (not auth headers), so the cached payload is safely
          // shared across users. Without `cacheOptions` this stays `no-store`,
          // which every other (user-scoped) Core call must keep.
          ...(cacheOptions
            ? { next: cacheOptions }
            : { cache: "no-store" as const }),
        }),
      "Failed to fetch agents",
    );
  }

  async function getAgentJobs(
    id: string,
    query?: GetAgentsByIdJobsData["query"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdJobs({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch agent jobs",
    );
  }

  async function getAgentReviews(
    id: string,
    query?: GetAgentsByIdReviewsData["query"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdReviews({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch agent reviews",
    );
  }

  async function getMyAgentReview(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdReviewsMe({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch your agent review",
    );
  }

  async function getAgentRatingEligibility(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdRatingsEligibility({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch agent rating eligibility",
    );
  }

  async function createAgentRating(
    id: string,
    body: NonNullable<PostAgentsByIdRatingsData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostAgentsByIdRatings({
          client,
          path: { id },
          body,
        }),
      "Failed to submit agent rating",
    );
  }

  async function createAgentJob(
    id: string,
    body: NonNullable<PostAgentsByIdJobsData["body"]>,
  ) {
    return executeOperation(
      getClient,
      async (client) => {
        const result = await corePostAgentsByIdJobs({
          client,
          path: { id },
          body,
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as PostAgentsByIdJobsError,
            response: result.response,
          };
        }

        return result;
      },
      "Failed to create agent job",
    );
  }

  async function getAgentInputSchema(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetAgentsByIdInputSchema({
          client,
          path: { id },
        }),
      "Failed to fetch agent input schema",
    );
  }

  async function getCategories(query?: GetCategoriesData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetCategories({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch categories",
    );
  }

  async function listVendors() {
    return executeOperation(
      getClient,
      (client) =>
        coreListVendors({
          client,
          cache: "no-store",
        }),
      "Failed to fetch vendors",
    );
  }

  async function listAdminVendors() {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminVendors({
          client,
          cache: "no-store",
        }),
      "Failed to fetch admin vendors",
    );
  }

  async function createAdminVendor(
    body: NonNullable<CreateAdminVendorData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreCreateAdminVendor({
          client,
          body,
          cache: "no-store",
        }),
      "Failed to create vendor",
    );
  }

  async function patchAdminVendor(
    id: string,
    body: NonNullable<PatchAdminVendorData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchAdminVendor({
          client,
          path: { id },
          body,
          cache: "no-store",
        }),
      "Failed to update vendor",
    );
  }

  async function listMyVendorMemberships() {
    return executeOperation(
      getClient,
      (client) =>
        coreListMyVendorMemberships({
          client,
          cache: "no-store",
        }),
      "Failed to fetch vendor memberships",
    );
  }

  async function patchVendor(
    id: string,
    body: NonNullable<PatchVendorData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchVendor({
          client,
          path: { id },
          body,
          cache: "no-store",
        }),
      "Failed to update vendor",
    );
  }

  async function listVendorMembers(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreListVendorMembers({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch vendor members",
    );
  }

  async function listCoworkerAssignments(vendorId: string, coworkerId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreListCoworkerAssignments({
          client,
          path: { id: vendorId, coworkerId },
          cache: "no-store",
        }),
      "Failed to fetch coworker assignments",
    );
  }

  async function assignCoworkerDeveloper(
    vendorId: string,
    coworkerId: string,
    userId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreAssignCoworkerDeveloper({
          client,
          path: { id: vendorId, coworkerId },
          body: { userId },
          cache: "no-store",
        }),
      "Failed to assign developer to coworker",
    );
  }

  async function unassignCoworkerDeveloper(
    vendorId: string,
    coworkerId: string,
    userId: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreUnassignCoworkerDeveloper({
          client,
          path: { id: vendorId, coworkerId, userId },
          cache: "no-store",
        }),
      "Failed to unassign developer from coworker",
    );
  }

  async function createTask(body: NonNullable<PostTasksData["body"]>) {
    return executeOperation(
      getClient,
      (client) =>
        corePostTasks({
          client,
          body,
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to create task",
    );
  }

  async function createTaskEvent(
    id: string,
    body: {
      status?:
        | "DRAFT"
        | "QUEUED"
        | "READY"
        | "GRANT_PENDING"
        | "INPUT_REQUIRED"
        | "APPROVAL_REQUIRED"
        | "AUTHENTICATION_REQUIRED"
        | "OUT_OF_CREDITS"
        | "CREDITS_TOPPED_UP"
        | "RUNNING"
        | "AWAITING_EXTERNAL"
        | "COMPLETED"
        | "FAILED"
        | "CANCELED";
      comment?: string;
    },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostTasksByIdEvents({
          client,
          path: { id },
          body,
        }),
      "Failed to create task event",
    );
  }

  async function patchTask(
    id: string,
    body: NonNullable<PatchTasksByIdData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchTasksById({
          client,
          path: { id },
          body,
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to update task",
    );
  }

  async function getTaskLinks(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetTasksByIdLinks({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch task links",
    );
  }

  async function createTaskLink(
    id: string,
    body: NonNullable<PostTasksByIdLinksData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostTasksByIdLinks({
          client,
          path: { id },
          body,
        }),
      "Failed to create task link",
    );
  }

  async function deleteTaskLink(id: string, linkId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteTasksByIdLinksByLinkId({
          client,
          path: { id, linkId },
        }),
      "Failed to delete task link",
    );
  }

  async function deleteTask(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteTasksById({
          client,
          path: { id },
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to delete task",
    );
  }

  async function putTaskSchedule(id: string, body: PutTaskScheduleRequest) {
    return executeOperation(
      getClient,
      (client) =>
        corePutTasksByIdSchedule({
          client,
          path: { id },
          body,
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to save task schedule",
    );
  }

  async function deleteTaskSchedule(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteTasksByIdSchedule({
          client,
          path: { id },
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to clear task schedule",
    );
  }

  async function getCoworkers(query?: GetCoworkersData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetCoworkers({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch coworkers",
    );
  }

  async function getOwnedCoworkers() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetCoworkers({
          client,
          query: { scope: "owned" },
          cache: "no-store",
        }),
      "Failed to fetch owned coworkers",
    );
  }

  async function getCoworkerById(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetCoworkersById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch coworker",
    );
  }

  async function patchCoworker(
    id: string,
    body: NonNullable<PatchCoworkersByIdData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchCoworkersById({
          client,
          path: { id },
          body,
        }),
      "Failed to update coworker",
    );
  }

  async function uploadCoworkerImage(id: string, file: Blob | File) {
    return executeOperation(
      getClient,
      (client) =>
        corePostCoworkersByIdImage({
          client,
          path: { id },
          body: { file },
          cache: "no-store",
        }),
      "Failed to upload coworker image",
    );
  }

  async function deleteCoworkerImage(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteCoworkersByIdImage({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to remove coworker image",
    );
  }

  async function patchCoworkerWhitelist(
    id: string,
    body: NonNullable<PatchCoworkersByIdWhitelistData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchCoworkersByIdWhitelist({
          client,
          path: { id },
          body,
        }),
      "Failed to update coworker whitelist",
    );
  }

  async function archiveCoworker(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteCoworkersById({
          client,
          path: { id },
        }),
      "Failed to archive coworker",
    );
  }

  async function unarchiveCoworker(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostCoworkersByIdUnarchive({
          client,
          path: { id },
        }),
      "Failed to unarchive coworker",
    );
  }

  async function getPendingNotices(kind?: NoticeKind): Promise<Notice[]> {
    const response = await executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdNoticesPending({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch pending notices",
    );

    const pendingNotices = response.data.pendingNotices;
    return kind
      ? pendingNotices.filter((notice) => notice.kind === kind)
      : pendingNotices;
  }

  async function acknowledgeNotice(id: string) {
    const response = await executeOperation(
      getClient,
      (client) =>
        corePostUsersByIdNoticesByNoticeIdAcknowledge({
          client,
          path: { id: CURRENT_USER_PATH_ID, noticeId: id },
        }),
      "Failed to acknowledge notice",
    );

    return response.data;
  }

  async function getMyCredits() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdCredits({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user credits",
    );
  }

  async function getMyOrganizations() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdOrganizations({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user organizations",
    );
  }

  async function getMyMembersWithOrganizations() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersByIdMembers({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          cache: "no-store",
        }),
      "Failed to fetch user memberships",
    );
  }

  /**
   * Returns the current user's membership in `organizationId`, or `null` when
   * the user is not a member (Core responds 404 in that case).
   */
  async function getMyMemberInOrganization(organizationId: string) {
    try {
      return await executeOperation(
        getClient,
        (client) =>
          coreGetUsersByIdOrganizationsByOrganizationIdMember({
            client,
            path: { id: CURRENT_USER_PATH_ID, organizationId },
            cache: "no-store",
          }),
        "Failed to fetch organization membership",
      );
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Resolves the DESIGN.md in effect for the caller's current workspace. Core
   * derives the active workspace from the session (the active organization, or
   * the personal workspace when none).
   */
  async function getWorkspaceDesignMd() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetWorkspacesDesignMd({
          client,
          cache: "no-store",
        }),
      "Failed to resolve workspace DESIGN.md",
    );
  }

  async function getWorkspaceOrganizationId(workspaceId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetWorkspacesById({
          client,
          path: { id: workspaceId },
          cache: "no-store",
        }),
      "Failed to resolve workspace organization",
    );
  }

  /**
   * Sets (or clears, when `content` is null) the current user's own DESIGN.md.
   */
  async function setMyDesignMd(
    body: NonNullable<PutUsersByIdDesignMdData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePutUsersByIdDesignMd({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body,
        }),
      "Failed to save DESIGN.md",
    );
  }

  /**
   * Sets the current user's preferred organization workspace (null for the
   * personal workspace). Core verifies membership and persists the write in
   * one transaction; a 403 with kind `organization_membership_required` means
   * the user is not a member of the organization.
   */
  async function setMyPreferredOrganization(organizationId: string | null) {
    return executeOperation(
      getClient,
      (client) =>
        corePutUsersByIdPreferredOrganization({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body: { organizationId },
          cache: "no-store",
        }),
      "Failed to set preferred organization",
    );
  }

  /**
   * Sets (or clears, when `content` is null) an organization's DESIGN.md. Core
   * enforces that the caller is an organization owner or admin.
   */
  async function setOrganizationDesignMd(
    organizationId: string,
    body: NonNullable<PutOrganizationsByIdDesignMdData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePutOrganizationsByIdDesignMd({
          client,
          path: { id: organizationId },
          body,
        }),
      "Failed to save organization DESIGN.md",
    );
  }

  /**
   * Creates a shareable, email-agnostic invite link for an organization. Core
   * enforces that the caller is an owner or admin. Returns the link with its
   * absolute `/join/{token}` URL.
   */
  async function createOrganizationInviteLink(
    organizationId: string,
    body: NonNullable<PostOrganizationsByIdInviteLinksData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdInviteLinks({
          client,
          path: { id: organizationId },
          body,
        }),
      "Failed to create invite link",
    );
  }

  /**
   * Revokes an organization invite link by token. Owner/admin only; the token
   * is scoped to the organization in the path so a token cannot be revoked
   * from another organization.
   */
  async function revokeOrganizationInviteLink(
    organizationId: string,
    token: string,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteOrganizationsByIdInviteLinksByToken({
          client,
          path: { id: organizationId, token },
        }),
      "Failed to revoke invite link",
    );
  }

  /**
   * Resolves a shareable invite-link token for the public `/join` preview.
   * Returns the link status and, only for a live (`valid`) link, a small
   * organization preview (name, slug, logo).
   */
  async function resolveOrganizationInviteLink(token: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetOrganizationInviteLinksByToken({
          client,
          path: { token },
          cache: "no-store",
        }),
      "Failed to resolve invite link",
    );
  }

  /**
   * Accepts a shareable invite-link token for the signed-in user, joining the
   * organization as a member (subject to the org's billing seat gate). Core
   * treats a concurrent/duplicate join as `already_member`.
   */
  async function acceptOrganizationInviteLink(token: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationInviteLinksByTokenAccept({
          client,
          path: { token },
        }),
      "Failed to accept invite link",
    );
  }

  /**
   * Resolves the highest-quality icon for a website URL and uploads it as an
   * organization-logo blob, returning its public URL (or null when no usable
   * icon was found). Core performs the SSRF-guarded fetch server-side.
   */
  async function resolveSiteIcon(url: string, organizationId: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetToolsSiteIcon({
          client,
          query: { url, organizationId },
          cache: "no-store",
        }),
      "Failed to resolve site icon",
    );
  }

  /**
   * Fetches an organization by id, returning null when it does not exist
   * (Core responds 404).
   */
  async function getOrganizationById(organizationId: string) {
    try {
      return await executeOperation(
        getClient,
        (client) =>
          coreGetOrganizationsById({
            client,
            path: { id: organizationId },
            cache: "no-store",
          }),
        "Failed to fetch organization",
      );
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetches the raw organization record by slug for the current member,
   * returning null when no organization matches the slug (Core responds 404).
   * A 403 (the caller is not a member) propagates as CoreApiRequestError.
   */
  async function getOrganizationBySlug(slug: string) {
    try {
      return await executeOperation(
        getClient,
        (client) =>
          coreGetOrganizationBySlug({
            client,
            path: { slug },
            cache: "no-store",
          }),
        "Failed to fetch organization",
      );
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async function getHermesInstance() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetHermesMeInstance({
          client,
          cache: "no-store",
        }),
      "Failed to fetch assistant instance",
    );
  }

  async function provisionHermesInstance() {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeInstance({
          client,
        }),
      "Failed to provision assistant instance",
    );
  }

  async function updateHermesInstance(body: HermesUpdateInstanceRequest) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchHermesMeInstance({
          client,
          body,
        }),
      "Failed to update assistant instance",
    );
  }

  async function destroyHermesInstance() {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteHermesMeInstance({
          client,
        }),
      "Failed to destroy assistant instance",
    );
  }

  async function getHermesMessages(query?: GetHermesMeMessagesData["query"]) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetHermesMeMessages({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to fetch assistant messages",
    );
  }

  async function getHermesUnreadCount() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetHermesMeUnreadCount({
          client,
          cache: "no-store",
        }),
      "Failed to fetch assistant unread count",
    );
  }

  async function markHermesInboxSeen(body?: MarkHermesInboxSeenRequest) {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeInboxSeen({
          client,
          body,
        }),
      "Failed to mark assistant inbox as seen",
    );
  }

  async function setHermesSecret(body: SetHermesSecretRequest) {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeSecrets({
          client,
          body,
        }),
      "Failed to write assistant secret",
    );
  }

  async function startHermesOnboarding(body: HermesStartOnboardingRequest) {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeInstanceOnboard({
          client,
          body,
        }),
      "Failed to start assistant onboarding",
    );
  }

  async function getHermesOnboardingProgress() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetHermesMeInstanceOnboardingProgress({
          client,
          cache: "no-store",
        }),
      "Failed to fetch assistant onboarding progress",
    );
  }

  async function listHermesIntegrations() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetHermesMeInstanceIntegrations({
          client,
          cache: "no-store",
        }),
      "Failed to list assistant integrations",
    );
  }

  async function listHermesSchedules() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetHermesMeInstanceSchedules({
          client,
          cache: "no-store",
        }),
      "Failed to list assistant schedules",
    );
  }

  async function patchHermesSchedule(
    scheduleId: string,
    body: HermesPatchScheduleRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchHermesMeInstanceSchedulesByScheduleId({
          client,
          path: { scheduleId },
          body,
        }),
      "Failed to update assistant schedule",
    );
  }

  async function approveHermesConfirmation(
    confirmationId: string,
    body?: HermesApproveConfirmationRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeInstanceConfirmationsByConfirmationIdApprove({
          client,
          path: { confirmationId },
          body,
        }),
      "Failed to approve assistant confirmation",
    );
  }

  async function rejectHermesConfirmation(
    confirmationId: string,
    body: HermesRejectConfirmationRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeInstanceConfirmationsByConfirmationIdReject({
          client,
          path: { confirmationId },
          body,
        }),
      "Failed to reject assistant confirmation",
    );
  }

  async function disconnectHermesIntegration(
    path: DeleteHermesMeInstanceIntegrationsByProviderData["path"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteHermesMeInstanceIntegrationsByProvider({
          client,
          path,
        }),
      "Failed to disconnect assistant integration",
    );
  }

  async function initiateHermesIntegration(
    body: HermesInitiateIntegrationRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeInstanceIntegrationsInitiate({
          client,
          body,
        }),
      "Failed to start integration OAuth",
    );
  }

  async function getSkillsCatalog(query: {
    view?: "trending" | "hot" | "all-time";
    page?: number;
    perPage?: number;
  }) {
    return executeOperation(
      getClient,
      (client) => coreGetHermesMeInstanceSkillsCatalog({ client, query }),
      "Failed to load skills catalog",
    );
  }

  async function searchSkillsCatalog(query: { q: string; limit?: number }) {
    return executeOperation(
      getClient,
      (client) => coreGetHermesMeInstanceSkillsCatalogSearch({ client, query }),
      "Failed to search skills",
    );
  }

  async function getCuratedSkills() {
    return executeOperation(
      getClient,
      (client) => coreGetHermesMeInstanceSkillsCatalogCurated({ client }),
      "Failed to load curated skills",
    );
  }

  async function getSkillDetail(query: { source: string; slug: string }) {
    return executeOperation(
      getClient,
      (client) => coreGetHermesMeInstanceSkillsCatalogDetail({ client, query }),
      "Failed to load skill",
    );
  }

  async function getInstalledSkills() {
    return executeOperation(
      getClient,
      (client) => coreGetHermesMeInstanceSkills({ client }),
      "Failed to list installed skills",
    );
  }

  async function getPreinstalledSkills() {
    return executeOperation(
      getClient,
      (client) => coreGetHermesMeInstanceSkillsPreinstalled({ client }),
      "Failed to list pre-installed skills",
    );
  }

  async function installSkill(body: { source: string; slug: string }) {
    return executeOperation(
      getClient,
      (client) => corePostHermesMeInstanceSkills({ client, body }),
      "Failed to install skill",
    );
  }

  async function removeSkill(slug: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteHermesMeInstanceSkillsBySlug({ client, path: { slug } }),
      "Failed to remove skill",
    );
  }

  async function finalizeHermesIntegration(
    body: HermesFinalizeIntegrationRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeInstanceIntegrationsFinalize({
          client,
          body,
        }),
      "Failed to finalize integration",
    );
  }

  async function createMyFileUploadSession(
    body: NonNullable<PostUsersByIdFilesData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostUsersByIdFiles({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body,
          cache: "no-store",
        }),
      "Failed to create upload session",
    );
  }

  async function createOrganizationLogoUploadSession(
    organizationId: string,
    body: NonNullable<PostOrganizationsByIdFilesData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdFiles({
          client,
          path: { id: organizationId },
          body,
          cache: "no-store",
        }),
      "Failed to create organization logo upload session",
    );
  }

  async function cleanupOrganizationLogo(
    organizationId: string,
    body: NonNullable<PostOrganizationsByIdFilesCleanupData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostOrganizationsByIdFilesCleanup({
          client,
          path: { id: organizationId },
          body,
          cache: "no-store",
        }),
      "Failed to cleanup organization logo",
    );
  }

  async function createVendorLogoUploadSession(
    vendorId: string,
    body: NonNullable<PostVendorsByIdFilesData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostVendorsByIdFiles({
          client,
          path: { id: vendorId },
          body,
          cache: "no-store",
        }),
      "Failed to create vendor logo upload session",
    );
  }

  async function cleanupVendorLogo(
    vendorId: string,
    body: NonNullable<PostVendorsByIdFilesCleanupData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostVendorsByIdFilesCleanup({
          client,
          path: { id: vendorId },
          body,
          cache: "no-store",
        }),
      "Failed to cleanup vendor logo",
    );
  }

  async function createTaskFileUploadSession(
    taskId: string,
    body: NonNullable<PostTasksByIdFilesData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostTasksByIdFiles({
          client,
          path: { id: taskId },
          body,
          cache: "no-store",
        }),
      "Failed to create task file upload session",
    );
  }

  async function createChatRoomFileUploadSession(
    roomId: string,
    body: NonNullable<PostChatsRoomsByIdFilesData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostChatsRoomsByIdFiles({
          client,
          path: { id: roomId },
          body,
          cache: "no-store",
        }),
      "Failed to create chat room file upload session",
    );
  }

  async function moveTaskToWorkspace(
    id: string,
    body: { organizationId: string | null },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePutTasksByIdWorkspace({
          client,
          path: { id },
          body,
          responseTransformer: async (data) =>
            transformTaskResponseEnvelope(data),
        }),
      "Failed to move task to workspace",
    );
  }

  async function moveJobToWorkspace(
    id: string,
    body: { organizationId: string | null },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePutJobsByIdWorkspace({
          client,
          path: { id },
          body,
        }),
      "Failed to move job to workspace",
    );
  }

  async function provideJobInput(
    id: string,
    body: NonNullable<PostJobsByIdInputsData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostJobsByIdInputs({
          client,
          path: { id },
          body,
        }),
      "Failed to provide job input",
    );
  }

  async function putJobShare(
    id: string,
    body: { allowSearchIndexing: boolean },
  ) {
    return executeOperation(
      getClient,
      async (client) => {
        const result = await corePutJobsByIdShare({
          client,
          path: { id },
          body,
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as PutJobsByIdShareError,
            response: result.response,
          };
        }
        return {
          data: result.data.data,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to update job share",
    );
  }

  async function deleteJobShare(id: string) {
    await executeOperation(
      getClient,
      async (client) => {
        const result = await coreDeleteJobsByIdShare({
          client,
          path: { id },
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as DeleteJobsByIdShareError,
            response: result.response,
          };
        }

        return {
          data: true,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to delete job share",
    );
  }

  async function putTaskShare(
    id: string,
    body: { allowSearchIndexing: boolean },
  ) {
    return executeOperation(
      getClient,
      async (client) => {
        const result = await corePutTasksByIdShare({
          client,
          path: { id },
          body,
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as PutTasksByIdShareError,
            response: result.response,
          };
        }
        return {
          data: result.data.data,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to update task share",
    );
  }

  async function deleteTaskShare(id: string) {
    await executeOperation(
      getClient,
      async (client) => {
        const result = await coreDeleteTasksByIdShare({
          client,
          path: { id },
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as DeleteTasksByIdShareError,
            response: result.response,
          };
        }

        return {
          data: true,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to delete task share",
    );
  }

  async function getSharedResourceByToken(token: string) {
    return executeOperation(
      getClient,
      async (client) => {
        const result = await coreGetShareByToken({
          client,
          path: { token },
          cache: "no-store",
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as GetShareByTokenError,
            response: result.response,
          };
        }
        return {
          data: mapCorePublicSharedResourceResponse(result.data.data),
          error: undefined,
          response: result.response,
        };
      },
      "Failed to fetch shared resource",
    );
  }

  async function listEnterpriseContracts(
    query?: GetEnterpriseContractsData["query"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetEnterpriseContracts({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list enterprise contracts",
    );
  }

  async function createEnterpriseContract(
    body: CreateEnterpriseContractRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostEnterpriseContracts({
          client,
          body,
        }),
      "Failed to create enterprise contract",
    );
  }

  async function getEnterpriseContract(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetEnterpriseContractsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch enterprise contract",
    );
  }

  async function patchEnterpriseContract(
    id: string,
    body: PatchEnterpriseContractRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchEnterpriseContractsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update enterprise contract",
    );
  }

  async function previewEnterpriseContractPeriods(
    id: string,
    activatedAt: Date,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetEnterpriseContractsByIdPeriodsPreview({
          client,
          path: { id },
          query: { activatedAt },
          cache: "no-store",
        }),
      "Failed to preview enterprise contract periods",
    );
  }

  async function activateEnterpriseContract(
    id: string,
    body?: ActivateEnterpriseContractRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostEnterpriseContractsByIdActivate({
          client,
          path: { id },
          body,
        }),
      "Failed to activate enterprise contract",
    );
  }

  async function cancelEnterpriseContract(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        corePostEnterpriseContractsByIdCancel({
          client,
          path: { id },
        }),
      "Failed to cancel enterprise contract",
    );
  }

  return {
    activateEnterpriseContract,
    cancelEnterpriseContract,
    createEnterpriseContract,
    getEnterpriseContract,
    listEnterpriseContracts,
    patchEnterpriseContract,
    previewEnterpriseContractPeriods,
    acknowledgeNotice,
    addChatRoomMessage,
    archiveChatRoom,
    restoreChatRoom,
    leaveChatRoom,
    assignOrganizationSeat,
    createChatRoom,
    createAgentJob,
    createChatRoomFileUploadSession,
    cleanupOrganizationLogo,
    cleanupVendorLogo,
    createMyFileUploadSession,
    createOrganizationLogoUploadSession,
    createVendorLogoUploadSession,
    createTask,
    createTaskFileUploadSession,
    createTaskLink,
    createTaskEvent,
    deleteJobShare,
    deleteProjectsById,
    deleteProjectsByIdJobsByJobId,
    deleteProjectsByIdTasksByTaskId,
    deleteTaskShare,
    deleteTaskLink,
    deleteTask,
    deleteTaskSchedule,
    getChatRoom,
    getChatRoomMessages,
    getChatRooms,
    markChatRoomRead,
    toggleChatRoomMessageReaction,
    getHermesInstance,
    getHermesMessages,
    getHermesOnboardingProgress,
    getHermesUnreadCount,
    getHistory,
    getNotifications,
    getNotificationsUnreadCount,
    updateChatRoom,
    updateChatRoomMessage,
    patchNotificationRead,
    patchNotificationsReadAll,
    listHermesIntegrations,
    listHermesSchedules,
    patchHermesSchedule,
    approveHermesConfirmation,
    rejectHermesConfirmation,
    startHermesOnboarding,
    disconnectHermesIntegration,
    initiateHermesIntegration,
    finalizeHermesIntegration,
    getSkillsCatalog,
    searchSkillsCatalog,
    getCuratedSkills,
    getSkillDetail,
    getInstalledSkills,
    getPreinstalledSkills,
    installSkill,
    removeSkill,
    getAgentById,
    getAgentJobs,
    getAgentInputSchema,
    getAgentRatingEligibility,
    getAgentReviews,
    getMyAgentReview,
    getAgents,
    createAgentRating,
    getCategories,
    getCoworkers,
    getOwnedCoworkers,
    getCoworkerById,
    patchCoworker,
    patchCoworkerWhitelist,
    archiveCoworker,
    unarchiveCoworker,
    uploadCoworkerImage,
    deleteCoworkerImage,
    searchAdminUsers,
    listAdminUsers,
    listAdminAgents,
    getAdminAgent,
    patchAdminAgentMetadataOverride,
    deleteAdminAgentMetadataOverride,
    listAdminTasks,
    getAdminTask,
    listDeveloperOwnedCoworkerTasks,
    getDeveloperOwnedCoworkerTask,
    searchAdminOrganizations,
    getAdminOrganizationBySlug,
    listAdminOrganizations,
    listAdminOrganizationMembers,
    addAdminOrganizationMember,
    removeAdminOrganizationMember,
    updateAdminOrganizationMemberRole,
    assignAdminOrganizationMemberSeat,
    unassignAdminOrganizationMemberSeat,
    listAdminInvoices,
    createAdminInvoice,
    createAdminFreeCreditGrant,
    getAdminInvoice,
    markAdminInvoicePaid,
    deleteAdminInvoice,
    listCreditPrices,
    getCreditTopUpPriceCatalog,
    getSubscriptionCatalog,
    createCreditCheckoutSession,
    getCheckoutSessionAnalytics,
    getCouponDetails,
    claimCoupon,
    getOrganizationEnterpriseContractSummary,
    getJobById,
    getJobs,
    getInvitationById,
    getMyActiveSubscription,
    getMyCredits,
    getMyMemberInOrganization,
    getMyMembersWithOrganizations,
    getMyOrganizationCredits,
    getMyOrganizations,
    createMyStripeCustomer,
    createOrganizationStripeCustomer,
    getMyBillingDetails,
    getUserBillingDetails,
    getMyStripeCustomer,
    getOrganizationActiveSubscription,
    getOrganizationBillingDetails,
    getOrganizationBillingPlan,
    getOrganizationById,
    getOrganizationBySlug,
    getOrganizationMembers,
    getOrganizationPendingInvitations,
    getOrganizationInviteLinks,
    getOrganizationVendorGrants,
    createOrganizationVendorGrant,
    approveOrganizationVendorGrant,
    denyOrganizationVendorGrant,
    revokeOrganizationVendorGrant,
    getMyVendorGrants,
    createMyVendorGrant,
    approveMyVendorGrant,
    denyMyVendorGrant,
    revokeMyVendorGrant,
    listVendors,
    listAdminVendors,
    createAdminVendor,
    patchAdminVendor,
    listMyVendorMemberships,
    patchVendor,
    listVendorMembers,
    listCoworkerAssignments,
    assignCoworkerDeveloper,
    unassignCoworkerDeveloper,
    getOrganizationSeatSummary,
    getOrganizationStripeCustomer,
    getWorkspaceDesignMd,
    getWorkspaceOrganizationId,
    setMyDesignMd,
    setMyPreferredOrganization,
    setOrganizationDesignMd,
    createOrganizationInviteLink,
    revokeOrganizationInviteLink,
    resolveOrganizationInviteLink,
    acceptOrganizationInviteLink,
    resolveSiteIcon,
    getPendingNotices,
    getProjects,
    getProjectsById,
    getProjectsStats,
    getSharedResourceByToken,
    destroyHermesInstance,
    markHermesInboxSeen,
    moveJobToWorkspace,
    moveTaskToWorkspace,
    patchJob,
    provideJobInput,
    patchProjectsById,
    postProjects,
    postProjectsByIdJobs,
    postProjectsByIdTasks,
    provisionHermesInstance,
    requestJobRefund,
    revokeMyOauthConsent,
    setHermesSecret,
    getTaskById,
    getTaskLinks,
    getTaskWorkspace,
    getTasks,
    patchTask,
    putJobShare,
    putTaskSchedule,
    putTaskShare,
    unassignOrganizationSeat,
    updateHermesInstance,
    updateOrganizationSubscriptionSeats,
  };
}

export type CoreClient = ReturnType<typeof createCoreClient>;
