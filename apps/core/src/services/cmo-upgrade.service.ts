import type { Prisma } from "@sokosumi/database";
import { cmoWhatsNew } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { type CusoTarget, requireCuso } from "@/services/cmo-cuso.service";

/** What CMO's "Cuso got better" dialog shows a member, once per move. */
export interface CmoUpgrade {
  versionId: string;
  lines: string[];
}

function versionOf(snapshot: Prisma.JsonValue | null): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const versionId = snapshot.versionId;
  return typeof versionId === "string" ? versionId : null;
}

/**
 * The newest administrator move of this Cuso, when it put him on the version
 * he runs now, made him newer, and this member has not closed its dialog.
 */
export async function cmoUpgradeFor(input: {
  sokoBotId: string;
  versionId: string | null;
  userId: string;
}): Promise<CmoUpgrade | null> {
  const { sokoBotId, versionId, userId } = input;
  if (!versionId) return null;
  const [move, seen] = await Promise.all([
    prisma.sokoBotAdminAction.findFirst({
      where: { sokoBotId, action: "SET_VERSION", status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      select: { before: true, after: true },
    }),
    prisma.cmoUpgradeSeen.findUnique({
      where: { userId_sokoBotId_versionId: { userId, sokoBotId, versionId } },
      select: { seenAt: true },
    }),
  ]);
  if (!move || seen || versionOf(move.after) !== versionId) return null;
  const lines = cmoWhatsNew(versionOf(move.before), versionId);
  return lines.length > 0 ? { versionId, lines } : null;
}

/** The member closed the dialog for the Cuso's move onto this version. */
export async function markCmoUpgradeSeen(
  target: CusoTarget,
  versionId: string,
): Promise<void> {
  const { sokoBotId } = await requireCuso(target);
  await prisma.cmoUpgradeSeen.upsert({
    where: {
      userId_sokoBotId_versionId: {
        userId: target.userId,
        sokoBotId,
        versionId,
      },
    },
    create: { userId: target.userId, sokoBotId, versionId },
    update: {},
  });
}
