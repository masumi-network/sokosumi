import type { Notice, NoticeKind } from "@sokosumi/database";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { mapCorePublicSharedResourceResponse } from "@/lib/clients/core.job-share";
import type {
  ActivateEnterpriseContractRequest,
  CreateConversationMessageRequest,
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
  GetCoworkersData,
  GetEnterpriseContractsData,
  GetHermesMeMessagesData,
  GetHistoryData,
  GetJobsData,
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
  PaginationMetadata,
  PatchEnterpriseContractRequest,
  PatchJobsByIdData,
  PatchOrganizationsByIdInvoiceEmailData,
  PatchProjectsByIdData,
  PostAgentsByIdDemoJobsData,
  PostAgentsByIdDemoJobsError,
  PostAgentsByIdJobsData,
  PostAgentsByIdJobsError,
  PostAgentsByIdRatingsData,
  PostJobsByIdInputsData,
  PostProjectsByIdJobsData,
  PostProjectsByIdTasksData,
  PostProjectsData,
  PostTasksByIdLinksData,
  PostUsersByIdUploadsData,
  PutJobsByIdShareError,
  PutOrganizationsByIdDesignMdData,
  PutTasksByIdShareError,
  PutUsersByIdDesignMdData,
  SetHermesSecretRequest,
} from "@/lib/clients/generated/core";
import {
  createAdminInvoice as coreCreateAdminInvoice,
  deleteHermesMeInstance as coreDeleteHermesMeInstance,
  deleteHermesMeInstanceIntegrationsByProvider as coreDeleteHermesMeInstanceIntegrationsByProvider,
  deleteJobsByIdShare as coreDeleteJobsByIdShare,
  deleteOrganizationsByIdMembersByMemberIdSeat as coreDeleteOrganizationsByIdMembersByMemberIdSeat,
  deleteProjectsById as coreDeleteProjectsById,
  deleteProjectsByIdJobsByJobId as coreDeleteProjectsByIdJobsByJobId,
  deleteProjectsByIdTasksByTaskId as coreDeleteProjectsByIdTasksByTaskId,
  deleteTasksById as coreDeleteTasksById,
  deleteTasksByIdLinksByLinkId as coreDeleteTasksByIdLinksByLinkId,
  deleteTasksByIdShare as coreDeleteTasksByIdShare,
  deleteUsersByIdOauthConsentsByConsentId as coreDeleteUsersByIdOauthConsentsByConsentId,
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
  getConversations as coreGetConversations,
  getConversationsById as coreGetConversationsById,
  getConversationsByIdMessages as coreGetConversationsByIdMessages,
  getCoworkers as coreGetCoworkers,
  getEnterpriseContracts as coreGetEnterpriseContracts,
  getEnterpriseContractsById as coreGetEnterpriseContractsById,
  getEnterpriseContractsByIdPeriodsPreview as coreGetEnterpriseContractsByIdPeriodsPreview,
  getHermesMeInstance as coreGetHermesMeInstance,
  getHermesMeInstanceIntegrations as coreGetHermesMeInstanceIntegrations,
  getHermesMeInstanceOnboardingProgress as coreGetHermesMeInstanceOnboardingProgress,
  getHermesMeInstanceSchedules as coreGetHermesMeInstanceSchedules,
  getHermesMeMessages as coreGetHermesMeMessages,
  getHermesMeUnreadCount as coreGetHermesMeUnreadCount,
  getHistory as coreGetHistory,
  getInvitationsById as coreGetInvitationsById,
  getJobs as coreGetJobs,
  getJobsById as coreGetJobsById,
  getOrganizationBySlug as coreGetOrganizationBySlug,
  getOrganizationEnterpriseContractSummary as coreGetOrganizationEnterpriseContractSummary,
  getOrganizationsById as coreGetOrganizationsById,
  getOrganizationsByIdBillingPlan as coreGetOrganizationsByIdBillingPlan,
  getOrganizationsByIdInvitations as coreGetOrganizationsByIdInvitations,
  getOrganizationsByIdMembers as coreGetOrganizationsByIdMembers,
  getOrganizationsByIdSeatSummary as coreGetOrganizationsByIdSeatSummary,
  getOrganizationsByIdStripeCustomer as coreGetOrganizationsByIdStripeCustomer,
  getOrganizationsByIdSubscription as coreGetOrganizationsByIdSubscription,
  getProjects as coreGetProjects,
  getProjectsById as coreGetProjectsById,
  getProjectsStats as coreGetProjectsStats,
  getShareByToken as coreGetShareByToken,
  getTasks as coreGetTasks,
  getTasksById as coreGetTasksById,
  getTasksByIdLinks as coreGetTasksByIdLinks,
  getUsersByIdCredits as coreGetUsersByIdCredits,
  getUsersByIdMembers as coreGetUsersByIdMembers,
  getUsersByIdNoticesPending as coreGetUsersByIdNoticesPending,
  getUsersByIdOrganizations as coreGetUsersByIdOrganizations,
  getUsersByIdOrganizationsByOrganizationIdCredits as coreGetUsersByIdOrganizationsByOrganizationIdCredits,
  getUsersByIdOrganizationsByOrganizationIdMember as coreGetUsersByIdOrganizationsByOrganizationIdMember,
  getUsersByIdStripeCustomer as coreGetUsersByIdStripeCustomer,
  getUsersByIdSubscription as coreGetUsersByIdSubscription,
  getWorkspacesDesignMd as coreGetWorkspacesDesignMd,
  listAdminInvoices as coreListAdminInvoices,
  listAdminTasks as coreListAdminTasks,
  listAdminUserOverview as coreListAdminUserOverview,
  listCreditPrices as coreListCreditPrices,
  markAdminInvoicePaid as coreMarkAdminInvoicePaid,
  patchConversationsById as corePatchConversationsById,
  patchConversationsByIdArchive as corePatchConversationsByIdArchive,
  patchEnterpriseContractsById as corePatchEnterpriseContractsById,
  patchHermesMeInstance as corePatchHermesMeInstance,
  patchHermesMeInstanceSchedulesByScheduleId as corePatchHermesMeInstanceSchedulesByScheduleId,
  patchJobsById as corePatchJobsById,
  patchOrganizationsByIdInvoiceEmail as corePatchOrganizationsByIdInvoiceEmail,
  patchProjectsById as corePatchProjectsById,
  patchTasksById as corePatchTasksById,
  postAgentsByIdDemoJobs as corePostAgentsByIdDemoJobs,
  postAgentsByIdJobs as corePostAgentsByIdJobs,
  postAgentsByIdRatings as corePostAgentsByIdRatings,
  postConversations as corePostConversations,
  postConversationsByIdMessages as corePostConversationsByIdMessages,
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
  postHermesMeSecrets as corePostHermesMeSecrets,
  postJobsByIdInputs as corePostJobsByIdInputs,
  postJobsByIdRefund as corePostJobsByIdRefund,
  postOrganizationsByIdStripeCustomer as corePostOrganizationsByIdStripeCustomer,
  postProjects as corePostProjects,
  postProjectsByIdJobs as corePostProjectsByIdJobs,
  postProjectsByIdTasks as corePostProjectsByIdTasks,
  postTasks as corePostTasks,
  postTasksByIdEvents as corePostTasksByIdEvents,
  postTasksByIdLinks as corePostTasksByIdLinks,
  postUsersByIdNoticesByNoticeIdAcknowledge as corePostUsersByIdNoticesByNoticeIdAcknowledge,
  postUsersByIdStripeCustomer as corePostUsersByIdStripeCustomer,
  postUsersByIdUploads as corePostUsersByIdUploads,
  putJobsByIdShare as corePutJobsByIdShare,
  putJobsByIdWorkspace as corePutJobsByIdWorkspace,
  putOrganizationsByIdDesignMd as corePutOrganizationsByIdDesignMd,
  putOrganizationsByIdMembersByMemberIdSeat as corePutOrganizationsByIdMembersByMemberIdSeat,
  putOrganizationsByIdSubscriptionSeats as corePutOrganizationsByIdSubscriptionSeats,
  putTasksByIdShare as corePutTasksByIdShare,
  putTasksByIdWorkspace as corePutTasksByIdWorkspace,
  putUsersByIdDesignMd as corePutUsersByIdDesignMd,
  putUsersByIdPreferredOrganization as corePutUsersByIdPreferredOrganization,
  searchAdminOrganizations as coreSearchAdminOrganizations,
  searchAdminUsers as coreSearchAdminUsers,
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

function transformTaskResponseEnvelope(data: any) {
  const task = data.data;

  task.createdAt = toDate(task.createdAt);
  task.updatedAt = toDate(task.updatedAt);
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

  if (result.error || !result.data) {
    const message = extractErrorMessage(result.error, result.response?.status);
    throw new CoreApiRequestError(message, {
      details: result.error,
      kind: extractErrorKind(result.error),
      status: result.response?.status,
    });
  }

  return result.data;
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
  async function getConversations() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetConversations({
          client,
          cache: "no-store",
        }),
      "Failed to fetch conversations",
    );
  }

  async function createConversation(body: {
    openaiId?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        corePostConversations({
          client,
          body,
        }),
      "Failed to create conversation",
    );
  }

  async function getConversation(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetConversationsById({
          client,
          path: { id },
          cache: "no-store",
        }),
      "Failed to fetch conversation",
    );
  }

  async function updateConversation(
    id: string,
    body: {
      metadata?: Record<string, unknown>;
      title?: string;
    },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchConversationsById({
          client,
          path: { id },
          body,
        }),
      "Failed to update conversation",
    );
  }

  async function archiveConversation(id: string, archived: boolean = true) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchConversationsByIdArchive({
          client,
          path: { id },
          body: { archived },
        }),
      "Failed to archive conversation",
    );
  }

  async function getConversationMessages(
    id: string,
    query?: { cursor?: string; limit?: number },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetConversationsByIdMessages({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch conversation messages",
    );
  }

  async function addConversationMessage(
    id: string,
    body: CreateConversationMessageRequest,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostConversationsByIdMessages({
          client,
          path: { id },
          body,
        }),
      "Failed to add conversation message",
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
    markFree: boolean;
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

  async function listAdminUserOverview(query: {
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    return executeOperation(
      getClient,
      (client) =>
        coreListAdminUserOverview({
          client,
          query,
          cache: "no-store",
        }),
      "Failed to list users",
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
      "Failed to fetch organization",
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

  async function createDemoJob(
    id: string,
    body: NonNullable<PostAgentsByIdDemoJobsData["body"]>,
  ) {
    return executeOperation(
      getClient,
      async (client) => {
        const result = await corePostAgentsByIdDemoJobs({
          client,
          path: { id },
          body,
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as PostAgentsByIdDemoJobsError,
            response: result.response,
          };
        }

        return result;
      },
      "Failed to create demo job",
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

  async function createTask(body: {
    name: string;
    description?: string | null;
    projectId?: string | null;
    coworkerId?: string | null;
    status?: "DRAFT" | "READY";
  }) {
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
        | "READY"
        | "INPUT_REQUIRED"
        | "AUTHENTICATION_REQUIRED"
        | "OUT_OF_CREDITS"
        | "CREDITS_TOPPED_UP"
        | "RUNNING"
        | "AWAITING_EXTERNAL"
        | "COMPLETED"
        | "FAILED"
        | "CANCEL_REQUESTED"
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
    body: {
      name?: string;
      description?: string | null;
      projectId?: string | null;
      coworkerId?: string | null;
    },
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
   * Sets (or clears, when `invoiceEmail` is null) an organization's invoice
   * email. Core enforces that the caller is an organization owner or admin.
   */
  async function updateOrganizationInvoiceEmail(
    organizationId: string,
    body: NonNullable<PatchOrganizationsByIdInvoiceEmailData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePatchOrganizationsByIdInvoiceEmail({
          client,
          path: { id: organizationId },
          body,
        }),
      "Failed to update organization invoice email",
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
      "Failed to fetch Hermes instance",
    );
  }

  async function provisionHermesInstance() {
    return executeOperation(
      getClient,
      (client) =>
        corePostHermesMeInstance({
          client,
        }),
      "Failed to provision Hermes instance",
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
      "Failed to update Hermes instance",
    );
  }

  async function destroyHermesInstance() {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteHermesMeInstance({
          client,
        }),
      "Failed to destroy Hermes instance",
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
      "Failed to fetch Hermes messages",
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
      "Failed to fetch Hermes unread count",
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
      "Failed to mark Hermes inbox as seen",
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
      "Failed to write Hermes secret",
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
      "Failed to start Hermes onboarding",
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
      "Failed to fetch Hermes onboarding progress",
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
      "Failed to list Hermes integrations",
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
      "Failed to list Hermes schedules",
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
      "Failed to update Hermes schedule",
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
      "Failed to approve Hermes confirmation",
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
      "Failed to reject Hermes confirmation",
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
      "Failed to disconnect Hermes integration",
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
    body: NonNullable<PostUsersByIdUploadsData["body"]>,
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostUsersByIdUploads({
          client,
          path: { id: CURRENT_USER_PATH_ID },
          body,
          cache: "no-store",
        }),
      "Failed to create upload session",
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
    addConversationMessage,
    archiveConversation,
    assignOrganizationSeat,
    createConversation,
    createAgentJob,
    createDemoJob,
    createMyFileUploadSession,
    createTask,
    createTaskLink,
    createTaskEvent,
    deleteJobShare,
    deleteProjectsById,
    deleteProjectsByIdJobsByJobId,
    deleteProjectsByIdTasksByTaskId,
    deleteTaskShare,
    deleteTaskLink,
    deleteTask,
    getConversation,
    getConversationMessages,
    getConversations,
    getHermesInstance,
    getHermesMessages,
    getHermesOnboardingProgress,
    getHermesUnreadCount,
    getHistory,
    listHermesIntegrations,
    listHermesSchedules,
    patchHermesSchedule,
    approveHermesConfirmation,
    rejectHermesConfirmation,
    startHermesOnboarding,
    disconnectHermesIntegration,
    initiateHermesIntegration,
    finalizeHermesIntegration,
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
    searchAdminUsers,
    listAdminUserOverview,
    listAdminTasks,
    getAdminTask,
    searchAdminOrganizations,
    getAdminOrganizationBySlug,
    listAdminInvoices,
    createAdminInvoice,
    getAdminInvoice,
    markAdminInvoicePaid,
    listCreditPrices,
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
    getMyStripeCustomer,
    getOrganizationActiveSubscription,
    getOrganizationBillingPlan,
    getOrganizationById,
    getOrganizationBySlug,
    getOrganizationMembers,
    getOrganizationPendingInvitations,
    getOrganizationSeatSummary,
    getOrganizationStripeCustomer,
    getWorkspaceDesignMd,
    setMyDesignMd,
    setMyPreferredOrganization,
    setOrganizationDesignMd,
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
    getTasks,
    patchTask,
    putJobShare,
    putTaskShare,
    unassignOrganizationSeat,
    updateConversation,
    updateHermesInstance,
    updateOrganizationInvoiceEmail,
    updateOrganizationSubscriptionSeats,
  };
}

export type CoreClient = ReturnType<typeof createCoreClient>;
