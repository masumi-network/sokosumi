import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";

const core = vi.hoisted(() => ({
  getNewsletterAvailability: vi.fn(),
  getProjectsByIdNewsletter: vi.fn(),
  putProjectsByIdNewsletter: vi.fn(),
}));
vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await import("@/lib/clients/core.request");
  return { coreClient: core, CoreApiRequestError };
});

import { newsletterService } from "./newsletter.service";

beforeEach(() => vi.resetAllMocks());

describe("newsletterService", () => {
  it.each([true, false])("reads enabled=%s from Core", async (enabled) => {
    core.getNewsletterAvailability.mockResolvedValue({ data: { enabled } });
    expect(await newsletterService.isEnabled()).toBe(enabled);
  });

  it("propagates availability failures", async () => {
    core.getNewsletterAvailability.mockRejectedValue(new Error("Core down"));
    await expect(newsletterService.isEnabled()).rejects.toThrow("Core down");
  });

  it("returns no settings only for a missing newsletter", async () => {
    core.getProjectsByIdNewsletter.mockRejectedValue(
      new CoreApiRequestError("Missing", { status: 404 }),
    );
    expect(await newsletterService.getSettings("p1")).toBeNull();
    expect(core.getProjectsByIdNewsletter).toHaveBeenCalledWith("p1");
  });

  it.each([403, 500])(
    "propagates a %i instead of showing a setup form",
    async (status) => {
      const error = new CoreApiRequestError("Failed", { status });
      core.getProjectsByIdNewsletter.mockRejectedValue(error);
      await expect(newsletterService.getSettings("p1")).rejects.toBe(error);
    },
  );

  it("returns Core settings directly", async () => {
    const settings = { id: "n1" };
    core.getProjectsByIdNewsletter.mockResolvedValue({ data: settings });
    expect(await newsletterService.getSettings("p1")).toBe(settings);
  });

  it("saves through Core and returns the saved settings", async () => {
    const input = {
      name: "Weekly",
      senderName: "Team",
      replyTo: "team@example.com",
      brand: {},
      welcomeEmailEnabled: false,
    };
    const settings = { ...input, publicSlug: "weekly-123" };
    core.putProjectsByIdNewsletter.mockResolvedValue({ data: settings });
    expect(await newsletterService.saveSettings("p1", input)).toBe(settings);
    expect(core.putProjectsByIdNewsletter).toHaveBeenCalledWith("p1", input);
  });

  it("propagates save failures", async () => {
    core.putProjectsByIdNewsletter.mockRejectedValue(new Error("Save failed"));
    await expect(
      newsletterService.saveSettings("p1", {
        name: "Weekly",
        senderName: "Team",
        replyTo: "team@example.com",
        brand: {},
        welcomeEmailEnabled: false,
      }),
    ).rejects.toThrow("Save failed");
  });
});
