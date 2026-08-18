import { getEnv } from "@/config/env";

type ProjectMemoryEnvironment = Pick<
  ReturnType<typeof getEnv>,
  "AI_GATEWAY_API_KEY" | "BLOB_READ_WRITE_TOKEN"
>;

export function isProjectMemoryConfigured(
  env: ProjectMemoryEnvironment = getEnv(),
): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY && env.BLOB_READ_WRITE_TOKEN);
}
