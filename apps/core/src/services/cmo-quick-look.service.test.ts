import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  brainFindUnique,
  brainUpsert,
  resetCmoServiceMocks,
} from "@/test-fixtures/cmo-service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
const { recordCheckUsage } = vi.hoisted(() => ({ recordCheckUsage: vi.fn() }));
vi.mock("@/services/soko-bot-billing.service", () => ({
  recordSokoBotCheckUsage: recordCheckUsage,
}));

import { writeCmoQuickLook } from "./cmo-quick-look.service";

const CUSO = {
  sokoBotId: "bot-1",
  projectId: "project-1",
  businessName: "Acme",
  websiteUrl: "https://acme.io",
};
const look = {
  line: "Acme sells rockets to founders who ship every week.",
  facts: ["From 9 dollars a month", "Based in Berlin"],
};

beforeEach(() => {
  resetCmoServiceMocks();
  brainFindUnique.mockResolvedValue(null);
});

describe("writeCmoQuickLook", () => {
  it("saves a first look from the homepage, charged to Cuso's payer", async () => {
    const readHomepage = vi.fn(async () => "Acme. Rockets for founders.");
    const ask = vi.fn(async () => ({ look, costUsd: 0.002 }));

    await expect(
      writeCmoQuickLook(CUSO, { readHomepage, ask }),
    ).resolves.toEqual(look);

    expect(readHomepage).toHaveBeenCalledWith("https://acme.io");
    expect(ask).toHaveBeenCalledWith({
      businessName: "Acme",
      websiteUrl: "https://acme.io",
      text: "Acme. Rockets for founders.",
    });
    expect(brainUpsert.mock.calls[0]?.[0].update.body.preview).toEqual(look);
    expect(recordCheckUsage).toHaveBeenCalledWith({
      sokoBotId: "bot-1",
      key: "cmo-quick-look:bot-1",
      costUsd: 0.002,
    });
  });

  it("asks no model when the homepage cannot be read", async () => {
    const ask = vi.fn();
    await expect(
      writeCmoQuickLook(CUSO, { readHomepage: async () => null, ask }),
    ).resolves.toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(brainUpsert).not.toHaveBeenCalled();
  });

  it("leaves the preview empty, without throwing, when the model fails", async () => {
    const ask = vi.fn(async () => {
      throw new Error("Gateway timeout");
    });
    await expect(
      writeCmoQuickLook(CUSO, { readHomepage: async () => "Acme", ask }),
    ).resolves.toBeNull();
    expect(brainUpsert).not.toHaveBeenCalled();
  });

  it("leaves the preview empty when the answer does not fit", async () => {
    const ask = vi.fn(async () => ({ look: { line: "" }, costUsd: 0 }));
    await expect(
      writeCmoQuickLook(CUSO, { readHomepage: async () => "Acme", ask }),
    ).resolves.toBeNull();
    expect(brainUpsert).not.toHaveBeenCalled();
  });

  it("writes nothing once the research saved the essentials", async () => {
    brainFindUnique.mockResolvedValue({
      body: {
        summary: "Acme sells rockets.",
        voice: { tone: "Direct", do: [], dont: [], examples: [] },
        audience: [],
        products: [],
        competitors: [],
        channels: [],
        profile: {},
      },
    });
    await expect(
      writeCmoQuickLook(CUSO, {
        readHomepage: async () => "Acme",
        ask: async () => ({ look, costUsd: 0 }),
      }),
    ).resolves.toBeNull();
    expect(brainUpsert).not.toHaveBeenCalled();
  });
});
