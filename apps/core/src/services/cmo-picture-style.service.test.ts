import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  project: { findUnique: vi.fn(), update: vi.fn() },
  referenceImage: { findUnique: vi.fn(), update: vi.fn() },
  readDesignMd: vi.fn(),
  describeStyle: vi.fn(),
  describeComposition: vi.fn(),
  readReference: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { project: m.project, referenceImage: m.referenceImage },
}));
vi.mock("@/lib/design-md-blob", () => ({
  readDesignMdContent: m.readDesignMd,
}));
vi.mock("@/lib/reference-library/layout", async (original) => ({
  ...(await original<typeof import("@/lib/reference-library/layout")>()),
  describeBrandPictureStyle: m.describeStyle,
  describeComposition: m.describeComposition,
}));
vi.mock("@/services/reference-library.service", () => ({
  readReferenceImage: m.readReference,
}));

import {
  cmoPictureStyle,
  referenceComposition,
} from "./cmo-picture-style.service";

beforeEach(() => vi.clearAllMocks());

describe("a brand's picture style", () => {
  it("is written once from its DESIGN.md and kept until the DESIGN.md changes", async () => {
    m.project.findUnique.mockResolvedValue({
      designMdUrl: "https://x/design.md",
      cmoPictureStyle: null,
      cmoPictureStyleSource: null,
    });
    m.readDesignMd.mockResolvedValue("# NMKR");
    m.describeStyle.mockResolvedValue({
      text: "Flat, green leads.",
      costUsd: 0.003,
    });
    await expect(cmoPictureStyle("p1", ["#11f250"])).resolves.toEqual({
      text: "Flat, green leads.",
      costUsd: 0.003,
    });
    expect(m.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          cmoPictureStyle: "Flat, green leads.",
          cmoPictureStyleSource: "https://x/design.md",
        },
      }),
    );
    m.project.findUnique.mockResolvedValue({
      designMdUrl: "https://x/design.md",
      cmoPictureStyle: "Flat, green leads.",
      cmoPictureStyleSource: "https://x/design.md",
    });
    await cmoPictureStyle("p1", ["#11f250"]);
    expect(m.describeStyle).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain modern look in the brand's colours without a DESIGN.md", async () => {
    m.project.findUnique.mockResolvedValue({
      designMdUrl: null,
      cmoPictureStyle: null,
      cmoPictureStyleSource: null,
    });
    m.readDesignMd.mockResolvedValue(null);
    const style = await cmoPictureStyle("p1", ["#ff51ff", "#000000"]);
    expect(style.text).toContain("#ff51ff leading");
    expect(m.describeStyle).not.toHaveBeenCalled();
  });
});

describe("a reference's composition", () => {
  it("is described once and kept on the reference", async () => {
    m.referenceImage.findUnique.mockResolvedValueOnce({
      composition: null,
      layout: "two figures carrying planks",
    });
    m.readReference.mockResolvedValue({ bytes: Buffer.from("x") });
    m.describeComposition.mockResolvedValue({
      text: "Headline band on top.",
      costUsd: 0.004,
    });
    await expect(referenceComposition("r1")).resolves.toEqual({
      text: "Headline band on top.",
      costUsd: 0.004,
    });
    expect(m.referenceImage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { composition: "Headline band on top." },
      }),
    );
    m.referenceImage.findUnique.mockResolvedValueOnce({
      composition: "Headline band on top.",
      layout: "x",
    });
    await expect(referenceComposition("r1")).resolves.toEqual({
      text: "Headline band on top.",
      costUsd: 0,
    });
  });
});
