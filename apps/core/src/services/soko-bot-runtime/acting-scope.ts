import { type Prisma } from "@sokosumi/database";
import { getSokoBotVersion } from "@sokosumi/soko-bot";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import {
  skillChangeRefusal,
  sokoBotDriveFolder,
} from "@/lib/soko-bot/self-config-guards";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
} from "../soko-bot-runtime.service";

/**
 * The member a tool runs as. A shared Soko Bot acting on its own acts for
 * nobody (ADR 0057), so a tool that needs a person refuses before it starts.
 */
export function actingMemberOf(authorized: {
  turn: { actingUserId: string | null };
}): string {
  const { actingUserId } = authorized.turn;
  if (actingUserId === null)
    throw new SokoBotRefusedUnsentError(
      "This action runs as a member, and nobody asked for this turn. Say what you would do in your chat; a member's request starts a turn that can do it.",
    );
  return actingUserId;
}

/**
 * Whether a turn acts in its owner's name. On Cuso, a shared CMO bot, every
 * member's turn does: he works for the whole business (ADR 0061). On any other
 * shared bot a member is a teammate, and an assistant never is the owner.
 */
export function actsForOwner(authorized: AuthorizedSokoBotRuntime): boolean {
  if (authorized.askedByKind === "OWNER") return true;
  return (
    authorized.askedByKind === "TEAMMATE" &&
    getSokoBotVersion(authorized.turn.versionId).profile === "cmo"
  );
}

/**
 * A personal bot reads its owner's Directs on the owner's own turns and its
 * rhythms; never for a teammate, another bot, or on a shared bot.
 */
export function ownerDirectReader(
  authorized: AuthorizedSokoBotRuntime,
): boolean {
  return (
    authorized.askedByKind !== "TEAMMATE" &&
    authorized.askedByKind !== "ASSISTANT" &&
    authorized.turn.actingUserId !== null &&
    !authorized.reader?.sharedScope
  );
}

/** The owner's Directs: this organization's and the org-free personal ones. */
export function ownerDirectWhere(
  authorized: AuthorizedSokoBotRuntime,
  scope: Prisma.ChatRoomWhereInput,
): Prisma.ChatRoomWhereInput {
  return {
    kind: "direct",
    archivedAt: null,
    OR: [{ organizationId: scope.organizationId }, { organizationId: null }],
    userMembers: { some: { userId: authorized.turn.actingUserId ?? "" } },
  };
}

/** A Drive folder a tool may write into, normalized; "" is the top level. */
export function driveFolderFor(folder: string | undefined): string {
  const result = sokoBotDriveFolder(folder);
  if ("refusal" in result) throw new SokoBotRefusedUnsentError(result.refusal);
  return result.folder;
}

/** The member a skill change runs as, once the owner asked for it in chat. */
export function requireOwnerSkillRequest(
  authorized: AuthorizedSokoBotRuntime,
): string {
  const refusal = skillChangeRefusal({
    source: authorized.turn.source,
    chainDepth: authorized.turn.chainDepth,
    askedByAssistant: authorized.askedByKind === "ASSISTANT",
    shared: Boolean(authorized.reader.sharedScope),
  });
  if (refusal) throw new SokoBotRefusedUnsentError(refusal);
  return actingMemberOf(authorized);
}

/** Who an action's operation key belongs to: the member, or the bot acting on its own. */
export function actionPrincipalId(turn: {
  actingUserId: string | null;
  sokoBotId: string;
}): string {
  return turn.actingUserId ?? `soko_bot:${turn.sokoBotId}`;
}

export async function requireSokoBotWorkspaceAccess(
  client: Pick<Prisma.TransactionClient, "workspace">,
  userId: string | null,
  workspaceId: string,
) {
  const workspace = await client.workspace.findFirst({
    where: sokoBotWorkspaceAccessWhere(userId, workspaceId),
    select: { id: true, organizationId: true },
  });
  if (!workspace) {
    throw new SokoBotRuntimeAuthorizationError(
      "Workspace access is no longer available",
    );
  }
  return workspace;
}
