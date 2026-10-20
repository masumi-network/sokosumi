import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectFindUniqueMock, ssrfSafeFetchMock } = vi.hoisted(() => ({
  projectFindUniqueMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findUnique: projectFindUniqueMock },
  },
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import { LIMITS } from "@/config/constants";
import {
  applyStudioBrandPrompt,
  loadStudioBrand,
} from "@/lib/image-studio/studio-brand";

const DESIGN_MD_URL =
  "https://abc123.public.blob.vercel-storage.com/design-md/hash.md";

describe("applyStudioBrandPrompt", () => {
  it("leaves the brief alone when Design and Memory are empty", () => {
    expect(
      applyStudioBrandPrompt("a red fox", { designMd: null, memory: null }),
    ).toBe("a red fox");
    expect(
      applyStudioBrandPrompt("a red fox", { designMd: "  ", memory: "\n" }),
    ).toBe("a red fox");
  });

  it("prefixes Design and Memory and keeps the brief last", () => {
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: "# Brand\nUse crimson.",
        memory: "We never use serif.",
      }),
    ).toBe(
      [
        "Follow this project's brand.",
        "Design:\n# Brand\nUse crimson.",
        "Memory:\nWe never use serif.",
        "Brief:\na red fox",
      ].join("\n\n"),
    );
  });

  it("omits a missing half", () => {
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: "# Brand",
        memory: null,
      }),
    ).toContain("Design:\n# Brand");
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: "# Brand",
        memory: null,
      }),
    ).not.toContain("Memory:");
  });

  it("clips a long brand block", () => {
    const designMd = "x".repeat(2000);
    const prompt = applyStudioBrandPrompt("brief", { designMd, memory: null });
    expect(prompt).toContain("x".repeat(1600));
    expect(prompt).not.toContain("x".repeat(1601));
  });
});

describe("loadStudioBrand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads Memory from the project and Design from the blob", async () => {
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl: DESIGN_MD_URL,
      contextMd: "  We never use serif.  ",
    });
    ssrfSafeFetchMock.mockResolvedValue(
      new Response("# Brand\nUse crimson.", { status: 200 }),
    );

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: "# Brand\nUse crimson.",
      memory: "We never use serif.",
    });
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(DESIGN_MD_URL, {
      maxResponseBytes: LIMITS.DESIGN_MD_MAX_SIZE_BYTES,
    });
  });

  it("skips a Design URL that is not a stored blob", async () => {
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl: "https://evil.example/design-md/hash.md",
      contextMd: "Keep the fox.",
    });

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: "Keep the fox.",
    });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("fails open when the project or Design cannot be read", async () => {
    projectFindUniqueMock.mockRejectedValue(new Error("db down"));
    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: null,
    });

    projectFindUniqueMock.mockResolvedValue({
      designMdUrl: DESIGN_MD_URL,
      contextMd: "Keep the fox.",
    });
    ssrfSafeFetchMock.mockRejectedValue(new Error("blocked"));
    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: "Keep the fox.",
    });
  });
});
