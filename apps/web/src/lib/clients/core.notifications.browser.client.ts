import { createClient } from "@/lib/clients/generated/core/client";
import type {
  GetNotificationsData,
  GetNotificationsErrors,
  GetNotificationsResponse,
  GetNotificationsResponses,
  GetNotificationsUnreadCountErrors,
  GetNotificationsUnreadCountResponse,
  GetNotificationsUnreadCountResponses,
  PatchNotificationsByIdReadData,
  PatchNotificationsByIdReadErrors,
  PatchNotificationsByIdReadResponse,
  PatchNotificationsByIdReadResponses,
  PatchNotificationsReadAllErrors,
  PatchNotificationsReadAllResponse,
  PatchNotificationsReadAllResponses,
} from "@/lib/clients/generated/core/types.gen";
import { getBrowserCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";
import { attachCoreRequestIdInterceptor } from "@/lib/clients/utils/core-request-id";
import { executeCoreOperation } from "./core.request";

let notificationsGeneratedClient: ReturnType<typeof createClient> | undefined;

function getNotificationsGeneratedClient() {
  notificationsGeneratedClient ??= attachCoreRequestIdInterceptor(
    createClient({
      baseUrl: getBrowserCoreApiBaseUrl(),
      credentials: "include",
    }),
  );

  return notificationsGeneratedClient;
}

function transformNotificationItem(data: Record<string, unknown>) {
  if (data.readAt) {
    data.readAt = new Date(data.readAt as string | Date);
  }
  data.createdAt = new Date(data.createdAt as string | Date);
  return data;
}

async function transformNotificationsListResponse(data: unknown) {
  const envelope = data as {
    data: Array<Record<string, unknown>>;
    meta: { timestamp: string | Date };
  };
  envelope.data = envelope.data.map((item) => transformNotificationItem(item));
  envelope.meta.timestamp = new Date(envelope.meta.timestamp);
  return envelope;
}

async function transformMetaTimestampResponse(data: unknown) {
  const envelope = data as { meta: { timestamp: string | Date } };
  envelope.meta.timestamp = new Date(envelope.meta.timestamp);
  return envelope;
}

async function transformNotificationItemResponse(data: unknown) {
  const envelope = data as {
    data: Record<string, unknown>;
    meta: { timestamp: string | Date };
  };
  envelope.data = transformNotificationItem(envelope.data);
  envelope.meta.timestamp = new Date(envelope.meta.timestamp);
  return envelope;
}

export const notificationsBrowserClient = {
  async getNotifications(
    query?: GetNotificationsData["query"],
  ): Promise<GetNotificationsResponse> {
    return executeCoreOperation(
      getNotificationsGeneratedClient,
      (client) =>
        client.get<GetNotificationsResponses, GetNotificationsErrors>({
          url: "/notifications",
          query,
          cache: "no-store",
          responseTransformer: transformNotificationsListResponse,
        }),
      "Failed to fetch notifications",
    );
  },

  async getNotificationsUnreadCount(): Promise<GetNotificationsUnreadCountResponse> {
    return executeCoreOperation(
      getNotificationsGeneratedClient,
      (client) =>
        client.get<
          GetNotificationsUnreadCountResponses,
          GetNotificationsUnreadCountErrors
        >({
          url: "/notifications/unread-count",
          cache: "no-store",
          responseTransformer: transformMetaTimestampResponse,
        }),
      "Failed to fetch notification unread count",
    );
  },

  async patchNotificationRead(
    path: PatchNotificationsByIdReadData["path"],
  ): Promise<PatchNotificationsByIdReadResponse> {
    return executeCoreOperation(
      getNotificationsGeneratedClient,
      (client) =>
        client.patch<
          PatchNotificationsByIdReadResponses,
          PatchNotificationsByIdReadErrors
        >({
          url: "/notifications/{id}/read",
          path,
          cache: "no-store",
          responseTransformer: transformNotificationItemResponse,
        }),
      "Failed to mark notification as read",
    );
  },

  async patchNotificationsReadAll(): Promise<PatchNotificationsReadAllResponse> {
    return executeCoreOperation(
      getNotificationsGeneratedClient,
      (client) =>
        client.patch<
          PatchNotificationsReadAllResponses,
          PatchNotificationsReadAllErrors
        >({
          url: "/notifications/read-all",
          cache: "no-store",
          responseTransformer: transformMetaTimestampResponse,
        }),
      "Failed to mark all notifications as read",
    );
  },
};
