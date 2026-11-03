import type { NewsletterIssue } from "@sokosumi/core-client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  NEWSLETTER,
  NEWSLETTER_ISSUE,
  NEWSLETTER_PROJECT_ID,
  NEWSLETTER_SENDING_DOMAIN_STATE,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  change: vi.fn(),
  refresh: vi.fn(),
  saveSettings: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/actions/newsletter/issue-lifecycle", () => ({
  changeNewsletterIssue: mocks.change,
}));
vi.mock("@/lib/actions/newsletter/issues", () => ({
  saveNewsletterIssue: mocks.save,
}));
vi.mock("@/lib/actions/newsletter/action", () => ({
  saveNewsletterSettings: mocks.saveSettings,
}));
vi.mock("./issue-preview", () => ({
  NewsletterIssuePreview: (props: unknown) => {
    mocks.preview(props);
    return <aside>Preview</aside>;
  },
}));

import { NewsletterIssueEditor } from "./issue-editor";

function renderEditor(
  issue = NEWSLETTER_ISSUE,
  locale: "en" | "de" | "es" = "en",
  draftedBySokoBot = false,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ en, de, es }[locale]}>
      <NewsletterIssueEditor
        projectId={NEWSLETTER_PROJECT_ID}
        issue={issue}
        activeSubscribers={3}
        newsletter={NEWSLETTER}
        sendingDomain={NEWSLETTER_SENDING_DOMAIN_STATE}
        draftedBySokoBot={draftedBySokoBot}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockImplementation(async ({ values, revision }) => ({
    ok: true,
    value: {
      ...NEWSLETTER_ISSUE,
      ...values,
      status: "DRAFT",
      revision: revision + 1,
    },
  }));
});

describe("newsletter issue editor", () => {
  it("puts the writing surface first and readiness in the Send panel", () => {
    renderEditor();
    const panel = screen.getByRole("complementary", { name: "Send" });
    const readiness = within(panel).getByRole("region", {
      name: "Before sending",
    });
    const details = screen.getByRole("region", { name: "Issue details" });
    expect(within(details).getByLabelText("Subject")).toBeInTheDocument();
    expect(
      within(readiness).getByText("3 active subscribers"),
    ).toBeInTheDocument();
    expect(
      details.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(panel).getByText("Draft")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Save issue" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Submit for approval" }),
    ).toBeEnabled();
  });

  it("restores edited blocks in reverse removal order, even after saving", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText("Text"), " with new writing");
    await user.click(screen.getByRole("button", { name: "Remove block 2" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Undo removal" }),
      ).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Remove block 2" }));
    expect(screen.getByText("2 blocks removed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() =>
      expect(screen.getByText("All changes saved")).toBeInTheDocument(),
    );
    expect(screen.getByText("2 blocks removed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo removal" }));
    expect(screen.getByText("1 block removed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo removal" }));
    const items = within(
      screen.getByRole("list", { name: "Content blocks" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[1]).getByLabelText("Text")).toHaveValue(
      "Our latest update with new writing",
    );
    expect(
      screen.queryByRole("button", { name: "Undo removal" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          revision: 3,
          values: expect.objectContaining({
            content: [
              NEWSLETTER_ISSUE.content[0],
              { type: "text", text: "Our latest update with new writing" },
              NEWSLETTER_ISSUE.content[2],
            ],
          }),
        }),
      ),
    );
  });

  it("keeps Undo and writing disabled while saving", async () => {
    const deferred = Promise.withResolvers<{
      ok: true;
      value: NewsletterIssue;
    }>();
    mocks.save.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Remove block 3" }));
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    expect(
      screen.getByText(en.App.Projects.Newsletter.Issues.saving),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo removal" })).toBeDisabled();
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    await act(async () =>
      deferred.resolve({
        ok: true,
        value: {
          ...NEWSLETTER_ISSUE,
          content: NEWSLETTER_ISSUE.content.slice(0, 2),
          revision: 3,
        },
      }),
    );
    expect(screen.getByRole("button", { name: "Undo removal" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Undo removal" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move block 3 up" }),
      ).toHaveFocus(),
    );
  });

  it("offers AI drafting in an empty editor and shows the review notice", () => {
    renderEditor({ ...NEWSLETTER_ISSUE, content: [] }, "en", true);
    expect(
      screen.getByRole("button", {
        name: en.App.Projects.Newsletter.Issues.Ai.action,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      en.App.Projects.Newsletter.Issues.Ai.notice,
    );
  });
  it.each([
    "SENT",
    "DRAFT",
    "NEEDS_APPROVAL",
    "SCHEDULED",
    "SENDING",
    "FAILED",
    "CANCELED",
  ] as const)("shows View on web only for SENT issues: %s", (status) => {
    renderEditor({ ...NEWSLETTER_ISSUE, status });
    const link = screen.queryByRole("link", { name: "View on web" });
    if (status === "SENT") {
      expect(link).toHaveAttribute(
        "href",
        `/n/${PUBLIC_NEWSLETTER_SLUG}/p/${NEWSLETTER_ISSUE.publicSlug}`,
      );
    } else expect(link).not.toBeInTheDocument();
  });

  it("saves edited fields with the current revision and marks later edits dirty", async () => {
    const user = userEvent.setup();
    renderEditor({ ...NEWSLETTER_ISSUE, status: "NEEDS_APPROVAL" });
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Subject"));
    await user.type(screen.getByLabelText("Subject"), "New subject");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() =>
      expect(screen.getByText("All changes saved")).toBeInTheDocument(),
    );
    expect(mocks.save).toHaveBeenLastCalledWith({
      projectId: NEWSLETTER_PROJECT_ID,
      issueId: NEWSLETTER_ISSUE.id,
      revision: 2,
      values: expect.objectContaining({ subject: "New subject" }),
    });
    expect(screen.getByText("Draft")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Preview text"), " More");
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ revision: 3 }),
      ),
    );
  });

  it("moves blocks, removes one, and adds each supported type", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Move block 2 up" }));
    let items = within(
      screen.getByRole("list", { name: "Content blocks" }),
    ).getAllByRole("listitem");
    expect(within(items[0]).getByLabelText("Text")).toHaveValue(
      "Our latest update",
    );
    await user.click(screen.getByRole("button", { name: "Move block 1 down" }));
    await user.click(screen.getByRole("button", { name: "Remove block 3" }));
    const library = screen.getByRole("region", { name: "Add block" });
    for (const type of ["Heading", "Text", "Image", "Button", "Divider"]) {
      await user.click(within(library).getByRole("button", { name: type }));
    }
    items = within(
      screen.getByRole("list", { name: "Content blocks" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(screen.getByLabelText("Image URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Alt text")).toBeInTheDocument();
    expect(screen.getByLabelText("Link URL (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Button label")).toBeInTheDocument();
    expect(screen.getByLabelText("Button URL")).toBeInTheDocument();
  });

  it("validates HTTPS links with translated inline errors and drops a cleared optional link", async () => {
    const user = userEvent.setup();
    renderEditor({
      ...NEWSLETTER_ISSUE,
      content: [
        {
          type: "image",
          url: "https://example.com/a.png",
          alt: "Cover",
          href: "https://example.com",
        },
        { type: "button", label: "Read", url: "https://example.com" },
      ],
    });
    await user.clear(screen.getByLabelText("Image URL"));
    await user.type(
      screen.getByLabelText("Image URL"),
      "http://example.com/a.png",
    );
    await user.clear(screen.getByLabelText("Button URL"));
    await user.type(screen.getByLabelText("Button URL"), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    expect(
      await screen.findAllByText(
        en.App.Projects.Newsletter.Issues.Validation.content,
      ),
    ).toHaveLength(2);
    expect(screen.getByLabelText("Image URL")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Image URL"), {
      target: { value: "https://example.com/a.png" },
    });
    fireEvent.change(screen.getByLabelText("Button URL"), {
      target: { value: "https://example.com/read" },
    });
    await user.clear(screen.getByLabelText("Link URL (optional)"));
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const saved = mocks.save.mock.calls[0][0].values.content[0];
    expect(saved.href).toBeUndefined();
  });

  it("preserves edits on a revision conflict and when the action throws", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({
      ok: false,
      error: { message: en.App.Projects.Newsletter.Issues.conflict },
    });
    renderEditor();
    await user.type(screen.getByLabelText("Subject"), " Changed");
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.App.Projects.Newsletter.Issues.conflict,
    );
    expect(screen.getByLabelText("Subject")).toHaveValue("Weekly news Changed");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    mocks.save.mockRejectedValue(new Error("Network"));
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        en.App.Projects.Newsletter.Issues.saveError,
      ),
    );
    expect(mocks.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 2 }),
    );
  });

  it.each([
    "SCHEDULED",
    "SENDING",
    "SENT",
    "FAILED",
    "CANCELED",
  ] satisfies NewsletterIssue["status"][])("makes %s read-only", (status) => {
    renderEditor({ ...NEWSLETTER_ISSUE, status });
    expect(
      screen.getByText(en.App.Projects.Newsletter.Issues.readOnly),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Heading level" }),
    ).toHaveAttribute("disabled");
    expect(
      screen.queryByRole("button", { name: "Save issue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Add block" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove block 1" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["de", de],
    ["es", es],
  ] as const)("renders %s labels and validation", async (locale, messages) => {
    const user = userEvent.setup();
    renderEditor(NEWSLETTER_ISSUE, locale);
    const copy = messages.App.Projects.Newsletter.Issues;
    await user.clear(screen.getByLabelText(copy.subject));
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(
      await screen.findByText(copy.Validation.subject),
    ).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["FAILED", "SENT"] as const)(
    "explains a %s delivery without exposing a resend action",
    (status) => {
      renderEditor({
        ...NEWSLETTER_ISSUE,
        status,
        lastError: "Provider could not confirm delivery",
      });
      expect(
        screen.getByText(/Provider could not confirm delivery/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", {
          name: en.App.Projects.Newsletter.Issues.Delivery.reviewSettings,
        }),
      ).toHaveAttribute(
        "href",
        `/newsletter/settings?projectId=${NEWSLETTER_PROJECT_ID}`,
      );
      expect(
        screen.queryByRole("button", { name: "Send now" }),
      ).not.toBeInTheDocument();
      if (status === "SENT")
        expect(
          screen.getByText(en.App.Projects.Newsletter.Issues.Delivery.partial),
        ).toBeInTheDocument();
    },
  );
  it("removes prerequisite navigation while the issue has unsaved changes", async () => {
    const user = userEvent.setup();
    renderEditor();
    const readiness = en.App.Projects.Newsletter.Issues.Readiness;
    expect(
      screen.getByRole("link", { name: readiness.senderSettings }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Subject"), " changed");
    expect(
      screen.queryByRole("link", { name: readiness.senderSettings }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(en.App.Projects.Newsletter.Issues.Lifecycle.saveFirst),
    ).toBeInTheDocument();
  });

  it("duplicates a block right after itself", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Duplicate block 2" }));
    const items = within(
      screen.getByRole("list", { name: "Content blocks" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(items[2]).getByLabelText("Text")).toHaveValue(
      "Our latest update",
    );
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          values: expect.objectContaining({
            content: [
              NEWSLETTER_ISSUE.content[0],
              NEWSLETTER_ISSUE.content[1],
              NEWSLETTER_ISSUE.content[1],
              NEWSLETTER_ISSUE.content[2],
            ],
          }),
        }),
      ),
    );
  });

  it("adds the studio blocks with fields to fill in and saves them", async () => {
    const user = userEvent.setup();
    renderEditor({ ...NEWSLETTER_ISSUE, content: [] });
    const library = screen.getByRole("region", { name: "Add block" });
    for (const type of ["Columns", "Social links", "Spacer", "Footer"]) {
      await user.click(within(library).getByRole("button", { name: type }));
    }
    expect(screen.getByRole("group", { name: "Column 1" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove column 1" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add column" }));
    expect(screen.getByRole("group", { name: "Column 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove column 3" }));
    const [left, right] = screen.getAllByRole("group", { name: /Column/ });
    await user.type(within(left).getByLabelText("Text"), "Left");
    await user.type(within(right).getByLabelText("Text"), "Right");
    await user.type(screen.getByLabelText("Link 1 URL"), "https://example.com");
    await user.type(screen.getByLabelText("Closing text"), "Bye");
    await user.type(screen.getByLabelText("Subject"), "!");
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          values: expect.objectContaining({
            content: [
              {
                type: "columns",
                columns: [{ text: "Left" }, { text: "Right" }],
              },
              {
                type: "social",
                links: [{ network: "website", url: "https://example.com" }],
              },
              { type: "spacer", size: "md" },
              { type: "footer", text: "Bye" },
            ],
          }),
        }),
      ),
    );
  });

  it("edits the design in its own tab, previews it live and blocks sending until saved", async () => {
    mocks.saveSettings.mockImplementation(async ({ values }) => ({
      ok: true,
      value: { ...NEWSLETTER, ...values },
    }));
    const user = userEvent.setup();
    renderEditor();
    expect(mocks.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        brand: expect.objectContaining({
          fontFamily: "Georgia",
          spacing: "roomy",
        }),
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Design" }));
    const design = screen.getByRole("form", { name: "Newsletter design" });
    expect(
      screen.queryByRole("region", { name: "Issue details" }),
    ).not.toBeInTheDocument();
    await user.type(within(design).getByLabelText("Footer text"), "See you");
    expect(mocks.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        brand: expect.objectContaining({ footerText: "See you" }),
      }),
    );
    expect(screen.getByText("Unsaved design changes")).toBeInTheDocument();
    expect(
      screen.getByText(
        en.App.Projects.Newsletter.Issues.Studio.saveDesignFirst,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit for approval" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save design" }));
    await waitFor(() =>
      expect(mocks.saveSettings).toHaveBeenCalledWith({
        projectId: NEWSLETTER_PROJECT_ID,
        values: expect.objectContaining({
          name: NEWSLETTER.name,
          senderName: NEWSLETTER.senderName,
          replyTo: NEWSLETTER.replyTo,
          fontFamily: "Georgia",
          footerText: "See you",
          spacing: "roomy",
        }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Unsaved design changes"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Submit for approval" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "Content" }));
    expect(
      screen.getByRole("region", { name: "Issue details" }),
    ).toBeInTheDocument();
  });

  it("keeps an unsaved design when the save fails", async () => {
    mocks.saveSettings.mockResolvedValue({
      ok: false,
      error: { message: en.App.Projects.Newsletter.error },
    });
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("tab", { name: "Design" }));
    await user.type(screen.getByLabelText("Footer text"), "Draft");
    await user.click(screen.getByRole("button", { name: "Save design" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.App.Projects.Newsletter.error,
    );
    expect(screen.getByLabelText("Footer text")).toHaveValue("Draft");
    expect(screen.getByText("Unsaved design changes")).toBeInTheDocument();
  });

  it("sizes and aligns an image block", async () => {
    const user = userEvent.setup();
    renderEditor({
      ...NEWSLETTER_ISSUE,
      content: [{ type: "image", url: "https://example.com/a.png", alt: "A" }],
    });
    expect(screen.getByRole("button", { name: "Replace image" })).toBeEnabled();
    for (const [field, option] of [
      ["Width", "Half"],
      ["Alignment", "Right"],
    ]) {
      fireEvent.click(screen.getByRole("combobox", { name: field }));
      fireEvent.click(await screen.findByRole("option", { name: option }));
    }
    await user.click(screen.getByRole("button", { name: "Save issue" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          values: expect.objectContaining({
            content: [
              {
                type: "image",
                url: "https://example.com/a.png",
                alt: "A",
                width: 50,
                align: "right",
              },
            ],
          }),
        }),
      ),
    );
  });
});
