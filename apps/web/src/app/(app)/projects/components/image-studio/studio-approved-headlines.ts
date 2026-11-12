import { MAX_STUDIO_HEADLINE_LENGTH } from "@sokosumi/utils";

import { getStudioBrandKit } from "@/lib/actions/image-studio/brand-kit";

export async function readApprovedStudioHeadlines(projectId: string) {
  const { approvedLines } = await getStudioBrandKit({ projectId });
  return [...new Set(approvedLines)].filter(
    (line) => line.trim() && line.length <= MAX_STUDIO_HEADLINE_LENGTH,
  );
}
