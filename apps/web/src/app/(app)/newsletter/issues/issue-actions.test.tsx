import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const m = vi.hoisted(() => ({
  change: vi.fn(),
  refresh: vi.fn(),
  changed: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh }),
}));
vi.mock("@/lib/actions/newsletter/issue-lifecycle", () => ({
  changeNewsletterIssue: m.change,
}));

import { IssueActions } from "./issue-actions";

const COPY = en.App.Projects.Newsletter.Issues.Lifecycle;
const APPROVED = {
  ...NEWSLETTER_ISSUE,
  status: "NEEDS_APPROVAL" as const,
  approvedAt: new Date("2026-10-23T10:00:00Z"),
  approvedByUserId: "user_1",
  approvedByName: "Ada",
  taskId: "task_1",
};
function show(
  issue = NEWSLETTER_ISSUE,
  disabled = false,
  locale: "en" | "de" | "es" = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ en, de, es }[locale]}
      timeZone="UTC"
      formats={{
        dateTime: { dateTime: { dateStyle: "medium", timeStyle: "short" } },
      }}
    >
      <IssueActions
        issue={issue}
        projectId={NEWSLETTER_PROJECT_ID}
        activeSubscribers={3}
        onChanged={m.changed}
        disabled={disabled}
      />
    </NextIntlClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  m.change.mockResolvedValue({ ok: true, value: APPROVED });
});

describe("newsletter issue actions", () => {
  it("submits a draft with its revision and disables the action while it is dirty", async () => {
    const user = userEvent.setup();
    const view = show();
    await user.click(screen.getByRole("button", { name: COPY.submit }));
    expect(m.change).toHaveBeenCalledWith({
      projectId: NEWSLETTER_PROJECT_ID,
      issueId: NEWSLETTER_ISSUE.id,
      revision: NEWSLETTER_ISSUE.revision,
      action: "submit",
    });
    await waitFor(() => expect(m.changed).toHaveBeenCalledWith(APPROVED));
    view.unmount();
    show(NEWSLETTER_ISSUE, true);
    expect(screen.getByRole("button", { name: COPY.submit })).toBeDisabled();
  });
  it("shows approval only while awaiting a person's decision", async () => {
    const user = userEvent.setup();
    show({ ...NEWSLETTER_ISSUE, status: "NEEDS_APPROVAL" });
    expect(
      screen.queryByRole("button", { name: COPY.schedule }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: COPY.approve }));
    expect(m.change).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approve" }),
    );
  });
  it("shows the approver, time, and linked approval Task", () => {
    show(APPROVED);
    expect(screen.getByText(/Approved by Ada on/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.task })).toHaveAttribute(
      "href",
      "/tasks/task_1",
    );
    expect(
      screen.queryByRole("button", { name: COPY.approve }),
    ).not.toBeInTheDocument();
  });
  it("confirms the active subscriber count before sending and keeps a failed dialog open", async () => {
    const user = userEvent.setup();
    show(APPROVED);
    await user.click(screen.getByRole("button", { name: COPY.sendNow }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("3 active subscribers");
    expect(m.change).not.toHaveBeenCalled();
    m.change.mockResolvedValueOnce({
      ok: false,
      error: { message: COPY.noSender },
    });
    await user.click(
      within(dialog).getByRole("button", { name: COPY.sendNow }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(COPY.noSender);
    expect(m.refresh).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: COPY.sendNow }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(m.change).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "sendNow",
        revision: APPROVED.revision,
      }),
    );
  });
  it("reuses Social's schedule picker and includes the browser time zone", async () => {
    const user = userEvent.setup();
    show(APPROVED);
    await user.click(screen.getByRole("button", { name: COPY.schedule }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Time zone:");
    await user.click(
      within(dialog).getByRole("button", { name: COPY.schedule }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      COPY.invalidSchedule,
    );
    await user.click(within(dialog).getByRole("button", { name: /Tomorrow/ }));
    await user.click(
      within(dialog).getByRole("button", { name: COPY.schedule }),
    );
    await waitFor(() =>
      expect(m.change).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "schedule",
          scheduledAt: expect.stringMatching(/Z$/),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      ),
    );
  });
  it("confirms cancellation and exposes no action while sending or sent", async () => {
    const user = userEvent.setup();
    const view = show({ ...APPROVED, status: "SCHEDULED" });
    await user.click(screen.getByRole("button", { name: COPY.cancel }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: COPY.cancel,
      }),
    );
    expect(m.change).toHaveBeenCalledWith(
      expect.objectContaining({ action: "cancel" }),
    );
    view.unmount();
    show({ ...NEWSLETTER_ISSUE, status: "SENDING" });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
  it.each(["schedule", "sendNow", "cancel"] as const)(
    "restores focus after dismissing %s",
    async (action) => {
      const user = userEvent.setup();
      show(
        action === "cancel" ? { ...APPROVED, status: "SCHEDULED" } : APPROVED,
      );
      const trigger = screen.getByRole("button", { name: COPY[action] });
      await user.click(trigger);
      const dialog = screen.getByRole(
        action === "schedule" ? "dialog" : "alertdialog",
      );
      expect(dialog).toBeVisible();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );
  it.each(["de", "es"] as const)(
    "renders translated actions in %s",
    (locale) => {
      show(NEWSLETTER_ISSUE, false, locale);
      expect(
        screen.getByRole("button", {
          name: { de, es }[locale].App.Projects.Newsletter.Issues.Lifecycle
            .submit,
        }),
      ).toBeInTheDocument();
    },
  );
});
