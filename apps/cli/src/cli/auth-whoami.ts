import type { UserIdentity } from "../api/models/user-identity.js";
import { fetchUserIdentity } from "../api/services/user-identity-service.js";
import { type CliTargetConfig, sanitizeApiUrl } from "../auth/config.js";
import {
  type CommandContext,
  writeJson,
  writeText,
} from "./commands/command-helpers.js";

export interface AuthWhoamiResult {
  user: UserIdentity;
  target: CliTargetConfig["target"];
  apiUrl: string;
}

export async function runAuthWhoami({
  client,
  config,
  stdout,
  json = false,
  signal,
}: CommandContext & { config: CliTargetConfig }): Promise<AuthWhoamiResult> {
  const user = await fetchUserIdentity(client, signal);
  const result: AuthWhoamiResult = {
    user,
    target: config.target,
    apiUrl: sanitizeApiUrl(config.apiUrl),
  };
  if (json) writeJson(stdout, result);
  else {
    writeText(stdout, [
      `Signed in as: ${user.email}`,
      `User ID: ${user.id}`,
      `Platform role: ${user.platformRole}`,
      `Target: ${result.target}`,
      `API URL: ${result.apiUrl}`,
    ]);
  }
  return result;
}
