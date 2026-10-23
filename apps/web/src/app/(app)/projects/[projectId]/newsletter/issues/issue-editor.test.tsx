import type { NewsletterIssue } from "@sokosumi/core-client";
import {
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
  NEWSLETTER_ISSUE,
  NEWSLETTER_PROJECT_ID,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  change: vi.fn(),
  refresh: vi.fn(),
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
vi.mock("./issue-preview", () => ({
  NewsletterIssuePreview: () => <aside>Preview</aside>,
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
        newsletterSlug={PUBLIC_NEWSLETTER_SLUG}
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
    let items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(within(items[0]).getByLabelText("Text")).toHaveValue(
      "Our latest update",
    );
    await user.click(screen.getByRole("button", { name: "Move block 1 down" }));
    await user.click(screen.getByRole("button", { name: "Remove block 3" }));
    for (const type of ["Heading", "Text", "Image", "Button", "Divider"]) {
      await user.click(screen.getByRole("button", { name: "Add block" }));
      await user.click(await screen.findByRole("menuitem", { name: type }));
    }
    items = within(screen.getByRole("list")).getAllByRole("listitem");
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
    expect(screen.getByRole("note")).toHaveTextContent(
      en.App.Projects.Newsletter.Issues.readOnly,
    );
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Heading level" }),
    ).toHaveAttribute("disabled");
    expect(
      screen.queryByRole("button", { name: "Save issue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add block" }),
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
});
