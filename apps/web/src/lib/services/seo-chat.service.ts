import "server-only";

import {
  listSeoAuditChat,
  type SendSeoAuditChatRequest,
  sendSeoAuditChat,
} from "@sokosumi/core-client";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

export const seoChatServiceNoRedirect = {
  async list(auditId: string) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => listSeoAuditChat({ client, path: { id: auditId } }),
      "Failed to load audit conversation",
    );
    return response.data;
  },
  async send(auditId: string, body: SendSeoAuditChatRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => sendSeoAuditChat({ client, path: { id: auditId }, body }),
      "Failed to send audit message",
    );
    return response.data;
  },
};
