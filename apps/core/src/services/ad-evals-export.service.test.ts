import { beforeEach, describe, expect, it, vi } from "vitest";

import { adEvalAsset, adFeedback } from "@/test-fixtures/ad-evals";

const mocks = vi.hoisted(() => ({
  loadAdEvalAssets: vi.fn(),
  privateBlobReadUrl: vi.fn(),
  requireStudioBlobToken: vi.fn(),
}));
vi.mock("./ad-evals.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ad-evals.service")>()),
  loadAdEvalAssets: mocks.loadAdEvalAssets,
}));
vi.mock("@/lib/blob-read-url", () => ({
  privateBlobReadUrl: mocks.privateBlobReadUrl,
}));
vi.mock("@/lib/image-studio/blob-store", () => ({
  requireStudioBlobToken: mocks.requireStudioBlobToken,
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  AD_EVAL_EXPORT_IMAGE_VALID_MS,
  adEvalWorkspaceHash,
  exportAdminAdEvals,
} from "./ad-evals-export.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadAdEvalAssets.mockResolvedValue([]);
  mocks.requireStudioBlobToken.mockReturnValue("studio-test-store");
  mocks.privateBlobReadUrl.mockImplementation(
    async (pathname: string) =>
      `https://blob.example/${pathname}?signed=short-lived`,
  );
});

describe("ad evals JSONL export", () => {
  it("selects training-consenting workspaces and returns an empty dataset without signing anything", async () => {
    const result = await exportAdminAdEvals();
    expect(mocks.loadAdEvalAssets).toHaveBeenCalledWith(true);
    expect(result.jsonl).toBe("");
    expect(result.manifest).toMatchObject({
      formatVersion: "1",
      policyVersion: "2026-11-13",
      rowCount: 0,
      workspaceHashes: [],
    });
    expect(mocks.privateBlobReadUrl).not.toHaveBeenCalled();
  });

  it("exports numeric ratings with hashed workspaces and drops all customer text and identities", async () => {
    const asset = adEvalAsset({
      prompt: "Acme's private campaign, Jane Smith, jane@acme.example",
      model: "flux-2-pro",
      adFeedback: [adFeedback({ reasons: ["great", "jane@acme.example"] })],
      adEvals: [
        {
          workspaceId: "workspace-a",
          overall: 4,
          judge: {
            criteria: {
              composition: {
                score: 5,
                reason: "Jane Smith from Acme approves",
              },
              "jane@acme.example": { score: 5 },
            },
            overall: 4,
            issues: ["Acme secret"],
          },
        },
      ],
      adEvents: [
        {
          workspaceId: "workspace-a",
          type: "downloaded",
          createdAt: new Date("2026-11-13T09:00:00Z"),
        },
        {
          workspaceId: "other-workspace",
          type: "posted",
          createdAt: new Date(),
        },
      ],
      job: {
        batchId: "batch-a",
        promptSnapshot: {
          templateId: "Acme",
          creativeDirection: "jane@acme.example",
          brandLook: {
            colors: ["#23453C", "Acme"],
            fonts: ["Inter", "Jane Smith", "jane@acme.example"],
            headline: "Acme secret",
            logo: "https://acme.example/logo.png",
          },
        },
      },
    });
    mocks.loadAdEvalAssets.mockResolvedValue([asset]);
    const { jsonl, manifest } = await exportAdminAdEvals();
    const row = JSON.parse(jsonl);
    expect(row).toMatchObject({
      type: "rating",
      asset_id: "asset-a",
      model: "flux-2-pro",
      label: 1,
      reasons: ["great"],
      prompt: {
        brief: null,
        final: null,
        text_redacted: true,
        template: null,
        direction: null,
        aspect: "1:1",
        brand: { palette: ["#23453C"], fonts: ["Inter"] },
      },
      judge: { overall: 4, criteria: { composition: 5 } },
      implicit_score: 1,
      workspace_hash: adEvalWorkspaceHash("workspace-a"),
      export_id: manifest.exportId,
      format_version: "1",
    });
    for (const privateText of [
      "Acme",
      "Jane Smith",
      "jane@",
      "workspace-a",
      "userId",
      "email",
      "comment",
      'reason":',
    ]) {
      expect(jsonl).not.toContain(privateText);
    }
    expect(manifest.workspaceHashes).toEqual([row.workspace_hash]);
    expect(mocks.privateBlobReadUrl).toHaveBeenCalledWith(
      asset.blobPathname,
      "studio-test-store",
      AD_EVAL_EXPORT_IMAGE_VALID_MS,
    );
  });

  it("exports human choices, skips ties/both bad/judge-only data, and signs each candidate once", async () => {
    const a = adEvalAsset({
      adFeedback: [
        adFeedback({
          kind: "PAIRWISE",
          otherAssetId: "asset-b",
          thumb: null,
          outcome: "B",
        }),
        adFeedback({
          id: "tie",
          kind: "PAIRWISE",
          otherAssetId: "asset-b",
          thumb: null,
          outcome: "TIE",
        }),
        adFeedback({
          id: "bad",
          kind: "PAIRWISE",
          otherAssetId: "asset-b",
          thumb: null,
          outcome: "BOTH_BAD",
        }),
        adFeedback(),
      ],
    });
    const b = adEvalAsset({
      id: "asset-b",
      model: "muse-image",
      blobPathname: "projects/project-a/image-studio/job-b/image.png",
      prompt: "Different variation of the batch brief",
    });
    const judgeOnly = adEvalAsset({
      id: "asset-c",
      adEvals: [{ workspaceId: "workspace-a", overall: 5, judge: null }],
    });
    mocks.loadAdEvalAssets.mockResolvedValue([a, b, judgeOnly]);
    const { jsonl, manifest } = await exportAdminAdEvals();
    const rows = jsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: "pair",
      pair_id: "feedback-a",
      chosen: { asset_id: "asset-b" },
      rejected: { asset_id: "asset-a" },
      source: "human_pairwise",
      weight: 1,
    });
    expect(rows[1]).toMatchObject({ type: "rating", asset_id: "asset-a" });
    expect(mocks.privateBlobReadUrl).toHaveBeenCalledTimes(2);
    expect(manifest.rowCount).toBe(2);
  });

  it("creates controlled thumb contrasts and implicit dominance pairs with their planned weights", async () => {
    const thumbs = [
      adEvalAsset({ id: "thumb-good", adFeedback: [adFeedback()] }),
      adEvalAsset({ id: "thumb-bad", adFeedback: [adFeedback({ thumb: -1 })] }),
    ];
    const implicit = [
      adEvalAsset({
        id: "posted",
        prompt: "Another brief",
        adEvents: [
          {
            workspaceId: "workspace-a",
            type: "posted",
            createdAt: new Date("2026-11-13T09:00:00Z"),
          },
          {
            workspaceId: "other-workspace",
            type: "downloaded",
            createdAt: new Date("2030-01-01T10:00:00Z"),
          },
        ],
      }),
      adEvalAsset({
        id: "hidden",
        prompt: "Another brief",
        adEvents: [
          {
            workspaceId: "workspace-a",
            type: "hidden",
            createdAt: new Date("2026-11-13T09:30:00Z"),
          },
        ],
      }),
    ];
    mocks.loadAdEvalAssets.mockResolvedValue([...thumbs, ...implicit]);
    const { jsonl } = await exportAdminAdEvals();
    const rows = jsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.filter((row) => row.type === "pair")).toEqual([
      expect.objectContaining({
        chosen: expect.objectContaining({ asset_id: "thumb-good" }),
        rejected: expect.objectContaining({ asset_id: "thumb-bad" }),
        source: "human_pairwise",
        weight: 0.7,
      }),
      expect.objectContaining({
        chosen: expect.objectContaining({ asset_id: "posted" }),
        rejected: expect.objectContaining({ asset_id: "hidden" }),
        source: "implicit",
        weight: 0.5,
        created_at: "2026-11-13T09:30:00.000Z",
      }),
    ]);
  });

  it("does not pair across workspaces, projects, batches, prompts or placements", async () => {
    const good = adEvalAsset({ adFeedback: [adFeedback()] });
    const negative = adFeedback({ thumb: -1 });
    const others = [
      adEvalAsset({
        id: "workspace",
        workspaceId: "workspace-b",
        adFeedback: [adFeedback({ workspaceId: "workspace-b", thumb: -1 })],
      }),
      adEvalAsset({
        id: "project",
        projectId: "project-b",
        adFeedback: [adFeedback({ projectId: "project-b", thumb: -1 })],
      }),
      adEvalAsset({
        id: "batch",
        job: { ...good.job, batchId: "batch-b" },
        adFeedback: [negative],
      }),
      adEvalAsset({
        id: "prompt",
        prompt: "Different prompt",
        adFeedback: [negative],
      }),
      adEvalAsset({
        id: "placement",
        settings: { aspectRatio: "9:16" },
        adFeedback: [negative],
      }),
    ];
    mocks.loadAdEvalAssets.mockResolvedValue([good, ...others]);
    const { jsonl } = await exportAdminAdEvals();
    const rows = jsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.every((row) => row.type === "rating")).toBe(true);
  });

  it("rejects malformed cross-workspace feedback and never exports judge-only pairs", async () => {
    mocks.loadAdEvalAssets.mockResolvedValue([
      adEvalAsset({
        adFeedback: [
          adFeedback({ workspaceId: "workspace-b" }),
          adFeedback({
            kind: "PAIRWISE",
            thumb: null,
            outcome: "A",
            otherAssetId: "other",
          }),
        ],
      }),
      adEvalAsset({
        id: "other",
        workspaceId: "workspace-b",
        adEvals: [{ workspaceId: "workspace-b", overall: 5, judge: null }],
      }),
    ]);
    expect((await exportAdminAdEvals()).jsonl).toBe("");
  });

  it("keeps derived pairing linear in the number of batch assets", async () => {
    const assets = Array.from({ length: 20 }, (_, index) =>
      adEvalAsset({
        id: `asset-${index}`,
        adFeedback: [adFeedback({ thumb: index < 10 ? 1 : -1 })],
      }),
    );
    mocks.loadAdEvalAssets.mockResolvedValue(assets);
    const { jsonl } = await exportAdminAdEvals();
    const rows = jsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.filter((row) => row.type === "pair")).toHaveLength(10);
    expect(rows.filter((row) => row.type === "rating")).toHaveLength(20);
  });
});
