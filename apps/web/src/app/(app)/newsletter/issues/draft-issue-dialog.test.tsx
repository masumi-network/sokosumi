import type { ProjectImageAsset } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const m = vi.hoisted(() => ({
  draft: vi.fn(),
  images: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock("@/lib/actions/newsletter/draft", () => ({
  draftNewsletterIssue: m.draft,
  getNewsletterDraftImages: m.images,
}));

import { DraftIssueButton } from "./draft-issue-dialog";

const COPY = en.App.Projects.Newsletter.Issues;
const IMAGE: ProjectImageAsset = {
  id: "66666666-6666-4666-8666-666666666666",
  projectId: NEWSLETTER_PROJECT_ID,
  projectName: "Launch",
  rootId: NEWSLETTER_ISSUE.id,
  parentId: null,
  version: 1,
  prompt: "Autumn launch",
  model: "test",
  width: 256,
  height: 256,
  bytes: 1000,
  contentType: "image/png",
  mediaType: "IMAGE",
  video: null,
  createdAt: new Date(),
  jobId: NEWSLETTER_ISSUE.id,
  settings: {},
  contentPath: "/v1/image",
};
function renderButton(locale: "en" | "de" | "es" = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={{ en, de, es }[locale]}>
      <DraftIssueButton projectId={NEWSLETTER_PROJECT_ID} />
    </NextIntlClientProvider>,
  );
}
async function openDialog() {
  renderButton();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: COPY.Ai.action }));
  return user;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.draft.mockResolvedValue({ ok: true, value: NEWSLETTER_ISSUE });
  m.images.mockResolvedValue({ ok: true, value: [IMAGE] });
});

describe("Write it for me", () => {
  it.each(["de", "es"] as const)(
    "keeps AI copy in key parity with real %s translations",
    (locale) => {
      const translated = { de, es }[locale].App.Projects.Newsletter.Issues.Ai;
      expect(Object.keys(translated).sort()).toEqual(
        Object.keys(COPY.Ai).sort(),
      );
      for (const key of Object.keys(COPY.Ai) as (keyof typeof COPY.Ai)[]) {
        expect(translated[key].trim()).not.toBe("");
        expect(translated[key]).not.toBe(COPY.Ai[key]);
      }
    },
  );
  it("requires a brief and focuses the invalid field without calling Core", async () => {
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: COPY.Ai.generate }));
    expect(await screen.findByText(COPY.Ai.invalid)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: COPY.Ai.brief })).toHaveFocus();
    expect(m.draft).not.toHaveBeenCalled();
    expect(m.images).not.toHaveBeenCalled();
  });

  it("uses source choices, selected images and template, then opens the draft editor with a review notice", async () => {
    const user = await openDialog();
    await user.type(
      screen.getByRole("textbox", { name: COPY.Ai.brief }),
      "Write our launch update",
    );
    await user.click(
      screen.getByRole("checkbox", { name: COPY.Ai.useRecentSocialPosts }),
    );
    await user.click(screen.getByRole("combobox", { name: COPY.Ai.template }));
    await user.click(
      screen.getByRole("option", { name: COPY.Templates.IMAGES.title }),
    );
    await user.click(screen.getByRole("button", { name: COPY.Ai.pickImages }));
    expect(m.images).toHaveBeenCalledWith({ projectId: NEWSLETTER_PROJECT_ID });
    await user.click(
      await screen.findByRole("checkbox", { name: IMAGE.prompt }),
    );
    await user.click(screen.getByRole("button", { name: COPY.Ai.generate }));
    await waitFor(() =>
      expect(m.push).toHaveBeenCalledWith(
        `/newsletter/issues/${NEWSLETTER_ISSUE.id}?projectId=${NEWSLETTER_PROJECT_ID}&draftedBySokoBot=true`,
      ),
    );
    expect(m.draft).toHaveBeenCalledExactlyOnceWith({
      projectId: NEWSLETTER_PROJECT_ID,
      values: {
        brief: "Write our launch update",
        useProjectMemory: true,
        useRecentSocialPosts: false,
        template: "IMAGES",
        imageIds: [IMAGE.id],
      },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("holds a loading state, blocks duplicate requests and keeps the dialog open during generation", async () => {
    let resolveDraft: (value: {
      ok: true;
      value: typeof NEWSLETTER_ISSUE;
    }) => void = () => {};
    m.draft.mockReturnValue(
      new Promise((resolve) => {
        resolveDraft = resolve;
      }),
    );
    const user = await openDialog();
    await user.type(
      screen.getByRole("textbox", { name: COPY.Ai.brief }),
      "Launch",
    );
    const generate = screen.getByRole("button", { name: COPY.Ai.generate });
    await user.click(generate);
    expect(generate).toHaveAttribute("aria-busy", "true");
    expect(generate).toHaveAttribute("aria-disabled", "true");
    await user.click(generate);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(m.draft).toHaveBeenCalledTimes(1);
    resolveDraft({ ok: true, value: NEWSLETTER_ISSUE });
    await waitFor(() => expect(m.push).toHaveBeenCalled());
  });

  it("preserves the brief on errors and allows retry", async () => {
    m.draft.mockResolvedValueOnce({
      ok: false,
      error: { message: COPY.Ai.rateLimited },
    });
    const user = await openDialog();
    await user.type(
      screen.getByRole("textbox", { name: COPY.Ai.brief }),
      "Launch",
    );
    await user.click(screen.getByRole("button", { name: COPY.Ai.generate }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      COPY.Ai.rateLimited,
    );
    expect(screen.getByRole("textbox", { name: COPY.Ai.brief })).toHaveValue(
      "Launch",
    );
    expect(m.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: COPY.Ai.generate }));
    await waitFor(() => expect(m.push).toHaveBeenCalled());
  });

  it("shows a recoverable image error, then an empty state", async () => {
    m.images.mockRejectedValueOnce(new Error("Network"));
    m.images.mockResolvedValueOnce({ ok: true, value: [] });
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: COPY.Ai.pickImages }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      COPY.Ai.imagesError,
    );
    await user.click(screen.getByRole("button", { name: COPY.Ai.pickImages }));
    expect(await screen.findByText(COPY.Ai.noImages)).toBeInTheDocument();
  });

  it.each(["en", "de", "es"] as const)(
    "renders translated controls in %s and restores focus on cancel",
    async (locale) => {
      const user = userEvent.setup();
      renderButton(locale);
      const copy = { en, de, es }[locale].App.Projects.Newsletter.Issues.Ai;
      const trigger = screen.getByRole("button", { name: copy.action });
      await user.click(trigger);
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("textbox", { name: copy.brief }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("checkbox", { name: copy.useProjectMemory }),
      ).toBeChecked();
      await user.click(
        within(dialog).getByRole("button", { name: copy.cancel }),
      );
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(m.draft).not.toHaveBeenCalled();
    },
  );
});
