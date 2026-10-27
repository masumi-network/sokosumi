import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { revalidatePath } from "next/cache";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import en from "@/messages/en.json";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const m = vi.hoisted(() => ({
  submit: vi.fn(),
  approve: vi.fn(),
  schedule: vi.fn(),
  sendNow: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "App.Projects.Newsletter.Issues.Lifecycle",
    }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: <T extends object, R>(handler: (input: T) => Promise<R>) =>
    handler,
}));
vi.mock("@/lib/clients/core.client", async () => ({
  CoreApiRequestError: (await import("@/lib/clients/core.request"))
    .CoreApiRequestError,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    submitIssue: m.submit,
    approveIssue: m.approve,
    scheduleIssue: m.schedule,
    sendIssueNow: m.sendNow,
    cancelIssue: m.cancel,
  },
}));

import { changeNewsletterIssue } from "./issue-lifecycle";

const TARGET = {
  projectId: NEWSLETTER_PROJECT_ID,
  issueId: NEWSLETTER_ISSUE.id,
  revision: 2,
};
const COPY = en.App.Projects.Newsletter.Issues.Lifecycle;
beforeEach(() => {
  vi.resetAllMocks();
  Object.values(m).forEach((fn) =>
    fn.mockResolvedValue({ ...NEWSLETTER_ISSUE, taskId: "task_1" }),
  );
});

describe("newsletter lifecycle actions", () => {
  it.each(["submit", "approve", "sendNow", "cancel"] as const)(
    "calls Core for %s with its revision and refreshes affected surfaces",
    async (action) => {
      expect(await changeNewsletterIssue({ ...TARGET, action })).toMatchObject({
        ok: true,
      });
      expect(m[action]).toHaveBeenCalledWith(TARGET.projectId, TARGET.issueId, {
        revision: 2,
      });
      expect(revalidatePath).toHaveBeenCalledWith(
        "/newsletter/issues",
        "layout",
      );
      for (const path of ["/social", "/calendar", "/tasks/task_1"])
        expect(revalidatePath).toHaveBeenCalledWith(path);
    },
  );
  it("forwards the selected instant and time zone", async () => {
    const schedule = {
      scheduledAt: "2026-11-01T12:00:00.000Z",
      timezone: "Europe/Berlin",
    };
    await changeNewsletterIssue({ ...TARGET, action: "schedule", ...schedule });
    expect(m.schedule).toHaveBeenCalledWith(TARGET.projectId, TARGET.issueId, {
      revision: 2,
      ...schedule,
      scheduledAt: new Date(schedule.scheduledAt),
    });
  });
  it("validates ids, revisions, and schedule input before calling Core", async () => {
    for (const input of [
      { ...TARGET, projectId: "bad", action: "approve" as const },
      { ...TARGET, revision: -1, action: "approve" as const },
      { ...TARGET, action: "schedule" as const },
      {
        ...TARGET,
        action: "schedule" as const,
        scheduledAt: "bad",
        timezone: "UTC",
      },
    ])
      expect(await changeNewsletterIssue(input)).toMatchObject({ ok: false });
    Object.values(m).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });
  it.each([
    [CORE_API_ERROR_KINDS.NEWSLETTER_NO_ACTIVE_SUBSCRIBERS, COPY.noSubscribers],
    [CORE_API_ERROR_KINDS.NEWSLETTER_SENDER_NOT_CONFIGURED, COPY.noSender],
    [CORE_API_ERROR_KINDS.NEWSLETTER_APPROVAL_REQUIRED, COPY.approvalRequired],
    [undefined, COPY.conflict],
  ])("translates the Core conflict kind %s", async (kind, message) => {
    m.sendNow.mockRejectedValue(
      new CoreApiRequestError("Private details", { status: 409, kind }),
    );
    expect(
      await changeNewsletterIssue({ ...TARGET, action: "sendNow" }),
    ).toEqual({ ok: false, error: { message } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each([
    [403, COPY.humanRequired],
    [422, COPY.invalidSchedule],
    [503, COPY.error],
  ] as const)("handles %s errors", async (status, message) => {
    m.approve.mockRejectedValue(new CoreApiRequestError("Failure", { status }));
    expect(
      await changeNewsletterIssue({ ...TARGET, action: "approve" }),
    ).toEqual({ ok: false, error: { message } });
  });
});
