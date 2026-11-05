import { revalidatePath } from "next/cache";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import en from "@/messages/en.json";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "App.Projects.Newsletter.Issues",
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
  newsletterService: {
    createIssue: mocks.create,
    saveIssue: mocks.save,
    deleteIssue: mocks.remove,
  },
}));

import {
  createNewsletterIssue,
  deleteNewsletterIssue,
  saveNewsletterIssue,
} from "./issues";

const VALUES = {
  subject: " Updated issue ",
  previewText: "Preview",
  template: "TEXT",
  content: [{ type: "text", text: "News" }],
};
const TARGET = {
  projectId: NEWSLETTER_PROJECT_ID,
  issueId: NEWSLETTER_ISSUE.id,
};
const COPY = en.App.Projects.Newsletter.Issues;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(NEWSLETTER_ISSUE);
  mocks.save.mockResolvedValue(NEWSLETTER_ISSUE);
});

describe("newsletter issue actions", () => {
  it("creates through Core, strips extra fields, and revalidates the list", async () => {
    expect(
      await createNewsletterIssue({
        projectId: TARGET.projectId,
        values: { ...VALUES, status: "SENT" },
      }),
    ).toEqual({ ok: true, value: NEWSLETTER_ISSUE });
    expect(mocks.create).toHaveBeenCalledWith(TARGET.projectId, {
      ...VALUES,
      subject: "Updated issue",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/newsletter/issues", "layout");
  });
  it("saves using the current revision", async () => {
    expect(
      await saveNewsletterIssue({ ...TARGET, values: VALUES, revision: 2 }),
    ).toEqual({ ok: true, value: NEWSLETTER_ISSUE });
    expect(mocks.save).toHaveBeenCalledWith(TARGET.projectId, TARGET.issueId, {
      ...VALUES,
      subject: "Updated issue",
      revision: 2,
    });
  });
  it.each([
    { ...VALUES, subject: "" },
    {
      ...VALUES,
      content: [{ type: "image", url: "http://example.com/a.png", alt: "" }],
    },
    {
      ...VALUES,
      content: [{ type: "button", label: "Read", url: "javascript:alert(1)" }],
    },
    { ...VALUES, content: [{ type: "heading", text: "Hi", level: 3 }] },
  ])("validates shared content at the action boundary", async (values) => {
    expect(
      await createNewsletterIssue({ projectId: TARGET.projectId, values }),
    ).toMatchObject({ ok: false });
    expect(
      await saveNewsletterIssue({ ...TARGET, values, revision: 2 }),
    ).toMatchObject({ ok: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects malformed targets and revisions", async () => {
    expect(
      await createNewsletterIssue({ projectId: "bad", values: VALUES }),
    ).toMatchObject({ ok: false });
    for (const revision of [undefined, -1, "2"])
      expect(
        await saveNewsletterIssue({ ...TARGET, values: VALUES, revision }),
      ).toMatchObject({ ok: false });
    expect(
      await deleteNewsletterIssue({ ...TARGET, issueId: "bad" }),
    ).toMatchObject({ ok: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([409, 403, 500])(
    "returns a translated save error for %i without invalidating data",
    async (status) => {
      mocks.save.mockRejectedValue(
        new CoreApiRequestError("Private Core detail", { status }),
      );
      expect(
        await saveNewsletterIssue({ ...TARGET, values: VALUES, revision: 2 }),
      ).toEqual({
        ok: false,
        error: { message: status === 409 ? COPY.conflict : COPY.saveError },
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
  it("deletes the draft through Core and handles create/delete failures", async () => {
    expect(await deleteNewsletterIssue(TARGET)).toEqual({
      ok: true,
      value: null,
    });
    expect(mocks.remove).toHaveBeenCalledWith(TARGET.projectId, TARGET.issueId);
    mocks.remove.mockRejectedValue(new Error("Unavailable"));
    expect(await deleteNewsletterIssue(TARGET)).toEqual({
      ok: false,
      error: { message: COPY.Delete.error },
    });
    mocks.create.mockRejectedValue(new Error("Unavailable"));
    expect(
      await createNewsletterIssue({
        projectId: TARGET.projectId,
        values: VALUES,
      }),
    ).toEqual({ ok: false, error: { message: COPY.createError } });
  });
});
