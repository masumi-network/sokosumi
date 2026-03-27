import type { Notice, NoticeKind } from "@sokosumi/database";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  mapCoreJobShare,
  mapCorePublicSharedJobResponse,
} from "@/lib/clients/core.job-share";
import type {
  DeleteJobsByIdShareError,
  GetCoworkersData,
  GetShareJobsByTokenError,
  GetTasksData,
  PaginationMetadata,
  PutJobsByIdShareError,
} from "@/lib/clients/generated/core";
import {
  deleteJobsByIdShare as coreDeleteJobsByIdShare,
  deleteTasksById as coreDeleteTasksById,
  getAgentsById as coreGetAgentsById,
  getAgentsByIdInputSchema as coreGetAgentsByIdInputSchema,
  getConversations as coreGetConversations,
  getConversationsById as coreGetConversationsById,
  getConversationsByIdItems as coreGetConversationsByIdItems,
  getCoworkers as coreGetCoworkers,
  getJobs as coreGetJobs,
  getJobsById as coreGetJobsById,
  getShareJobsByToken as coreGetShareJobsByToken,
  getTasks as coreGetTasks,
  getTasksById as coreGetTasksById,
  getUsersMeCredits as coreGetUsersMeCredits,
  getUsersMeNoticesPending as coreGetUsersMeNoticesPending,
  getUsersMeOrganizations as coreGetUsersMeOrganizations,
  patchConversationsById as corePatchConversationsById,
  patchConversationsByIdArchive as corePatchConversationsByIdArchive,
  patchTasksById as corePatchTasksById,
  postConversations as corePostConversations,
  postConversationsByIdItems as corePostConversationsByIdItems,
  postTasks as corePostTasks,
  postTasksByIdEvents as corePostTasksByIdEvents,
  postUsersMeFiles as corePostUsersMeFiles,
  postUsersMeNoticesByIdAcknowledge as corePostUsersMeNoticesByIdAcknowledge,
  putJobsByIdShare as corePutJobsByIdShare,
  putTasksByIdWorkspace as corePutTasksByIdWorkspace,
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
  status?: number;

  constructor(
    message: string,
    options?: { details?: unknown; status?: number },
  ) {
    super(message);
    this.name = "CoreApiRequestError";
    this.details = options?.details;
    this.status = options?.status;
  }
}

type CoreOperationResult<TData, TError> = {
  data?: TData;
  error?: TError;
  response: Response;
};

type GetClient = () => Client | Promise<Client>;

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
    const message = extractErrorMessage(result.error, result.response.status);
    throw new CoreApiRequestError(message, {
      details: result.error,
      status: result.response.status,
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

  async function getConversationItems(
    id: string,
    query?: { cursor?: string; limit?: number },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetConversationsByIdItems({
          client,
          path: { id },
          query,
          cache: "no-store",
        }),
      "Failed to fetch conversation items",
    );
  }

  async function addConversationItem(
    id: string,
    body: {
      role: "user" | "assistant" | "system";
      content: Array<{ type: string; text?: string }> | string;
    },
  ) {
    return executeOperation(
      getClient,
      (client) =>
        corePostConversationsByIdItems({
          client,
          path: { id },
          body,
        }),
      "Failed to add conversation item",
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

  async function getTaskById(
    id: string,
    scope: Array<"context" | "owned"> = ["context"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetTasksById({
          client,
          path: { id },
          query: { scope },
          cache: "no-store",
        }),
      "Failed to fetch task",
    );
  }

  async function getJobs(query?: {
    scope?: Array<"context" | "owned">;
    cursor?: string;
    limit?: number;
    agentId?: string;
    status?:
      | "RUNNING"
      | "COMPLETED"
      | "FAILED"
      | "INITIATED"
      | "AWAITING_PAYMENT"
      | "AWAITING_INPUT";
  }) {
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

  async function getJobById(
    id: string,
    scope: Array<"context" | "owned"> = ["context"],
  ) {
    return executeOperation(
      getClient,
      (client) =>
        coreGetJobsById({
          client,
          path: { id },
          query: { scope },
          cache: "no-store",
        }),
      "Failed to fetch job",
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

  async function createTask(body: {
    name: string;
    description?: string | null;
    coworkerId?: string | null;
    status?: "DRAFT" | "READY";
  }) {
    return executeOperation(
      getClient,
      (client) =>
        corePostTasks({
          client,
          body,
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
        }),
      "Failed to update task",
    );
  }

  async function deleteTask(id: string) {
    return executeOperation(
      getClient,
      (client) =>
        coreDeleteTasksById({
          client,
          path: { id },
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
        coreGetUsersMeNoticesPending({
          client,
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
        corePostUsersMeNoticesByIdAcknowledge({
          client,
          path: { id },
        }),
      "Failed to acknowledge notice",
    );

    return response.data;
  }

  async function getMyCredits() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersMeCredits({
          client,
          cache: "no-store",
        }),
      "Failed to fetch user credits",
    );
  }

  async function getMyOrganizations() {
    return executeOperation(
      getClient,
      (client) =>
        coreGetUsersMeOrganizations({
          client,
          cache: "no-store",
        }),
      "Failed to fetch user organizations",
    );
  }

  async function uploadMyFile(file: Blob | File) {
    return executeOperation(
      getClient,
      (client) =>
        corePostUsersMeFiles({
          client,
          body: { file },
        }),
      "Failed to upload file",
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
        }),
      "Failed to move task to workspace",
    );
  }

  async function postConversationsByIdRecoverResponse(id: string) {
    return executeOperation(
      getClient,
      async (client) => {
        const result = await client.post({
          url: `/conversations/${encodeURIComponent(id)}/recover-response`,
          security: [{ scheme: "bearer", type: "http" }],
          cache: "no-store",
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error,
            response: result.response,
          };
        }
        const envelope = result.data as { data?: unknown } | undefined;
        return {
          data: envelope?.data as
            | {
                recovered?: boolean;
                reason?: "not_found" | "in_progress" | "terminal";
              }
            | undefined,
          error: undefined,
          response: result.response,
        };
      },
      "Failed to recover conversation response",
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
          data: mapCoreJobShare(result.data.data),
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

  async function getSharedJobByToken(token: string) {
    return executeOperation(
      getClient,
      async (client) => {
        const result = await coreGetShareJobsByToken({
          client,
          path: { token },
          cache: "no-store",
        });
        if (result.error) {
          return {
            data: undefined,
            error: result.error as GetShareJobsByTokenError,
            response: result.response,
          };
        }
        return {
          data: mapCorePublicSharedJobResponse(result.data.data),
          error: undefined,
          response: result.response,
        };
      },
      "Failed to fetch shared job",
    );
  }

  return {
    acknowledgeNotice,
    addConversationItem,
    archiveConversation,
    createConversation,
    createTask,
    createTaskEvent,
    deleteJobShare,
    deleteTask,
    getConversation,
    getConversationItems,
    getConversations,
    getAgentById,
    getAgentInputSchema,
    postConversationsByIdRecoverResponse,
    getCoworkers,
    getJobById,
    getJobs,
    getMyCredits,
    getMyOrganizations,
    getPendingNotices,
    getSharedJobByToken,
    moveTaskToWorkspace,
    getTaskById,
    getTasks,
    patchTask,
    putJobShare,
    updateConversation,
    uploadMyFile,
  };
}

export type CoreClient = ReturnType<typeof createCoreClient>;
