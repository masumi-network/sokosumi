/**
 * Public-safe types for Hermes — these are the only shapes that may cross
 * the server/client boundary. Never include `apiServerKey` or the orchestrator
 * token here.
 */

export type HermesInstanceStatus =
  | "provisioning"
  | "running"
  | "suspended"
  | "error";

export interface HermesInstancePublic {
  status: HermesInstanceStatus;
  endpointUrl: string | null;
  lastActivityAt: string | null;
}

export interface HermesChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Shape returned to clients when listing the user's persisted Hermes
 * conversation. `id` is the DB row id (uuid7), `createdAt` is ISO 8601.
 */
export interface HermesPersistedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /**
   * Outbox kind from the orchestrator for agent-initiated pushes.
   * Null for normal chat turns. Drives notification-style rendering.
   */
  kind: string | null;
  createdAt: string;
}
