import { getEnvSecrets } from "@/config/env.config";

const LOCK_TIMEOUT_MS = getEnvSecrets().LOCK_TIMEOUT;

export function isLockExpired(lockedAt: Date | null): boolean {
  if (!lockedAt) return true;
  return Date.now() - lockedAt.getTime() > LOCK_TIMEOUT_MS;
}
