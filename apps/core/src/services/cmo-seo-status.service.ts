import prisma from "@/lib/db/prisma";
import type { CmoSeoSuggestion } from "@/schemas/cmo-seo.schema";
import {
  CmoNotFoundError,
  type CusoTarget,
  requireCuso,
} from "@/services/cmo-cuso.service";
import { toSuggestion } from "@/services/cmo-seo.service";
import { updateSeoSuggestion } from "@/services/seo-impact-record";

export async function setCmoSeoSuggestionStatus(
  target: CusoTarget,
  id: string,
  status: "open" | "done" | "dismissed",
  now: Date = new Date(),
): Promise<CmoSeoSuggestion> {
  const cuso = await requireCuso(target);
  const row = await prisma.projectSeoSuggestion.findFirst({
    where: { id, projectId: cuso.projectId },
  });
  if (!row) throw new CmoNotFoundError("Suggestion not found");
  return toSuggestion(
    await updateSeoSuggestion({
      where: { id },
      data: {
        status,
        doneAt: status === "done" ? now : null,
        checkedAt: null,
        verifiedAt: null,
      },
    }),
  );
}
