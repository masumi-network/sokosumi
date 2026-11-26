import {
  deleteUsersByIdSessionsBySessionId,
  getUsersByIdSessions,
} from "@sokosumi/core-client";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

/** The signed-in person's sessions, without their tokens. */
export async function listMySessions() {
  const response = await getUsersByIdSessions({
    client: getBrowserCoreClient(),
    path: { id: "me" },
    throwOnError: true,
  });
  return response.data.data.sessions;
}

export async function signOutMySession(sessionId: string): Promise<void> {
  await deleteUsersByIdSessionsBySessionId({
    client: getBrowserCoreClient(),
    path: { id: "me", sessionId },
    throwOnError: true,
  });
}
