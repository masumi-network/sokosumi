import { reportAiGatewayBudgetResponse } from "@/lib/ai-gateway-budget";
import { aiGatewayApiKey } from "@/lib/ai-gateway-purpose";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const MODELS_TIMEOUT_MS = 8_000;
/** The catalog moves slowly; a picker does not need a live call per render. */
const MODELS_CACHE_MS = 10 * 60 * 1_000;

export interface GatewayModel {
  id: string;
  name: string | null;
  /** Zones the model can be pinned to for data residency, e.g. ["eu"]. */
  regions: string[];
}

let cache: { at: number; models: GatewayModel[] } | null = null;

function parseModels(payload: unknown): GatewayModel[] {
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).data
      : null;
  if (!Array.isArray(data)) return [];
  const models: GatewayModel[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string") continue;
    const regions = Array.isArray(record.regions)
      ? record.regions.filter(
          (region): region is string => typeof region === "string",
        )
      : [];
    models.push({
      id: record.id,
      name: typeof record.name === "string" ? record.name : null,
      regions,
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Models an authored version may pick from. Returns an empty list rather than
 * throwing when the gateway is unreachable or unconfigured: the model field
 * stays free text, so a picker that cannot load must not block authoring.
 */
export async function listGatewayModels(): Promise<GatewayModel[]> {
  if (cache && Date.now() - cache.at < MODELS_CACHE_MS) return cache.models;
  const apiKey = aiGatewayApiKey();
  if (!apiKey) return [];
  try {
    const response = await fetch(GATEWAY_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (await reportAiGatewayBudgetResponse(response, apiKey))
        return cache?.models ?? [];
      recordCoreWarning(
        { operation: "ai_gateway_list_models" },
        {
          message: "The AI Gateway did not return its model list",
          why: "The AI Gateway answered the model list request with an error status",
          fix: "The picker shows the last list it loaded, or none. If it repeats, check the AI Gateway key and Vercel's status.",
        },
        { provider: "ai-gateway", status: response.status },
      );
      return cache?.models ?? [];
    }
    const models = parseModels(await response.json());
    cache = { at: Date.now(), models };
    return models;
  } catch (error) {
    // A provider's answer is untrusted text: content-free fields only.
    recordCoreWarning(
      { operation: "ai_gateway_list_models" },
      {
        message: "The AI Gateway model list could not be loaded",
        why: "The model list request failed before an answer could be read",
        fix: "The picker shows the last list it loaded, or none. If it repeats, check the network path to the AI Gateway.",
      },
      { provider: "ai-gateway", failure: messageSafeErrorFields(error) },
    );
    return cache?.models ?? [];
  }
}
