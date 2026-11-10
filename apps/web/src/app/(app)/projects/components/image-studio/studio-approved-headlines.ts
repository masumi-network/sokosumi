import { getStudioBrandKit } from "@/lib/actions/image-studio/brand-kit";

const MAX_HEADLINE_LENGTH = 120;

export async function readApprovedStudioHeadlines(projectId: string) {
  const { approvedLines } = await getStudioBrandKit({ projectId });
  return [...new Set(approvedLines)].filter(
    (line) => line.trim() && line.length <= MAX_HEADLINE_LENGTH,
  );
}
