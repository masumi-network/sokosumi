import { beforeEach, describe, expect, it, vi } from "vitest";

const isEnabledMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { isEnabled: isEnabledMock },
}));

import { isNewsletterEnabled } from "./newsletter-access.server";

describe("isNewsletterEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])("returns Core's availability: %s", async (enabled) => {
    isEnabledMock.mockResolvedValue(enabled);

    await expect(isNewsletterEnabled()).resolves.toBe(enabled);
  });

  it("fails closed when availability cannot be loaded", async () => {
    isEnabledMock.mockRejectedValue(new Error("Core unavailable"));

    await expect(isNewsletterEnabled()).resolves.toBe(false);
  });
});
