import type { AdEvalAsset } from "@/services/ad-evals.service";

export function adEvalAsset(overrides: Partial<AdEvalAsset> = {}): AdEvalAsset {
  return {
    id: "asset-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    model: "ideogram-v3",
    prompt: "Create a square product spotlight ad.",
    settings: { aspectRatio: "1:1" },
    blobPathname: "projects/project-a/image-studio/job-a/image.png",
    job: {
      batchId: "batch-a",
      promptSnapshot: {
        templateId: "ad",
        creativeDirection: "spotlight",
        brandLook: { colors: ["#23453C"], fonts: ["Inter"] },
      },
    },
    adEvals: [],
    adFeedback: [],
    adEvents: [],
    ...overrides,
  };
}

export function adFeedback(
  overrides: Partial<AdEvalAsset["adFeedback"][number]> = {},
): AdEvalAsset["adFeedback"][number] {
  return {
    id: "feedback-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    kind: "THUMB",
    otherAssetId: null,
    thumb: 1,
    outcome: null,
    reasons: ["great"],
    createdAt: new Date("2026-11-13T10:00:00Z"),
    ...overrides,
  };
}
