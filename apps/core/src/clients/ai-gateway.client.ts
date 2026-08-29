import { getEnv } from "@/config/env";

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
  const apiKey = getEnv().AI_GATEWAY_API_KEY;
  if (!apiKey) return [];
  try {
    const response = await fetch(GATEWAY_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn("AI Gateway model list failed", { status: response.status });
      return cache?.models ?? [];
    }
    const models = parseModels(await response.json());
    cache = { at: Date.now(), models };
    return models;
  } catch (error) {
    console.warn("AI Gateway model list unreachable", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return cache?.models ?? [];
  }
}
