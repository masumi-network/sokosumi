import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";

interface StudioAdEventInput {
  workspaceId: string;
  assetId: string;
  userId?: string | null;
  type: string;
  meta?: Prisma.InputJsonValue;
}

export async function recordStudioAdEvent(
  input: StudioAdEventInput,
): Promise<void> {
  try {
    await prisma.adEvent.create({
      data: {
        workspaceId: input.workspaceId,
        assetId: input.assetId,
        userId: input.userId,
        type: input.type,
        meta: input.meta,
      },
    });
  } catch {
    // Preference signals are best effort and must never fail the user's action.
  }
}
