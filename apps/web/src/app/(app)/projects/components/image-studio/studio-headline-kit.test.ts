import { MAX_STUDIO_HEADLINE_LENGTH } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import { getStudioBrandKit } from "@/lib/actions/image-studio/brand-kit";
import { readStudioHeadlineKit } from "./studio-headline-kit";

vi.mock("@/lib/actions/image-studio/brand-kit", () => ({
  getStudioBrandKit: vi.fn(),
}));

describe("Studio headline Brand Kit", () => {
  it("retains the loaded look while filtering approved copy without a second request", async () => {
    const look = { colors: ["#A33421"], fonts: ["Playfair Display"] };
    vi.mocked(getStudioBrandKit).mockResolvedValue({
      ...look,
      approvedLines: [
        "A slower morning.",
        "A slower morning.",
        " ",
        "a".repeat(MAX_STUDIO_HEADLINE_LENGTH + 1),
      ],
      logo: null,
      summary: "",
      tone: "",
      audience: [],
      version: null,
    });

    await expect(readStudioHeadlineKit("project-a")).resolves.toEqual({
      approvedLines: ["A slower morning."],
      look,
    });
    expect(getStudioBrandKit).toHaveBeenCalledExactlyOnceWith({
      projectId: "project-a",
    });
  });
});
