import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import type { CmoSeoSuggestion } from "@/schemas/cmo-seo.schema";
import {
  CmoConflictError,
  CmoNotFoundError,
  type CusoTarget,
  requireCuso,
} from "@/services/cmo-cuso.service";
import { toSuggestion } from "@/services/cmo-seo.service";
import { updateSeoSuggestion } from "@/services/seo-impact-record";

/** A write that lost a race reads the row again: one retry covers one concurrent writer. */
const STATUS_WRITE_ATTEMPTS = 3;

export async function setCmoSeoSuggestionStatus(
  target: CusoTarget,
  id: string,
  status: "open" | "done" | "dismissed",
  now: Date = new Date(),
): Promise<CmoSeoSuggestion> {
  const cuso = await requireCuso(target);
  for (let attempt = 1; ; attempt += 1) {
    const row = await prisma.projectSeoSuggestion.findFirst({
      where: { id, projectId: cuso.projectId },
    });
    if (!row) throw new CmoNotFoundError("Suggestion not found");
    // A retried request changes nothing: a second done would record a second
    // change. A verified change is done already.
    if (
      row.status === status ||
      (status === "done" && row.status === "verified")
    )
      return toSuggestion(row);
    try {
      return toSuggestion(
        await updateSeoSuggestion({
          // Only from the status read above: of two requests at once, one writes.
          where: { id, status: row.status },
          data: {
            status,
            doneAt: status === "done" ? now : null,
            checkedAt: null,
            verifiedAt: null,
          },
        }),
      );
    } catch (error) {
      if (!isPrismaRecordNotFoundError(error)) throw error;
      if (attempt === STATUS_WRITE_ATTEMPTS)
        throw new CmoConflictError(
          "The suggestion changed while it was saved. Try again.",
        );
    }
  }
}
