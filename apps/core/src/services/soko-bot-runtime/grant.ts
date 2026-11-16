import { type Prisma } from "@sokosumi/database";
import {
  isSokoBotCapability,
  SOKO_BOT_SEO_CAPABILITIES,
  type SokoBotTurnGrantClaims,
} from "@sokosumi/soko-bot";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";
import { SokoBotRuntimeAuthorizationError } from "../soko-bot-runtime.service";

/** Tools whose work belongs to a Project; a project bot's go to its own. */
export const PROJECT_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  ...SOKO_BOT_SEO_CAPABILITIES,
  "list_tasks",
  "create_task",
  "hire_agent",
  "generate_image",
  "get_image",
  "list_project_social_accounts",
  "list_social_posts",
  "get_social_post",
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
]);

/**
 * The runtime executes inside Core, so a turn's scope is read from the row the
 * control plane wrote rather than from a signed grant carried across a network
 * hop. The claims shape is unchanged: capability scoping, the context snapshot
 * a turn is pinned to, and the memory version it was handed all still gate what
 * a tool call may do.
 */
export function buildTurnGrant(
  turn: {
    id: string;
    sokoBotId: string;
    workspaceId: string;
    capabilityNames: string[];
    contextSnapshot: { id: string; packet: Prisma.JsonValue } | null;
    requestedByUserId: string | null;
    sokoBot: { userId: string | null };
  },
  sessionId: string,
): SokoBotTurnGrantClaims {
  if (!turn.contextSnapshot) {
    throw new SokoBotRuntimeAuthorizationError(
      "Context snapshot is unavailable",
    );
  }
  const packet = turn.contextSnapshot.packet;
  const memory =
    packet && typeof packet === "object" && !Array.isArray(packet)
      ? (packet as Record<string, unknown>).memory
      : null;
  const memoryVersion =
    memory && typeof memory === "object" && !Array.isArray(memory)
      ? (memory as Record<string, unknown>).version
      : null;
  return {
    issuer: "sokosumi-core",
    audience: "soko-bot-core",
    subject: turn.sokoBotId,
    jwtId: `in-process:${turn.id}`,
    sessionId,
    turnId: turn.id,
    sokoBotId: turn.sokoBotId,
    userId: sokoBotActingUserId(turn),
    workspaceId: turn.workspaceId,
    contextSnapshotId: turn.contextSnapshot.id,
    memoryRevisionId: null,
    memoryVersion: typeof memoryVersion === "number" ? memoryVersion : 0,
    capabilities: turn.capabilityNames.filter(isSokoBotCapability),
    issuedAt: 0,
    expiresAt: 0,
  };
}
