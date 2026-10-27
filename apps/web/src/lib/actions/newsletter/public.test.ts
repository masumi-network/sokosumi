import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEWSLETTER_ISSUE,
  PUBLIC_NEWSLETTER_ISSUE_SUMMARY,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { listPublicIssues: mocks.list },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

import { loadPublicNewsletterIssues } from "./public";

const INPUT = { slug: PUBLIC_NEWSLETTER_SLUG, cursor: NEWSLETTER_ISSUE.id };
beforeEach(() => vi.resetAllMocks());

describe("public archive pagination action", () => {
  it("loads sent issues without requiring a session and preserves cursor metadata", async () => {
    const response = {
      data: [PUBLIC_NEWSLETTER_ISSUE_SUMMARY],
      meta: { pagination: { nextCursor: null } },
    };
    mocks.list.mockResolvedValue(response);
    expect(await loadPublicNewsletterIssues(INPUT)).toEqual({
      ok: true,
      value: response,
    });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(INPUT.slug, {
      cursor: INPUT.cursor,
    });
  });

  it.each([
    { ...INPUT, slug: "" },
    { ...INPUT, slug: "a".repeat(301) },
    { ...INPUT, cursor: "bad" },
  ])("validates action input before Core access: %j", async (input) => {
    expect(await loadPublicNewsletterIssues(input)).toEqual({
      ok: false,
      error: { message: "loadError" },
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("handles missing newsletters and the disabled flag", async () => {
    mocks.list.mockResolvedValue(null);
    expect(await loadPublicNewsletterIssues(INPUT)).toEqual({
      ok: false,
      error: { message: "unavailable" },
    });
  });

  it("returns a translated error without exposing Core errors", async () => {
    mocks.list.mockRejectedValue(new Error("Internal details"));
    expect(await loadPublicNewsletterIssues(INPUT)).toEqual({
      ok: false,
      error: { message: "loadError" },
    });
  });
});
