import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { createGateway, gateway } from "ai";
import { getEnv } from "@/config/env";

/**
 * Which spend line an AI Gateway call belongs to. Each purpose may have its
 * own key; one without falls back to `AI_GATEWAY_API_KEY`, so nothing changes
 * until a purpose key is set.
 */
export type AiGatewayPurpose =
  | "soko-bot"
  | "cmo"
  | "project-memory"
  | "evals"
  | "default";

const PURPOSE_KEYS = {
  "soko-bot": "SOKO_BOT_AI_GATEWAY_API_KEY",
  cmo: "CMO_AI_GATEWAY_API_KEY",
  "project-memory": "PROJECT_MEMORY_AI_GATEWAY_API_KEY",
  evals: "EVALS_AI_GATEWAY_API_KEY",
} as const;

type GatewayEnv = Partial<
  Record<
    "AI_GATEWAY_API_KEY" | (typeof PURPOSE_KEYS)[keyof typeof PURPOSE_KEYS],
    string
  >
>;

function purposeKey(
  purpose: AiGatewayPurpose,
  env: GatewayEnv,
): string | undefined {
  return purpose === "default" ? undefined : env[PURPOSE_KEYS[purpose]];
}

/** The purpose's key, else the shared one. */
export function aiGatewayApiKey(
  purpose: AiGatewayPurpose = "default",
  env: GatewayEnv = getEnv(),
): string | undefined {
  return purposeKey(purpose, env) ?? env.AI_GATEWAY_API_KEY;
}

/**
 * A Gateway client for the purpose. Without a purpose key this is the SDK's
 * default `gateway`, which reads `AI_GATEWAY_API_KEY` itself or, on Vercel,
 * the OIDC token: exactly what plain `"provider/model"` calls did before.
 */
export function aiGateway(purpose: AiGatewayPurpose = "default") {
  const apiKey = purposeKey(purpose, getEnv());
  return apiKey ? createGateway({ apiKey }) : gateway;
}

/**
 * Turn spend line: eval turns win over everything, then CMO (`cmo-` / `cmo:`
 * turn ids, or a CMO-profile version), else Soko Bot. A turn is an eval when
 * its id starts `lab:` or it runs in an eval lane's workspace (`inEvalLane`):
 * the CMO cases and background children start with other ids, so the
 * workspace is the one marker every eval turn carries.
 */
export function sokoBotTurnPurpose(
  turn: {
    clientTurnId?: string | null;
    versionId?: string | null;
    inEvalLane?: boolean;
  } | null,
): "soko-bot" | "cmo" | "evals" {
  const id = turn?.clientTurnId ?? "";
  if (turn?.inEvalLane || id.startsWith("lab:")) return "evals";
  if (
    id.startsWith("cmo-") ||
    id.startsWith("cmo:") ||
    getSokoBotVersion(turn?.versionId).profile === "cmo"
  )
    return "cmo";
  return "soko-bot";
}
