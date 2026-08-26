import type { SokoBotCapability } from "@sokosumi/soko-bot";

export interface RuntimeAuthAttributes {
  userId: string;
  sokoBotId: string;
  workspaceId: string;
  turnId: string;
  sessionIdClaim: string;
  turnGrant: string;
  capabilities: SokoBotCapability[];
  /** Version the control plane chose for this turn; empty on eval/legacy tokens. */
  model: string | null;
  versionId: string | null;
  /** AI Gateway region pin ("eu" | "us"); null for global routing. */
  inferenceRegion: string | null;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Soko Bot runtime auth missing ${name}`);
  return value;
}

function optional(
  value: string | readonly string[] | undefined,
): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function scalar(
  value: string | readonly string[] | undefined,
  name: string,
): string {
  return required(typeof value === "string" ? value : undefined, name);
}

export function readRuntimeAuth(
  auth:
    | {
        readonly attributes: Readonly<
          Record<string, string | readonly string[]>
        >;
      }
    | null
    | undefined,
): RuntimeAuthAttributes {
  const attributes = auth?.attributes;
  if (!attributes)
    throw new Error("Soko Bot runtime session is not authenticated");
  const parsed: unknown = JSON.parse(
    scalar(attributes.capabilities, "capabilities"),
  );
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error("Soko Bot runtime capabilities are invalid");
  }
  return {
    userId: scalar(attributes.userId, "userId"),
    sokoBotId: scalar(attributes.sokoBotId, "sokoBotId"),
    workspaceId: scalar(attributes.workspaceId, "workspaceId"),
    turnId: scalar(attributes.turnId, "turnId"),
    sessionIdClaim: scalar(attributes.sessionIdClaim, "sessionIdClaim"),
    turnGrant: scalar(attributes.turnGrant, "turnGrant"),
    capabilities: parsed as SokoBotCapability[],
    model: optional(attributes.model),
    versionId: optional(attributes.versionId),
    inferenceRegion: optional(attributes.inferenceRegion),
  };
}
