import { getEnv } from "@/config/env";

/** A memory refresh holds the Project's `contextMdUpdatingSince` lock this long at most. */
export const PROJECT_MEMORY_LOCK_TTL_MS = 5 * 60 * 1000;

type ProjectMemoryEnvironment = Pick<
  ReturnType<typeof getEnv>,
  "AI_GATEWAY_API_KEY" | "BLOB_READ_WRITE_TOKEN"
>;

export function isProjectMemoryConfigured(
  env: ProjectMemoryEnvironment = getEnv(),
): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY && env.BLOB_READ_WRITE_TOKEN);
}
