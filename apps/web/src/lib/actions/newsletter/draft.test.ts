import { newsletterDraftInputSchema } from "@sokosumi/utils";
import { revalidatePath } from "next/cache";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import en from "@/messages/en.json";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const m = vi.hoisted(() => ({ draft: vi.fn(), images: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "App.Projects.Newsletter.Issues.Ai",
    }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: <T extends object, R>(handler: (params: T) => Promise<R>) =>
    handler,
}));
vi.mock("@/lib/clients/core.client", async () => ({
  CoreApiRequestError: (await import("@/lib/clients/core.request"))
    .CoreApiRequestError,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { draftIssue: m.draft },
}));
vi.mock("@/lib/services/image-studio.service", () => ({
  imageStudioService: { getState: m.images },
}));

import { draftNewsletterIssue, getNewsletterDraftImages } from "./draft";

const COPY = en.App.Projects.Newsletter.Issues.Ai;
beforeEach(() => {
  vi.resetAllMocks();
  m.draft.mockResolvedValue(NEWSLETTER_ISSUE);
  m.images.mockResolvedValue({ assets: [] });
});
describe("newsletter AI actions", () => {
  it("validates a brief, supplies defaults, calls Core, and revalidates the issue list", async () => {
    const values = { brief: "  Launch news  " };
    expect(
      await draftNewsletterIssue({ projectId: NEWSLETTER_PROJECT_ID, values }),
    ).toEqual({ ok: true, value: NEWSLETTER_ISSUE });
    expect(m.draft).toHaveBeenCalledExactlyOnceWith(
      NEWSLETTER_PROJECT_ID,
      newsletterDraftInputSchema.parse(values),
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/projects/${NEWSLETTER_PROJECT_ID}/newsletter/issues`,
    );
  });
  it("forwards all source choices, template and selected asset ids", async () => {
    const values = {
      brief: "Launch",
      useProjectMemory: true,
      useRecentSocialPosts: false,
      template: "IMAGES",
      imageIds: [NEWSLETTER_ISSUE.id],
    };
    await draftNewsletterIssue({ projectId: NEWSLETTER_PROJECT_ID, values });
    expect(m.draft).toHaveBeenCalledWith(NEWSLETTER_PROJECT_ID, values);
  });
  it.each([
    {},
    { brief: " " },
    { brief: "Launch", imageIds: ["bad"] },
    { brief: "Launch", status: "SENT" },
    { brief: "Launch", approve: true },
    { brief: "Launch", scheduledAt: "2026-11-01" },
  ])("rejects invalid or delivery inputs %# before Core", async (values) => {
    expect(
      await draftNewsletterIssue({ projectId: NEWSLETTER_PROJECT_ID, values }),
    ).toMatchObject({ ok: false, error: { message: COPY.invalid } });
    expect(m.draft).not.toHaveBeenCalled();
  });
  it("rejects malformed project ids for generation and image selection", async () => {
    expect(
      await draftNewsletterIssue({
        projectId: "bad",
        values: { brief: "Launch" },
      }),
    ).toMatchObject({ ok: false });
    expect(await getNewsletterDraftImages({ projectId: "bad" })).toMatchObject({
      ok: false,
    });
    expect(m.draft).not.toHaveBeenCalled();
    expect(m.images).not.toHaveBeenCalled();
  });
  it.each([
    new Error("Network"),
    new CoreApiRequestError("Rate limit", { status: 429 }),
  ])("returns translated generation errors", async (error) => {
    m.draft.mockRejectedValue(error);
    expect(
      await draftNewsletterIssue({
        projectId: NEWSLETTER_PROJECT_ID,
        values: { brief: "Launch" },
      }),
    ).toEqual({
      ok: false,
      error: {
        message:
          error instanceof CoreApiRequestError ? COPY.rateLimited : COPY.error,
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("loads recent images through the existing Content Studio service", async () => {
    const images = Array.from({ length: 35 }, (_, id) => ({
      id: String(id),
      contentType: "image/png",
    }));
    const videos = Array.from({ length: 30 }, (_, id) => ({
      id: `video-${id}`,
      contentType: "video/mp4",
    }));
    m.images.mockResolvedValue({ assets: [...videos, ...images] });
    expect(
      await getNewsletterDraftImages({ projectId: NEWSLETTER_PROJECT_ID }),
    ).toEqual({ ok: true, value: images.slice(0, 30) });
    expect(m.images).toHaveBeenCalledExactlyOnceWith(NEWSLETTER_PROJECT_ID);
    m.images.mockRejectedValue(new Error("Unavailable"));
    expect(
      await getNewsletterDraftImages({ projectId: NEWSLETTER_PROJECT_ID }),
    ).toEqual({ ok: false, error: { message: COPY.imagesError } });
  });
});
