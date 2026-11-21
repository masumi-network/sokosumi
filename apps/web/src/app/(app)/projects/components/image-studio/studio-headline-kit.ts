import { MAX_STUDIO_HEADLINE_LENGTH } from "@sokosumi/utils";

import { getStudioBrandKit } from "@/lib/actions/image-studio/brand-kit";
import type { StudioHeadlineLook } from "./studio-ad-headline";

export async function readStudioHeadlineKit(projectId: string): Promise<{
  approvedLines: string[];
  look: StudioHeadlineLook;
}> {
  const { approvedLines, colors, fonts } = await getStudioBrandKit({
    projectId,
  });
  return {
    approvedLines: [...new Set(approvedLines)].filter(
      (line) => line.trim() && line.length <= MAX_STUDIO_HEADLINE_LENGTH,
    ),
    look: { colors, fonts },
  };
}
