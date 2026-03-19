import type { Notice, NoticeKind } from "@sokosumi/database";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import type {
  GetCoworkersData,
  GetTasksData,
  PaginationMetadata,
} from "@/lib/clients/generated/core";
import {
  deleteTasksById as coreDeleteTasksById,
  getAgentsById as coreGetAgentsById,
  getAgentsByIdInputSchema as coreGetAgentsByIdInputSchema,
  getConversations as coreGetConversations,
  getConversationsById as coreGetConversationsById,
  getConversationsByIdItems as coreGetConversationsByIdItems,
  getCoworkers as coreGetCoworkers,
  getJobs as coreGetJobs,
  getJobsById as coreGetJobsById,
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
  postUsersMeNoticesByIdAcknowledge as corePostUsersMeNoticesByIdAcknowledge,
} from "@/lib/clients/generated/core";
import type { Client } from "@/lib/clients/generated/core/client";

import { getCoreTransportAdapter } from "./core.transport";

export {
  coreApiBaseUrl,
  normalizeCoreApiBaseUrl,
} from "./core.transport.shared";

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

type CoreOperationResult<TData, TError> = {
  data?: TData;
  error?: TError;
  response: Response;
};

async function createCoreGeneratedClient(): Promise<Client> {
  const transport = await getCoreTransportAdapter();
  return transport.createGeneratedClient();
}

async function executeOperation<TData, TError>(
  operation: (client: Client) => Promise<CoreOperationResult<TData, TError>>,
  fallbackMessage: string,
): Promise<TData> {
  const client = await createCoreGeneratedClient();

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

export const coreClient = (() => {
  async function getConversations() {
    return executeOperation(
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
    scope?: Array<"context" | "owned" | "shared">;
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
    scope: Array<"context" | "owned" | "shared"> = ["context"],
  ) {
    return executeOperation(
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
      (client) =>
        coreGetUsersMeOrganizations({
          client,
          cache: "no-store",
        }),
      "Failed to fetch user organizations",
    );
  }

  return {
    acknowledgeNotice,
    addConversationItem,
    archiveConversation,
    createConversation,
    createTask,
    createTaskEvent,
    deleteTask,
    getConversation,
    getConversationItems,
    getConversations,
    getAgentInputSchema,
    getCoworkers,
    getAgentById,
    getJobById,
    getJobs,
    getPendingNotices,
    getMyCredits,
    getMyOrganizations,
    getTaskById,
    getTasks,
    patchTask,
    updateConversation,
  };
})();
