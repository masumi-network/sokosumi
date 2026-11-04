import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
const isEnabledMock = vi.fn();

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { isEnabled: () => isEnabledMock() },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    redirectMock(url);
    throw new Error("NEXT_REDIRECT");
  },
}));

import NewsletterCalendarPage from "./page";

describe("NewsletterCalendarPage", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    isEnabledMock.mockResolvedValue(true);
  });

  it("is not found when the workspace has no Newsletter", async () => {
    isEnabledMock.mockResolvedValue(false);

    await expect(
      NewsletterCalendarPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("opens the Calendar on Newsletter issues for the Project in scope", async () => {
    await expect(
      NewsletterCalendarPage({
        searchParams: Promise.resolve({ projectId: "project-1" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith(
      "/calendar?types=newsletter&projectId=project-1",
    );
  });

  it("opens it on every Project when none is in scope", async () => {
    await expect(
      NewsletterCalendarPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith("/calendar?types=newsletter");
  });
});
