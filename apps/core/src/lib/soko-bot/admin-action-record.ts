import { createHash, randomUUID } from "node:crypto";
import {
  containsSokoBotSensitiveMaterial,
  redactSokoBotSensitiveText,
} from "@sokosumi/soko-bot";

export interface AdminActionSnapshotInput {
  status: string;
  adminPausedAt: Date | null;
  eveSessionId: string | null;
  memoryVersion: number;
  archivedAt: Date | null;
  versionId: string | null;
}

export function adminActionSnapshot(bot: AdminActionSnapshotInput) {
  return {
    status: bot.status,
    adminPausedAt: bot.adminPausedAt,
    hasEveSession: bot.eveSessionId !== null,
    memoryVersion: bot.memoryVersion,
    archivedAt: bot.archivedAt,
    // Which version the bot ran before and after. `SET_VERSION` is otherwise
    // invisible in the audit trail: nothing else on the snapshot changes.
    versionId: bot.versionId,
  };
}

export function adminActionOperationId(
  operationId: string | undefined,
  requestId: string | undefined,
  traceId: string | undefined,
): string {
  if (operationId) return operationId;
  const source = requestId
    ? `request:${requestId}`
    : traceId
      ? `trace:${traceId}`
      : `generated:${randomUUID()}`;
  return createHash("sha256").update(source).digest("hex");
}

export function adminRetryOperationKey(operationId: string): string {
  return createHash("sha256").update(operationId).digest("hex").slice(0, 32);
}

/** A record id is never a secret; blanking one fails the response schema. */
const EXACT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redactAdminPresentation<T>(value: T): T {
  if (typeof value === "string") {
    return (
      EXACT_UUID.test(value) ? value : redactSokoBotSensitiveText(value)
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAdminPresentation(item)) as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const safeKey = redactSokoBotSensitiveText(key);
        return [
          safeKey,
          containsSokoBotSensitiveMaterial(`${key}: value`)
            ? "[Sensitive value removed]"
            : redactAdminPresentation(item),
        ];
      }),
    ) as T;
  }
  return value;
}
